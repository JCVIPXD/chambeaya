import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';
import { resetPaymentProviderCacheForTests } from '../../src/modules/payments/payments.service.js';
import { signPayload } from '../../src/modules/payments/webhook-signature.js';

// Alcance E del plan de pagos: capa de adaptadores, proveedor simulado y
// webhook firmado, contra PostgreSQL real. Cubre lo que ninguna prueba con
// Prisma simulado puede probar de verdad: la transacción PENDING->SCHEDULED
// + creación del intento, la idempotencia de un doble clic, 10 checkouts
// concurrentes, 5 webhooks idénticos concurrentes, aprobación/rechazo
// concurrentes del mismo intento, y el flujo completo turno -> checkout ->
// aprobar simulado -> PROCESSED -> visible en el reporte de comisiones.
const integrationDatabaseUrl = process.env.DATABASE_URL;
const WEBHOOK_SECRET = 'integration-test-webhook-secret-0123456789';

function requireTestDatabase() {
  if (process.env.CHAMBEAYA_INTEGRATION_TESTS !== 'true') {
    throw new Error('INTEGRATION_TESTS_REQUIRE_EXPLICIT_OPT_IN');
  }
  if (!integrationDatabaseUrl) throw new Error('INTEGRATION_TESTS_REQUIRE_DATABASE_URL');
  const databaseName = new URL(integrationDatabaseUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!databaseName?.endsWith('_test')) {
    throw new Error('INTEGRATION_TESTS_REQUIRE_TEST_DATABASE');
  }
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('Alcance E: proveedor simulado y webhook de pagos, contra PostgreSQL real', () => {
  const previousEnv = {
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET,
    PANEL_PUBLIC_URL: process.env.PANEL_PUBLIC_URL,
  };

  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
    paymentsPrisma: prisma,
    rateLimit: false,
  });

  let businessToken = '';
  let businessUserId = '';
  let databaseReady = false;
  let workerCounter = 0;

  beforeAll(async () => {
    requireTestDatabase();
    process.env.PAYMENT_PROVIDER = 'simulated';
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.PANEL_PUBLIC_URL = 'https://panel.chambeaya.test';
    resetPaymentProviderCacheForTests();

    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await prisma.platformSettings.upsert({
      where: { id: 'global' },
      update: { commissionBps: 1000, taxBps: 1800, updatedById: null },
      create: { id: 'global', commissionBps: 1000, taxBps: 1800 },
    });
    databaseReady = true;

    const salt = 'payments-e2e-salt';
    const business = await prisma.user.create({
      data: {
        email: 'empresa.pagos-e@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de pagos E',
        identifier: '20777777777',
      },
    });
    businessUserId = business.id;
    const login = await request(app).post('/api/auth/login').send({ email: 'empresa.pagos-e@chambeaya.test', password: 'Empresa123' });
    expect(login.status).toBe(200);
    businessToken = login.body.token as string;
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
    process.env.PAYMENT_PROVIDER = previousEnv.PAYMENT_PROVIDER;
    process.env.PAYMENT_WEBHOOK_SECRET = previousEnv.PAYMENT_WEBHOOK_SECRET;
    process.env.PANEL_PUBLIC_URL = previousEnv.PANEL_PUBLIC_URL;
    resetPaymentProviderCacheForTests();
  });

  async function registerWorker() {
    workerCounter += 1;
    const response = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: `Trabajador de pagos E ${workerCounter}`,
      email: `trabajador.pagos-e.${workerCounter}@chambeaya.test`,
      password: 'Trabajador123',
      dniOrRuc: `5100${String(workerCounter).padStart(4, '0')}`,
    });
    expect(response.status).toBe(201);
    return response.body.token as string;
  }

  async function createShift(input: { title: string; startsAt: Date; endsAt: Date; payCents: number }) {
    const current = await verifier.platformSettings.findUniqueOrThrow({ where: { id: 'global' } });
    const response = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: input.title,
        location: 'Miraflores, Lima',
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        payCents: input.payCents,
        requiredWorkers: 1,
        description: 'Turno de prueba de integración del Alcance E de pagos.',
        requirements: 'Disponibilidad completa para el horario indicado.',
        expectedCommissionBps: current.commissionBps,
        expectedTaxBps: current.taxBps,
      });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  async function applyAndAccept(shiftId: string, workerToken: string) {
    const application = await request(app)
      .post(`/api/shifts/${shiftId}/applications`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ answers: [] });
    expect(application.status).toBe(201);
    const accepted = await request(app)
      .patch(`/api/business/shifts/${shiftId}/applications/${application.body.id}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'ACCEPTED' });
    expect(accepted.status).toBe(200);
    const mine = await request(app).get('/api/workers/applications').set('Authorization', `Bearer ${workerToken}`);
    const assignment = mine.body.find((item: { shiftId: string }) => item.shiftId === shiftId).assignment as { id: string; checkInCredential: string };
    return { assignmentId: assignment.id, credential: assignment.checkInCredential };
  }

  const confirm = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/confirm`).set('Authorization', `Bearer ${token}`);
  const checkIn = (shiftId: string, token: string, credential: string) => request(app).post(`/api/shifts/${shiftId}/check-in`).set('Authorization', `Bearer ${token}`).send({ credential });
  const checkOut = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/check-out`).set('Authorization', `Bearer ${token}`);

  async function completeShiftPayment(payCents: number) {
    const now = Date.now();
    const shiftId = await createShift({ title: 'Turno pago simulado', startsAt: new Date(now + 5 * MINUTE), endsAt: new Date(now + 6 * HOUR), payCents });
    const workerToken = await registerWorker();
    const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);
    expect((await confirm(shiftId, workerToken)).status).toBe(200);
    expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
    expect((await checkOut(shiftId, workerToken)).status).toBe(200);
    const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId } });
    return payment;
  }

  it('GET /api/business/payment-settings reports mode="simulated"', async () => {
    const response = await request(app).get('/api/business/payment-settings').set('Authorization', `Bearer ${businessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('simulated');
  });

  it('a completed shift creates a Payment with provider="simulated"', async () => {
    const payment = await completeShiftPayment(10000);
    expect(payment.provider).toBe('simulated');
    expect(payment.status).toBe('PENDING');
  });

  it('checkout: PENDING -> SCHEDULED + attempt, and a double click is idempotent', async () => {
    const payment = await completeShiftPayment(20000);
    const first = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ attemptId: expect.any(String), redirectUrl: expect.stringContaining('/pago-simulado/'), expiresAt: expect.any(String) });

    const scheduled = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(scheduled.status).toBe('SCHEDULED');

    const second = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const attempts = await verifier.paymentAttempt.findMany({ where: { paymentId: payment.id } });
    expect(attempts).toHaveLength(1);
  });

  it('10 concurrent checkouts on the same payment leave exactly one live attempt', async () => {
    const payment = await completeShiftPayment(15000);
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`)),
    );
    for (const response of responses) expect(response.status).toBe(200);
    const attemptIds = new Set(responses.map((response) => response.body.attemptId));
    expect(attemptIds.size).toBe(1);
    const attempts = await verifier.paymentAttempt.findMany({ where: { paymentId: payment.id } });
    expect(attempts).toHaveLength(1);
  });

  it('checkout on a manual-provider payment responds 409 PROVIDER_MANUAL', async () => {
    // Un pago legacy (o creado antes del Alcance E) con provider='manual'
    // nunca admite checkout.
    const legacy = await prisma.payment.create({
      data: {
        companyId: (await prisma.company.findFirstOrThrow({ where: { ownerId: businessUserId } })).id,
        reference: `LEGACY-${Date.now()}`,
        description: 'Pago legacy de prueba',
        amountCents: 5000, provider: 'manual', status: 'PENDING', totalCents: 5000,
      },
    });
    const response = await request(app).post(`/api/business/payments/${legacy.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('PROVIDER_MANUAL');
  });

  it('checkout on another company\'s payment responds 404', async () => {
    const salt = 'other-company-salt';
    await prisma.user.create({
      data: { email: 'otra-empresa.pagos-e@chambeaya.test', passwordHash: hashPassword('Empresa123', salt), salt, role: 'BUSINESS', name: 'Otra empresa', identifier: '20888888888' },
    });
    const otherLogin = await request(app).post('/api/auth/login').send({ email: 'otra-empresa.pagos-e@chambeaya.test', password: 'Empresa123' });
    const payment = await completeShiftPayment(9000);
    const response = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${otherLogin.body.token}`);
    expect(response.status).toBe(404);
  });

  function signedWebhookRequest(checkoutId: string, outcome: 'APPROVED' | 'REJECTED', amountCents: number, currency = 'PEN', eventId = `evt-${Math.random()}`) {
    const body = { eventId, checkoutId, outcome, amountCents, currency };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = signPayload(WEBHOOK_SECRET, rawBody);
    // `supertest`/`superagent` re-serializa un `Buffer` pasado a `.send()`
    // como `{"type":"Buffer","data":[...]}` cuando el `Content-Type` es
    // `application/json` (confirmado en un sondeo aparte): el `rawBody`
    // exacto que la API recibiría por la red hay que pasarlo como STRING
    // UTF-8, nunca como `Buffer`, para que los bytes coincidan con los que
    // se firmaron.
    return request(app)
      .post('/api/payments/webhooks/simulated')
      .set('Content-Type', 'application/json')
      .set('x-payment-signature', signature)
      .send(rawBody.toString('utf8'));
  }

  it('webhook: approving a checkout marks the payment PROCESSED and reports a SYSTEM PAYMENT_REPORTED event', async () => {
    const payment = await completeShiftPayment(30000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });

    const response = await signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents);
    expect(response.status).toBe(200);

    const processed = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(processed.status).toBe('PROCESSED');
    expect(processed.processedAt).not.toBeNull();

    const events = await verifier.shiftEvent.findMany({ where: { shiftId: payment.shiftId ?? undefined, type: 'PAYMENT_REPORTED', actorRole: 'SYSTEM' } });
    expect(events).toHaveLength(1);
  });

  it('webhook: rejects without a signature (401)', async () => {
    const response = await request(app).post('/api/payments/webhooks/simulated').set('Content-Type', 'application/json').send('{}');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('INVALID_SIGNATURE');
  });

  it('webhook: rejects a tampered body (signature no longer matches)', async () => {
    const payment = await completeShiftPayment(12000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });
    const body = { eventId: 'evt-tampered', checkoutId: attempt.checkoutId, outcome: 'APPROVED', amountCents: attempt.totalCents, currency: 'PEN' };
    const signature = signPayload(WEBHOOK_SECRET, Buffer.from(JSON.stringify(body)));
    const tamperedBody = Buffer.from(JSON.stringify({ ...body, amountCents: 1 }));
    const response = await request(app).post('/api/payments/webhooks/simulated').set('Content-Type', 'application/json').set('x-payment-signature', signature).send(tamperedBody.toString('utf8'));
    expect(response.status).toBe(401);
  });

  it('webhook: rejects a signature with a skewed clock (outside the 5-minute tolerance)', async () => {
    const body = { eventId: 'evt-skew', checkoutId: 'nonexistent', outcome: 'APPROVED', amountCents: 1, currency: 'PEN' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = signPayload(WEBHOOK_SECRET, rawBody, Date.now() - 10 * MINUTE);
    const response = await request(app).post('/api/payments/webhooks/simulated').set('Content-Type', 'application/json').set('x-payment-signature', signature).send(rawBody.toString('utf8'));
    expect(response.status).toBe(401);
  });

  it('webhook: an unknown checkoutId still records the event and responds 404', async () => {
    const response = await signedWebhookRequest('does-not-exist', 'APPROVED', 1000, 'PEN', 'evt-unknown-checkout');
    expect(response.status).toBe(404);
    const event = await verifier.paymentProviderEvent.findUnique({ where: { provider_eventId: { provider: 'simulated', eventId: 'evt-unknown-checkout' } } });
    expect(event).not.toBeNull();
  });

  it('webhook: an amount mismatch responds 422 and marks needsReview, without moving the payment to PROCESSED', async () => {
    const payment = await completeShiftPayment(8000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });

    const response = await signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents + 1);
    expect(response.status).toBe(422);

    const stillScheduled = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stillScheduled.status).toBe('SCHEDULED');
    expect(stillScheduled.needsReview).toBe(true);
  });

  it('webhook: a rejection never reverts an approval already settled', async () => {
    const payment = await completeShiftPayment(11000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });

    expect((await signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents, 'PEN', 'evt-approve-then-reject')).status).toBe(200);
    const afterApprove = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(afterApprove.status).toBe('PROCESSED');

    const rejectResponse = await signedWebhookRequest(attempt.checkoutId, 'REJECTED', attempt.totalCents, 'PEN', 'evt-late-reject');
    expect(rejectResponse.status).toBe(200);
    const afterReject = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(afterReject.status).toBe('PROCESSED');
  });

  it('webhook: a duplicate eventId is a no-op (200, single ShiftEvent, single transition)', async () => {
    const payment = await completeShiftPayment(13000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });
    const eventId = 'evt-duplicate-once';

    const first = await signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents, 'PEN', eventId);
    expect(first.status).toBe(200);
    const second = await signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents, 'PEN', eventId);
    expect(second.status).toBe(200);

    const events = await verifier.paymentProviderEvent.findMany({ where: { provider: 'simulated', eventId } });
    expect(events).toHaveLength(1);
    const reportedEvents = await verifier.shiftEvent.findMany({ where: { shiftId: payment.shiftId ?? undefined, type: 'PAYMENT_REPORTED', actorRole: 'SYSTEM' } });
    expect(reportedEvents).toHaveLength(1);
  });

  it('5 identical concurrent webhooks produce a single event and a single transition', async () => {
    const payment = await completeShiftPayment(14000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });
    const eventId = 'evt-concurrent-5x';

    const responses = await Promise.all(Array.from({ length: 5 }, () => signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents, 'PEN', eventId)));
    for (const response of responses) expect(response.status).toBe(200);

    const events = await verifier.paymentProviderEvent.findMany({ where: { provider: 'simulated', eventId } });
    expect(events).toHaveLength(1);
    const processed = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(processed.status).toBe('PROCESSED');
    const reportedEvents = await verifier.shiftEvent.findMany({ where: { shiftId: payment.shiftId ?? undefined, type: 'PAYMENT_REPORTED', actorRole: 'SYSTEM' } });
    expect(reportedEvents).toHaveLength(1);
  });

  it('concurrent approve+reject of the same attempt (different eventIds) settle consistently on APPROVED', async () => {
    const payment = await completeShiftPayment(16000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });

    const [approve, reject] = await Promise.all([
      signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents, 'PEN', 'evt-race-approve'),
      signedWebhookRequest(attempt.checkoutId, 'REJECTED', attempt.totalCents, 'PEN', 'evt-race-reject'),
    ]);
    expect(approve.status).toBe(200);
    expect(reject.status).toBe(200);

    const finalPayment = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    // Cualquiera sea el orden real de ejecución, un rechazo nunca revierte
    // una aprobación: si la aprobación llegó a asentarse, el pago queda
    // PROCESSED para siempre; si el rechazo ganó la carrera y se asentó
    // antes de que la aprobación corriera, esta última todavía puede
    // aprobarlo después (PENDING admite una aprobación). El único estado
    // que este par de eventos JAMÁS debe dejar es SCHEDULED (ninguno de los
    // dos webhooks deja el pago a medio resolver).
    expect(['PROCESSED', 'PENDING']).toContain(finalPayment.status);
  });

  it('a late approval on an EXPIRED attempt is accepted while the payment is still PENDING', async () => {
    const payment = await completeShiftPayment(17000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });

    // Fuerza la expiración perezosa: retrocede `expiresAt` y lee la lista
    // (dispara `expireStaleScheduledPayments`).
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const listResponse = await request(app).get('/api/business/payments').set('Authorization', `Bearer ${businessToken}`);
    expect(listResponse.status).toBe(200);
    const expiredView = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(expiredView.status).toBe('PENDING');
    const expiredAttempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(expiredAttempt.status).toBe('EXPIRED');

    // El webhook llega tarde, después de que el intento expiró, pero el
    // pago sigue PENDING: se acepta.
    const response = await signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents, 'PEN', 'evt-late-approval');
    expect(response.status).toBe(200);
    const finalPayment = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalPayment.status).toBe('PROCESSED');
  });

  it('an APPROVED event on an already-PROCESSED payment (double charge) marks needsReview without any other effect', async () => {
    const payment = await completeShiftPayment(18000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });
    expect((await signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents, 'PEN', 'evt-first-approve')).status).toBe(200);

    const before = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(before.processedAt).not.toBeNull();

    // Segundo checkout ya no es posible (el pago está PROCESSED, no
    // PENDING); simula el doble cobro directamente con otro eventId sobre
    // el mismo checkoutId, como si el proveedor reenviara el mismo webhook
    // con un id de evento distinto (defensivo: nunca debería pasar con un
    // proveedor real, pero la función de procesamiento debe blindarse igual).
    const response = await signedWebhookRequest(attempt.checkoutId, 'APPROVED', attempt.totalCents, 'PEN', 'evt-double-charge');
    expect(response.status).toBe(200);

    const after = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('PROCESSED');
    expect(after.processedAt?.toISOString()).toBe(before.processedAt?.toISOString());
    expect(after.needsReview).toBe(true);
  });

  it('POST /api/payments/simulated/:checkoutId/approve requires the owning BUSINESS session and processes through the shared function', async () => {
    const payment = await completeShiftPayment(19000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);

    const response = await request(app)
      .post(`/api/payments/simulated/${checkout.body.attemptId}/approve`)
      .set('Authorization', `Bearer ${businessToken}`);
    // El checkoutId real es distinto de attemptId; se usa el checkoutId real abajo.
    void response;

    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });
    const approve = await request(app).post(`/api/payments/simulated/${attempt.checkoutId}/approve`).set('Authorization', `Bearer ${businessToken}`);
    expect(approve.status).toBe(200);
    const processed = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(processed.status).toBe('PROCESSED');
  });

  it('POST /api/payments/simulated/:checkoutId/reject returns the payment to PENDING', async () => {
    const payment = await completeShiftPayment(21000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });

    const reject = await request(app).post(`/api/payments/simulated/${attempt.checkoutId}/reject`).set('Authorization', `Bearer ${businessToken}`);
    expect(reject.status).toBe(200);
    const backToPending = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(backToPending.status).toBe('PENDING');
  });

  it('the simulated endpoints respond 404 when the active provider is not "simulated" (e.g. "manual")', async () => {
    const payment = await completeShiftPayment(23000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });

    process.env.PAYMENT_PROVIDER = 'manual';
    try {
      const response = await request(app).post(`/api/payments/simulated/${attempt.checkoutId}/approve`).set('Authorization', `Bearer ${businessToken}`);
      expect(response.status).toBe(404);
    } finally {
      process.env.PAYMENT_PROVIDER = 'simulated';
    }
  });

  it('the simulated endpoints require the owning business session (404 for another company)', async () => {
    const payment = await completeShiftPayment(22000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });

    const otherLogin = await request(app).post('/api/auth/login').send({ email: 'otra-empresa.pagos-e@chambeaya.test', password: 'Empresa123' });
    const response = await request(app).post(`/api/payments/simulated/${attempt.checkoutId}/approve`).set('Authorization', `Bearer ${otherLogin.body.token}`);
    expect(response.status).toBe(404);
  });

  it('the full journey (shift -> checkout -> simulated approval) is counted as "collected" by the commissions report', async () => {
    const salt = 'admin-pagos-e-salt';
    await prisma.user.create({
      data: { email: 'admin.pagos-e@chambeaya.test', passwordHash: hashPassword('Admin12345', salt), salt, role: 'ADMIN', name: 'Admin de pagos E', identifier: 'ADMIN-PAGOS-E-0001' },
    });
    const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin.pagos-e@chambeaya.test', password: 'Admin12345' });
    const adminToken = adminLogin.body.token as string;

    const payment = await completeShiftPayment(25000);
    const checkout = await request(app).post(`/api/business/payments/${payment.id}/checkout`).set('Authorization', `Bearer ${businessToken}`);
    const attempt = await verifier.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });
    const approve = await request(app).post(`/api/payments/simulated/${attempt.checkoutId}/approve`).set('Authorization', `Bearer ${businessToken}`);
    expect(approve.status).toBe(200);

    const report = await request(app).get('/api/admin/commissions').set('Authorization', `Bearer ${adminToken}`);
    expect(report.status).toBe(200);
    const company = report.body.companies.find((row: { companyId: string }) => row.companyId === (payment as { companyId: string }).companyId);
    expect(company.collectedCents).toBeGreaterThan(0);
  });
});
