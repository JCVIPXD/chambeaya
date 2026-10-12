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
import {
  ContractRecordsRetainedError,
  removeCompanyJobRecords,
  removeWorkerJobRecords,
} from "../jobs/jobs.retention.js";
import { CHECK_IN_LATE_LIMIT_MS, resolveAssignmentLifecycle } from "../operations/shift-state.js";
import { withSerializableRetry } from "../operations/serializable-retry.js";

/**
 * El libro mayor de moneda virtual es inmutable (trigger append-only), así que
 * un titular con movimientos no se puede borrar sin destruir la auditoría.
 * Decisión financiera (CN-20261001-035): se bloquea con 409 y no se borra nada
 * (ni filas ni archivos). Una cuenta sin movimientos no tiene historial que
 * conservar y se elimina junto con el titular.
 */
const LEDGER_RETAINED = "CURRENCY_LEDGER_RETAINED";

class LedgerRetainedError extends Error {
  constructor() {
    super(LEDGER_RETAINED);
  }
}

/**
 * El titular ya no existe cuando la transacción de borrado lo busca bajo bloqueo: otro
 * borrado simultáneo del mismo titular ganó (BAJO-A de CN-20261007-046). Responde 404,
 * igual que si el borrado llegara después, y no deja ningún efecto.
 */
class DeleteTargetGoneError extends Error {
  constructor(public readonly code: "WORKER_NOT_FOUND" | "COMPANY_NOT_FOUND") {
    super(code);
  }
}

/**
 * Orden de bloqueo del borrado de una cuenta (BAJO-A de CN-20261007-046): PRIMERO la fila de
 * `User` (`FOR UPDATE`), después cuenta de moneda, postulaciones y borrado. Bloquear al
 * usuario primero serializa los borrados simultáneos del mismo titular y espera a que
 * terminen las acciones del titular que ya tienen su fila referenciada (una FK toma
 * `KEY SHARE`). Aun así algunas acciones toman sus bloqueos en otro orden (primero la
 * postulación y luego el usuario por una FK), así que el borrado corre en `Serializable`
 * con reintento: PostgreSQL aborta a uno de los dos (40P01/40001), el reintento lee el estado
 * nuevo (cuenta borrada = 404, acción terminada = borra) y ninguno responde 500.
 */
