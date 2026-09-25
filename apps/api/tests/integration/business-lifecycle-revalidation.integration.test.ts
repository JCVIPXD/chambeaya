import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Ciclo de vida de la empresa (`resolveShiftAssignmentsLifecycle`) frente a
// operaciones que cambian la asignación entre su lectura y su escritura
// (BAJO-3 de CN-20260918-002, declarado de nuevo en CN-20260923-015).
//
// Antes la función leía las asignaciones FUERA de su transacción, calculaba
// `NO_SHOW`/`ABANDONED` con esa lectura y escribía sin revalidar (y cada
// reintento reutilizaba la misma lectura obsoleta). Una cancelación del
// trabajador (o de la empresa) confirmada justo entre la lectura y la escritura
// quedaba pisada: la asignación `CANCELLED` volvía a `NO_SHOW` (y por tanto era
// resoluble con pago) y, con el turno cancelado, el turno volvía a `PUBLISHED`.
//
// Determinista: una pausa de un solo uso, colgada de la lectura previa de las
// asignaciones (la del cliente sin transacción), deja obsoleta esa lectura; la
// operación concurrente se hace y termina dentro de la pausa. Con la corrección
// la escritura relee y revalida dentro de su transacción y no cambia nada.
// Solo corre con opt-in explícito y contra una base cuyo nombre termina en
// `_test` (mismo guardia que el resto de `tests/integration`).
const integrationDatabaseUrl = process.env.DATABASE_URL;

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
const WAIT_TIMEOUT_MS = 10_000;

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Cliente Prisma cuya PRIMERA(S) `parties` lectura(s) `shiftAssignment.findMany`
 * (fuera de transacción) devuelve su resultado y espera en la barrera antes de
 * seguir. Las lecturas hechas con el cliente de una transacción (`tx`) no pasan
 * por aquí, así que la relectura de la corrección nunca se pausa.
 */
function pauseAssignmentRead(base: PrismaClient, parties: number) {
  let arrived = 0;
  let release!: () => void;
  let allReached!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { allReached = resolve; });
  const waitReached = () => Promise.race([
    reached,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PAUSE_POINT_NOT_REACHED')), WAIT_TIMEOUT_MS)),
  ]);
  const client = new Proxy(base, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (prop !== 'shiftAssignment') return typeof value === 'function' ? (value as AnyFunction).bind(target) : value;
      return new Proxy(value as object, {
        get(delegate, method) {
          const member = Reflect.get(delegate, method) as unknown;
          if (method !== 'findMany') return typeof member === 'function' ? (member as AnyFunction).bind(delegate) : member;
          return async (...args: unknown[]) => {
            const result = await (member as AnyFunction).apply(delegate, args);
            if (arrived < parties) {
              arrived += 1;
              if (arrived === parties) allReached();
              await released;
            }
            return result;
          };
        },
      });
    },
  }) as PrismaClient;
  return { client, release, waitReached };
}

