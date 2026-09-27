import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { ManualPaymentProvider } from './manual.provider.js';
import type { PaymentProvider, VerifiedProviderEvent } from './provider.js';
import { SimulatedPaymentProvider } from './simulated.provider.js';

export const KNOWN_PAYMENT_PROVIDERS = ['manual', 'simulated'] as const;
export type KnownPaymentProviderName = (typeof KNOWN_PAYMENT_PROVIDERS)[number];

const DEFAULT_CHECKOUT_TTL_MINUTES = 30;
const MIN_WEBHOOK_SECRET_LENGTH = 32;

export class UnknownPaymentProviderError extends Error {
  constructor(value: string) {
    super(`PAYMENT_PROVIDER desconocido: "${value}". Valores válidos: ${KNOWN_PAYMENT_PROVIDERS.join(', ')}.`);
  }
}

export class PaymentConfigError extends Error {}

/** Nombre del proveedor activo, tal como viene de `PAYMENT_PROVIDER`
 * (`'manual'` por defecto). No instancia nada; solo valida el nombre.
 * `env` es inyectable para pruebas unitarias sin mutar `process.env`. */
export function activePaymentProviderName(env: NodeJS.ProcessEnv = process.env): KnownPaymentProviderName {
  const raw = (env.PAYMENT_PROVIDER ?? 'manual').trim();
  if (!KNOWN_PAYMENT_PROVIDERS.includes(raw as KnownPaymentProviderName)) {
    throw new UnknownPaymentProviderError(raw);
  }
  return raw as KnownPaymentProviderName;
}

let cachedProvider: PaymentProvider | undefined;
let cachedProviderName: string | undefined;

/**
 * Resuelve el adaptador activo a partir de `PAYMENT_PROVIDER` (`'manual'` por
 * defecto), siguiendo el mismo patrón de selección por variable de entorno
 * que `google_identity.ts#googleSignInEnabled` y
 * `private_document_storage.ts` (leer la variable directamente, sin un
 * registro central de fábricas). Memoiza la instancia por proceso: ninguno
 * de los dos adaptadores de este alcance guarda estado propio, así que
 * memoizar solo evita reconstruir el objeto en cada llamada. Si
 * `PAYMENT_PROVIDER` cambiara en caliente (no soportado: solo se lee al
 * arrancar el proceso), la memoria quedaría desactualizada; ningún código de
 * producción hace eso.
 */
export function resolvePaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const name = activePaymentProviderName(env);
  if (cachedProvider && cachedProviderName === name) return cachedProvider;
  cachedProvider = name === 'simulated' ? new SimulatedPaymentProvider() : new ManualPaymentProvider();
  cachedProviderName = name;
  return cachedProvider;
}

/** Solo para pruebas: limpia la memoización tras cambiar `PAYMENT_PROVIDER`
 * en el mismo proceso. */
export function resetPaymentProviderCacheForTests() {
  cachedProvider = undefined;
  cachedProviderName = undefined;
}

export function paymentCheckoutTtlMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PAYMENT_CHECKOUT_TTL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHECKOUT_TTL_MINUTES;
}

/**
 * Guardas de arranque (Alcance E). Se llaman una sola vez al iniciar el
 * proceso (`server.ts`), ANTES de escuchar en el puerto: un valor de
 * configuración de pagos inválido no debe dejar la API arriba aceptando
 * tráfico con un adaptador a medio configurar.
 *
 * - `PAYMENT_PROVIDER` debe ser uno de los valores conocidos.
 * - Si el proveedor activo no es `manual`, `PAYMENT_WEBHOOK_SECRET` debe
 *   existir y tener al menos 32 caracteres (el HMAC de
 *   `webhook-signature.ts` es tan fuerte como este secreto).
 * - En `NODE_ENV=production`, el proveedor `simulated` exige
 *   `PAYMENT_SIMULATION_ALLOWED=true` explícito: sin esto, un despliegue de
 *   producción con `PAYMENT_PROVIDER=simulated` por error (o heredado de una
 *   copia del `.env` de desarrollo) fallaría en silencio en vez de arrancar
 *   fingiendo cobrar.
 */
