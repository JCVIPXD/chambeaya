import { Prisma, PrismaClient } from '@prisma/client';
import express, { Router, type Request, type Response } from 'express';

import { AuthError, DatabaseAuthService, type AuthService } from '../auth/auth.service.js';
import { createRateLimitMiddleware } from '../../middleware/rate_limit.js';
import { InvalidSignatureError } from './webhook-signature.js';
import { buildSimulatedEvent } from './simulated.provider.js';
import { activePaymentProviderName, processProviderEvent, resolvePaymentProvider } from './payments.service.js';

function bearerToken(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function param(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

type BusinessSession = { userId: string; role: string };

async function requireBusinessSession(request: Request, response: Response, authService: AuthService): Promise<BusinessSession | null> {
  try {
    const session = await authService.restore(bearerToken(request.header('authorization')));
    if (session.role !== 'BUSINESS') {
      response.status(403).json({ error: 'BUSINESS_ACCOUNT_REQUIRED' });
      return null;
    }
    return session;
  } catch (error) {
    if (error instanceof AuthError) {
      response.status(401).json({ error: error.code });
      return null;
    }
    response.status(401).json({ error: 'INVALID_SESSION' });
    return null;
  }
}

const DEFAULT_WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_WEBHOOK_RATE_LIMIT_MAX = 60;

function resolveWebhookRateLimitOptions() {
  const windowMs = Number(process.env.PAYMENT_WEBHOOK_RATE_LIMIT_WINDOW_MS ?? DEFAULT_WEBHOOK_RATE_LIMIT_WINDOW_MS);
  const max = Number(process.env.PAYMENT_WEBHOOK_RATE_LIMIT_MAX ?? DEFAULT_WEBHOOK_RATE_LIMIT_MAX);
  return {
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WEBHOOK_RATE_LIMIT_WINDOW_MS,
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_WEBHOOK_RATE_LIMIT_MAX,
    errorCode: 'PAYMENT_WEBHOOK_RATE_LIMITED',
  };
}

/**
 * Router del webhook público (`POST /api/payments/webhooks/:provider`). Debe
 * montarse en `app.ts` ANTES de `express.json()` global, con `express.raw`
 * sobre esta misma ruta: la firma (`webhook-signature.ts`) se calcula sobre
 * el `rawBody` exacto que llegó por la red, y `express.json()` lo consumiría
 * y lo reemplazaría por un objeto ya parseado, perdiendo los bytes exactos.
 * Sin autenticación de sesión (el proveedor no tiene ningún token de
 * Chambeaya): la única defensa es la firma HMAC + `rateLimit`.
 */
export function createPaymentsWebhookRouter(prisma: PrismaClient = new PrismaClient()) {
  const router = Router();
  const rateLimiter = createRateLimitMiddleware(resolveWebhookRateLimitOptions());

  router.post(
    '/webhooks/:provider',
    rateLimiter,
    express.raw({ type: '*/*', limit: '256kb' }),
    async (request: Request, response: Response) => {
      const providerParam = param(request, 'provider');
      let activeName: string;
      try {
        activeName = activePaymentProviderName();
      } catch {
        response.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
        return;
      }
      if (providerParam !== activeName) {
        response.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
        return;
      }
      const provider = resolvePaymentProvider();
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from('');
      let event;
      try {
        event = await provider.verifyWebhook(rawBody, request.headers as Record<string, string | string[] | undefined>);
      } catch (error) {
        if (error instanceof InvalidSignatureError) {
          response.status(401).json({ error: 'INVALID_SIGNATURE' });
          return;
        }
        console.error(error);
        response.status(401).json({ error: 'INVALID_SIGNATURE' });
        return;
      }
      let payload: unknown = null;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        payload = null;
      }
      try {
        const result = await processProviderEvent(prisma, activeName, event, payload);
        if (result.kind === 'attempt_not_found') {
          response.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
          return;
        }
        if (result.kind === 'amount_mismatch') {
          response.status(422).json({ error: 'AMOUNT_MISMATCH' });
          return;
        }
        response.status(200).json({ ok: true });
      } catch (error) {
        console.error(error);
        response.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    },
  );

  return router;
}

/**
 * Router del checkout simulado (`POST /api/payments/simulated/:checkoutId/
 * (approve|reject)`, Alcance E). Se monta DESPUÉS de `express.json()` global
 * (usa sesión BUSINESS por Bearer, como el resto de la API), a diferencia
 * del webhook. Construye y firma un evento con el mismo formato que
 * `POST /api/payments/webhooks/:provider` recibiría y lo procesa con la
 * MISMA función (`processProviderEvent`), pasando primero por
 * `provider.verifyWebhook` (nunca se salta la verificación de firma, aunque
 * la firmemos nosotros mismos en el paso anterior): así el camino de
 * aprobar/rechazar desde el panel ejerce exactamente el mismo código que un
 * proveedor real ejercería.
 */
export function createSimulatedPaymentsRouter(
  authService: AuthService = new DatabaseAuthService(),
  prisma: PrismaClient = new PrismaClient(),
) {
  const router = Router();

  const ownedAttempt = async (checkoutId: string, session: BusinessSession) => {
    const attempt = await prisma.paymentAttempt.findUnique({
      where: { checkoutId },
      include: { payment: { include: { company: true } } },
    });
    return attempt && attempt.payment.company.ownerId === session.userId ? attempt : null;
  };

  router.get('/simulated/:checkoutId', async (request: Request, response: Response) => {
    const session = await requireBusinessSession(request, response, authService);
    if (!session) return;
    let activeName: string;
    try {
      activeName = activePaymentProviderName();
    } catch {
      response.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
      return;
    }
    if (activeName !== 'simulated') {
      response.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
      return;
    }
    try {
      const attempt = await ownedAttempt(param(request, 'checkoutId'), session);
      if (!attempt) {
        response.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
        return;
      }
      response.json({
        checkoutId: attempt.checkoutId,
        status: attempt.status,
        expiresAt: attempt.expiresAt.toISOString(),
        payment: {
          id: attempt.payment.id,
          reference: attempt.payment.reference,
          description: attempt.payment.description,
          totalCents: attempt.payment.totalCents,
          currency: attempt.currency,
          status: attempt.payment.status,
        },
      });
    } catch (error) {
      console.error(error);
      response.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  const handle = (outcome: 'APPROVED' | 'REJECTED') => async (request: Request, response: Response) => {
    const session = await requireBusinessSession(request, response, authService);
    if (!session) return;
    try {
      let activeName: string;
      try {
        activeName = activePaymentProviderName();
      } catch {
        response.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
        return;
      }
      if (activeName !== 'simulated') {
        response.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
        return;
      }
      const checkoutId = param(request, 'checkoutId');
      const attempt = await ownedAttempt(checkoutId, session);
      if (!attempt) {
        response.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
        return;
      }
      const provider = resolvePaymentProvider();
      const { rawBody, headers } = buildSimulatedEvent(checkoutId, outcome, attempt.totalCents, attempt.currency);
      const event = await provider.verifyWebhook(rawBody, headers);
      const payload = JSON.parse(rawBody.toString('utf8'));
      const result = await processProviderEvent(prisma, activeName, event, payload);
      if (result.kind === 'attempt_not_found') {
        response.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
        return;
      }
      if (result.kind === 'amount_mismatch') {
        response.status(422).json({ error: 'AMOUNT_MISMATCH' });
        return;
      }
      response.status(200).json({ ok: true, result: result.kind });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as Prisma.PrismaClientKnownRequestError).code === 'P2025') {
        response.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
        return;
      }
      console.error(error);
      response.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  };

  router.post('/simulated/:checkoutId/approve', handle('APPROVED'));
  router.post('/simulated/:checkoutId/reject', handle('REJECTED'));

  return router;
}
