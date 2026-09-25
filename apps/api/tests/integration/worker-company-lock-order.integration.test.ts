import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Orden de bloqueo entre las operaciones del trabajador y las de la empresa
// (CN-20260923-013 MEDIO-1, sobre CN-20260923-012).
//
// Las operaciones del trabajador bloquean SUS filas con `SELECT ... FOR NO KEY
// UPDATE` en el orden postulación -> asignación -> turno (CN-20260923-012).
// `cancelShift` de la empresa actualizaba primero las asignaciones y después las
// postulaciones: orden inverso. Si una cancelación del trabajador y la
// cancelación del turno se cruzaban, PostgreSQL detectaba un interbloqueo
// (`40P01`, tras `deadlock_timeout`) que nunca llegaba como `P2034`, así que
// `withSerializableRetry` no lo reintentaba y una de las dos respondía `500`.
//
// Dos tipos de prueba, todas DETERMINISTAS (sin depender del reloj para decidir
// quién llega primero: se espera a que PostgreSQL informe que una sesión está
// bloqueada esperando un bloqueo de fila, con `pg_stat_activity`):
//  1. Entrelazados reales entre `cancelAssignment` y `cancelShift` en los dos
//     sentidos (el trabajador ya tiene sus bloqueos / la empresa ya actualizó su
//     primera tabla). Exigen que las dos respondan sin `500`, con el resultado
//     de una ejecución en serie, y que NINGÚN servicio haya visto un `40P01`: eso
//     prueba el ORDEN de bloqueo, no el reintento. Con el orden anterior la
//     empresa (o el trabajador) recibe el interbloqueo.
//  2. Interbloqueos FORZADOS con una transacción de prueba que toma las filas en
//     orden inverso (el orden global no puede evitar el de un tercero): exigen que
//     la operación que pierde el `40P01` se reintente y responda como una
//     llamada secuencial. Cubren las dos formas del error de Prisma (`P2010` de
//     `$queryRaw` del trabajador y el error sin código de `updateMany` de la
//     empresa).
//
// Dependencias del entorno que esta prueba fija a propósito:
//  - Margen del interbloqueo forzado: PostgreSQL aborta a quien primero vea el
//    ciclo cuando vence SU `deadlock_timeout`. Para que la víctima sea la
//    operación bajo prueba (que empezó a esperar antes) y no la transacción de
//    prueba, la de prueba tiene que entrar al ciclo antes de que venza el
//    temporizador de la operación: el margen se deriva de `SHOW deadlock_timeout`
//    (un tercio) y no es un valor fijo, así que la prueba no da falsos fallos si
//    la base usa un valor menor que el predeterminado de 1 s (verificado con
//    200 ms; por debajo de unos 100 ms la propia latencia de la prueba ya no
//    cabe en el margen).
//  - Las sesiones bloqueadas se cuentan solo entre las conexiones de esta prueba
//    (`application_name` propio de su cliente Prisma), no las de otros clientes
//    de la misma base.
//  - Reconocer `40P01`: Prisma 6 (motor de consultas Rust) entrega el interbloqueo
//    de `updateMany`/`update`/`create` como un error SIN `code` cuyo mensaje trae
//    `PostgresError { code: "40P01"` (y el de `$queryRaw` como `P2010` con
//    `meta.code`). `isDeadlock` de aquí y `isRetryableTransactionError` de
//    `serializable-retry.ts` dependen de ese formato. Si un cambio de Prisma (o de
//    su motor) altera el mensaje, el síntoma es que los interbloqueos forzados de
//    abajo dejan de ver el `40P01` ("PostgreSQL must have aborted the first
//    attempt") y que la empresa vuelve a responder `500` en vez de reintentar.
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
const TEST_TIMEOUT_MS = 60_000;

// `application_name` de las conexiones de ESTA prueba (una distinta por proceso):
// `waitUntilSomeSessionIsBlocked` solo mira sesiones con este nombre.
const OWN_APPLICATION_NAME = `chambeaya-lock-order-${process.pid}`;

