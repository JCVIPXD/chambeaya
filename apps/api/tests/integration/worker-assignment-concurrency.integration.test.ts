import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Concurrencia real del trabajador sobre su propia asignación (CN-20260923-010,
// mismo patrón que CN-20260923-008/009 aplicó a `resolveAssignment`):
//  - doble check-in y doble check-out simultáneos;
//  - cancelar contra check-in y cancelar contra confirmar.
// El resultado tiene que ser el de alguna ejecución en serie de las dos
// llamadas, con la respuesta que daría una llamada secuencial repetida:
//  - check-in repetido: `200` idempotente con el `checkedInAt` original;
//  - check-out repetido: `404 ASSIGNMENT_NOT_FOUND` (la asignación ya es
//    `COMPLETED`);
//  - cancelar tras un check-in: `409 CANCELLATION_NOT_ALLOWED`;
//  - check-in o confirmar tras cancelar: `404 ASSIGNMENT_NOT_FOUND`.
//
// Cada escenario tiene dos formas:
//  1. Variante DETERMINISTA: un `Proxy` sobre Prisma retiene la lectura de la
//     asignación (o de la postulación dentro de la transacción de cancelar)
//     hasta que la otra operación haya terminado, de modo que la lectura queda
//     obsoleta. Es exactamente lo que ocurre en una carrera real, pero sin
//     depender del reloj. Con el código anterior a este cambio deja un doble
//     efecto siempre.
//  2. Variante REAL: varias rondas con `Promise.all` por HTTP contra turnos
//     distintos. Las carreras no son deterministas; cada ronda comprueba la
//     invariante y, con el código anterior, alguna ronda la rompe.
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
const ROUNDS = 8;
// Las pruebas `real:` repiten `ROUNDS` carreras simultáneas contra la base: la más
// lenta (8 cancelaciones dobles) medida en ~10 s en una máquina en reposo, por
// encima del `testTimeout` global de 20 s de `vitest.integration.config.mts`
// solo con poco margen, así que tienen el suyo (CN-20260923-015 BAJO-1).
const RACE_TIMEOUT_MS = 60_000;
const REACHED_TIMEOUT_MS = 10_000;

type Hook = () => Promise<void>;
type AnyFunction = (...args: unknown[]) => unknown;

/** Punto de pausa de un solo uso: `reached` avisa que la operación llegó, `release` la deja seguir. */
function pausePoint() {
  let release!: () => void;
  let reached!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
  let used = false;
  const hook: Hook = async () => {
    if (used) return;
    used = true;
    reached();
    await released;
  };
  const waitReached = () => Promise.race([
    reachedPromise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PAUSE_POINT_NOT_REACHED')), REACHED_TIMEOUT_MS)),
  ]);
  return { hook, release, waitReached };
}

/** Barrera de `parties` llegadas: las primeras esperan a las demás, las posteriores pasan. */
function barrier(parties: number): Hook {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return async () => {
    arrived += 1;
    if (arrived >= parties) open();
    if (arrived <= parties) await opened;
  };
}

function bound(target: object, prop: string | symbol) {
  const value = Reflect.get(target, prop) as unknown;
  return typeof value === 'function' ? (value as AnyFunction).bind(target) : value;
}

function hookDelegate(delegate: object, method: string, hook?: Hook) {
  return new Proxy(delegate, {
    get(target, prop) {
      if (hook && prop === method) {
        return async (...args: unknown[]) => {
          const result = await (Reflect.get(target, prop) as AnyFunction).apply(target, args);
          await hook();
          return result;
        };
      }
      return bound(target, prop);
    },
  });
}

/**
 * Cliente Prisma con dos ganchos: `assignmentRead` corre tras cada
 * `shiftAssignment.findFirst`, dentro o fuera de una transacción (la lectura
 * previa de `checkIn`/`checkOut`, o la de `confirmAssignment` según dónde la
 * haga cada versión del código), y `afterLock` tras el bloqueo de la fila del
 * turno (`SELECT ... FOR NO KEY UPDATE`, la última sentencia de bloqueo de las
 * operaciones del trabajador que escriben el turno, CN-20260923-012).
 * Cada gancho de un solo uso solo retiene la primera ocurrencia; los
 * reintentos y las relecturas posteriores pasan sin esperar.
 */
function instrumentPrisma(base: PrismaClient, hooks: { assignmentRead?: Hook; afterLock?: Hook }) {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'shiftAssignment') return hookDelegate(target.shiftAssignment, 'findFirst', hooks.assignmentRead);
      if (prop === '$transaction') {
        return (callback: (tx: unknown) => Promise<unknown>, options?: unknown) => (target.$transaction as AnyFunction)(
          (tx: object) => callback(new Proxy(tx, {
            get(txTarget, txProp) {
              if (txProp === 'shiftApplication') return bound(txTarget, txProp);
              if (txProp === '$queryRaw' && hooks.afterLock) {
                const afterLock = hooks.afterLock;
                return async (...args: unknown[]) => {
                  const result = await (Reflect.get(txTarget, txProp) as AnyFunction).apply(txTarget, args);
                  // Solo tras el ÚLTIMO bloqueo (el del turno): en ese punto la
                  // operación ya tiene todas sus filas bloqueadas y aún no leyó.
                  const sql = Array.isArray(args[0]) ? (args[0] as string[]).join('?') : '';
                  if (sql.includes('FROM "Shift" WHERE')) await afterLock();
                  return result;
                };
              }
              if (txProp === 'shiftAssignment') return hookDelegate((txTarget as PrismaClient).shiftAssignment, 'findFirst', hooks.assignmentRead);
              return bound(txTarget, txProp);
            },
          })),
          options,
        );
      }
      return bound(target, prop);
    },
  }) as PrismaClient;
}