export function assertPaymentConfig(env: NodeJS.ProcessEnv = process.env) {
  const raw = (env.PAYMENT_PROVIDER ?? 'manual').trim();
  if (!KNOWN_PAYMENT_PROVIDERS.includes(raw as KnownPaymentProviderName)) {
    throw new PaymentConfigError(new UnknownPaymentProviderError(raw).message);
  }
  const name = raw as KnownPaymentProviderName;
  if (name !== 'manual') {
    const secret = env.PAYMENT_WEBHOOK_SECRET?.trim() ?? '';
    if (secret.length < MIN_WEBHOOK_SECRET_LENGTH) {
      throw new PaymentConfigError(
        `PAYMENT_WEBHOOK_SECRET debe tener al menos ${MIN_WEBHOOK_SECRET_LENGTH} caracteres cuando PAYMENT_PROVIDER="${name}".`,
      );
    }
  }
  if (env.NODE_ENV === 'production' && name === 'simulated' && env.PAYMENT_SIMULATION_ALLOWED !== 'true') {
    throw new PaymentConfigError(
      'PAYMENT_PROVIDER=simulated en producción exige PAYMENT_SIMULATION_ALLOWED=true explícito.',
    );
  }
}

// --- Errores de dominio de checkout ----------------------------------------

export class PaymentNotFoundError extends Error {}
/** El pago existe y es de esta empresa, pero el proveedor activo es
 * `'manual'` (sin checkout) o el pago no coincide con el proveedor activo. */
export class ProviderManualError extends Error {}
/** El pago existe y es de esta empresa, pero no está en condición de iniciar
 * un checkout (no está `PENDING`, o perdió la carrera). */
export class PaymentNotPayableError extends Error {}
/** El proveedor falló al crear el checkout (red, error 5xx, etc.). El intento
 * queda `REJECTED` y el pago vuelve a `PENDING` antes de lanzar este error. */
export class ProviderUnavailableError extends Error {}

export type CheckoutResponse = { attemptId: string; redirectUrl: string; expiresAt: string };

/** Interno: una de varias llamadas concurrentes a `checkoutPayment` perdió la
 * carrera del `updateMany` `PENDING`->`SCHEDULED` (otra ya lo hizo). Nunca
 * sale de este módulo: se atrapa dentro de `checkoutPayment` y se resuelve
 * esperando el intento que la ganadora está creando (`awaitScheduledCheckoutAttempt`). */
class CheckoutRaceLostError extends Error {}

/**
 * Espera (sondeo acotado, sin ningún lock ni `LISTEN/NOTIFY`) a que el
 * intento `CREATED` vigente de un pago `SCHEDULED` tenga su `redirectUrl`
 * ya escrito, y lo devuelve. Cubre dos momentos de la misma carrera: (a) el
 * pago ya estaba `SCHEDULED` cuando esta llamada empezó, o (b) esta llamada
 * perdió el `updateMany` de otra ganadora hace un instante
 * (`CheckoutRaceLostError`). En ambos casos, el intento vigente puede
 * todavía no tener `redirectUrl` (la llamada al proveedor, fuera de la
 * transacción, sigue en curso) — de ahí el sondeo, nunca una sola lectura.
 */
async function awaitScheduledCheckoutAttempt(prisma: PrismaClient, paymentId: string): Promise<CheckoutResponse> {
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const attempt = await prisma.paymentAttempt.findFirst({
      where: { paymentId, status: 'CREATED' },
      orderBy: { createdAt: 'desc' },
    });
    if (attempt?.redirectUrl) {
      return { attemptId: attempt.id, redirectUrl: attempt.redirectUrl, expiresAt: attempt.expiresAt.toISOString() };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Ni siquiera tras el sondeo hay un intento `CREATED` con `redirectUrl`:
  // el proveedor falló (el pago ya debería haber vuelto a `PENDING`) o el
  // estado es inconsistente. No es "pagable" en este instante; quien llama
  // puede reintentar.
  throw new PaymentNotPayableError('PAYMENT_NOT_PAYABLE');
}

/**
 * Expira perezosamente los intentos vencidos de los pagos `SCHEDULED` que
 * cumplan `where` (o de un solo pago, si `where` ya lo identifica). Nunca se
 * ejecuta con un cron: se llama al leer (`listPayments`/`getPayment`) o al
 * reintentar un checkout, tal como pide el plan ("expiración perezosa").
 * Es segura de llamar seguido: si nada venció, no escribe nada.
 */
export async function expireStaleScheduledPayments(
  prisma: PrismaClient,
  where: Prisma.PaymentWhereInput,
): Promise<void> {
  const now = new Date();
  const stale = await prisma.payment.findMany({
    where: { ...where, status: 'SCHEDULED' },
    select: {
      id: true,
      attempts: { where: { status: 'CREATED' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, expiresAt: true } },
    },
  });
  for (const payment of stale) {
    const attempt = payment.attempts[0];
    if (!attempt || attempt.expiresAt >= now) continue;
    await prisma.$transaction([
      prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'EXPIRED' } }),
      prisma.payment.updateMany({ where: { id: payment.id, status: 'SCHEDULED' }, data: { status: 'PENDING' } }),
    ]);
  }
}

