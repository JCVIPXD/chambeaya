import { Router, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';

import { AuthError, DatabaseAuthService, type AccountRole, type AuthService } from '../auth/auth.service.js';
import { CurrencyCatalogService } from './currency.catalog.service.js';
import { CurrencyError, CurrencyLedgerService } from './currency.service.js';

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(128).optional(),
});
const adjustmentSchema = z.object({
  quantity: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, 'QUANTITY_MUST_NOT_BE_ZERO'),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'INVALID_IDEMPOTENCY_KEY'),
}).strict();
const catalogPageSchema = pageSchema.extend({ entryId: z.string().trim().min(1).max(128).optional() });
/** Solo se editan monto, estado, cuota y devolución; clave, actor y tipo son
 * fijos. El motivo es obligatorio para que cada cambio quede explicado. */
const catalogPatchSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000).optional(),
  active: z.boolean().optional(),
  freeMonthlyQuota: z.number().int().min(0).max(10_000).optional(),
  refundWindowHours: z.number().int().min(1).max(8_760).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
}).strict().refine(
  (value) => value.amount !== undefined || value.active !== undefined || value.freeMonthlyQuota !== undefined || value.refundWindowHours !== undefined,
  { message: 'NO_CATALOG_FIELD_TO_CHANGE' },
);

function bearerToken(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function routeParam(request: Request, name: string) {
  const value = request.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function sendError(response: Response, error: unknown) {
  if (error instanceof AuthError) {
    response.status(401).json({ error: 'INVALID_SESSION' });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'INVALID_INPUT', issues: error.issues });
    return;
  }
  if (error instanceof CurrencyError) {
    response.status(error.statusCode).json({ error: error.code });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'INTERNAL_ERROR' });
}

function guarded(
  authService: AuthService,
  role: AccountRole,
  handler: (request: Request, response: Response, userId: string) => Promise<void>,
) {
  return async (request: Request, response: Response) => {
    try {
      const session = await authService.restore(bearerToken(request.header('authorization')));
      if (session.role !== role) {
        response.status(403).json({ error: `${role}_ACCOUNT_REQUIRED` });
        return;
      }
      await handler(request, response, session.userId);
    } catch (error) {
      sendError(response, error);
    }
  };
}

/** Saldo y movimientos del propio trabajador. No existe una ruta para leer
 * la cuenta de otra persona ni para transferir/retirar crédito. */
export function createWorkerCurrencyRouter(
  authService: AuthService = new DatabaseAuthService(),
  ledger: CurrencyLedgerService = new CurrencyLedgerService(),
  catalog: CurrencyCatalogService = new CurrencyCatalogService(),
) {
  const router = Router();
  router.get('/workers/currency/catalog', guarded(authService, 'WORKER', async (_request, response, userId) => {
    response.json(await catalog.listForActor('WORKER', userId));
  }));
  router.get('/workers/currency/balance', guarded(authService, 'WORKER', async (_request, response, userId) => {
    response.json(await ledger.balanceForWorker(userId));
  }));
  router.get('/workers/currency/movements', guarded(authService, 'WORKER', async (request, response, userId) => {
    response.json(await ledger.movementsForWorker(userId, pageSchema.parse(request.query)));
  }));
  return router;
}

/** Saldo y movimientos de la empresa dueña de la sesión. */
export function createBusinessCurrencyRouter(
  authService: AuthService = new DatabaseAuthService(),
  ledger: CurrencyLedgerService = new CurrencyLedgerService(),
  catalog: CurrencyCatalogService = new CurrencyCatalogService(),
) {
  const router = Router();
  router.get('/currency/catalog', guarded(authService, 'BUSINESS', async (_request, response, userId) => {
    response.json(await catalog.listForActor('COMPANY', userId));
  }));
  router.get('/currency/balance', guarded(authService, 'BUSINESS', async (_request, response, userId) => {
    response.json(await ledger.balanceForBusiness(userId));
  }));
  router.get('/currency/movements', guarded(authService, 'BUSINESS', async (request, response, userId) => {
    response.json(await ledger.movementsForBusiness(userId, pageSchema.parse(request.query)));
  }));
  return router;
}

/** Ajustes manuales de M1. La razón y la clave de idempotencia son
 * obligatorias para que cada abono o débito sea trazable y reintentable. */
export function createAdminCurrencyRouter(
  authService: AuthService = new DatabaseAuthService(),
  ledger: CurrencyLedgerService = new CurrencyLedgerService(),
  catalog: CurrencyCatalogService = new CurrencyCatalogService(),
) {
  const router = Router();
  router.get('/currency/catalog', guarded(authService, 'ADMIN', async (_request, response) => {
    response.json(await catalog.listForAdmin());
  }));
  router.get('/currency/catalog/changes', guarded(authService, 'ADMIN', async (request, response) => {
    response.json(await catalog.changes(catalogPageSchema.parse(request.query)));
  }));
  router.patch('/currency/catalog/:entryId', guarded(authService, 'ADMIN', async (request, response, adminId) => {
    const { reason, ...patch } = catalogPatchSchema.parse(request.body);
    response.json(await catalog.update(routeParam(request, 'entryId'), patch, reason, adminId));
  }));
  router.post('/currency/workers/:workerId/adjustments', guarded(authService, 'ADMIN', async (request, response, adminId) => {
    const result = await ledger.adjust('WORKER', routeParam(request, 'workerId'), { ...adjustmentSchema.parse(request.body), actorId: adminId });
    response.status(result.idempotent ? 200 : 201).json(result);
  }));
  router.post('/currency/companies/:companyId/adjustments', guarded(authService, 'ADMIN', async (request, response, adminId) => {
    const result = await ledger.adjust('COMPANY', routeParam(request, 'companyId'), { ...adjustmentSchema.parse(request.body), actorId: adminId });
    response.status(result.idempotent ? 200 : 201).json(result);
  }));
  return router;
}
