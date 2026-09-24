import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Contención entre trabajadores DISTINTOS (CN-20260923-012, ALTO-1 de la
// auditoría CN-20260923-011). `worker-assignment-concurrency` cubre dos
// llamadas sobre LA MISMA asignación; esta suite cubre la carga real de la
// plataforma: N trabajadores (4 y 10) ejecutan a la vez la MISMA operación
// cada uno sobre su propia asignación, en turnos distintos (un turno por
// trabajador) y en un mismo turno multi-cupo. La operación de un trabajador
// no depende de la de otro, así que TODAS tienen que responder `200`: ni
// `401`/`500` por conflictos de serialización agotados ni resultados
// perdidos. Con el aislamiento `Serializable` y la relectura de
// CN-20260923-010 cada ronda dejaba pasar solo 3 llamadas y el resto recibía
// `401 INVALID_SESSION`.
//
// Además de los códigos HTTP se comprueba el estado final (eventos, pagos,
// `confirmedWorkers`, estado del turno) y que ninguna llamada usara más de
// dos intentos de transacción (a lo sumo un reintento interno).
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
// `CHAMBEAYA_LOAD_ROUNDS` permite ejecutar una medición más larga a mano.
const ROUNDS = Math.max(1, Number(process.env.CHAMBEAYA_LOAD_ROUNDS ?? 3));
const WORKER_COUNTS = [4, 10] as const;
const MAX_WORKERS = Math.max(...WORKER_COUNTS);
const LOAD_TIMEOUT_MS = 300_000;

type AnyFunction = (...args: unknown[]) => unknown;

/** Cliente Prisma que cuenta cuántas transacciones abre el servicio (una por intento). */
function countTransactions(base: PrismaClient) {
  const counter = { transactions: 0 };
  const client = new Proxy(base, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (prop === '$transaction') {
        return (...args: unknown[]) => {
          counter.transactions += 1;
          return (value as AnyFunction).apply(target, args);
        };
      }
      return typeof value === 'function' ? (value as AnyFunction).bind(target) : value;
    },
  }) as PrismaClient;
  return { client, counter };
}

type Worker = { id: string; token: string };
type Slot = { shiftId: string; worker: Worker; assignmentId: string; credential: string };
type Layout = 'distinct-shifts' | 'same-shift';

