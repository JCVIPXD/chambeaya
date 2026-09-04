import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService } from '../src/modules/auth/auth.service.js';
import type { BusinessOperations } from '../src/modules/business/business.service.js';
import { withSerializableRetry } from '../src/modules/business/business.service.js';
import { MarketplaceShiftEvents } from '../src/modules/marketplace/marketplace.events.js';

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
      title: 'Mozo de salón', location: 'Miraflores', startsAt: '2026-08-23T18:00:00.000Z',
      endsAt: '2026-08-24T00:00:00.000Z', payCents: 10000, requiredWorkers: 2,
      description: 'Apoya al equipo de salón durante el servicio.',
      responsibilities: 'Preparar el salón y atender mesas.',
      requirements: 'Experiencia en atención al cliente.',
      screeningQuestions: ['¿Tienes disponibilidad durante todo el horario indicado?'],
      modality: 'PRESENCIAL',
    };

    expect((await request(app).post('/api/business/shifts').set('Authorization', authorization).send(valid)).status).toBe(201);
    expect((await request(app).post('/api/business/shifts').set('Authorization', authorization).send({ ...valid, endsAt: valid.startsAt })).status).toBe(400);
    expect((await request(app).patch('/api/business/shifts/shift-1').set('Authorization', authorization).send({ rescueActive: true })).status).toBe(200);
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
      title: 'Anfitrión de evento', location: 'Barranco', startsAt: '2026-08-24T18:00:00.000Z',
      endsAt: '2026-08-25T00:00:00.000Z', payCents: 12000, requiredWorkers: 2,
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
      title: 'Mozo', location: 'Lima', startsAt: '2026-08-23T18:00:00.000Z', endsAt: '2026-08-24T00:00:00.000Z',
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
      title: 'Anfitrión de evento', location: 'Barranco', startsAt: '2026-08-24T18:00:00.000Z',
      endsAt: '2026-08-25T00:00:00.000Z', payCents: 12000, requiredWorkers: 2,
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
});
