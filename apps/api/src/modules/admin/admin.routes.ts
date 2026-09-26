import { Prisma, PrismaClient } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z, ZodError } from "zod";
import {
  AuthError,
  DatabaseAuthService,
  hashPassword,
  type AuthService,
} from "../auth/auth.service.js";
import { PrivateDocumentStorage } from "../talent/private_document_storage.js";

function bearerToken(value: string | undefined) {
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : "";
}
const companyCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(240).nullable().optional(),
  ruc: z.string().regex(/^\d{11}$/),
  email: z.string().email().max(180),
  password: z.string().min(8).regex(/[A-Z]/).regex(/\d/),
  industry: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
  district: z.string().trim().max(120).nullable().optional(),
});
const companyUpdateSchema = companyCreateSchema
  .omit({ email: true, password: true, ruc: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

// `commissionBps` entero entre 0 (0,00%) y 5000 (50,00%): un tope defensivo
// contra un valor absurdo por error de tecleo, sin ser tan bajo que impida un
// ajuste comercial real. `taxBps` es de solo lectura en este alcance (no
// existe ningún endpoint que lo modifique).
const platformSettingsUpdateSchema = z.object({
  commissionBps: z.number().int().min(0).max(5000),
});

export function createAdminRouter(
  authService: AuthService = new DatabaseAuthService(),
  prisma = new PrismaClient(),
  documents = new PrivateDocumentStorage(),
) {
  const router = Router();
  const guard = async (
    request: Request,
    response: Response,
    handler: (userId: string) => Promise<void>,
  ) => {
    try {
      const session = await authService.restore(
        bearerToken(request.header("authorization")),
      );
      if (session.role !== "ADMIN") {
        response.status(403).json({ error: "ADMIN_ACCOUNT_REQUIRED" });
        return;
      }
      await handler(session.userId);
    } catch (error) {
      if (error instanceof AuthError) {
        response.status(401).json({ error: error.code });
        return;
      }
      if (error instanceof ZodError) {
        response
          .status(400)
          .json({ error: "INVALID_INPUT", issues: error.issues });
        return;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        response.status(409).json({ error: "DUPLICATE_RECORD" });
        return;
      }
      console.error(error);
      response.status(500).json({ error: "INTERNAL_ERROR" });
    }
  };

  router.get("/overview", (request, response) =>
    guard(request, response, async () => {
      const [
        companies,
        workers,
        activeShifts,
        openIncidents,
        pendingApplications,
      ] = await Promise.all([
        prisma.company.count(),
        prisma.user.count({ where: { role: "WORKER" } }),
        prisma.shift.count({
          where: { status: { in: ["PUBLISHED", "ASSIGNED", "CHECKED_IN"] } },
        }),
        prisma.shift.count({ where: { rescueActive: true } }),
        prisma.shiftApplication.count({ where: { status: "PENDING" } }),
      ]);
      response.json({
        companies,
        workers,
        activeShifts,
        openIncidents,
        pendingApplications,
      });
    }),
  );

  router.get("/companies", (request, response) =>
    guard(request, response, async () => {
      const companies = await prisma.company.findMany({
        include: {
          owner: { select: { id: true, name: true, email: true } },
          subscription: true,
        },
        orderBy: { createdAt: "desc" },
      });
      response.json(
        companies.map((company) => ({
          id: company.id,
          name: company.name,
          legalName: company.legalName,
          ruc: company.ruc,
          industry: company.industry,
          district: company.district,
          owner: company.owner,
          subscription: company.subscription,
          createdAt: company.createdAt,
        })),
      );
    }),
  );

  router.post("/companies", (request, response) =>
    guard(request, response, async () => {
      const input = companyCreateSchema.parse(request.body);
      const salt = randomBytes(16).toString("hex");
      const user = await prisma.$transaction(async (tx) => {
        const account = await tx.user.create({
          data: {
            email: input.email.trim().toLowerCase(),
            passwordHash: hashPassword(input.password, salt),
            salt,
            role: "BUSINESS",
            name: input.name,
            identifier: input.ruc,
          },
        });
        const company = await tx.company.create({
          data: {
            ownerId: account.id,
            name: input.name,
            legalName: input.legalName ?? null,
            ruc: input.ruc,
            industry: input.industry ?? null,
            phone: input.phone ?? null,
            address: input.address ?? null,
            district: input.district ?? null,
          },
        });
        return {
          id: company.id,
          name: company.name,
          legalName: company.legalName,
          ruc: company.ruc,
          industry: company.industry,
          district: company.district,
          owner: { id: account.id, name: account.name, email: account.email },
          subscription: null,
          createdAt: company.createdAt,
        };
      });
      response.status(201).json(user);
    }),
  );

  router.patch("/companies/:id", (request, response) =>
    guard(request, response, async () => {
      const input = companyUpdateSchema.parse(request.body);
      const company = await prisma.company.findUnique({
        where: { id: request.params.id },
      });
      if (!company) {
        response.status(404).json({ error: "COMPANY_NOT_FOUND" });
        return;
      }
      response.json(
        await prisma.company.update({
          where: { id: company.id },
          data: input,
          include: {
            owner: { select: { id: true, name: true, email: true } },
            subscription: true,
          },
        }),
      );
    }),
  );

  router.delete("/companies/:id", (request, response) =>
    guard(request, response, async (adminId) => {
      const company = await prisma.company.findUnique({
        where: { id: request.params.id },
        select: { ownerId: true },
      });
      if (!company) {
        response.status(404).json({ error: "COMPANY_NOT_FOUND" });
        return;
      }
      if (company.ownerId === adminId) {
        response.status(400).json({ error: "SELF_DELETE_NOT_ALLOWED" });
        return;
      }
      await prisma.user.delete({ where: { id: company.ownerId } });
      response.status(204).send();
    }),
  );

  router.get("/workers", (request, response) =>
    guard(request, response, async () => {
      const workers = await prisma.user.findMany({
        where: { role: "WORKER" },
        select: {
          id: true,
          name: true,
          email: true,
          identifier: true,
          createdAt: true,
          companyWorkerContacts: {
            select: {
              status: true,
              company: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      response.json(workers);
    }),
  );

  router.delete("/workers/:id", (request, response) =>
    guard(request, response, async () => {
      const worker = await prisma.user.findUnique({
        where: { id: request.params.id },
        select: { role: true },
      });
      if (!worker || worker.role !== "WORKER") {
        response.status(404).json({ error: "WORKER_NOT_FOUND" });
        return;
      }
      const workerDocuments = await prisma.workerDocument.findMany({
        where: { userId: request.params.id },
        select: { storageKey: true },
      });
      for (const document of workerDocuments) {
        await documents.remove(document.storageKey);
      }
      await prisma.user.delete({ where: { id: request.params.id } });
      response.status(204).send();
    }),
  );

  router.get("/incidents", (request, response) =>
    guard(request, response, async () => {
      const [rescueShifts, cancelledShifts] = await Promise.all([
        prisma.shift.findMany({
          where: { rescueActive: true },
          include: { company: { select: { name: true } } },
          orderBy: { updatedAt: "desc" },
          take: 50,
        }),
        prisma.shift.findMany({
          where: { status: "CANCELLED" },
          include: { company: { select: { name: true } } },
          orderBy: { updatedAt: "desc" },
          take: 50,
        }),
      ]);
      response.json([
        ...rescueShifts.map((shift) => ({
          id: `rescue-${shift.id}`,
          type: "REEMPLAZO",
          priority: "HIGH",
          status: "OPEN",
          subject: `Cobertura incompleta · ${shift.title}`,
          company: shift.company.name,
          shiftId: shift.id,
          updatedAt: shift.updatedAt,
        })),
        ...cancelledShifts.map((shift) => ({
          id: `cancel-${shift.id}`,
          type: "CANCELACIÓN",
          priority: "MEDIUM",
          status: "CLOSED",
          subject: `Turno cancelado · ${shift.title}`,
          company: shift.company.name,
          shiftId: shift.id,
          updatedAt: shift.updatedAt,
        })),
      ]);
    }),
  );

  router.get("/settings", (request, response) =>
    guard(request, response, async () => {
      const settings = await prisma.platformSettings.findUnique({
        where: { id: "global" },
        include: { updatedBy: { select: { id: true, name: true } } },
      });
      // No debería faltar (la migración la inserta), pero responde con los
      // valores por defecto en vez de romper el panel de administración si
      // alguna vez faltara (misma defensa que `getPlatformSettings`).
      if (!settings) {
        response.json({ commissionBps: 1000, taxBps: 1800, updatedAt: null, updatedBy: null });
        return;
      }
      response.json({
        commissionBps: settings.commissionBps,
        taxBps: settings.taxBps,
        updatedAt: settings.updatedAt,
        updatedBy: settings.updatedBy,
      });
    }),
  );

  router.patch("/settings", (request, response) =>
    guard(request, response, async (adminId) => {
      const input = platformSettingsUpdateSchema.parse(request.body);
      const updated = await prisma.$transaction(async (tx) => {
        // MEDIO-1 de CN-20260926-012: un `upsert` con `update: {}` no toma
        // ningún bloqueo de fila bajo `READ COMMITTED` (el nivel por
        // defecto), así que dos `PATCH` concurrentes leían el mismo
        // `oldValue` y la auditoría quedaba con una cadena rota (8 `PATCH`
        // simultáneos dejaron 6 `oldValue` duplicados, reproducido por
        // auditoría). `INSERT ... ON CONFLICT DO NOTHING` es idempotente y
        // nunca aborta la transacción aunque la fila ya exista (a
        // diferencia de un `INSERT` simple, que sí lo haría); el `SELECT
        // ... FOR UPDATE` que sigue bloquea la fila `global` hasta el
        // commit, así que una segunda transacción que llegue a ese mismo
        // `SELECT` espera y relee el `commissionBps` que la primera ya
        // escribió, nunca el que había antes de las dos.
        await tx.$executeRaw`
          INSERT INTO "PlatformSettings" ("id", "commissionBps", "taxBps", "updatedAt")
          VALUES ('global', 1000, 1800, now())
          ON CONFLICT ("id") DO NOTHING
        `;
        const [locked] = await tx.$queryRaw<{ commissionBps: number }[]>`
          SELECT "commissionBps" FROM "PlatformSettings" WHERE "id" = 'global' FOR UPDATE
        `;
        const oldValue = locked!.commissionBps;
        const next = await tx.platformSettings.update({
          where: { id: "global" },
          data: { commissionBps: input.commissionBps, updatedById: adminId },
          include: { updatedBy: { select: { id: true, name: true } } },
        });
        // Auditoría inmutable del cambio (`PlatformSettingChange`): un cambio
        // que deja el mismo valor todavía se registra, porque el admin
        // confirmó la acción explícitamente (no es un guard de "sin cambios",
        // como `EMPTY_UPDATE` en otros formularios).
        await tx.platformSettingChange.create({
          data: {
            field: "commissionBps",
            oldValue: String(oldValue),
            newValue: String(input.commissionBps),
            changedById: adminId,
          },
        });
        return next;
      });
      response.json({
        commissionBps: updated.commissionBps,
        taxBps: updated.taxBps,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      });
    }),
  );

  return router;
}
