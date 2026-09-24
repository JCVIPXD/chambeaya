import http from 'node:http';
import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService, type AuthService } from '../src/modules/auth/auth.service.js';
import { MarketplaceError, type MarketplaceOperations } from '../src/modules/marketplace/marketplace.service.js';

describe('marketplace application routes', () => {
  it('protects worker availability and wallet routes with a worker session', async () => {
    const authService = new LocalAuthService();
    const session = await authService.register({
      role: 'WORKER',
      name: 'Luis Permisos',
      email: 'luis-permisos@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '76543210',
    });
    const business = await authService.register({
      role: 'BUSINESS',
      name: 'Empresa Permisos',
      email: 'empresa-permisos@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '20123456789',
    });
    const updateAvailability = vi.fn(async (workerId: string, isAvailable: boolean) => ({ workerId, isAvailable }));
    const wallet = vi.fn(async (workerId: string) => ({ workerId, balanceCents: 0 }));
    const app = createApp({
      authService,
      marketplaceService: { updateAvailability, wallet } as unknown as MarketplaceOperations,
    });

    expect((await request(app).put('/api/workers/availability').send({ isAvailable: true })).status).toBe(401);
    expect((await request(app).get('/api/workers/wallet')).status).toBe(401);
    expect((await request(app).get('/api/workers/wallet').set('Authorization', `Bearer ${business.token}`)).status).toBe(403);

    const availability = await request(app)
      .put('/api/workers/availability')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ isAvailable: true });
    expect(availability.status).toBe(200);
    expect(updateAvailability).toHaveBeenCalledWith(session.userId, true);

    const walletResponse = await request(app)
      .get('/api/workers/wallet')
      .set('Authorization', `Bearer ${session.token}`);
    expect(walletResponse.status).toBe(200);
    expect(wallet).toHaveBeenCalledWith(session.userId);
  });

  it('keeps availability and wallet identity-scoped between workers', async () => {
    const authService = new LocalAuthService();
    const workerA = await authService.register({ role: 'WORKER', name: 'A', email: 'a-isolation@example.com', password: 'ClaveSegura1', dniOrRuc: '70000001' });
    const workerB = await authService.register({ role: 'WORKER', name: 'B', email: 'b-isolation@example.com', password: 'ClaveSegura1', dniOrRuc: '70000002' });
    const availability = new Map<string, boolean>();
    const updateAvailability = vi.fn(async (workerId: string, isAvailable: boolean) => {
      availability.set(workerId, isAvailable);
      return { workerId, isAvailable };
    });
    const wallet = vi.fn(async (workerId: string) => ({ workerId, balanceCents: workerId === workerA.userId ? 10 : 20 }));
    const app = createApp({ authService, marketplaceService: { updateAvailability, wallet } as unknown as MarketplaceOperations });

    await request(app).put('/api/workers/availability').set('Authorization', `Bearer ${workerA.token}`).send({ isAvailable: false });
    await request(app).put('/api/workers/availability').set('Authorization', `Bearer ${workerB.token}`).send({ isAvailable: true });
    expect(availability.get(workerA.userId)).toBe(false);
    expect(availability.get(workerB.userId)).toBe(true);
    const walletA = await request(app).get('/api/workers/wallet').set('Authorization', `Bearer ${workerA.token}`);
    const walletB = await request(app).get('/api/workers/wallet').set('Authorization', `Bearer ${workerB.token}`);
    expect(walletA.body).toEqual({ workerId: workerA.userId, balanceCents: 10 });
    expect(walletB.body).toEqual({ workerId: workerB.userId, balanceCents: 20 });
  });

  it('passes validated screening answers from an authenticated worker', async () => {
    const authService = new LocalAuthService();
    const session = await authService.register({
      role: 'WORKER',
      name: 'Ana Mendoza',
      email: 'ana-screening@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '87654321',
    });
    const applyToShift = vi.fn(async (_workerId, shiftId, answers) => ({
      id: 'application-1',
      shiftId,
      answers,
    }));
    const app = createApp({
      authService,
      marketplaceService: { applyToShift } as unknown as MarketplaceOperations,
    });
    const payload = {
      answers: [{
        question: '¿Tienes disponibilidad durante todo el horario indicado?',
        answer: 'Sí, durante todo el turno.',
      }],
    };

    const response = await request(app)
      .post('/api/shifts/shift-1/applications')
      .set('Authorization', `Bearer ${session.token}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(applyToShift).toHaveBeenCalledWith(session.userId, 'shift-1', payload.answers);

    const invalid = await request(app)
      .post('/api/shifts/shift-1/applications')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ answers: Array.from({ length: 4 }, (_, index) => ({ question: `Pregunta válida número ${index}`, answer: 'Sí' })) });
    expect(invalid.status).toBe(400);
  });

  it('refreshes the live shift feed on a timer, not only when a business publishes a change', async () => {
    // Antes de este cierre, `/api/shifts/events` solo reemitía una foto nueva
    // cuando `events.publish()` se disparaba desde el panel de la empresa. Un
    // turno que simplemente vencía por el paso del tiempo nunca generaba una
    // reemisión, así que un trabajador con la pantalla de descubrimiento
    // abierta seguía viéndolo como disponible indefinidamente. Esta prueba
    // demuestra que ahora el feed se reemite solo, sin ningún evento externo.
    let snapshot = 0;
    const listAvailableShifts = vi.fn(async () => {
      snapshot += 1;
      return [{ id: `shift-snapshot-${snapshot}` }];
    });
    const app = createApp({
      marketplaceService: { listAvailableShifts } as unknown as MarketplaceOperations,
      marketplaceFeedRefreshIntervalMs: 20,
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    const receivedSnapshots = await new Promise<number>((resolve) => {
      let payload = '';
      let settled = false;
      const clientRequest = http.get({ port, path: '/api/shifts/events' }, (response) => {
        response.on('data', (chunk: Buffer) => {
          payload += chunk.toString('utf8');
          const shiftEvents = payload.split('event: shifts').length - 1;
          if (shiftEvents >= 3 && !settled) {
            settled = true;
            clientRequest.destroy();
            resolve(shiftEvents);
          }
        });
      });
      clientRequest.on('error', () => {
        if (!settled) {
          settled = true;
          resolve(payload.split('event: shifts').length - 1);
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          clientRequest.destroy();
          resolve(payload.split('event: shifts').length - 1);
        }
      }, 1000);
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Ningún `events.publish()` fue llamado en esta prueba: las reemisiones
    // observadas solo pueden venir del refresco periódico por tiempo.
    expect(receivedSnapshots).toBeGreaterThanOrEqual(3);
    expect(listAvailableShifts.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

// Traducción de errores de las rutas del trabajador (CN-20260923-012,
// MEDIO-1 de CN-20260923-011): antes cualquier error que no fuera un
// `MarketplaceError` respondía `401 INVALID_SESSION`, lo que presentaba un
// fallo transitorio del servidor (p. ej. un conflicto de serialización
// agotado) como una sesión inválida.
describe('marketplace worker routes translate errors', () => {
  type WorkerRoute = { name: string; method: 'get' | 'post' | 'put'; path: string; body?: Record<string, unknown>; serviceMethod: keyof MarketplaceOperations };
  const routes: WorkerRoute[] = [
    { name: 'active shift', method: 'get', path: '/api/shifts/active', serviceMethod: 'activeShift' },
    { name: 'applications', method: 'get', path: '/api/workers/applications', serviceMethod: 'listApplications' },
    { name: 'conversations', method: 'get', path: '/api/workers/conversations', serviceMethod: 'listWorkerConversations' },
    { name: 'confirm payment', method: 'post', path: '/api/workers/payments/payment-1/confirm', serviceMethod: 'confirmPayment' },
    { name: 'conversation', method: 'get', path: '/api/workers/conversations/conversation-1', serviceMethod: 'getWorkerConversation' },
    { name: 'send message', method: 'post', path: '/api/workers/conversations/conversation-1/messages', body: { body: 'Hola' }, serviceMethod: 'createWorkerMessage' },
    { name: 'apply', method: 'post', path: '/api/shifts/shift-1/applications', body: { answers: [] }, serviceMethod: 'applyToShift' },
    { name: 'confirm assignment', method: 'post', path: '/api/shifts/shift-1/confirm', serviceMethod: 'confirmAssignment' },
    { name: 'check-in', method: 'post', path: '/api/shifts/shift-1/check-in', body: { credential: 'CUMPLE-ABC123' }, serviceMethod: 'checkIn' },
    { name: 'check-out', method: 'post', path: '/api/shifts/shift-1/check-out', serviceMethod: 'checkOut' },
    { name: 'cancel', method: 'post', path: '/api/shifts/shift-1/cancel', body: { reason: 'Ya no puedo asistir' }, serviceMethod: 'cancelAssignment' },
    { name: 'set availability', method: 'put', path: '/api/workers/availability', body: { isAvailable: true }, serviceMethod: 'updateAvailability' },
    { name: 'availability', method: 'get', path: '/api/workers/availability', serviceMethod: 'workerAvailability' },
    { name: 'wallet', method: 'get', path: '/api/workers/wallet', serviceMethod: 'wallet' },
  ];

  async function workerApp(failure: () => unknown) {
    const authService = new LocalAuthService();
    const worker = await authService.register({ role: 'WORKER', name: 'Ana Errores', email: 'ana-errores@example.com', password: 'ClaveSegura1', dniOrRuc: '70000010' });
    const service: Record<string, unknown> = {};
    for (const route of routes) service[route.serviceMethod] = vi.fn(async () => { throw failure(); });
    const app = createApp({ authService, marketplaceService: service as unknown as MarketplaceOperations });
    const call = (route: WorkerRoute, token = worker.token) => {
      const pending = request(app)[route.method](route.path).set('Authorization', `Bearer ${token}`);
      return route.body ? pending.send(route.body) : pending;
    };
    return { app, call, service };
  }

  it.each(routes)('$name: an exhausted serialization conflict (P2034) answers a retryable 409 CONCURRENT_UPDATE, not a 401', async (route) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = await workerApp(() => Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' }));

    const response = await call(route);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'CONCURRENT_UPDATE' });
    errorLog.mockRestore();
  });

  it.each(routes)('$name: an exhausted deadlock (40P01, both Prisma shapes) also answers a retryable 409 CONCURRENT_UPDATE', async (route) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const shapes = [
      Object.assign(new Error('Raw query failed. Code: `40P01`'), { code: 'P2010', meta: { code: '40P01' } }),
      new Error('Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected" }) })'),
    ];
    for (const shape of shapes) {
      const { call } = await workerApp(() => shape);

      const response = await call(route);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'CONCURRENT_UPDATE' });
    }
    errorLog.mockRestore();
  });

  it.each(routes)('$name: an unexpected server error answers 500 INTERNAL_ERROR, not a 401', async (route) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = await workerApp(() => new Error('connection refused'));

    const response = await call(route);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'INTERNAL_ERROR' });
    // El fallo real queda en el registro del servidor para diagnóstico.
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it.each(routes)('$name: a MarketplaceError keeps its own status and code', async (route) => {
    const { call } = await workerApp(() => new MarketplaceError('ASSIGNMENT_NOT_FOUND', 404));

    const response = await call(route);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'ASSIGNMENT_NOT_FOUND' });
  });

  it.each(routes)('$name: an unknown session still answers 401 INVALID_SESSION and never reaches the service', async (route) => {
    const { call, service } = await workerApp(() => new Error('must not be called'));

    const response = await call(route, 'token-inexistente');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'INVALID_SESSION' });
    expect(service[route.serviceMethod]).not.toHaveBeenCalled();
  });

  it('a session lookup that fails for a reason other than an invalid session answers 500, not 401', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const restore = vi.fn(async () => { throw new Error('database unavailable'); });
    const confirmAssignment = vi.fn();
    const app = createApp({
      authService: { restore } as unknown as AuthService,
      marketplaceService: { confirmAssignment } as unknown as MarketplaceOperations,
    });

    const response = await request(app).post('/api/shifts/shift-1/confirm').set('Authorization', 'Bearer cualquiera');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(confirmAssignment).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('a business session is still refused with 403 on worker routes', async () => {
    const authService = new LocalAuthService();
    const business = await authService.register({ role: 'BUSINESS', name: 'Empresa Errores', email: 'empresa-errores@example.com', password: 'ClaveSegura1', dniOrRuc: '20123456780' });
    const checkIn = vi.fn();
    const app = createApp({ authService, marketplaceService: { checkIn } as unknown as MarketplaceOperations });

    const response = await request(app).post('/api/shifts/shift-1/check-in').set('Authorization', `Bearer ${business.token}`).send({ credential: 'CUMPLE-ABC123' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'SHIFT_UNAVAILABLE' });
    expect(checkIn).not.toHaveBeenCalled();
  });
});
