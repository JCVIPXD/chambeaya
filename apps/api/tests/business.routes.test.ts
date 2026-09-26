import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService } from '../src/modules/auth/auth.service.js';
import type { BusinessOperations } from '../src/modules/business/business.service.js';
import { withSerializableRetry } from '../src/modules/business/business.service.js';
import { MarketplaceShiftEvents } from '../src/modules/marketplace/marketplace.events.js';

// Los turnos de prueba deben quedar siempre en el futuro relativo al reloj
// real: una fecha fija (p. ej. '2026-08-23') pasa a estar en el pasado tarde o
// temprano y empieza a chocar con la validación de "el turno no puede
// crearse/guardarse ya vencido" sin que el escenario probado tenga relación
// alguna con esa regla.
const HOUR_MS = 60 * 60 * 1000;
function futureIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * HOUR_MS).toISOString();
}

async function businessContext(
  overrides: Partial<BusinessOperations> = {},
  marketplaceEvents?: MarketplaceShiftEvents,
) {
  const authService = new LocalAuthService();
  const session = await authService.register({
    role: 'BUSINESS',
    name: 'Restaurante Demo',
    email: 'empresa@example.com',
    password: 'ClaveSegura1',
    dniOrRuc: '20123456789',
  });
  const businessService = overrides as BusinessOperations;
  return {
    app: createApp({ authService, businessService, marketplaceEvents }),
    authorization: `Bearer ${session.token}`,
  };
}

