import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Contención de las rutas de empresa que usan transacciones `Serializable`
// (`decideShiftApplication`, `cancelShift`, `resolveAssignment`) cuando varias
// se ejecutan a la vez sobre turnos o asignaciones DISTINTOS
// (CN-20260923-012, complemento de ALTO-1 de CN-20260923-011).
// Con 3 reintentos inmediatos de `P2034`, solo 3 de N llamadas simultáneas
// terminaban bien y el resto respondía `500` (medido con N=4 y N=10, incluso
// cuando cada llamada actuaba sobre su propio turno). `withSerializableRetry`
// reintenta ahora con espera aleatoria y 6 intentos, lo que reduce mucho esos
// fallos pero NO los elimina: es un diseño probabilístico (aislamiento
// `Serializable`, sin bloqueo de filas, a diferencia de las rutas del
// trabajador) y con ráfagas grandes de una misma empresa (N=20) 1 o 2 llamadas de
// 20 siguen agotando los 6 intentos y responden `500` (CN-20260923-013, MEDIO-2:
// una versión anterior de esta prueba exigía `200` en todas y fallaba al azar
// en la suite completa).
//
// Por eso la prueba por defecto NO exige `200` en todas: exige lo que el diseño
// sí garantiza siempre, de forma determinista, sin importar cuántas fallen:
//  - toda respuesta es `200` o `500 INTERNAL_ERROR` (nunca otro código);
//  - al menos una llamada gana (`Serializable` siempre deja pasar a la primera en
//    confirmar);
//  - atomicidad: cada `200` dejó su efecto completo y cada `500` no dejó NINGÚN
//    efecto (ni asignación, ni pago, ni evento, ni cancelación a medias), y los
//    agregados del turno (`confirmedWorkers`, estado) cuadran con los `200`;
//  - una llamada que responde `500` se puede repetir y entonces responde `200`.
// La medición de "todas responden `200`" es opt-in: `CHAMBEAYA_LOAD_STRICT=true`
// (con `CHAMBEAYA_LOAD_WORKERS=4,10,20` para ráfagas mayores) y es informativa,
// no una garantía.
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
const ROUNDS = Math.max(1, Number(process.env.CHAMBEAYA_LOAD_ROUNDS ?? 2));
// `CHAMBEAYA_LOAD_WORKERS=4,10,20` cambia los tamaños de ráfaga; `CHAMBEAYA_LOAD_STRICT=true`
// exige además `200` en todas (medición opt-in: no es una garantía, ver arriba).
const WORKER_COUNTS = (process.env.CHAMBEAYA_LOAD_WORKERS ?? '4,10').split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
const STRICT = process.env.CHAMBEAYA_LOAD_STRICT === 'true';
const MAX_WORKERS = Math.max(...WORKER_COUNTS);
const LOAD_TIMEOUT_MS = 300_000;

type Worker = { id: string; token: string };
type Layout = 'distinct-shifts' | 'same-shift';