describe('a worker acting on their own assignment never produces a double effect under a real concurrent race', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  // Cada ronda registra un trabajador nuevo: se desactiva el límite de
  // intentos de `/api/auth` (opción de prueba de `createApp`) para no chocar
  // con el `429` por volumen de altas.
  const app = createApp({
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

    const salt = 'worker-concurrency-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.workerrace@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de carrera del trabajador',
        identifier: '20888888888',
      },
    });
    const login = await request(app).post('/api/auth/login').send({ email: 'empresa.workerrace@chambeaya.test', password: 'Empresa123' });
    expect(login.status).toBe(200);
    businessToken = login.body.token as string;
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  // Turno de un cupo que empieza en 10 minutos (dentro de la ventana de
  // check-in), con un trabajador aceptado. `confirmed` y `checkedIn` llevan la
  // asignación al punto de partida del escenario usando las rutas reales.
  async function assignedShift(input: { confirmed: boolean; checkedIn: boolean }) {
    counter += 1;
    const now = Date.now();
    const created = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: `Turno de carrera del trabajador ${counter}`,
        location: 'Miraflores, Lima',
        startsAt: new Date(now + 10 * MINUTE).toISOString(),
        endsAt: new Date(now + 8 * HOUR).toISOString(),
        payCents: 12000,
        requiredWorkers: 1,
        description: 'Turno de prueba de integración de la carrera del trabajador.',
        requirements: 'Disponibilidad completa para el horario indicado.',
      });
    expect(created.status).toBe(201);
    const shiftId = created.body.id as string;

    const email = `trabajador.workerrace.${counter}@chambeaya.test`;
    const worker = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: `Trabajador de carrera ${counter}`,
      email,
      password: 'Trabajador123',
      dniOrRuc: `6000${String(counter).padStart(4, '0')}`,
    });
    expect(worker.status).toBe(201);
    const token = worker.body.token as string;
    const workerId = (await verifier.user.findFirstOrThrow({ where: { email } })).id;

    const application = await request(app).post(`/api/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${token}`).send({ answers: [] });
    expect(application.status).toBe(201);
    const accepted = await request(app)
      .patch(`/api/business/shifts/${shiftId}/applications/${application.body.id as string}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'ACCEPTED' });
    expect(accepted.status).toBe(200);
    const assignment = await verifier.shiftAssignment.findFirstOrThrow({ where: { shiftId } });
    const credential = assignment.checkInCredential as string;

    if (input.confirmed || input.checkedIn) expect((await confirm(shiftId, token)).status).toBe(200);
    if (input.checkedIn) expect((await checkIn(shiftId, token, credential)).status).toBe(200);
    return { shiftId, token, workerId, credential, assignmentId: assignment.id, applicationId: application.body.id as string };
  }

  const confirm = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/confirm`).set('Authorization', `Bearer ${token}`);
  const checkIn = (shiftId: string, token: string, credential: string) => request(app).post(`/api/shifts/${shiftId}/check-in`).set('Authorization', `Bearer ${token}`).send({ credential });
  const checkOut = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/check-out`).set('Authorization', `Bearer ${token}`);
  const cancel = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/cancel`).set('Authorization', `Bearer ${token}`).send({ reason: 'Ya no puedo asistir al turno' });
  const eventCount = (shiftId: string, type: 'CHECKED_IN' | 'CHECKED_OUT' | 'COMPLETED' | 'ASSIGNMENT_CONFIRMED' | 'CANCELLED') => verifier.shiftEvent.count({ where: { shiftId, type } });

  // ---------------------------------------------------------------- check-in

  it('deterministic: two check-ins that both read the assignment before either writes leave one CHECKED_IN event and one timestamp', async () => {
    const setup = await assignedShift({ confirmed: true, checkedIn: false });
    const gated = new DatabaseMarketplaceService(instrumentPrisma(prisma, { assignmentRead: barrier(2) }));

    const results = await Promise.allSettled([
      gated.checkIn(setup.workerId, setup.shiftId, setup.credential),
      gated.checkIn(setup.workerId, setup.shiftId, setup.credential),
    ]);

    // Igual que dos llamadas secuenciales: las dos responden `200` con el mismo `checkedInAt`.
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const [first, second] = results.map((result) => (result as PromiseFulfilledResult<{ checkedInAt: string }>).value.checkedInAt);
    expect(second).toBe(first);
    const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } });
    expect(assignment.checkedInAt?.toISOString()).toBe(first);
    expect(await eventCount(setup.shiftId, 'CHECKED_IN')).toBe(1);
    expect((await verifier.shift.findUniqueOrThrow({ where: { id: setup.shiftId } })).status).toBe('CHECKED_IN');
  });

  it(`real: ${ROUNDS} simultaneous double check-ins leave a single CHECKED_IN event and one checkedInAt`, { timeout: RACE_TIMEOUT_MS }, async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const setup = await assignedShift({ confirmed: true, checkedIn: false });
      const [a, b] = await Promise.all([checkIn(setup.shiftId, setup.token, setup.credential), checkIn(setup.shiftId, setup.token, setup.credential)]);
      const label = `round ${round}: a=${a.status} b=${b.status}`;

      expect([a.status, b.status], label).toEqual([200, 200]);
      expect(b.body.checkedInAt, label).toBe(a.body.checkedInAt);
      const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } });
      expect(assignment.checkedInAt?.toISOString(), label).toBe(a.body.checkedInAt);
      expect(await eventCount(setup.shiftId, 'CHECKED_IN'), label).toBe(1);
    }
  });

  // --------------------------------------------------------------- check-out

  async function expectSingleCompletion(setup: { shiftId: string; assignmentId: string }, checkedOutAt: string, label: string) {
    const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } });
    expect(assignment.status, label).toBe('COMPLETED');
    expect(assignment.checkedOutAt?.toISOString(), label).toBe(checkedOutAt);
    expect(assignment.completedAt?.toISOString(), label).toBe(checkedOutAt);
    expect(await eventCount(setup.shiftId, 'CHECKED_OUT'), label).toBe(1);
    expect(await eventCount(setup.shiftId, 'COMPLETED'), label).toBe(1);
    const payments = await verifier.payment.findMany({ where: { shiftId: setup.shiftId } });
    expect(payments, label).toHaveLength(1);
    expect(payments[0]).toMatchObject({ assignmentId: setup.assignmentId, status: 'PENDING' });
    expect(payments[0]?.dueAt?.toISOString(), label).toBe(checkedOutAt);
    expect((await verifier.shift.findUniqueOrThrow({ where: { id: setup.shiftId } })).status, label).toBe('COMPLETED');
  }

  it('deterministic: two check-outs that both read the assignment before either writes complete it once (one event, one payment, one completedAt)', async () => {
    const setup = await assignedShift({ confirmed: true, checkedIn: true });
    const gated = new DatabaseMarketplaceService(instrumentPrisma(prisma, { assignmentRead: barrier(2) }));

    const results = await Promise.allSettled([gated.checkOut(setup.workerId, setup.shiftId), gated.checkOut(setup.workerId, setup.shiftId)]);

    // Igual que dos llamadas secuenciales: la primera completa y la segunda ya no encuentra la asignación.
    const fulfilled = results.filter((result) => result.status === 'fulfilled') as PromiseFulfilledResult<{ checkedOutAt: string }>[];
    const rejected = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'ASSIGNMENT_NOT_FOUND', statusCode: 404 });
    await expectSingleCompletion(setup, fulfilled[0]!.value.checkedOutAt, 'deterministic double check-out');
  });

  it(`real: ${ROUNDS} simultaneous double check-outs complete once each (one event, one payment, one completedAt)`, { timeout: RACE_TIMEOUT_MS }, async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const setup = await assignedShift({ confirmed: true, checkedIn: true });
      const [a, b] = await Promise.all([checkOut(setup.shiftId, setup.token), checkOut(setup.shiftId, setup.token)]);
      const label = `round ${round}: a=${a.status} b=${b.status}`;

      const winner = a.status === 200 ? a : b;
      const loser = a.status === 200 ? b : a;
      expect(winner.status, label).toBe(200);
      expect(loser.status, label).toBe(404);
      expect(loser.body, label).toMatchObject({ error: 'ASSIGNMENT_NOT_FOUND' });
      await expectSingleCompletion(setup, winner.body.checkedOutAt as string, label);
    }
  });

  // -------------------------------------------------- cancelar contra check-in

  async function expectCheckedInNotCancelled(setup: { shiftId: string; assignmentId: string; applicationId: string }, label: string) {
    const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } });
    expect(assignment.status, label).toBe('ASSIGNED');
    expect(assignment.checkedInAt, label).not.toBeNull();
    expect((await verifier.shiftApplication.findUniqueOrThrow({ where: { id: setup.applicationId } })).status, label).toBe('ACCEPTED');
    expect(await verifier.shiftCancellation.count({ where: { shiftId: setup.shiftId } }), label).toBe(0);
    expect(await eventCount(setup.shiftId, 'CANCELLED'), label).toBe(0);
    expect(await eventCount(setup.shiftId, 'CHECKED_IN'), label).toBe(1);
    expect((await verifier.shift.findUniqueOrThrow({ where: { id: setup.shiftId } })).status, label).toBe('CHECKED_IN');
  }

  async function expectCancelledNotCheckedIn(setup: { shiftId: string; assignmentId: string; applicationId: string }, label: string) {
    const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } });
    expect(assignment.status, label).toBe('CANCELLED');
    expect(assignment.checkedInAt, label).toBeNull();
    expect((await verifier.shiftApplication.findUniqueOrThrow({ where: { id: setup.applicationId } })).status, label).toBe('CANCELLED');
    expect(await verifier.shiftCancellation.count({ where: { shiftId: setup.shiftId } }), label).toBe(1);
    expect(await eventCount(setup.shiftId, 'CANCELLED'), label).toBe(1);
    expect(await eventCount(setup.shiftId, 'CHECKED_IN'), label).toBe(0);
    // El cupo vuelve a quedar libre para otra persona.
    expect((await verifier.shift.findUniqueOrThrow({ where: { id: setup.shiftId } })).status, label).toBe('PUBLISHED');
  }

  it('deterministic: a check-in whose read went stale because the worker cancelled in between is rejected with 404 and leaves the cancellation intact', async () => {
    const setup = await assignedShift({ confirmed: true, checkedIn: false });
    const pause = pausePoint();
    const gated = new DatabaseMarketplaceService(instrumentPrisma(prisma, { assignmentRead: pause.hook }));

    const staleCheckIn = gated.checkIn(setup.workerId, setup.shiftId, setup.credential).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await pause.waitReached();
    const cancelled = await cancel(setup.shiftId, setup.token);
    expect(cancelled.status).toBe(200);
    pause.release();
    const outcome = await staleCheckIn;

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatchObject({ code: 'ASSIGNMENT_NOT_FOUND', statusCode: 404 });
    await expectCancelledNotCheckedIn(setup, 'stale check-in after cancel');
  });

  /** Espera `ms` y dice si la promesa sigue pendiente (una llamada bloqueada por un bloqueo de fila). */
  async function stillPendingAfter(promise: Promise<unknown>, ms: number) {
    return Promise.race([promise.then(() => false, () => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), ms))]);
  }

  it('deterministic: a check-in that holds the assignment lock makes a concurrent cancellation wait, and the cancellation then answers 409 and leaves the check-in intact', async () => {
    const setup = await assignedShift({ confirmed: true, checkedIn: false });
    const pause = pausePoint();
    const gated = new DatabaseMarketplaceService(instrumentPrisma(prisma, { afterLock: pause.hook }));

    const holdingCheckIn = gated.checkIn(setup.workerId, setup.shiftId, setup.credential);
    await pause.waitReached();
    // La cancelación llega mientras el check-in tiene las filas bloqueadas: tiene que esperar, no adelantarse.
    const concurrentCancel = cancel(setup.shiftId, setup.token).then((response) => response);
    expect(await stillPendingAfter(concurrentCancel, 700), 'the cancellation must wait for the row lock').toBe(true);
    pause.release();
    await holdingCheckIn;
    const cancelled = await concurrentCancel;

    expect(cancelled.status).toBe(409);
    expect(cancelled.body).toMatchObject({ error: 'CANCELLATION_NOT_ALLOWED' });
    await expectCheckedInNotCancelled(setup, 'cancel after a check-in that held the lock');
  });

  it('deterministic: a cancellation that holds the locks makes a concurrent check-in wait, and the check-in then answers 404 and leaves the cancellation intact', async () => {
    const setup = await assignedShift({ confirmed: true, checkedIn: false });
    const pause = pausePoint();
    const gated = new DatabaseMarketplaceService(instrumentPrisma(prisma, { afterLock: pause.hook }));

    const holdingCancel = gated.cancelAssignment(setup.workerId, setup.shiftId, 'Ya no puedo asistir al turno');
    await pause.waitReached();
    const concurrentCheckIn = checkIn(setup.shiftId, setup.token, setup.credential).then((response) => response);
    expect(await stillPendingAfter(concurrentCheckIn, 700), 'the check-in must wait for the row lock').toBe(true);
    pause.release();
    await holdingCancel;
    const checkedIn = await concurrentCheckIn;

    expect(checkedIn.status).toBe(404);
    expect(checkedIn.body).toMatchObject({ error: 'ASSIGNMENT_NOT_FOUND' });
    await expectCancelledNotCheckedIn(setup, 'check-in after a cancellation that held the lock');
  });

  it(`real: ${ROUNDS} simultaneous cancel/check-in races have a single coherent winner`, { timeout: RACE_TIMEOUT_MS }, async () => {
    const winners: string[] = [];
    for (let round = 1; round <= ROUNDS; round += 1) {
      const setup = await assignedShift({ confirmed: true, checkedIn: false });
      const [cancelResponse, checkInResponse] = await Promise.all([cancel(setup.shiftId, setup.token), checkIn(setup.shiftId, setup.token, setup.credential)]);
      const label = `round ${round}: cancel=${cancelResponse.status} checkIn=${checkInResponse.status}`;

      if (cancelResponse.status === 200) {
        winners.push('cancel');
        expect(checkInResponse.status, label).toBe(404);
        expect(checkInResponse.body, label).toMatchObject({ error: 'ASSIGNMENT_NOT_FOUND' });
        await expectCancelledNotCheckedIn(setup, label);
      } else {
        winners.push('checkIn');
        expect(cancelResponse.status, label).toBe(409);
        expect(cancelResponse.body, label).toMatchObject({ error: 'CANCELLATION_NOT_ALLOWED' });
        expect(checkInResponse.status, label).toBe(200);
        await expectCheckedInNotCancelled(setup, label);
      }
    }
    expect(winners).toHaveLength(ROUNDS);
  });

  // ------------------------------------------------------ cancelar contra confirmar

  it('deterministic: a cancellation that holds the locks makes a concurrent confirmation wait, and the confirmation then answers 404 and writes nothing', async () => {
    const setup = await assignedShift({ confirmed: false, checkedIn: false });
    const pause = pausePoint();
    const gated = new DatabaseMarketplaceService(instrumentPrisma(prisma, { afterLock: pause.hook }));

    const holdingCancel = gated.cancelAssignment(setup.workerId, setup.shiftId, 'Ya no puedo asistir al turno');
    await pause.waitReached();
    const concurrentConfirm = confirm(setup.shiftId, setup.token).then((response) => response);
    expect(await stillPendingAfter(concurrentConfirm, 700), 'the confirmation must wait for the row lock').toBe(true);
    pause.release();
    await holdingCancel;
    const confirmed = await concurrentConfirm;

    expect(confirmed.status).toBe(404);
    expect(confirmed.body).toMatchObject({ error: 'ASSIGNMENT_NOT_FOUND' });
    const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } });
    expect(assignment.status).toBe('CANCELLED');
    expect(assignment.workerConfirmedAt).toBeNull();
    expect(await eventCount(setup.shiftId, 'ASSIGNMENT_CONFIRMED')).toBe(0);
  });

  it(`real: ${ROUNDS} simultaneous cancel/confirm races never confirm a cancelled assignment`, { timeout: RACE_TIMEOUT_MS }, async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const setup = await assignedShift({ confirmed: false, checkedIn: false });
      const [cancelResponse, confirmResponse] = await Promise.all([cancel(setup.shiftId, setup.token), confirm(setup.shiftId, setup.token)]);
      const label = `round ${round}: cancel=${cancelResponse.status} confirm=${confirmResponse.status}`;

      expect(cancelResponse.status, label).toBe(200);
      const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } });
      expect(assignment.status, label).toBe('CANCELLED');
      const confirmedEvents = await eventCount(setup.shiftId, 'ASSIGNMENT_CONFIRMED');
      if (confirmResponse.status === 200) {
        // La confirmación ganó y la cancelación fue después: el orden en serie es confirmar y cancelar.
        expect(confirmedEvents, label).toBe(1);
        const confirmed = await verifier.shiftEvent.findFirstOrThrow({ where: { shiftId: setup.shiftId, type: 'ASSIGNMENT_CONFIRMED' } });
        const cancelled = await verifier.shiftEvent.findFirstOrThrow({ where: { shiftId: setup.shiftId, type: 'CANCELLED' } });
        expect(confirmed.createdAt.getTime(), label).toBeLessThanOrEqual(cancelled.createdAt.getTime());
      } else {
        // La cancelación ganó: la confirmación ya no encuentra la asignación y no escribe nada.
        expect(confirmResponse.status, label).toBe(404);
        expect(confirmedEvents, label).toBe(0);
        expect(assignment.workerConfirmedAt, label).toBeNull();
      }
    }
  });

  // ------------------------------------------------------- cancelar dos veces

  it(`real: ${ROUNDS} simultaneous double cancellations record a single cancellation`, { timeout: RACE_TIMEOUT_MS }, async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const setup = await assignedShift({ confirmed: true, checkedIn: false });
      const [a, b] = await Promise.all([cancel(setup.shiftId, setup.token), cancel(setup.shiftId, setup.token)]);
      const label = `round ${round}: a=${a.status} b=${b.status}`;

      // Igual que dos llamadas secuenciales: la primera cancela y la segunda ya no encuentra la postulación.
      const winner = a.status === 200 ? a : b;
      const loser = a.status === 200 ? b : a;
      expect(winner.status, label).toBe(200);
      expect(loser.status, label).toBe(404);
      expect(loser.body, label).toMatchObject({ error: 'ASSIGNMENT_NOT_FOUND' });
      await expectCancelledNotCheckedIn(setup, label);
    }
  });
});