describe('workers acting at once on their own assignments never starve each other', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const { client: countedPrisma, counter } = countTransactions(prisma);
  // Cada ronda registra trabajadores y se lanzan ráfagas de peticiones: se
  // desactiva el límite de intentos de `/api/auth` (opción de prueba).
  const app = createApp({
    rateLimit: false,
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(countedPrisma),
  });

  let businessToken = '';
  let databaseReady = false;
  let shiftCounter = 0;
  const workers: Worker[] = [];

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;

    const salt = 'worker-load-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.workerload@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de carga de trabajadores',
        identifier: '20999999999',
      },
    });
    const login = await request(app).post('/api/auth/login').send({ email: 'empresa.workerload@chambeaya.test', password: 'Empresa123' });
    expect(login.status).toBe(200);
    businessToken = login.body.token as string;

    for (let index = 1; index <= MAX_WORKERS; index += 1) {
      const email = `trabajador.workerload.${index}@chambeaya.test`;
      const registered = await request(app).post('/api/auth/register').send({
        role: 'WORKER',
        name: `Trabajador de carga ${index}`,
        email,
        password: 'Trabajador123',
        dniOrRuc: `7100${String(index).padStart(4, '0')}`,
      });
      expect(registered.status).toBe(201);
      workers.push({ id: (await verifier.user.findFirstOrThrow({ where: { email } })).id, token: registered.body.token as string });
    }
  }, 60_000);

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  const asWorker = (worker: Worker) => ({ Authorization: `Bearer ${worker.token}` });
  const confirm = (slot: Slot) => request(app).post(`/api/shifts/${slot.shiftId}/confirm`).set(asWorker(slot.worker));
  const checkIn = (slot: Slot) => request(app).post(`/api/shifts/${slot.shiftId}/check-in`).set(asWorker(slot.worker)).send({ credential: slot.credential });
  const checkOut = (slot: Slot) => request(app).post(`/api/shifts/${slot.shiftId}/check-out`).set(asWorker(slot.worker));
  const cancel = (slot: Slot) => request(app).post(`/api/shifts/${slot.shiftId}/cancel`).set(asWorker(slot.worker)).send({ reason: 'Ya no puedo asistir al turno' });

  // Un turno que empieza en 10 minutos (dentro de la ventana de check-in) con
  // `group.length` cupos, todos aceptados; `confirmed`/`checkedIn` llevan cada
  // asignación al punto de partida del escenario usando las rutas reales.
  async function prepareShift(group: Worker[], input: { confirmed: boolean; checkedIn: boolean }): Promise<Slot[]> {
    shiftCounter += 1;
    const now = Date.now();
    const created = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: `Turno de carga ${shiftCounter}`,
        location: 'Miraflores, Lima',
        startsAt: new Date(now + 10 * MINUTE).toISOString(),
        endsAt: new Date(now + 8 * HOUR).toISOString(),
        payCents: 12000,
        requiredWorkers: group.length,
        description: 'Turno de prueba de integración de la carga de trabajadores simultáneos.',
        requirements: 'Disponibilidad completa para el horario indicado.',
      });
    expect(created.status).toBe(201);
    const shiftId = created.body.id as string;

    const slots: Slot[] = [];
    for (const worker of group) {
      const application = await request(app).post(`/api/shifts/${shiftId}/applications`).set(asWorker(worker)).send({ answers: [] });
      expect(application.status).toBe(201);
      const accepted = await request(app)
        .patch(`/api/business/shifts/${shiftId}/applications/${application.body.id as string}`)
        .set('Authorization', `Bearer ${businessToken}`)
        .send({ decision: 'ACCEPTED' });
      expect(accepted.status).toBe(200);
      const assignment = await verifier.shiftAssignment.findFirstOrThrow({ where: { shiftId, workerId: worker.id } });
      slots.push({ shiftId, worker, assignmentId: assignment.id, credential: assignment.checkInCredential as string });
    }
    for (const slot of slots) {
      if (input.confirmed || input.checkedIn) expect((await confirm(slot)).status).toBe(200);
      if (input.checkedIn) expect((await checkIn(slot)).status).toBe(200);
    }
    return slots;
  }

  async function prepare(layout: Layout, count: number, input: { confirmed: boolean; checkedIn: boolean }) {
    const group = workers.slice(0, count);
    if (layout === 'same-shift') return prepareShift(group, input);
    const slots: Slot[] = [];
    for (const worker of group) slots.push(...await prepareShift([worker], input));
    return slots;
  }

  /** Lanza la operación de todos los trabajadores a la vez y exige `200` en cada llamada. */
  async function burst(slots: Slot[], operation: (slot: Slot) => Promise<request.Response>, label: string) {
    counter.transactions = 0;
    const responses = await Promise.all(slots.map((slot) => operation(slot)));
    const transactions = counter.transactions;
    const tally: Record<string, number> = {};
    for (const response of responses) tally[response.status] = (tally[response.status] ?? 0) + 1;
    const context = `${label}: ${JSON.stringify(tally)}`;
    expect(tally, context).toEqual({ 200: slots.length });
    // A lo sumo un reintento interno por llamada (dos intentos de transacción).
    expect(transactions, `${context}, transacciones=${transactions}`).toBeLessThanOrEqual(slots.length * 2);
    return responses;
  }

  const shiftIdsOf = (slots: Slot[]) => [...new Set(slots.map((slot) => slot.shiftId))];
  const eventCount = (shiftIds: string[], type: 'CHECKED_IN' | 'CHECKED_OUT' | 'COMPLETED' | 'ASSIGNMENT_CONFIRMED' | 'CANCELLED') => (
    verifier.shiftEvent.count({ where: { shiftId: { in: shiftIds }, type } })
  );

  for (const count of WORKER_COUNTS) {
    for (const layout of ['distinct-shifts', 'same-shift'] as const) {
      const scenario = `${count} workers, ${layout}`;

      it(`${scenario}: every simultaneous confirmation answers 200 and records one event each`, { timeout: LOAD_TIMEOUT_MS }, async () => {
        for (let round = 1; round <= ROUNDS; round += 1) {
          const slots = await prepare(layout, count, { confirmed: false, checkedIn: false });
          const label = `confirm ${scenario} round ${round}`;
          await burst(slots, confirm, label);

          const assignments = await verifier.shiftAssignment.findMany({ where: { id: { in: slots.map((slot) => slot.assignmentId) } } });
          expect(assignments.filter((assignment) => assignment.workerConfirmedAt !== null), label).toHaveLength(count);
          expect(await eventCount(shiftIdsOf(slots), 'ASSIGNMENT_CONFIRMED'), label).toBe(count);
        }
      });

      it(`${scenario}: every simultaneous check-in answers 200 and records one event each`, { timeout: LOAD_TIMEOUT_MS }, async () => {
        for (let round = 1; round <= ROUNDS; round += 1) {
          const slots = await prepare(layout, count, { confirmed: true, checkedIn: false });
          const label = `check-in ${scenario} round ${round}`;
          await burst(slots, checkIn, label);

          const assignments = await verifier.shiftAssignment.findMany({ where: { id: { in: slots.map((slot) => slot.assignmentId) } } });
          expect(assignments.filter((assignment) => assignment.checkedInAt !== null), label).toHaveLength(count);
          expect(await eventCount(shiftIdsOf(slots), 'CHECKED_IN'), label).toBe(count);
          const shifts = await verifier.shift.findMany({ where: { id: { in: shiftIdsOf(slots) } } });
          expect(shifts.every((shift) => shift.status === 'CHECKED_IN'), label).toBe(true);
        }
      });

      it(`${scenario}: every simultaneous check-out answers 200 with one payment and one completion event per shift`, { timeout: LOAD_TIMEOUT_MS }, async () => {
        for (let round = 1; round <= ROUNDS; round += 1) {
          const slots = await prepare(layout, count, { confirmed: true, checkedIn: true });
          const label = `check-out ${scenario} round ${round}`;
          await burst(slots, checkOut, label);

          const shiftIds = shiftIdsOf(slots);
          const assignments = await verifier.shiftAssignment.findMany({ where: { id: { in: slots.map((slot) => slot.assignmentId) } } });
          expect(assignments.filter((assignment) => assignment.status === 'COMPLETED' && assignment.checkedOutAt !== null), label).toHaveLength(count);
          expect(await eventCount(shiftIds, 'CHECKED_OUT'), label).toBe(count);
          expect(await verifier.payment.count({ where: { shiftId: { in: shiftIds } } }), label).toBe(count);
          // El último check-out de cada turno lo cierra: un solo `COMPLETED` por turno.
          expect(await eventCount(shiftIds, 'COMPLETED'), label).toBe(shiftIds.length);
          const shifts = await verifier.shift.findMany({ where: { id: { in: shiftIds } } });
          expect(shifts.every((shift) => shift.status === 'COMPLETED'), label).toBe(true);
        }
      });

      it(`${scenario}: simultaneous cancellations answer 200 and leave confirmedWorkers correct`, { timeout: LOAD_TIMEOUT_MS }, async () => {
        for (let round = 1; round <= ROUNDS; round += 1) {
          const slots = await prepare(layout, count, { confirmed: true, checkedIn: false });
          const shiftIds = shiftIdsOf(slots);
          // En el turno multi-cupo se conserva la asignación del último
          // trabajador para que `confirmedWorkers` final no sea trivialmente 0.
          const cancelling = layout === 'same-shift' ? slots.slice(0, -1) : slots;
          const label = `cancel ${scenario} round ${round}`;
          expect((await verifier.shift.findMany({ where: { id: { in: shiftIds } } })).every((shift) => shift.confirmedWorkers === (layout === 'same-shift' ? count : 1)), label).toBe(true);
          await burst(cancelling, cancel, label);

          const assignments = await verifier.shiftAssignment.findMany({ where: { shiftId: { in: shiftIds } } });
          expect(assignments.filter((assignment) => assignment.status === 'CANCELLED'), label).toHaveLength(cancelling.length);
          expect(await verifier.shiftCancellation.count({ where: { shiftId: { in: shiftIds } } }), label).toBe(cancelling.length);
          expect(await eventCount(shiftIds, 'CANCELLED'), label).toBe(cancelling.length);
          const shifts = await verifier.shift.findMany({ where: { id: { in: shiftIds } } });
          for (const shift of shifts) {
            const active = assignments.filter((assignment) => assignment.shiftId === shift.id && assignment.status === 'ASSIGNED').length;
            expect(shift.confirmedWorkers, label).toBe(active);
            expect(shift.status, label).toBe('PUBLISHED');
          }
          expect(shifts.reduce((sum, shift) => sum + shift.confirmedWorkers, 0), label).toBe(count - cancelling.length);
        }
      });
    }
  }
});