/** Borra al usuario ya bloqueado; si otra transacción lo borró igual (P2025) responde 404, nunca 500. */
async function deleteLockedUser(tx: Prisma.TransactionClient, userId: string, gone: DeleteTargetGoneError["code"]) {
  try {
    await tx.user.delete({ where: { id: userId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw new DeleteTargetGoneError(gone);
    throw error;
  }
}

const DELETE_TX = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 } as const;

/**
 * El bono de bienvenida por sí solo no retiene el borrado (CN-20261007-045,
 * MEDIO-2 de CN-20261007-044). Con la cuenta ya bloqueada (`FOR UPDATE`, así un
 * movimiento concurrente termina antes y se ve aquí), cualquier movimiento que
 * no sea el `WELCOME_BONUS` mantiene el 409. Si el bono es lo único, se declara
 * el permiso estrecho del trigger del libro (`set_config` local a la
 * transacción, solo para ESTA cuenta) y se borra ese movimiento; la cuenta y el
 * titular se borran después en la misma transacción. Un movimiento que se cuele
 * entre el conteo y el borrado lo rechaza el trigger (que vuelve a comprobarlo)
 * o la FK `RESTRICT` de la cuenta (23001), y ambos llegan como 409.
 */
async function releaseWelcomeOnlyLedger(tx: Prisma.TransactionClient, accountId: string | null) {
  if (!accountId) return;
  const others = await tx.currencyMovement.count({
    where: { accountId, NOT: { action: "REWARD", actionKey: "WELCOME_BONUS" } },
  });
  if (others > 0) throw new LedgerRetainedError();
  await tx.$executeRaw`SELECT set_config('chambeaya.welcome_bonus_delete_account', ${accountId}, true)`;
  await tx.currencyMovement.deleteMany({ where: { accountId, action: "REWARD", actionKey: "WELCOME_BONUS" } });
}

/**
 * Una FK `RESTRICT` rechaza el borrado con SQLSTATE 23001 (`restrict_violation`),
 * que Prisma no traduce a `P2003`: llega como error desconocido con el código
 * y el nombre de la restricción en el mensaje (BAJO-4 de CN-20261001-036). Se
 * reconoce también el `P2003` que producen las FK `NO ACTION`.
 */
function isRestrictViolation(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2003";
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /23001|restrict_violation|violates RESTRICT setting/i.test(error.message);
  }
  return false;
}

function isCurrencyForeignKeyViolation(error: unknown) {
  if (!isRestrictViolation(error)) return false;
  const detail =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? JSON.stringify(error.meta ?? {})
      : (error as Error).message;
  return detail.includes("Currency");
}

/**
 * La constancia de una oferta aceptada (y su postulación, puesto y empresa) se
 * conserva igual que el libro: borrar al titular se bloquea con 409 y no se borra
 * nada. Cubre también el 23001 de las FK `RESTRICT` de puestos y postulaciones
 * (p. ej. una aceptación que llega entre la comprobación y el borrado).
 */
const CONTRACT_RETAINED = "CONTRACT_RECORDS_RETAINED";

function isJobForeignKeyViolation(error: unknown) {
  if (!isRestrictViolation(error)) return false;
  const detail =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? JSON.stringify(error.meta ?? {})
      : (error as Error).message;
  return detail.includes("Job");
}

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

// Corrección de ALTO-1 de CN-20260926-020: `from`/`to` son fechas de
// CALENDARIO de Lima ("AAAA-MM-DD"), nunca un instante UTC. La versión
// anterior aceptaba cualquier ISO-8601 y `z.coerce.date()` interpretaba
// "AAAA-MM-DD" como medianoche UTC (05:00 de Lima), así que el `to` de un
// mes completo excluía todo lo ocurrido entre las 19:00 del penúltimo día y
// las 19:00 del último día hora Lima: comisión que nunca se facturaba.
// Ahora solo se acepta el formato estricto "AAAA-MM-DD" (400 INVALID_INPUT
// para cualquier otra cosa, incluida una hora completa: eliminar la
// ambigüedad es más seguro que adivinarla) y se convierte con una única
// función (`limaDayStartUtc`), nunca restando 5 horas a mano en varios
// sitios.
// BAJO-1 de CN-20260926-022: la sola forma "AAAA-MM-DD" no basta. El regex
// admite "2026-02-30" (Prisma/`Date` lo corría en silencio al 02/03: 200 con
// el día equivocado) y "2026-13-01" (mes fuera de rango: `new Date(...)`
// devuelve `Invalid Date`, que Prisma no acepta -antes respondía `500`, no
// `400`). `isRealCalendarDate` reconstruye la fecha en UTC y compara año, mes
// y día contra lo recibido: cualquier desborde (mes >12, día que no existe
// en ese mes, incluidos los bisiestos) deja de coincidir y se rechaza.
function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
const dayOnly = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "INVALID_DATE_FORMAT")
  .refine(isRealCalendarDate, "INVALID_CALENDAR_DATE");
const commissionsQuerySchema = z.object({
  from: dayOnly.optional(),
  to: dayOnly.optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "INVALID_RANGE", path: ["to"] });

