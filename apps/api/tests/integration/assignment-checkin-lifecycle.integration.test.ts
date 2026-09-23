import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Ciclo de vida de check-in por asignación contra PostgreSQL real
// (CN-20260923-006):
//  (a) un reemplazo aceptado DESPUÉS de un `NO_SHOW` puede confirmar y hacer
//      check-in: su ventana se cuenta desde que se le asignó, no desde
//      `startsAt` (ya vencido);
//  (b) en un turno multi-cupo, que un trabajador ya haya hecho check-in
//      (turno `CHECKED_IN`) no impide que los demás asignados confirmen y
//      hagan su check-in.
// Para simular el paso del tiempo sin esperar, las pruebas mueven
// `Shift.startsAt` y `ShiftAssignment.assignedAt` con un cliente Prisma
// aparte (`verifier`); toda la operación real pasa por las rutas HTTP.
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

describe('per-assignment check-in lifecycle with PostgreSQL', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
  });

  let businessToken = '';
  let databaseReady = false;
  let workerCounter = 0;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;

    const salt = 'checkin-lifecycle-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.checkin@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de check-in',
        identifier: '20555555555',
      },
    });
    const login = await request(app).post('/api/auth/login').send({ email: 'empresa.checkin@chambeaya.test', password: 'Empresa123' });
    expect(login.status).toBe(200);
    businessToken = login.body.token as string;
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  async function registerWorker() {
    workerCounter += 1;
    const response = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: `Trabajador de check-in ${workerCounter}`,
      email: `trabajador.checkin.${workerCounter}@chambeaya.test`,
      password: 'Trabajador123',
      dniOrRuc: `4000${String(workerCounter).padStart(4, '0')}`,
    });
    expect(response.status).toBe(201);
    return response.body.token as string;
  }

  async function createShift(input: { title: string; startsAt: Date; endsAt: Date; requiredWorkers: number }) {
    const response = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: input.title,
        location: 'Miraflores, Lima',
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        payCents: 12000,
        requiredWorkers: input.requiredWorkers,
        description: 'Turno de prueba de integración del ciclo de check-in.',
        requirements: 'Disponibilidad completa para el horario indicado.',
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
    return { applicationId: application.body.id as string, assignmentId: assignment.id, credential: assignment.checkInCredential };
  }

  const confirm = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/confirm`).set('Authorization', `Bearer ${token}`);
  const checkIn = (shiftId: string, token: string, credential: string) => request(app).post(`/api/shifts/${shiftId}/check-in`).set('Authorization', `Bearer ${token}`).send({ credential });
  const checkOut = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/check-out`).set('Authorization', `Bearer ${token}`);
  const shiftStatus = async (shiftId: string) => (await verifier.shift.findUniqueOrThrow({ where: { id: shiftId } })).status;
  const assignmentStatus = async (assignmentId: string) => (await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status;

  it('multi-seat: an assigned worker can confirm and check in after another seat already checked in', async () => {
    const now = Date.now();
    const shiftId = await createShift({ title: 'Multi-cupo', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), requiredWorkers: 2 });
    const tokenA = await registerWorker();
    const tokenB = await registerWorker();
    const stranger = await registerWorker();
    const a = await applyAndAccept(shiftId, tokenA);
    const b = await applyAndAccept(shiftId, tokenB);
    expect(await shiftStatus(shiftId)).toBe('ASSIGNED');

    // El primer trabajador confirma y hace check-in: el turno pasa a CHECKED_IN.
    expect((await confirm(shiftId, tokenA)).status).toBe(200);
    expect((await checkIn(shiftId, tokenA, a.credential)).status).toBe(200);
    expect(await shiftStatus(shiftId)).toBe('CHECKED_IN');

    // El segundo, que aún no había confirmado, ya no recibe 404.
    const confirmB = await confirm(shiftId, tokenB);
    expect(confirmB.status).toBe(200);
    expect(confirmB.body).toMatchObject({ shiftId, assignment: expect.objectContaining({ workerConfirmedAt: expect.any(String) }) });

    // Negativos de seguridad con el turno ya CHECKED_IN: sin asignación no se
    // confirma ni se hace check-in, y la credencial del otro no sirve.
    expect((await confirm(shiftId, stranger)).status).toBe(404);
    expect((await checkIn(shiftId, stranger, b.credential)).status).toBe(404);
    const wrongCredential = await checkIn(shiftId, tokenB, a.credential);
    expect(wrongCredential.status).toBe(400);
    expect(wrongCredential.body).toMatchObject({ error: 'INVALID_CHECK_IN' });

    expect((await checkIn(shiftId, tokenB, b.credential)).status).toBe(200);
    expect(await shiftStatus(shiftId)).toBe('CHECKED_IN');
    expect(await assignmentStatus(b.assignmentId)).toBe('ASSIGNED');

    // El turno se cierra solo cuando ambos completan.
    expect((await checkOut(shiftId, tokenA)).status).toBe(200);
    expect(await shiftStatus(shiftId)).toBe('CHECKED_IN');
    expect((await checkOut(shiftId, tokenB)).status).toBe(200);
    expect(await shiftStatus(shiftId)).toBe('COMPLETED');

    // Con el turno COMPLETED ya no se confirma ni se hace check-in.
    expect((await confirm(shiftId, tokenB)).status).toBe(404);
    expect((await checkIn(shiftId, tokenA, a.credential)).status).toBe(404);
    expect((await checkIn(shiftId, tokenB, b.credential)).status).toBe(404);
  });

  it('multi-seat: a seat that missed its window is marked NO_SHOW without affecting the seat that already checked in', async () => {
    const now = Date.now();
    // Turno que empezó hace 3 horas y termina en 5.
    const shiftId = await createShift({ title: 'Multi-cupo con ausente', startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 5 * HOUR), requiredWorkers: 2 });
    const tokenA = await registerWorker();
    const tokenB = await registerWorker();
    const a = await applyAndAccept(shiftId, tokenA);
    const b = await applyAndAccept(shiftId, tokenB);
    // Ambas asignaciones son anteriores a `startsAt` (simulado).
    await verifier.shiftAssignment.updateMany({ where: { shiftId }, data: { assignedAt: new Date(now - 4 * HOUR) } });
    // A llegó a tiempo (5 minutos después de `startsAt`); se registra directo
    // porque la ventana ya cerró para cualquier check-in de hoy.
    await verifier.shiftAssignment.update({ where: { id: a.assignmentId }, data: { workerConfirmedAt: new Date(now - 4 * HOUR), checkedInAt: new Date(now - 3 * HOUR + 5 * MINUTE) } });
    await verifier.shift.update({ where: { id: shiftId }, data: { status: 'CHECKED_IN' } });

    // B nunca llegó y su ventana ya cerró: el check-in la marca NO_SHOW (409),
    // sin tocar la asignación de A ni el estado del turno.
    const late = await checkIn(shiftId, tokenB, b.credential);
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ error: 'ASSIGNMENT_NOT_ACTIONABLE' });
    expect(await assignmentStatus(b.assignmentId)).toBe('NO_SHOW');
    expect(await assignmentStatus(a.assignmentId)).toBe('ASSIGNED');
    expect(await shiftStatus(shiftId)).toBe('CHECKED_IN');
  });

  it('replacement: a worker accepted after a NO_SHOW can confirm and check in, and the original stays NO_SHOW', async () => {
    const now = Date.now();
    // Turno de un cupo que empezó hace 3 horas y termina en 5.
    const shiftId = await createShift({ title: 'Reemplazo tras NO_SHOW', startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 5 * HOUR), requiredWorkers: 1 });
    const tokenOriginal = await registerWorker();
    const tokenReplacement = await registerWorker();
    const stranger = await registerWorker();

    const original = await applyAndAccept(shiftId, tokenOriginal);
    // El original se asignó antes de `startsAt` y nunca llegó.
    await verifier.shiftAssignment.update({ where: { id: original.assignmentId }, data: { assignedAt: new Date(now - 4 * HOUR), workerConfirmedAt: new Date(now - 4 * HOUR) } });

    // Abrir el panel de la empresa resuelve el ciclo de vida: NO_SHOW y el turno se reabre.
    const panel = await request(app).get(`/api/business/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${businessToken}`);
    expect(panel.status).toBe(200);
    expect(await assignmentStatus(original.assignmentId)).toBe('NO_SHOW');
    expect(await shiftStatus(shiftId)).toBe('PUBLISHED');

    // Un postulante es aceptado como reemplazo: su asignación nace ahora.
    const replacement = await applyAndAccept(shiftId, tokenReplacement);
    expect(await shiftStatus(shiftId)).toBe('ASSIGNED');

    // Negativos: el original NO_SHOW no puede confirmar ni hacer check-in, y
    // quien no está asignado tampoco.
    expect((await confirm(shiftId, tokenOriginal)).status).toBe(404);
    const originalCheckIn = await checkIn(shiftId, tokenOriginal, original.credential);
    expect(originalCheckIn.status).toBe(409);
    expect(originalCheckIn.body).toMatchObject({ error: 'ASSIGNMENT_NOT_ACTIONABLE' });
    expect((await confirm(shiftId, stranger)).status).toBe(404);
    expect((await checkIn(shiftId, stranger, replacement.credential)).status).toBe(404);

    // El reemplazo confirma y hace check-in (con HEAD anterior a este cambio, quedaba NO_SHOW al primer toque).
    expect((await confirm(shiftId, tokenReplacement)).status).toBe(200);
    const wrongCredential = await checkIn(shiftId, tokenReplacement, original.credential);
    expect(wrongCredential.status).toBe(400);
    expect(wrongCredential.body).toMatchObject({ error: 'INVALID_CHECK_IN' });
    const replacementCheckIn = await checkIn(shiftId, tokenReplacement, replacement.credential);
    expect(replacementCheckIn.status).toBe(200);
    expect(await assignmentStatus(replacement.assignmentId)).toBe('ASSIGNED');
    expect(await shiftStatus(shiftId)).toBe('CHECKED_IN');

    // Completa el turno; el original sigue sin resolver y bloquea el cierre.
    expect((await checkOut(shiftId, tokenReplacement)).status).toBe(200);
    expect(await shiftStatus(shiftId)).toBe('CHECKED_IN');
    const resolved = await request(app)
      .post(`/api/business/shifts/${shiftId}/assignments/${original.assignmentId}/resolve`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ outcome: 'CANCELLED', reason: 'No se presentó' });
    expect(resolved.status).toBe(200);
    expect(await shiftStatus(shiftId)).toBe('COMPLETED');
    expect(await assignmentStatus(original.assignmentId)).toBe('CANCELLED');
    expect(await assignmentStatus(replacement.assignmentId)).toBe('COMPLETED');

    // Y con todo cerrado nadie puede volver a hacer check-in.
    expect((await checkIn(shiftId, tokenReplacement, replacement.credential)).status).toBe(404);
    expect((await checkIn(shiftId, tokenOriginal, original.credential)).status).toBe(404);
  });

  it('replacement: the grace counted from the assignment is finite, and the window of an assignment made before startsAt is not extended', async () => {
    const now = Date.now();
    const shiftId = await createShift({ title: 'Reemplazo tardío', startsAt: new Date(now - 4 * HOUR), endsAt: new Date(now + 4 * HOUR), requiredWorkers: 2 });
    const tokenLate = await registerWorker();
    const tokenEarly = await registerWorker();
    const late = await applyAndAccept(shiftId, tokenLate);
    const early = await applyAndAccept(shiftId, tokenEarly);
    // Uno se asignó hace 2 horas (después de `startsAt`, fuera de su propio
    // margen de 60 minutos) y otro antes de `startsAt`.
    await verifier.shiftAssignment.update({ where: { id: late.assignmentId }, data: { assignedAt: new Date(now - 2 * HOUR) } });
    await verifier.shiftAssignment.update({ where: { id: early.assignmentId }, data: { assignedAt: new Date(now - 5 * HOUR) } });

    expect((await confirm(shiftId, tokenLate)).status).toBe(200);
    const lateCheckIn = await checkIn(shiftId, tokenLate, late.credential);
    expect(lateCheckIn.status).toBe(409);
    expect(lateCheckIn.body).toMatchObject({ error: 'ASSIGNMENT_NOT_ACTIONABLE' });
    expect(await assignmentStatus(late.assignmentId)).toBe('NO_SHOW');

    expect((await confirm(shiftId, tokenEarly)).status).toBe(200);
    const earlyCheckIn = await checkIn(shiftId, tokenEarly, early.credential);
    expect(earlyCheckIn.status).toBe(409);
    expect(earlyCheckIn.body).toMatchObject({ error: 'ASSIGNMENT_NOT_ACTIONABLE' });
    expect(await assignmentStatus(early.assignmentId)).toBe('NO_SHOW');
  });
});