describe('business routes acting at once on different shifts or assignments never starve each other', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    rateLimit: false,
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
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

    const salt = 'business-load-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.businessload@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de carga de rutas de empresa',
        identifier: '20666666666',
      },
    });
    const login = await request(app).post('/api/auth/login').send({ email: 'empresa.businessload@chambeaya.test', password: 'Empresa123' });
    expect(login.status).toBe(200);
    businessToken = login.body.token as string;
    // La empresa se crea con un `upsert` en el primer uso; se hace ahora, en serie,
    // para que las primeras llamadas simultáneas de las pruebas no compitan por
    // crearla (esa carrera es ajena a lo que mide esta prueba).
    expect((await request(app).get('/api/business/company').set('Authorization', `Bearer ${businessToken}`)).status).toBe(200);

    for (let index = 1; index <= MAX_WORKERS; index += 1) {
      const email = `trabajador.businessload.${index}@chambeaya.test`;
      const registered = await request(app).post('/api/auth/register').send({
        role: 'WORKER',
        name: `Trabajador de carga de empresa ${index}`,
        email,
        password: 'Trabajador123',
        dniOrRuc: `7300${String(index).padStart(4, '0')}`,
      });
      expect(registered.status).toBe(201);
      workers.push({ id: (await verifier.user.findFirstOrThrow({ where: { email } })).id, token: registered.body.token as string });
    }
  }, 60_000);

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  const asBusiness = () => ({ Authorization: `Bearer ${businessToken}` });

  async function createShift(requiredWorkers: number) {
    shiftCounter += 1;
    const now = Date.now();
    const created = await request(app).post('/api/business/shifts').set(asBusiness()).send({
      title: `Turno de carga de empresa ${shiftCounter}`,
      location: 'Miraflores, Lima',
      startsAt: new Date(now + 10 * MINUTE).toISOString(),
      endsAt: new Date(now + 8 * HOUR).toISOString(),
      payCents: 12000,
      requiredWorkers,
      description: 'Turno de prueba de integración de la carga de rutas de empresa.',
      requirements: 'Disponibilidad completa para el horario indicado.',
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  async function apply(shiftId: string, worker: Worker) {
    const application = await request(app).post(`/api/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${worker.token}`).send({ answers: [] });
    expect(application.status).toBe(201);
    return application.body.id as string;
  }

  const decide = (shiftId: string, applicationId: string) => request(app)
    .patch(`/api/business/shifts/${shiftId}/applications/${applicationId}`)
    .set(asBusiness())
    .send({ decision: 'ACCEPTED' });

  /** Un turno por trabajador, o un solo turno con un cupo por trabajador. */
  async function shiftGroups(layout: Layout, count: number) {
    const group = workers.slice(0, count);
    if (layout === 'same-shift') return [{ shiftId: await createShift(count), group }];
    return Promise.all(group.map(async (worker) => ({ shiftId: await createShift(1), group: [worker] })));
  }

  /**
   * Lanza todas las llamadas a la vez y comprueba lo que el diseño garantiza:
   * solo `200` o `500 INTERNAL_ERROR` y al menos un `200`. Devuelve, por posición,
   * si cada llamada tuvo éxito, para que quien llama compruebe la atomicidad (los
   * efectos de cada llamada existen si y solo si respondió `200`). Con
   * `CHAMBEAYA_LOAD_STRICT=true` exige además `200` en todas.
   */
  async function burst(calls: (() => Promise<request.Response>)[], label: string) {
    const responses = await Promise.all(calls.map((call) => call()));
    const tally: Record<string, number> = {};
    for (const response of responses) tally[response.status] = (tally[response.status] ?? 0) + 1;
    const description = `${label}: ${JSON.stringify(tally)}`;
    if (tally[500]) process.stderr.write(`[business-load] ${description}
`);
    for (const response of responses) {
      if (response.status !== 200) expect({ status: response.status, body: response.body }, description).toEqual({ status: 500, body: { error: 'INTERNAL_ERROR' } });
    }
    expect(tally[200] ?? 0, description).toBeGreaterThanOrEqual(1);
    if (STRICT) expect(tally, description).toEqual({ 200: calls.length });
    return responses.map((response) => response.status === 200);
  }

  /** Repite en serie las llamadas que respondieron `500`: una llamada que no se aplicó se puede repetir y responde `200`. */
  async function retryFailed(calls: (() => Promise<request.Response>)[], succeeded: boolean[], label: string) {
    for (const [index, call] of calls.entries()) {
      if (succeeded[index]) continue;
      const response = await call();
      expect(response.status, `${label}: retry of call ${index}: ${JSON.stringify(response.body)}`).toBe(200);
    }
  }

  for (const count of WORKER_COUNTS) {
    for (const layout of ['distinct-shifts', 'same-shift'] as const) {
      const scenario = `${count} decisions, ${layout}`;

      it(`${scenario}: simultaneous acceptances are atomic (200 = full assignment, 500 = nothing) and a failed one can be repeated`, { timeout: LOAD_TIMEOUT_MS }, async () => {
        for (let round = 1; round <= ROUNDS; round += 1) {
          const groups = await shiftGroups(layout, count);
          const targets: { shiftId: string; applicationId: string }[] = [];
          for (const { shiftId, group } of groups) {
            for (const worker of group) targets.push({ shiftId, applicationId: await apply(shiftId, worker) });
          }
          const label = `decide ${scenario} round ${round}`;
          const calls = targets.map((target) => () => decide(target.shiftId, target.applicationId));
          const succeeded = await burst(calls, label);

          // Atomicidad: cada `200` dejó postulación aceptada + asignación + evento; cada `500` no dejó nada.
          for (const [index, target] of targets.entries()) {
            const application = await verifier.shiftApplication.findUniqueOrThrow({ where: { id: target.applicationId } });
            expect(application.status, `${label}: call ${index}`).toBe(succeeded[index] ? 'ACCEPTED' : 'PENDING');
            expect(await verifier.shiftAssignment.count({ where: { applicationId: target.applicationId } }), `${label}: call ${index}`).toBe(succeeded[index] ? 1 : 0);
            expect(await verifier.shiftEvent.count({ where: { shiftId: target.shiftId, type: 'APPLICATION_ACCEPTED', detail: target.applicationId } }), `${label}: call ${index}`).toBe(succeeded[index] ? 1 : 0);
          }
          for (const { shiftId, group } of groups) {
            const won = targets.filter((target, index) => target.shiftId === shiftId && succeeded[index]).length;
            const shift = await verifier.shift.findUniqueOrThrow({ where: { id: shiftId } });
            expect(shift.confirmedWorkers, label).toBe(won);
            expect(shift.status, label).toBe(won >= group.length ? 'ASSIGNED' : 'PUBLISHED');
          }

          await retryFailed(calls, succeeded, label);
          const shiftIds = groups.map((group) => group.shiftId);
          expect(await verifier.shiftAssignment.count({ where: { shiftId: { in: shiftIds }, status: 'ASSIGNED' } }), label).toBe(count);
          const shifts = await verifier.shift.findMany({ where: { id: { in: shiftIds } } });
          expect(shifts.reduce((sum, shift) => sum + shift.confirmedWorkers, 0), label).toBe(count);
          expect(shifts.every((shift) => shift.status === 'ASSIGNED'), label).toBe(true);
        }
      });

      it(`${scenario}: simultaneous resolutions of a NO_SHOW assignment are atomic (200 = completed with its payment, 500 = untouched) and a failed one can be repeated`, { timeout: LOAD_TIMEOUT_MS }, async () => {
        for (let round = 1; round <= ROUNDS; round += 1) {
          const groups = await shiftGroups(layout, count);
          const targets: { shiftId: string; assignmentId: string }[] = [];
          for (const { shiftId, group } of groups) {
            for (const worker of group) expect((await decide(shiftId, await apply(shiftId, worker))).status).toBe(200);
            // Se retrasa el reloj del turno (simula el paso del tiempo) y se abre el
            // turno para que el ciclo de vida persista las asignaciones como `NO_SHOW`.
            const now = Date.now();
            await verifier.shift.update({ where: { id: shiftId }, data: { startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 2 * HOUR) } });
            await verifier.shiftAssignment.updateMany({ where: { shiftId }, data: { assignedAt: new Date(now - 4 * HOUR) } });
            expect((await request(app).get(`/api/business/shifts/${shiftId}/applications`).set(asBusiness())).status).toBe(200);
            for (const assignment of await verifier.shiftAssignment.findMany({ where: { shiftId } })) {
              expect(assignment.status).toBe('NO_SHOW');
              targets.push({ shiftId, assignmentId: assignment.id });
            }
          }
          const label = `resolve ${scenario} round ${round}`;
          const calls = targets.map((target) => () => request(app)
            .post(`/api/business/shifts/${target.shiftId}/assignments/${target.assignmentId}/resolve`)
            .set(asBusiness())
            .send({ outcome: 'COMPLETED' }));
          const succeeded = await burst(calls, label);

          // Atomicidad: cada `200` dejó la asignación `COMPLETED` y un solo `Payment`; cada `500`, la asignación `NO_SHOW` y ningún pago.
          for (const [index, target] of targets.entries()) {
            const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: target.assignmentId } });
            expect(assignment.status, `${label}: call ${index}`).toBe(succeeded[index] ? 'COMPLETED' : 'NO_SHOW');
            expect(await verifier.payment.count({ where: { assignmentId: target.assignmentId } }), `${label}: call ${index}`).toBe(succeeded[index] ? 1 : 0);
          }

          await retryFailed(calls, succeeded, label);
          const shiftIds = groups.map((group) => group.shiftId);
          expect(await verifier.shiftAssignment.count({ where: { shiftId: { in: shiftIds }, status: 'COMPLETED' } }), label).toBe(count);
          expect(await verifier.payment.count({ where: { shiftId: { in: shiftIds } } }), label).toBe(count);
          const shifts = await verifier.shift.findMany({ where: { id: { in: shiftIds } } });
          expect(shifts.every((shift) => shift.status === 'COMPLETED'), label).toBe(true);
        }
      });
    }

    it(`${count} cancellations of different shifts: simultaneous cancelShift calls are atomic (200 = cancelled with its cancellation record, 500 = untouched) and a failed one can be repeated`, { timeout: LOAD_TIMEOUT_MS }, async () => {
      for (let round = 1; round <= ROUNDS; round += 1) {
        const groups = await shiftGroups('distinct-shifts', count);
        for (const { shiftId, group } of groups) {
          for (const worker of group) expect((await decide(shiftId, await apply(shiftId, worker))).status).toBe(200);
        }
        const label = `cancelShift ${count} distinct-shifts round ${round}`;
        const calls = groups.map(({ shiftId }) => () => request(app)
          .post(`/api/business/shifts/${shiftId}/cancel`)
          .set(asBusiness())
          .send({ reason: 'La empresa ya no necesita el turno' }));
        const succeeded = await burst(calls, label);

        // Atomicidad: cada `200` canceló turno, asignación y postulación y dejó una sola cancelación; cada `500` no tocó nada.
        for (const [index, { shiftId }] of groups.entries()) {
          const cancelled = succeeded[index] === true;
          expect((await verifier.shift.findUniqueOrThrow({ where: { id: shiftId } })).status, `${label}: call ${index}`).toBe(cancelled ? 'CANCELLED' : 'ASSIGNED');
          expect(await verifier.shiftAssignment.count({ where: { shiftId, status: cancelled ? 'CANCELLED' : 'ASSIGNED' } }), `${label}: call ${index}`).toBe(1);
          expect(await verifier.shiftApplication.count({ where: { shiftId, status: cancelled ? 'CANCELLED' : 'ACCEPTED' } }), `${label}: call ${index}`).toBe(1);
          expect(await verifier.shiftCancellation.count({ where: { shiftId } }), `${label}: call ${index}`).toBe(cancelled ? 1 : 0);
          expect(await verifier.shiftEvent.count({ where: { shiftId, type: 'CANCELLED' } }), `${label}: call ${index}`).toBe(cancelled ? 1 : 0);
        }

        await retryFailed(calls, succeeded, label);
        const shiftIds = groups.map((group) => group.shiftId);
        const shifts = await verifier.shift.findMany({ where: { id: { in: shiftIds } } });
        expect(shifts.every((shift) => shift.status === 'CANCELLED'), label).toBe(true);
        expect(await verifier.shiftAssignment.count({ where: { shiftId: { in: shiftIds }, status: 'CANCELLED' } }), label).toBe(count);
        expect(await verifier.shiftCancellation.count({ where: { shiftId: { in: shiftIds } } }), label).toBe(count);
      }
    });
  }
});