describe('business CRUD routes', () => {
  it('retries a serializable transaction conflict and preserves non-conflict errors', async () => {
    let attempts = 0;
    await expect(withSerializableRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw { code: 'P2034' };
      return 'ok';
    })).resolves.toBe('ok');
    expect(attempts).toBe(2);

    await expect(withSerializableRetry(async () => { throw { code: 'P2003' }; })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('requires a valid BUSINESS session', async () => {
    const authService = new LocalAuthService();
    const worker = await authService.register({
      role: 'WORKER', name: 'Ana', email: 'ana@example.com', password: 'ClaveSegura1', dniOrRuc: '12345678',
    });
    const app = createApp({ authService, businessService: {} as BusinessOperations });

    expect((await request(app).get('/api/business/shifts')).status).toBe(401);
    expect((await request(app).get('/api/business/shifts').set('Authorization', `Bearer ${worker.token}`)).status).toBe(403);
  });

  it('creates, updates and deletes shifts with validated input', async () => {
    const createShift = vi.fn(async (_session, input) => ({ id: 'shift-1', ...input }));
    const updateShift = vi.fn(async (_session, id, input) => ({ id, ...input }));
    const deleteShift = vi.fn(async () => undefined);
    const { app, authorization } = await businessContext({ createShift, updateShift, deleteShift });
    const valid = {
      title: 'Mozo de salón', location: 'Miraflores', startsAt: futureIso(48),
      endsAt: futureIso(54), payCents: 10000, requiredWorkers: 2,
      description: 'Apoya al equipo de salón durante el servicio.',
      responsibilities: 'Preparar el salón y atender mesas.',
      requirements: 'Experiencia en atención al cliente.',
      screeningQuestions: ['¿Tienes disponibilidad durante todo el horario indicado?'],
      modality: 'PRESENCIAL',
      expectedCommissionBps: 1000, expectedTaxBps: 1800,
    };

    expect((await request(app).post('/api/business/shifts').set('Authorization', authorization).send(valid)).status).toBe(201);

    // El código de negocio real -no una violación de esquema genérica- debe
    // viajar directo en el campo `error`, para que un cliente (web/Flutter)
    // pueda distinguir "fechas invertidas" de "ya venció" de cualquier otro
    // dato inválido. Ver CN-20260916-099 MEDIO-1.
    const invalidRange = await request(app).post('/api/business/shifts').set('Authorization', authorization).send({ ...valid, endsAt: valid.startsAt });
    expect(invalidRange.status).toBe(400);
    expect(invalidRange.body).toEqual({ error: 'INVALID_DATE_RANGE' });

    const alreadyEnded = await request(app).post('/api/business/shifts').set('Authorization', authorization).send({ ...valid, startsAt: futureIso(-54), endsAt: futureIso(-48) });
    expect(alreadyEnded.status).toBe(400);
    expect(alreadyEnded.body).toEqual({ error: 'SHIFT_ALREADY_ENDED' });

    expect((await request(app).patch('/api/business/shifts/shift-1').set('Authorization', authorization).send({ rescueActive: true })).status).toBe(200);

    const updateEnded = await request(app).patch('/api/business/shifts/shift-1').set('Authorization', authorization).send({ endsAt: futureIso(-1) });
    expect(updateEnded.status).toBe(400);
    expect(updateEnded.body).toEqual({ error: 'SHIFT_ALREADY_ENDED' });

    expect((await request(app).patch('/api/business/shifts/shift-1').set('Authorization', authorization).send({ status: 'COMPLETED' })).status).toBe(400);
    expect((await request(app).delete('/api/business/shifts/shift-1').set('Authorization', authorization)).status).toBe(204);
    expect(createShift).toHaveBeenCalledOnce();
    expect(createShift.mock.calls[0]?.[1].screeningQuestions).toEqual(valid.screeningQuestions);
    expect(updateShift).toHaveBeenCalledOnce();
    expect(deleteShift).toHaveBeenCalledOnce();
  });

  it('limits screening questions to three safe, meaningful prompts', async () => {
    const createShift = vi.fn(async (_session, input) => ({ id: 'shift-screening', ...input }));
    const { app, authorization } = await businessContext({ createShift });
    const base = {
      title: 'Anfitrión de evento', location: 'Barranco', startsAt: futureIso(48),
      endsAt: futureIso(54), payCents: 12000, requiredWorkers: 2,
    };
    const response = await request(app).post('/api/business/shifts').set('Authorization', authorization).send({
      ...base,
      screeningQuestions: ['Pregunta válida número uno', 'Pregunta válida número dos', 'Pregunta válida número tres', 'Pregunta adicional no permitida'],
    });
    expect(response.status).toBe(400);
    expect(createShift).not.toHaveBeenCalled();
  });

  it('rejects low-quality job details when a company sends them', async () => {
    const createShift = vi.fn(async (_session, input) => ({ id: 'shift-quality', ...input }));
    const { app, authorization } = await businessContext({ createShift });
    const response = await request(app).post('/api/business/shifts').set('Authorization', authorization).send({
      title: 'Mozo', location: 'Lima', startsAt: futureIso(48), endsAt: futureIso(54),
      payCents: 10000, requiredWorkers: 1, description: 'corto', responsibilities: 'ok', requirements: 'ok', modality: 'PRESENCIAL',
    });
    expect(response.status).toBe(400);
    expect(createShift).not.toHaveBeenCalled();
  });

  it('notifies the worker marketplace after a company changes its shifts', async () => {
    const createShift = vi.fn(async (_session, input) => ({ id: 'shift-live', ...input }));
    const updateShift = vi.fn(async (_session, id, input) => ({ id, ...input }));
    const deleteShift = vi.fn(async () => undefined);
    const events = new MarketplaceShiftEvents();
    const listener = vi.fn();
    events.subscribe(listener);
    const { app, authorization } = await businessContext(
      { createShift, updateShift, deleteShift },
      events,
    );
    const valid = {
      title: 'Anfitrión de evento', location: 'Barranco', startsAt: futureIso(48),
      endsAt: futureIso(54), payCents: 12000, requiredWorkers: 2,
      expectedCommissionBps: 1000, expectedTaxBps: 1800,
    };

    await request(app).post('/api/business/shifts').set('Authorization', authorization).send(valid);
    await request(app).patch('/api/business/shifts/shift-live').set('Authorization', authorization).send({ rescueActive: true });
    await request(app).delete('/api/business/shifts/shift-live').set('Authorization', authorization);

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('supports worker and company CRUD operations', async () => {
    const updateCompany = vi.fn(async (_session, input) => ({ id: 'company-1', ...input }));
    const createWorker = vi.fn(async (_session, input) => ({ id: 'worker-1', ...input }));
    const updateWorker = vi.fn(async (_session, id, input) => ({ id, ...input }));
    const deleteWorker = vi.fn(async () => undefined);
    const { app, authorization } = await businessContext({ updateCompany, createWorker, updateWorker, deleteWorker });

    expect((await request(app).patch('/api/business/company').set('Authorization', authorization).send({ district: 'Miraflores' })).status).toBe(200);
    expect((await request(app).post('/api/business/workers').set('Authorization', authorization).send({ name: 'Ana Mendoza', role: 'Servicio', skills: ['Eventos'] })).status).toBe(201);
    expect((await request(app).patch('/api/business/workers/worker-1').set('Authorization', authorization).send({ status: 'ON_SHIFT' })).status).toBe(200);
    expect((await request(app).delete('/api/business/workers/worker-1').set('Authorization', authorization)).status).toBe(204);
  });

  it('supports conversations, messages and payment CRUD operations', async () => {
    const createConversation = vi.fn(async (_session, input) => ({ id: 'conversation-1', ...input }));
    const createMessage = vi.fn(async (_session, conversationId, body) => ({ id: 'message-1', conversationId, body }));
    const updateMessage = vi.fn(async (_session, _conversationId, id, input) => ({ id, ...input }));
    const deleteMessage = vi.fn(async () => undefined);
    const createPayment = vi.fn(async (_session, input) => ({ id: 'payment-1', ...input }));
    const updatePayment = vi.fn(async (_session, id, input) => ({ id, ...input }));
    const deletePayment = vi.fn(async () => undefined);
    const { app, authorization } = await businessContext({ createConversation, createMessage, updateMessage, deleteMessage, createPayment, updatePayment, deletePayment });

    expect((await request(app).post('/api/business/conversations').set('Authorization', authorization).send({ workerId: 'worker-1', subject: 'Ingreso al turno' })).status).toBe(201);
    expect((await request(app).post('/api/business/conversations/conversation-1/messages').set('Authorization', authorization).send({ body: 'Preséntate 15 minutos antes.' })).status).toBe(201);
    expect((await request(app).patch('/api/business/conversations/conversation-1/messages/message-1').set('Authorization', authorization).send({ body: 'Preséntate 20 minutos antes.' })).status).toBe(200);
    expect((await request(app).delete('/api/business/conversations/conversation-1/messages/message-1').set('Authorization', authorization)).status).toBe(204);

    const payment = { reference: 'CN-1001', description: 'Turnos validados', amountCents: 38000, workerCount: 4 };
    expect((await request(app).post('/api/business/payments').set('Authorization', authorization).send(payment)).status).toBe(201);
    expect((await request(app).patch('/api/business/payments/payment-1').set('Authorization', authorization).send({ status: 'PROCESSED' })).status).toBe(200);
    expect((await request(app).delete('/api/business/payments/payment-1').set('Authorization', authorization)).status).toBe(204);
  });

  // BAJO-4 de CN-20260926-012: si el panel envía los bps que mostró en la
  // vista previa (`expectedCommissionBps`/`expectedTaxBps`) y ya no
  // coinciden con lo que decide el servicio, la ruta responde 409 con el
  // código y los valores vigentes -para que el panel pueda refrescar su
  // vista previa sin una segunda petición- y nunca llega a crear el turno.
  it('POST /shifts responds 409 COMMISSION_CHANGED with the current bps when expectedCommissionBps/expectedTaxBps are stale', async () => {
    const { CommissionChangedError } = await import('../src/modules/business/business.service.js');
    const createShift = vi.fn(async (_session: unknown, _input: unknown) => { throw new CommissionChangedError(1500, 1800); });
    const { app, authorization } = await businessContext({ createShift });
    const valid = {
      title: 'Mozo de salón', location: 'Miraflores', startsAt: futureIso(48),
      endsAt: futureIso(54), payCents: 10000, requiredWorkers: 2,
      description: 'Apoya al equipo de salón durante el servicio.',
      responsibilities: 'Preparar el salón y atender mesas.',
      requirements: 'Experiencia en atención al cliente.',
      expectedCommissionBps: 1000, expectedTaxBps: 1800,
    };

    const response = await request(app).post('/api/business/shifts').set('Authorization', authorization).send(valid);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'COMMISSION_CHANGED', commissionBps: 1500, taxBps: 1800 });
    expect(createShift).toHaveBeenCalledOnce();
    expect(createShift.mock.calls[0]?.[1]).toMatchObject({ expectedCommissionBps: 1000, expectedTaxBps: 1800 });
  });

  // BAJO-1 de CN-20260926-012: `amountCents` admitía hasta 10^10, por encima
  // del propio `Int` de Postgres (máx. 2.147.483.647), así que un monto
  // grande no respondía `400` en el borde válido: pasaba de la validación de
  // Zod y desbordaba más adelante en la base (`500 INTERNAL_ERROR`). Ahora
  // el tope (S/100.000) responde `400 INVALID_INPUT` con `issues`, y
  // `amount + commission + tax` nunca puede desbordar `Int` ni con el `bps`
  // máximo. `payCents` (creación de turno) tiene el mismo tope.
  it('rejects an amountCents/payCents above the money cap with 400 INVALID_INPUT, never a 500 from an Int overflow downstream', async () => {
    const createPayment = vi.fn(async (_session, input) => ({ id: 'payment-1', ...input }));
    const createShift = vi.fn(async (_session, input) => ({ id: 'shift-1', ...input }));
    const { app, authorization } = await businessContext({ createPayment, createShift });

    const tooLargePayment = await request(app)
      .post('/api/business/payments')
      .set('Authorization', authorization)
      .send({ reference: 'CN-9999', description: 'Monto fuera de rango', amountCents: 100_000_01 });
    expect(tooLargePayment.status).toBe(400);
    expect(tooLargePayment.body.error).toBe('INVALID_INPUT');
    expect(createPayment).not.toHaveBeenCalled();

    const tooLargeShift = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', authorization)
      .send({
        title: 'Turno con pago fuera de rango', location: 'Lima',
        startsAt: futureIso(2), endsAt: futureIso(10),
        payCents: 100_000_01, requiredWorkers: 1,
        description: 'Descripción de longitud suficiente para pasar la validación.',
        requirements: 'Requisito de longitud suficiente.',
      });
    expect(tooLargeShift.status).toBe(400);
    expect(tooLargeShift.body.error).toBe('INVALID_INPUT');
    expect(createShift).not.toHaveBeenCalled();
  });

  it('resolves an abandoned assignment manually with a validated outcome', async () => {
    const resolveAssignment = vi.fn(async (_session, shiftId, assignmentId, outcome, reason) => ({ id: assignmentId, shiftId, status: outcome, reason }));
    const { app, authorization } = await businessContext({ resolveAssignment });

    const missingOutcome = await request(app)
      .post('/api/business/shifts/shift-1/assignments/assignment-1/resolve')
      .set('Authorization', authorization)
      .send({});
    expect(missingOutcome.status).toBe(400);
    expect(resolveAssignment).not.toHaveBeenCalled();

    const response = await request(app)
      .post('/api/business/shifts/shift-1/assignments/assignment-1/resolve')
      .set('Authorization', authorization)
      .send({ outcome: 'COMPLETED', reason: 'El cliente confirmó que sí trabajó' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'assignment-1', shiftId: 'shift-1', status: 'COMPLETED' });
    expect(resolveAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'BUSINESS' }),
      'shift-1',
      'assignment-1',
      'COMPLETED',
      'El cliente confirmó que sí trabajó',
    );
  });

  it('GET /payment-settings returns the current global commission/tax bps in manual mode', async () => {
    const paymentSettings = vi.fn(async () => ({ commissionBps: 1000, taxBps: 1800, currency: 'PEN', mode: 'manual' }));
    const { app, authorization } = await businessContext({ paymentSettings });

    const response = await request(app).get('/api/business/payment-settings').set('Authorization', authorization);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ commissionBps: 1000, taxBps: 1800, currency: 'PEN', mode: 'manual' });
  });
});