/**
 * `POST /api/business/payments/:id/checkout`. Solo aplica a un pago propio de
 * la empresa (`companyId`), `PENDING`, cuyo `provider` es el proveedor activo.
 *
 * Idempotente: si el pago ya está `SCHEDULED` con un intento `CREATED`
 * vigente (no vencido), devuelve exactamente el mismo `{attemptId,
 * redirectUrl, expiresAt}` sin llamar de nuevo al proveedor -un doble clic no
 * crea dos intentos ni dos cargos-.
 */
export async function checkoutPayment(
  prisma: PrismaClient,
  companyId: string,
  paymentId: string,
): Promise<CheckoutResponse> {
  const provider = resolvePaymentProvider();
  await expireStaleScheduledPayments(prisma, { id: paymentId, companyId });

  const payment = await prisma.payment.findFirst({ where: { id: paymentId, companyId } });
  if (!payment) throw new PaymentNotFoundError('PAYMENT_NOT_FOUND');

  if (payment.provider !== provider.name || provider.name === 'manual') {
    throw new ProviderManualError('PROVIDER_MANUAL');
  }

  if (payment.status === 'SCHEDULED') {
    return awaitScheduledCheckoutAttempt(prisma, payment.id);
  }

  if (payment.status !== 'PENDING') {
    throw new PaymentNotPayableError('PAYMENT_NOT_PAYABLE');
  }

  const ttlMinutes = paymentCheckoutTtlMinutes();
  const checkoutId = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  let attempt;
  try {
    attempt = await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: { id: payment.id, companyId, status: 'PENDING' },
        data: { status: 'SCHEDULED' },
      });
      if (updated.count === 0) throw new CheckoutRaceLostError();
      return tx.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          provider: provider.name,
          checkoutId,
          status: 'CREATED',
          totalCents: payment.totalCents,
          currency: 'PEN',
          expiresAt,
        },
      });
    });
  } catch (error) {
    if (error instanceof CheckoutRaceLostError) {
      // 10 checkouts concurrentes (Alcance E): todos leyeron `PENDING`
      // antes de que cualquiera hiciera commit; solo uno gana el
      // `updateMany`. Los perdedores nunca deben responder `409`: el pago ya
      // está `SCHEDULED` (o a punto de estarlo) por obra de otra petición
      // idéntica, así que esperan el mismo intento que esa petición está
      // creando, en vez de fallar solo por haber perdido la carrera.
      return awaitScheduledCheckoutAttempt(prisma, payment.id);
    }
    throw error;
  }

  try {
    const result = await provider.createCheckout(
      { id: attempt.id, checkoutId: attempt.checkoutId, totalCents: attempt.totalCents, currency: attempt.currency, expiresAt: attempt.expiresAt },
      { id: payment.id, companyId: payment.companyId, reference: payment.reference, description: payment.description, totalCents: payment.totalCents },
      { idempotencyKey: attempt.id },
    );
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { redirectUrl: result.redirectUrl } });
    return { attemptId: attempt.id, redirectUrl: result.redirectUrl, expiresAt: attempt.expiresAt.toISOString() };
  } catch (error) {
    await prisma.$transaction([
      prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'REJECTED', failureReason: 'PROVIDER_UNAVAILABLE' } }),
      prisma.payment.updateMany({ where: { id: payment.id, status: 'SCHEDULED' }, data: { status: 'PENDING' } }),
    ]);
    throw new ProviderUnavailableError('PROVIDER_UNAVAILABLE');
  }
}

// --- Procesamiento de eventos (webhook y simulado comparten esta función) --