describe('the company lifecycle revalidates inside its transaction before writing NO_SHOW/ABANDONED', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const plainApp = createApp({
    rateLimit: false,
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
  });

  let businessToken = '';
  let databaseReady = false;
  let counter = 0;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;

    const salt = 'lifecycle-revalidation-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.revalidacion@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de la revalidación',
        identifier: '20888888888',
      },
    });
    const login = await request(plainApp).post('/api/auth/login').send({ email: 'empresa.revalidacion@chambeaya.test', password: 'Empresa123' });
    expect(login.status).toBe(200);
    businessToken = login.body.token as string;
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  /** App de la empresa cuya lectura previa de asignaciones se pausa; el resto usa la app normal. */
  function businessAppWithPause(parties: number) {
    const pause = pauseAssignmentRead(prisma, parties);
    const app = createApp({
      rateLimit: false,
      authService: new DatabaseAuthService(prisma),
      businessService: new DatabaseBusinessService(pause.client),
      marketplaceService: new DatabaseMarketplaceService(prisma),
    });
    return { app, pause };
  }

  // Turno de un cupo con una asignación cuya ventana de check-in ya cerró
  // (`startsAt` hace 3 h, asignada hace 4 h): abrir el turno en el panel la
  // marcaría `NO_SHOW`.
  async function overdueAssignedShift() {
    counter += 1;
    const now = Date.now();
    const created = await request(plainApp)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: `Turno de la revalidación ${counter}`,
        location: 'Miraflores, Lima',
        startsAt: new Date(now - 3 * HOUR).toISOString(),
        endsAt: new Date(now + 5 * HOUR).toISOString(),
        payCents: 12000,
        requiredWorkers: 1,
        description: 'Turno de prueba de integración de la revalidación del ciclo de vida.',
        requirements: 'Disponibilidad completa para el horario indicado.',
      });
    expect(created.status).toBe(201);
    const shiftId = created.body.id as string;

    const worker = await request(plainApp).post('/api/auth/register').send({
      role: 'WORKER',
      name: `Trabajador de la revalidación ${counter}`,
      email: `trabajador.revalidacion.${counter}@chambeaya.test`,
      password: 'Trabajador123',
      dniOrRuc: `7500${String(counter).padStart(4, '0')}`,
    });
    expect(worker.status).toBe(201);
    const token = worker.body.token as string;

    const application = await request(plainApp).post(`/api/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${token}`).send({ answers: [] });
    expect(application.status).toBe(201);
    const accepted = await request(plainApp)
      .patch(`/api/business/shifts/${shiftId}/applications/${application.body.id}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'ACCEPTED' });
    expect(accepted.status).toBe(200);
    const assignment = await verifier.shiftAssignment.findFirstOrThrow({ where: { shiftId } });
    await verifier.shiftAssignment.update({ where: { id: assignment.id }, data: { assignedAt: new Date(now - 4 * HOUR) } });
    return { shiftId, token, assignmentId: assignment.id };
  }

  const openShift = (app: ReturnType<typeof createApp>, shiftId: string) => request(app)
    .get(`/api/business/shifts/${shiftId}`)
    .set('Authorization', `Bearer ${businessToken}`)
    .then((response) => response);

  const systemEvents = (shiftId: string) => verifier.shiftEvent.count({ where: { shiftId, actorRole: 'SYSTEM' } });

  it('sanity: without a concurrent change, opening the shift marks the overdue assignment NO_SHOW once', async () => {
    const setup = await overdueAssignedShift();
    const response = await openShift(plainApp, setup.shiftId);
    expect(response.status).toBe(200);
    expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } })).status).toBe('NO_SHOW');
    expect(await systemEvents(setup.shiftId)).toBe(1);
    // Abrirlo otra vez no escribe nada más.
    expect((await openShift(plainApp, setup.shiftId)).status).toBe(200);
    expect(await systemEvents(setup.shiftId)).toBe(1);
  });

  it('a worker cancellation confirmed between the lifecycle read and its write is not overwritten with NO_SHOW', async () => {
    const setup = await overdueAssignedShift();
    const { app, pause } = businessAppWithPause(1);

    const opening = openShift(app, setup.shiftId);
    await pause.waitReached();
    // La lectura previa de la empresa ya vio `ASSIGNED`; ahora el trabajador cancela y termina.
    const cancel = await request(plainApp)
      .post(`/api/shifts/${setup.shiftId}/cancel`)
      .set('Authorization', `Bearer ${setup.token}`)
      .send({ reason: 'Ya no puedo asistir al turno' });
    expect(cancel.status).toBe(200);
    pause.release();
    const response = await opening;

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } })).status, 'the cancelled assignment must stay CANCELLED').toBe('CANCELLED');
    expect(await systemEvents(setup.shiftId), 'no automatic transition may be recorded for a cancelled assignment').toBe(0);
    const shift = await verifier.shift.findUniqueOrThrow({ where: { id: setup.shiftId } });
    expect(shift.confirmedWorkers).toBe(0);
    expect(response.body).toMatchObject({ id: setup.shiftId, status: shift.status });
    // Consecuencia visible del defecto: un `NO_SHOW` fantasma se podía cerrar con pago.
    const resolved = await request(plainApp)
      .post(`/api/business/shifts/${setup.shiftId}/assignments/${setup.assignmentId}/resolve`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ outcome: 'COMPLETED' });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(400);
    expect(resolved.body).toMatchObject({ error: 'ASSIGNMENT_NOT_RESOLVABLE' });
    expect(await verifier.payment.count({ where: { shiftId: setup.shiftId } })).toBe(0);
  });

  it('a shift cancellation by the company confirmed between the lifecycle read and its write keeps the shift CANCELLED', async () => {
    const setup = await overdueAssignedShift();
    const { app, pause } = businessAppWithPause(1);

    const opening = openShift(app, setup.shiftId);
    await pause.waitReached();
    const cancel = await request(plainApp)
      .post(`/api/business/shifts/${setup.shiftId}/cancel`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ reason: 'La empresa ya no necesita el turno' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    pause.release();
    const response = await opening;

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'CANCELLED' });
    const shift = await verifier.shift.findUniqueOrThrow({ where: { id: setup.shiftId } });
    expect(shift.status, 'a cancelled shift must not be reopened by a stale lifecycle decision').toBe('CANCELLED');
    expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } })).status).toBe('CANCELLED');
    expect(await systemEvents(setup.shiftId)).toBe(0);
  });

  it('two lifecycle resolutions that both read ASSIGNED before either writes record a single NO_SHOW transition', async () => {
    const setup = await overdueAssignedShift();
    const { app, pause } = businessAppWithPause(2);

    const first = openShift(app, setup.shiftId);
    const second = openShift(app, setup.shiftId);
    await pause.waitReached();
    pause.release();
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } })).status).toBe('NO_SHOW');
    expect(await systemEvents(setup.shiftId), 'the second resolution must find the assignment already NO_SHOW').toBe(1);
  });
});