/** Misma base que `DATABASE_URL`, con un `application_name` propio en las conexiones del cliente. */
function clientNamed(applicationName: string) {
  const url = new URL(integrationDatabaseUrl as string);
  url.searchParams.set('application_name', applicationName);
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

/** Milisegundos de un valor de `SHOW deadlock_timeout` (`1s`, `200ms`, `1min`...). */
function parseDurationMs(value: string) {
  const match = /^(\d+(?:\.\d+)?)\s*(us|ms|s|min|h|d)$/.exec(value.trim());
  if (!match) throw new Error(`UNPARSEABLE_DEADLOCK_TIMEOUT: ${value}`);
  const factor = { us: 0.001, ms: 1, s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'us'];
  return Number(match[1]) * factor;
}

type Hook = () => Promise<void>;
type AnyFunction = (...args: unknown[]) => unknown;

const sleep = (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });

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
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PAUSE_POINT_NOT_REACHED')), WAIT_TIMEOUT_MS)),
  ]);
  return { hook, release, waitReached };
}

function bound(target: object, prop: string | symbol) {
  const value = Reflect.get(target, prop) as unknown;
  return typeof value === 'function' ? (value as AnyFunction).bind(target) : value;
}

function hookDelegate(delegate: object, method: string, hook: Hook) {
  return new Proxy(delegate, {
    get(target, prop) {
      if (prop === method) {
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
 * `true` si el error es un interbloqueo (`40P01`). Depende del formato de error
 * de Prisma 6 (ver la nota del principio del archivo): `P2010` con `meta.code`
 * (`$queryRaw`) o, sin `code`, el texto `PostgresError { code: "40P01"` del
 * mensaje (`updateMany`).
 */
function isDeadlock(error: unknown) {
  if (typeof error !== 'object' || error === null) return false;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  const message = (error as { message?: unknown }).message;
  return meta?.code === '40P01' || (typeof message === 'string' && message.includes('"40P01"'));
}

/**
 * Cliente Prisma que anota los errores con que terminan las transacciones (para
 * saber si PostgreSQL vio un interbloqueo aunque `withSerializableRetry` lo
 * reintentara) y que, opcionalmente, retiene la operación en un punto:
 * `afterApplicationLock` tras el `SELECT ... FOR NO KEY UPDATE` de la
 * postulación (operaciones del trabajador) y `afterFirstUpdateMany` tras el
 * primer `updateMany` de una postulación o asignación (`cancelShift`).
 */
function instrument(base: PrismaClient, seen: { errors: unknown[]; transactions: number }, hooks: { afterApplicationLock?: Hook; afterFirstUpdateMany?: Hook } = {}) {
  return new Proxy(base, {
    get(target, prop) {
      if (prop !== '$transaction') return bound(target, prop);
      return (callback: (tx: unknown) => Promise<unknown>, options?: unknown) => (target.$transaction as AnyFunction)(
        async (tx: object) => {
          seen.transactions += 1;
          const proxy = new Proxy(tx, {
            get(txTarget, txProp) {
              if (txProp === '$queryRaw' && hooks.afterApplicationLock) {
                const afterApplicationLock = hooks.afterApplicationLock;
                return async (...args: unknown[]) => {
                  const result = await (Reflect.get(txTarget, txProp) as AnyFunction).apply(txTarget, args);
                  const sql = Array.isArray(args[0]) ? (args[0] as string[]).join('?') : '';
                  if (sql.includes('FROM "ShiftApplication" WHERE')) await afterApplicationLock();
                  return result;
                };
              }
              if ((txProp === 'shiftApplication' || txProp === 'shiftAssignment') && hooks.afterFirstUpdateMany) {
                return hookDelegate(Reflect.get(txTarget, txProp) as object, 'updateMany', hooks.afterFirstUpdateMany);
              }
              return bound(txTarget, txProp);
            },
          });
          try {
            return await callback(proxy);
          } catch (error) {
            seen.errors.push(error);
            throw error;
          }
        },
        options,
      );
    },
  }) as PrismaClient;
}

describe('worker and company operations that lock the same rows in opposite order never fail with a deadlock', () => {
  const prisma = clientNamed(OWN_APPLICATION_NAME);
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
  // Margen entre que la operación se bloquea y la transacción de prueba entra al
  // ciclo (`forceDeadlock`): un tercio de `deadlock_timeout`, entre 10 y 300 ms.
  let deadlockMarginMs = 300;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    const [{ deadlock_timeout: deadlockTimeout } = { deadlock_timeout: '1s' }] = await verifier.$queryRaw<{ deadlock_timeout: string }[]>`SHOW deadlock_timeout`;
    deadlockMarginMs = Math.min(300, Math.max(10, Math.floor(parseDurationMs(deadlockTimeout) / 3)));
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;

    const salt = 'lock-order-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.lockorder@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa del orden de bloqueo',
        identifier: '20777777777',
      },
    });
    const login = await request(plainApp).post('/api/auth/login').send({ email: 'empresa.lockorder@chambeaya.test', password: 'Empresa123' });
    expect(login.status).toBe(200);
    businessToken = login.body.token as string;
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  // La app con la que se hacen las llamadas cruzadas: el servicio del trabajador
  // y el de la empresa comparten un registro de errores y cada uno puede tener
  // su punto de pausa.
  function racedApp(hooks: { worker?: { afterApplicationLock?: Hook }; business?: { afterFirstUpdateMany?: Hook } }) {
    const worker = { errors: [] as unknown[], transactions: 0 };
    const business = { errors: [] as unknown[], transactions: 0 };
    const app = createApp({
      rateLimit: false,
      authService: new DatabaseAuthService(prisma),
      businessService: new DatabaseBusinessService(instrument(prisma, business, hooks.business)),
      marketplaceService: new DatabaseMarketplaceService(instrument(prisma, worker, hooks.worker)),
    });
    return { app, worker, business };
  }

  // Turno de un cupo que empieza en 10 minutos, con un trabajador aceptado y
  // confirmado. Usa la app sin instrumentar.
  async function assignedShift() {
    counter += 1;
    const now = Date.now();
    const created = await request(plainApp)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: `Turno del orden de bloqueo ${counter}`,
        location: 'Miraflores, Lima',
        startsAt: new Date(now + 10 * MINUTE).toISOString(),
        endsAt: new Date(now + 8 * HOUR).toISOString(),
        payCents: 12000,
        requiredWorkers: 1,
        description: 'Turno de prueba de integración del orden de bloqueo.',
        requirements: 'Disponibilidad completa para el horario indicado.',
      });
    expect(created.status).toBe(201);
    const shiftId = created.body.id as string;

    const email = `trabajador.lockorder.${counter}@chambeaya.test`;
    const worker = await request(plainApp).post('/api/auth/register').send({
      role: 'WORKER',
      name: `Trabajador del orden de bloqueo ${counter}`,
      email,
      password: 'Trabajador123',
      dniOrRuc: `7400${String(counter).padStart(4, '0')}`,
    });
    expect(worker.status).toBe(201);
    const token = worker.body.token as string;
    const workerId = (await verifier.user.findFirstOrThrow({ where: { email } })).id;

    const application = await request(plainApp).post(`/api/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${token}`).send({ answers: [] });
    expect(application.status).toBe(201);
    const applicationId = application.body.id as string;
    const accepted = await request(plainApp)
      .patch(`/api/business/shifts/${shiftId}/applications/${applicationId}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'ACCEPTED' });
    expect(accepted.status).toBe(200);
    const assignment = await verifier.shiftAssignment.findFirstOrThrow({ where: { shiftId } });
    expect((await request(plainApp).post(`/api/shifts/${shiftId}/confirm`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    return { shiftId, token, workerId, applicationId, assignmentId: assignment.id };
  }

  const workerCancel = (app: ReturnType<typeof createApp>, shiftId: string, token: string) => request(app)
    .post(`/api/shifts/${shiftId}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason: 'Ya no puedo asistir al turno' })
    .then((response) => response);
  const companyCancel = (app: ReturnType<typeof createApp>, shiftId: string) => request(app)
    .post(`/api/business/shifts/${shiftId}/cancel`)
    .set('Authorization', `Bearer ${businessToken}`)
    .send({ reason: 'La empresa ya no necesita el turno' })
    .then((response) => response);

  /**
   * Espera a que PostgreSQL informe una sesión de ESTA prueba (`application_name`
   * propio) bloqueada esperando un bloqueo de fila/transacción. Las sesiones de
   * otros clientes de la misma base no cuentan.
   */
  async function waitUntilSomeSessionIsBlocked(applicationName = OWN_APPLICATION_NAME, timeoutMs = WAIT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await verifier.$queryRaw<{ blocked: bigint }[]>`
        SELECT count(*) AS blocked FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${applicationName} AND wait_event_type = 'Lock'`;
      if (Number(rows[0]?.blocked ?? 0) > 0) return;
      await sleep(20);
    }
    throw new Error('NO_SESSION_BLOCKED');
  }

  async function expectCompanyCancelledFirst(setup: Awaited<ReturnType<typeof assignedShift>>) {
    // Orden en serie: la empresa cancela el turno y después el trabajador ya no encuentra su postulación.
    const shift = await verifier.shift.findUniqueOrThrow({ where: { id: setup.shiftId } });
    expect(shift.status).toBe('CANCELLED');
    expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } })).status).toBe('CANCELLED');
    expect((await verifier.shiftApplication.findUniqueOrThrow({ where: { id: setup.applicationId } })).status).toBe('CANCELLED');
    expect(await verifier.shiftCancellation.count({ where: { shiftId: setup.shiftId, actorRole: 'BUSINESS' } })).toBe(1);
    expect(await verifier.shiftCancellation.count({ where: { shiftId: setup.shiftId, actorRole: 'WORKER' } })).toBe(0);
    expect(await verifier.shiftEvent.count({ where: { shiftId: setup.shiftId, type: 'CANCELLED' } })).toBe(1);
  }

  async function expectWorkerCancelledFirst(setup: Awaited<ReturnType<typeof assignedShift>>) {
    // Orden en serie: el trabajador cancela (el turno queda sin asignaciones) y después la empresa cancela el turno.
    const shift = await verifier.shift.findUniqueOrThrow({ where: { id: setup.shiftId } });
    expect(shift.status).toBe('CANCELLED');
    expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } })).status).toBe('CANCELLED');
    expect((await verifier.shiftApplication.findUniqueOrThrow({ where: { id: setup.applicationId } })).status).toBe('CANCELLED');
    expect(await verifier.shiftCancellation.count({ where: { shiftId: setup.shiftId, actorRole: 'WORKER' } })).toBe(1);
    expect(await verifier.shiftCancellation.count({ where: { shiftId: setup.shiftId, actorRole: 'BUSINESS' } })).toBe(1);
    expect(await verifier.shiftEvent.count({ where: { shiftId: setup.shiftId, type: 'CANCELLED' } })).toBe(2);
  }

  // ------------------------------------------------- entrelazados reales, dos sentidos

  it('the worker holds the application lock when the company cancels the shift: both answer 200 and no deadlock is ever seen', { timeout: TEST_TIMEOUT_MS }, async () => {
    const setup = await assignedShift();
    const pause = pausePoint();
    const raced = racedApp({ worker: { afterApplicationLock: pause.hook } });

    const workerResponse = workerCancel(raced.app, setup.shiftId, setup.token);
    await pause.waitReached();
    const companyResponse = companyCancel(raced.app, setup.shiftId);
    await waitUntilSomeSessionIsBlocked();
    pause.release();
    const [worker, company] = await Promise.all([workerResponse, companyResponse]);

    expect({ worker: worker.status, company: company.status }, JSON.stringify({ worker: worker.body, company: company.body })).toEqual({ worker: 200, company: 200 });
    expect(company.body).toMatchObject({ status: 'CANCELLED' });
    await expectWorkerCancelledFirst(setup);
    expect(raced.worker.errors.filter(isDeadlock), 'the worker transaction must not see a deadlock').toHaveLength(0);
    expect(raced.business.errors.filter(isDeadlock), 'the company transaction must not see a deadlock').toHaveLength(0);
    expect(raced.worker.transactions, 'the worker needs a single transaction').toBe(1);
  });

  it('the company already updated its first table when the worker cancels: the company answers 200, the worker answers 404 and no deadlock is ever seen', { timeout: TEST_TIMEOUT_MS }, async () => {
    const setup = await assignedShift();
    const pause = pausePoint();
    const raced = racedApp({ business: { afterFirstUpdateMany: pause.hook } });

    const companyResponse = companyCancel(raced.app, setup.shiftId);
    await pause.waitReached();
    const workerResponse = workerCancel(raced.app, setup.shiftId, setup.token);
    await waitUntilSomeSessionIsBlocked();
    pause.release();
    const [company, worker] = await Promise.all([companyResponse, workerResponse]);

    expect({ company: company.status, worker: worker.status }, JSON.stringify({ company: company.body, worker: worker.body })).toEqual({ company: 200, worker: 404 });
    expect(worker.body).toMatchObject({ error: 'ASSIGNMENT_NOT_FOUND' });
    await expectCompanyCancelledFirst(setup);
    expect(raced.worker.errors.filter(isDeadlock), 'the worker transaction must not see a deadlock').toHaveLength(0);
    expect(raced.business.errors.filter(isDeadlock), 'the company transaction must not see a deadlock').toHaveLength(0);
    expect(raced.worker.transactions, 'the worker needs a single transaction').toBe(1);
  });

  // ------------------------------------------------- la espera solo cuenta sesiones propias

  it('waiting for a blocked session ignores blocked sessions of other clients of the same database', { timeout: TEST_TIMEOUT_MS }, async () => {
    const foreignName = `${OWN_APPLICATION_NAME}-foreign`;
    const holder = clientNamed(foreignName);
    const waiter = clientNamed(foreignName);
    let releaseHolder!: () => void;
    const holderReleased = new Promise<void>((resolve) => { releaseHolder = resolve; });
    let holding!: () => void;
    const holdingLock = new Promise<void>((resolve) => { holding = resolve; });
    // Dos sesiones ajenas: una toma un bloqueo consultivo y la otra queda esperándolo.
    const held = holder.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
      holding();
      await holderReleased;
    }, { timeout: 30_000 });
    let waiting: Promise<unknown> = Promise.resolve();
    try {
      await holdingLock;
      waiting = waiter.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`; }, { timeout: 30_000 });
      // Control positivo: la consulta SÍ ve la sesión bloqueada cuando se pide por su nombre...
      await waitUntilSomeSessionIsBlocked(foreignName);
      // ...y la espera de esta prueba, con su `application_name`, no la cuenta.
      await expect(waitUntilSomeSessionIsBlocked(OWN_APPLICATION_NAME, 400)).rejects.toThrow('NO_SESSION_BLOCKED');
    } finally {
      releaseHolder();
      await Promise.allSettled([held, waiting]);
      await Promise.all([holder.$disconnect(), waiter.$disconnect()]);
    }
  });

  // ------------------------------------- interbloqueos forzados por un tercero en orden inverso

  /**
   * Una transacción de prueba toma la asignación, espera a que la operación bajo
   * prueba esté bloqueada por ella y entonces pide la postulación que esa
   * operación ya tiene: interbloqueo real. La operación llegó antes al bloqueo
   * (más tiempo esperando), así que es a quien PostgreSQL aborta con `40P01`
   * cuando vence `deadlock_timeout`. La operación debe reintentar y responder
   * como una llamada secuencial; la transacción de prueba termina sin error.
   */
  async function forceDeadlock(setup: Awaited<ReturnType<typeof assignedShift>>, startOperation: () => Promise<request.Response>) {
    let signalBlocked!: () => void;
    const operationBlocked = new Promise<void>((resolve) => { signalBlocked = resolve; });
    let signalHolding!: () => void;
    const holding = new Promise<void>((resolve) => { signalHolding = resolve; });
    const third = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ShiftAssignment" WHERE "id" = ${setup.assignmentId} FOR NO KEY UPDATE`;
      signalHolding();
      await operationBlocked;
      // La operación lleva esperando desde antes: su temporizador de interbloqueo
      // vence primero, con el ciclo ya formado, siempre que este margen sea menor
      // que `deadlock_timeout` (se deriva de él, ver el principio del archivo).
      await sleep(deadlockMarginMs);
      await tx.$queryRaw`SELECT "id" FROM "ShiftApplication" WHERE "id" = ${setup.applicationId} FOR NO KEY UPDATE`;
    }, { maxWait: WAIT_TIMEOUT_MS, timeout: 30_000 }).then(() => null, (error: unknown) => error);

    await holding;
    const operation = startOperation();
    await waitUntilSomeSessionIsBlocked();
    signalBlocked();
    const [thirdError, response] = await Promise.all([third, operation]);
    expect(thirdError, 'the test transaction must not be the deadlock victim').toBeNull();
    return response;
  }

  it('a worker cancellation aborted by a deadlock with a third transaction is retried and answers like a sequential call (P2010 from $queryRaw)', { timeout: TEST_TIMEOUT_MS }, async () => {
    const setup = await assignedShift();
    const raced = racedApp({});

    const response = await forceDeadlock(setup, () => workerCancel(raced.app, setup.shiftId, setup.token));

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'CANCELLED' });
    expect(raced.worker.errors.filter(isDeadlock), 'PostgreSQL must have aborted the first attempt with 40P01').toHaveLength(1);
    expect(raced.worker.transactions).toBe(2);
    expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: setup.assignmentId } })).status).toBe('CANCELLED');
    expect(await verifier.shiftCancellation.count({ where: { shiftId: setup.shiftId, actorRole: 'WORKER' } })).toBe(1);
    expect(await verifier.shiftEvent.count({ where: { shiftId: setup.shiftId, type: 'CANCELLED' } })).toBe(1);
  });

  it('a company shift cancellation aborted by a deadlock with a third transaction is retried and answers like a sequential call (unknown request error from updateMany)', { timeout: TEST_TIMEOUT_MS }, async () => {
    const setup = await assignedShift();
    const raced = racedApp({});

    const response = await forceDeadlock(setup, () => companyCancel(raced.app, setup.shiftId));

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'CANCELLED' });
    expect(raced.business.errors.filter(isDeadlock), 'PostgreSQL must have aborted the first attempt with 40P01').toHaveLength(1);
    expect(raced.business.transactions).toBe(2);
    await expectCompanyCancelledFirst(setup);
  });

  // ------------------------------------------ matriz de las demás parejas trabajador x empresa

  // Recorrido de todas las parejas (operación del trabajador sobre su asignación
  // A) x (operación de la empresa sobre el MISMO turno), lanzadas a la vez. El
  // análisis del orden de bloqueo (docs/reference/api.md) dice que ninguna forma
  // un ciclo; esto lo comprueba en la práctica: ninguna respuesta es `500` y ningún
  // servicio ve un `40P01`. Las respuestas `4xx` de la llamada que pierde (404, 409,
  // 400) son las de una ejecución en serie y son válidas. Un pase no prueba la
  // ausencia de ciclos (la carrera es aleatoria), pero un ciclo real fallaría en
  // cuanto el entrelazado se produjera; el orden se cubre de forma determinista
  // arriba solo para la pareja que lo tenía invertido.
  const MATRIX_ROUNDS = Math.max(1, Number(process.env.CHAMBEAYA_LOAD_ROUNDS ?? 3));
  type WorkerState = 'assigned' | 'confirmed' | 'checkedIn';
  type MatrixSetup = { shiftId: string; a: { token: string; credential: string }; applicationB: string; assignmentC: string };

  // Turno de 3 cupos en la ventana de check-in con: el trabajador A asignado
  // (`assigned`/`confirmed`/`checkedIn`), una postulación pendiente de B (para
  // `decide`) y una asignación de C en `NO_SHOW` (para `resolve`).
  async function matrixShift(aState: WorkerState): Promise<MatrixSetup> {
    counter += 1;
    const now = Date.now();
    const created = await request(plainApp)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: `Turno de la matriz ${counter}`,
        location: 'Miraflores, Lima',
        startsAt: new Date(now + 10 * MINUTE).toISOString(),
        endsAt: new Date(now + 8 * HOUR).toISOString(),
        payCents: 12000,
        requiredWorkers: 3,
        description: 'Turno de prueba de integración de la matriz de bloqueo.',
        requirements: 'Disponibilidad completa para el horario indicado.',
      });
    expect(created.status).toBe(201);
    const shiftId = created.body.id as string;

    const registerWorker = async (label: string) => {
      const email = `trabajador.matrix.${label}.${counter}@chambeaya.test`;
      const registered = await request(plainApp).post('/api/auth/register').send({
        role: 'WORKER',
        name: `Trabajador de la matriz ${label} ${counter}`,
        email,
        password: 'Trabajador123',
        dniOrRuc: `76${String(counter).padStart(4, '0')}${label === 'a' ? '1' : label === 'b' ? '2' : '3'}0`,
      });
      expect(registered.status).toBe(201);
      return registered.body.token as string;
    };
    const applyAs = async (token: string) => {
      const application = await request(plainApp).post(`/api/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${token}`).send({ answers: [] });
      expect(application.status).toBe(201);
      return application.body.id as string;
    };
    const accept = async (applicationId: string) => {
      const response = await request(plainApp)
        .patch(`/api/business/shifts/${shiftId}/applications/${applicationId}`)
        .set('Authorization', `Bearer ${businessToken}`)
        .send({ decision: 'ACCEPTED' });
      expect(response.status).toBe(200);
    };

    const tokenA = await registerWorker('a');
    await accept(await applyAs(tokenA));
    const assignmentA = await verifier.shiftAssignment.findFirstOrThrow({ where: { shiftId } });
    const credential = assignmentA.checkInCredential as string;
    const tokenC = await registerWorker('c');
    await accept(await applyAs(tokenC));
    const assignmentC = await verifier.shiftAssignment.findFirstOrThrow({ where: { shiftId, id: { not: assignmentA.id } } });
    await verifier.shiftAssignment.update({ where: { id: assignmentC.id }, data: { status: 'NO_SHOW' } });

    const tokenB = await registerWorker('b');
    const applicationB = await applyAs(tokenB);
    // A confirma y hace check-in al final: con el check-in el turno pasa a `CHECKED_IN` y ya no admite postulaciones.
    if (aState !== 'assigned') expect((await request(plainApp).post(`/api/shifts/${shiftId}/confirm`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
    if (aState === 'checkedIn') {
      expect((await request(plainApp).post(`/api/shifts/${shiftId}/check-in`).set('Authorization', `Bearer ${tokenA}`).send({ credential })).status).toBe(200);
    }
    return { shiftId, a: { token: tokenA, credential }, applicationB, assignmentC: assignmentC.id };
  }

  const workerOperations: { name: string; state: WorkerState; call: (app: ReturnType<typeof createApp>, setup: MatrixSetup) => Promise<request.Response> }[] = [
    { name: 'confirm', state: 'assigned', call: (app, setup) => request(app).post(`/api/shifts/${setup.shiftId}/confirm`).set('Authorization', `Bearer ${setup.a.token}`).then((response) => response) },
    { name: 'check-in', state: 'confirmed', call: (app, setup) => request(app).post(`/api/shifts/${setup.shiftId}/check-in`).set('Authorization', `Bearer ${setup.a.token}`).send({ credential: setup.a.credential }).then((response) => response) },
    { name: 'check-out', state: 'checkedIn', call: (app, setup) => request(app).post(`/api/shifts/${setup.shiftId}/check-out`).set('Authorization', `Bearer ${setup.a.token}`).then((response) => response) },
    { name: 'cancel', state: 'confirmed', call: (app, setup) => workerCancel(app, setup.shiftId, setup.a.token) },
  ];
  const companyOperations: { name: string; call: (app: ReturnType<typeof createApp>, setup: MatrixSetup) => Promise<request.Response> }[] = [
    { name: 'decideShiftApplication', call: (app, setup) => request(app).patch(`/api/business/shifts/${setup.shiftId}/applications/${setup.applicationB}`).set('Authorization', `Bearer ${businessToken}`).send({ decision: 'ACCEPTED' }).then((response) => response) },
    { name: 'resolveAssignment', call: (app, setup) => request(app).post(`/api/business/shifts/${setup.shiftId}/assignments/${setup.assignmentC}/resolve`).set('Authorization', `Bearer ${businessToken}`).send({ outcome: 'COMPLETED' }).then((response) => response) },
    { name: 'cancelShift', call: (app, setup) => companyCancel(app, setup.shiftId) },
    { name: 'updateShift', call: (app, setup) => request(app).patch(`/api/business/shifts/${setup.shiftId}`).set('Authorization', `Bearer ${businessToken}`).send({ title: 'Turno de la matriz editado' }).then((response) => response) },
  ];

  for (const workerOperation of workerOperations) {
    for (const companyOperation of companyOperations) {
      it(`${workerOperation.name} (worker) x ${companyOperation.name} (company) on the same shift: no 500 and no deadlock in ${MATRIX_ROUNDS} simultaneous rounds`, { timeout: TEST_TIMEOUT_MS * 2 }, async () => {
        for (let round = 1; round <= MATRIX_ROUNDS; round += 1) {
          const setup = await matrixShift(workerOperation.state);
          const raced = racedApp({});
          const [worker, company] = await Promise.all([workerOperation.call(raced.app, setup), companyOperation.call(raced.app, setup)]);
          const label = `round ${round}: worker=${worker.status} ${JSON.stringify(worker.body).slice(0, 120)} company=${company.status} ${JSON.stringify(company.body).slice(0, 120)}`;

          expect(worker.status, label).toBeLessThan(500);
          expect(company.status, label).toBeLessThan(500);
          expect(raced.worker.errors.filter(isDeadlock), `${label}: worker transaction deadlock`).toHaveLength(0);
          expect(raced.business.errors.filter(isDeadlock), `${label}: company transaction deadlock`).toHaveLength(0);
        }
      });
    }
  }
});