export type ProcessEventResult =
  | { kind: 'duplicate' }
  | { kind: 'attempt_not_found' }
  | { kind: 'amount_mismatch' }
  | { kind: 'approved' }
  | { kind: 'rejected' }
  | { kind: 'already_processed' }
  | { kind: 'noop' };

/**
 * Aplica un evento YA VERIFICADO (`provider.verifyWebhook`) a la base:
 * inserta `PaymentProviderEvent` (deduplicación por `@@unique([provider,
 * eventId])`) y, si es nuevo, transiciona el intento y el pago. Todo dentro
 * de UNA transacción: `POST /api/payments/webhooks/:provider` y
 * `POST /api/payments/simulated/:checkoutId/(approve|reject)` llaman a esta
 * MISMA función, nunca duplican esta lógica.
 *
 * Reglas (ver el plan, Alcance E):
 * - Duplicado (mismo `provider`+`eventId`): `200` sin ningún efecto.
 * - Intento no encontrado (`checkoutId` desconocido): el evento igual se
 *   registra (para auditoría) pero la transición no se aplica.
 * - Monto o moneda distintos de `attempt.totalCents`/`'PEN'`: `422`,
 *   `Payment.needsReview = true`, el pago NUNCA pasa a `PROCESSED`.
 * - `APPROVED` sobre un pago ya `PROCESSED` (doble cobro): `needsReview`,
 *   sin ningún otro efecto.
 * - `APPROVED` sobre un pago `PENDING`/`SCHEDULED` (incluida una aprobación
 *   tardía de un intento ya `EXPIRED`, mientras el pago siga `PENDING`):
 *   intento `APPROVED`, pago `PROCESSED` + `processedAt`, `ShiftEvent`
 *   `PAYMENT_REPORTED` con actor `SYSTEM` si el pago tiene `shiftId`.
 * - `REJECTED`: intento `REJECTED` con `failureReason`; el pago vuelve a
 *   `PENDING` SOLO si no está ya `PROCESSED` (un rechazo nunca revierte una
 *   aprobación).
 */
export async function processProviderEvent(
  prisma: PrismaClient,
  providerName: string,
  event: VerifiedProviderEvent,
  rawPayload: unknown,
): Promise<ProcessEventResult> {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({
      where: { checkoutId: event.checkoutId },
      include: { payment: true },
    });

    try {
      await tx.paymentProviderEvent.create({
        data: {
          provider: providerName,
          eventId: event.eventId,
          attemptId: attempt?.id ?? null,
          payload: rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { kind: 'duplicate' };
      }
      throw error;
    }

    if (!attempt) return { kind: 'attempt_not_found' };
    const payment = attempt.payment;

    if (event.amountCents !== attempt.totalCents || event.currency !== attempt.currency) {
      await tx.payment.update({ where: { id: payment.id }, data: { needsReview: true } });
      return { kind: 'amount_mismatch' };
    }

    if (event.outcome === 'APPROVED') {
      if (payment.status === 'PROCESSED' || payment.status === 'CANCELLED') {
        // Doble cobro (ya PROCESSED) o una aprobación sobre un pago que ya
        // no debería recibir dinero (CANCELLED): nunca se revierte nada,
        // solo se señala para revisión humana.
        await tx.payment.update({ where: { id: payment.id }, data: { needsReview: true } });
        return { kind: 'already_processed' };
      }
      // PENDING o SCHEDULED, aunque el intento ya esté EXPIRED (aprobación
      // tardía aceptada mientras el pago siga sin resolver): se acepta.
      const processedAt = new Date();
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'APPROVED' } });
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'PROCESSED', processedAt } });
      if (payment.shiftId) {
        await tx.shiftEvent.create({
          data: { shiftId: payment.shiftId, actorId: null, actorRole: 'SYSTEM', type: 'PAYMENT_REPORTED', detail: payment.id },
        });
      }
      return { kind: 'approved' };
    }

    // REJECTED: nunca revierte una aprobación ya asentada.
    if (payment.status === 'PROCESSED') {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'REJECTED', failureReason: 'PROVIDER_REJECTED_AFTER_APPROVAL' } });
      return { kind: 'noop' };
    }
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'REJECTED', failureReason: 'PROVIDER_REJECTED' } });
    await tx.payment.updateMany({ where: { id: payment.id, status: { in: ['SCHEDULED', 'PENDING'] } }, data: { status: 'PENDING' } });
    return { kind: 'rejected' };
  });
}