// Perú no observa horario de verano: `-05:00` es válido para cualquier
// fecha, todo el año. Pasar el desfase explícito en el string ISO (en vez de
// restar `5 * 60 * 60 * 1000` a mano) delega el cálculo al parser de `Date`,
// que ya sabe manejar los saltos de mes y de año.
const LIMA_UTC_OFFSET = "-05:00";
/** El instante UTC de la medianoche de Lima de ese día (límite inicial, inclusivo). */
function limaDayStartUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000${LIMA_UTC_OFFSET}`);
}
/** El instante UTC de la medianoche de Lima del día SIGUIENTE (límite final, exclusivo: `lt`, nunca `lte`). */
function limaNextDayStartUtc(day: string): Date {
  return new Date(limaDayStartUtc(day).getTime() + 24 * 60 * 60 * 1000);
}

// Proveedores que hoy pueden aparecer en `Payment.provider`. `'manual'` es
// el único que genera comisión "por facturar" (el modo sin pasarela vigente
// en producción); `'legacy'` (CRUD retirado o backfill sin `assignmentId`)
// nunca tuvo comisión y queda fuera de los tres totales. Cualquier otro
// valor es una pasarela del Alcance E (todavía ninguna contratada): hoy la
// consulta de abajo nunca encuentra filas para "cobrada"/"por cobrar", pero
// la estructura ya queda lista para cuando exista una.
const GATEWAY_PROVIDER_FILTER = { notIn: ["manual", "legacy"] as string[] };

export function createAdminRouter(
  authService: AuthService = new DatabaseAuthService(),
  prisma = new PrismaClient(),
  documents = new PrivateDocumentStorage(),
  options: {
    /** Se invoca tras crear la cuenta de una empresa (bono de bienvenida, M4); un fallo no deshace la alta. */
    onCompanyCreated?: (ownerId: string) => Promise<void>;
  } = {},
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
      if (error instanceof DeleteTargetGoneError) {
        response.status(404).json({ error: error.code });
        return;
      }
      if (
        error instanceof LedgerRetainedError ||
        isCurrencyForeignKeyViolation(error) ||
        (error instanceof Error && error.message.includes("CURRENCY_MOVEMENT_APPEND_ONLY"))
      ) {
        response.status(409).json({ error: LEDGER_RETAINED });
        return;
      }
      if (error instanceof ContractRecordsRetainedError || isJobForeignKeyViolation(error)) {
        response.status(409).json({ error: CONTRACT_RETAINED });
        return;
      }
      if (isRestrictViolation(error)) {
        response.status(409).json({ error: "RELATED_RECORDS_EXIST" });
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
      await options.onCompanyCreated?.(user.owner.id).catch((error: unknown) => {
        // La alta ya está confirmada; el bono se puede regularizar con la ruta de administración.
        console.error("WELCOME_BONUS_FAILED", error);
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
        select: { id: true, ownerId: true },
      });
      if (!company) {
        response.status(404).json({ error: "COMPANY_NOT_FOUND" });
        return;
      }
      if (company.ownerId === adminId) {
        response.status(400).json({ error: "SELF_DELETE_NOT_ALLOWED" });
        return;
      }
      let jobFiles: string[] = [];
      await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        // Primero el usuario dueño (ver DELETE_TX): un borrado simultáneo de la misma empresa
        // espera aquí y, al despertar, ya no la encuentra.
        const owner = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${company.ownerId} FOR UPDATE`;
        if (owner.length === 0 || !(await tx.company.findUnique({ where: { id: company.id }, select: { id: true } }))) throw new DeleteTargetGoneError("COMPANY_NOT_FOUND");
        // Bloquea la cuenta antes de contar: un ajuste que ya la tenga bloqueada
        // termina primero y su movimiento se ve en el conteo (BAJO-4).
        const accountIds = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CurrencyAccount" WHERE "companyId" = ${company.id} FOR UPDATE`;
        await releaseWelcomeOnlyLedger(tx, accountIds[0]?.id ?? null);
        jobFiles = await removeCompanyJobRecords(tx, company.id);
        await tx.currencyAccount.deleteMany({ where: { companyId: company.id } });
        await deleteLockedUser(tx, company.ownerId, "COMPANY_NOT_FOUND");
      }, DELETE_TX));
      for (const storageKey of jobFiles) {
        try {
          await documents.remove(storageKey);
        } catch (error) {
          console.error("ORPHAN_JOB_DOCUMENT_FILE", storageKey, error);
        }
      }
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
      // Primero la base (en transacción) y después los archivos: si el borrado
      // se rechaza (libro mayor retenido) no se pierde ningún archivo. Si el
      // almacenamiento falla tras confirmar, solo quedan archivos huérfanos
      // sin fila que los referencie, que es el fallo recuperable.
      let jobFiles: string[] = [];
      await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        // Primero el usuario (ver DELETE_TX): un borrado simultáneo del mismo trabajador espera
        // aquí y, al despertar, ya no lo encuentra (404, no 500).
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${request.params.id} AND "role" = 'WORKER' FOR UPDATE`;
        if (locked.length === 0) throw new DeleteTargetGoneError("WORKER_NOT_FOUND");
        const accountIds = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CurrencyAccount" WHERE "workerId" = ${request.params.id} FOR UPDATE`;
        await releaseWelcomeOnlyLedger(tx, accountIds[0]?.id ?? null);
        jobFiles = await removeWorkerJobRecords(tx, request.params.id);
        await tx.currencyAccount.deleteMany({ where: { workerId: request.params.id } });
        await deleteLockedUser(tx, request.params.id, "WORKER_NOT_FOUND");
      }, DELETE_TX));
      for (const storageKey of jobFiles) {
        try {
          await documents.remove(storageKey);
        } catch (error) {
          console.error("ORPHAN_JOB_DOCUMENT_FILE", storageKey, error);
        }
      }
      for (const document of workerDocuments) {
        try {
          await documents.remove(document.storageKey);
        } catch (error) {
          console.error("ORPHAN_WORKER_DOCUMENT_FILE", document.storageKey, error);
        }
      }
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

  // Alcance D: cuánto le debe facturar Chambeaya a cada empresa (modo
  // manual, sin pasarela contratada todavía) y cuánto ya cobró/tiene por
  // cobrar vía pasarela (Alcance E; hoy siempre 0, ver
  // `GATEWAY_PROVIDER_FILTER`). Filtra por `Payment.createdAt` -nunca por
  // `processedAt`-: "por facturar" debe incluir la comisión de un pago
  // `manual` que la empresa TODAVÍA no marcó pagado (`processedAt` sigue
  // `null`), porque en modo manual Chambeaya no cobra nada por la app y de
  // todas formas le corresponde facturar esa comisión; filtrar por
  // `processedAt` los excluiría del período por completo.
  router.get("/commissions", (request, response) =>
    guard(request, response, async () => {
      const query = commissionsQuerySchema.parse({ from: request.query.from, to: request.query.to });
      // Ventana en instantes UTC, pero calculada a partir de fechas de
      // calendario de LIMA (corrección de ALTO-1 de CN-20260926-020): `gte`
      // inclusivo desde la medianoche de Lima de `from`, `lt` EXCLUSIVO
      // desde la medianoche de Lima del día siguiente a `to` (nunca `lte`,
      // que redondearía hacia abajo y perdería las últimas horas de ese
      // día). Se aplica igual a `Payment.createdAt` y a
      // `ShiftAssignment.closedWithoutPaymentAt`: ambos son el mismo tipo de
      // corte de período.
      const fromUtc = query.from ? limaDayStartUtc(query.from) : undefined;
      const toUtcExclusive = query.to ? limaNextDayStartUtc(query.to) : undefined;
      const periodFilter = (fromUtc || toUtcExclusive)
        ? { ...(fromUtc ? { gte: fromUtc } : {}), ...(toUtcExclusive ? { lt: toUtcExclusive } : {}) }
        : undefined;

      const [toInvoice, collected, pendingCollection, closedWithoutPaymentRows, pendingResolutionRows, companies] = await Promise.all([
        prisma.payment.groupBy({
          by: ["companyId"],
          where: { provider: "manual", status: { not: "CANCELLED" }, ...(periodFilter ? { createdAt: periodFilter } : {}) },
          _sum: { commissionCents: true, taxCents: true },
          _count: { _all: true },
        }),
        prisma.payment.groupBy({
          by: ["companyId"],
          where: { provider: GATEWAY_PROVIDER_FILTER, status: "PROCESSED", ...(periodFilter ? { createdAt: periodFilter } : {}) },
          _sum: { commissionCents: true, taxCents: true },
          _count: { _all: true },
        }),
        prisma.payment.groupBy({
          by: ["companyId"],
          where: { provider: GATEWAY_PROVIDER_FILTER, status: { in: ["PENDING", "SCHEDULED"] }, ...(periodFilter ? { createdAt: periodFilter } : {}) },
          _sum: { commissionCents: true, taxCents: true },
          _count: { _all: true },
        }),
        // Señal estructurada (corrección de MEDIO-1 de CN-20260926-020, ver
        // `business.service.ts`): nunca depende de `ShiftEvent.detail`. Sin
        // columna `companyId` directa en `ShiftAssignment`, se agrega en JS
        // a partir de `shift.companyId` (mismo patrón que ya usaba la
        // versión anterior con `ShiftEvent`).
        prisma.shiftAssignment.findMany({
          where: { closedWithoutPayment: true, ...(periodFilter ? { closedWithoutPaymentAt: periodFilter } : {}) },
          select: { shift: { select: { companyId: true } } },
        }),
        // "Pendientes de decisión": `NO_SHOW`/`ABANDONED` que la empresa
        // TODAVÍA no resolvió. Nunca se filtra por período -es un estado
        // actual, no un evento con fecha propia-, precisamente para que
        // dejarlas sin resolver no las saque del reporte sin importar qué
        // rango se consulte.
        //
        // Corrección de MEDIO-1 (nuevo) de CN-20260926-022: no basta con leer
        // el estado PERSISTIDO. `NO_SHOW`/`ABANDONED` son perezosos (los
        // calcula `resolveAssignmentLifecycle` la próxima vez que algo toca
        // esa asignación puntual -check-in, check-out, o abrir el turno en
        // el panel-, nunca un job de fondo), así que una asignación que ya
        // venció su ventana pero que nadie volvió a tocar sigue `ASSIGNED`
        // en la base. Este reporte NUNCA escribe (es una ruta de lectura,
        // sin abrir ninguna transacción por turno: escribir aquí sería caro
        // -una transacción Serializable por cada turno con candidatos- y
        // competiría por las mismas filas que `resolveAssignment`/
        // `cancelShift`); en vez de eso, trae también las `ASSIGNED` y
        // aplica la MISMA función pura (`resolveAssignmentLifecycle`, sin
        // persistir nada) para decidir su estado efectivo.
        //
        // Prefiltro de rendimiento: ninguna asignación puede volverse
        // `NO_SHOW`/`ABANDONED` antes de que pasen `CHECK_IN_LATE_LIMIT_MS`
        // (60 min) desde que su turno empezó (`checkInWindowViolation` nunca
        // cierra la ventana antes de eso, y `ABANDONED` exige además que
        // pase `endsAt`, siempre después de `startsAt`). Filtrar por
        // `shift.startsAt <= ahora - 60min` a nivel de base evita traer
        // todas las asignaciones `ASSIGNED` de turnos futuros o recién
        // empezados, que nunca podrían calificar.
        prisma.shiftAssignment.findMany({
          where: {
            OR: [
              { status: { in: ["NO_SHOW", "ABANDONED"] } },
              { status: "ASSIGNED", shift: { startsAt: { lte: new Date(Date.now() - CHECK_IN_LATE_LIMIT_MS) } } },
            ],
          },
          select: {
            status: true, assignedAt: true, checkedInAt: true, checkedOutAt: true,
            shift: { select: { companyId: true, startsAt: true, endsAt: true } },
          },
        }),
        prisma.company.findMany({ select: { id: true, name: true, ruc: true } }),
      ]);

      const countByCompany = (rows: { shift: { companyId: string } | null }[]) => {
        const map = new Map<string, number>();
        for (const row of rows) {
          const companyId = row.shift?.companyId;
          if (!companyId) continue;
          map.set(companyId, (map.get(companyId) ?? 0) + 1);
        }
        return map;
      };
      const closedWithoutPaymentByCompany = countByCompany(closedWithoutPaymentRows);
      const now = new Date();
      const effectivelyPending = pendingResolutionRows.filter((row) => {
        if (!row.shift) return false;
        const lifecycle = resolveAssignmentLifecycle(row, row.shift, now);
        return lifecycle.status === "NO_SHOW" || lifecycle.status === "ABANDONED";
      });
      const pendingResolutionByCompany = countByCompany(effectivelyPending);

      type Row = {
        companyId: string;
        _sum: { commissionCents: number | null; taxCents: number | null };
        _count: { _all: number };
      };
      const byCompany = <T extends Row>(rows: T[]) => new Map(rows.map((row) => [row.companyId, row]));
      const toInvoiceByCompany = byCompany(toInvoice as unknown as Row[]);
      const collectedByCompany = byCompany(collected as unknown as Row[]);
      const pendingByCompany = byCompany(pendingCollection as unknown as Row[]);

      // `pendingResolution` se incluye SIEMPRE, sin importar el período
      // consultado: es justamente la métrica que evita que una empresa se
      // esconda del reporte con solo dejar asignaciones sin resolver.
      const relevantCompanyIds = new Set<string>([
        ...toInvoiceByCompany.keys(),
        ...collectedByCompany.keys(),
        ...pendingByCompany.keys(),
        ...closedWithoutPaymentByCompany.keys(),
        ...pendingResolutionByCompany.keys(),
      ]);

      const companyRows = companies
        .filter((company) => relevantCompanyIds.has(company.id))
        .map((company) => {
          const invoice = toInvoiceByCompany.get(company.id);
          const gatewayCollected = collectedByCompany.get(company.id);
          const gatewayPending = pendingByCompany.get(company.id);
          return {
            companyId: company.id,
            name: company.name,
            ruc: company.ruc,
            toInvoiceCents: invoice?._sum.commissionCents ?? 0,
            toInvoiceTaxCents: invoice?._sum.taxCents ?? 0,
            collectedCents: (gatewayCollected?._sum.commissionCents ?? 0) + (gatewayCollected?._sum.taxCents ?? 0),
            pendingCollectionCents: (gatewayPending?._sum.commissionCents ?? 0) + (gatewayPending?._sum.taxCents ?? 0),
            payments: (invoice?._count._all ?? 0) + (gatewayCollected?._count._all ?? 0) + (gatewayPending?._count._all ?? 0),
            closedWithoutPayment: closedWithoutPaymentByCompany.get(company.id) ?? 0,
            pendingResolution: pendingResolutionByCompany.get(company.id) ?? 0,
          };
        })
        .sort((a, b) => b.toInvoiceCents - a.toInvoiceCents);

      const totals = companyRows.reduce(
        (acc, row) => ({
          toInvoiceCents: acc.toInvoiceCents + row.toInvoiceCents,
          toInvoiceTaxCents: acc.toInvoiceTaxCents + row.toInvoiceTaxCents,
          collectedCents: acc.collectedCents + row.collectedCents,
          pendingCollectionCents: acc.pendingCollectionCents + row.pendingCollectionCents,
          payments: acc.payments + row.payments,
          pendingResolution: acc.pendingResolution + row.pendingResolution,
        }),
        { toInvoiceCents: 0, toInvoiceTaxCents: 0, collectedCents: 0, pendingCollectionCents: 0, payments: 0, pendingResolution: 0 },
      );

      response.json({
        // Período efectivo tal como se aplicó, sin ambigüedad (corrección de
        // ALTO-1): las fechas de Lima recibidas y los instantes UTC reales
        // usados en la consulta (`toUtcExclusive` es el límite EXCLUSIVO).
        period: {
          from: query.from ?? null,
          to: query.to ?? null,
          fromUtc: fromUtc?.toISOString() ?? null,
          toUtcExclusive: toUtcExclusive?.toISOString() ?? null,
        },
        totals,
        companies: companyRows,
      });
    }),
  );

  return router;
}
