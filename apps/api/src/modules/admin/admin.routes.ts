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

export function createAdminRouter(
  authService: AuthService = new DatabaseAuthService(),
  prisma = new PrismaClient(),
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
          workerProfiles: {
            select: {
              status: true,
              cumpleScore: true,
              verified: true,
              company: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      response.json(workers);
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

  return router;
}
