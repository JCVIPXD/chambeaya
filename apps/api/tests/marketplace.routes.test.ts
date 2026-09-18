import http from 'node:http';
import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService } from '../src/modules/auth/auth.service.js';
import type { MarketplaceOperations } from '../src/modules/marketplace/marketplace.service.js';

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
