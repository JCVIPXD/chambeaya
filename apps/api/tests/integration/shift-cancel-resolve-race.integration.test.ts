import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Carrera real (no simulada) entre `cancelShift` y `resolveAssignment` sobre
// la misma asignación `NO_SHOW` (BAJO-1 y BAJO-2 de CN-20260920-004).
//
// Las dos operaciones son serializables y releen el estado dentro de su
// transacción reintentable, así que el resultado tiene que ser el de alguna
// ejecución en serie:
//  - gana la cancelación: la asignación queda `CANCELLED`, el turno `CANCELLED`
//    y no hay pago; la resolución responde `400 ASSIGNMENT_NOT_RESOLVABLE`;
//  - gana la resolución (`COMPLETED`): la asignación y el turno quedan
//    `COMPLETED`, hay un solo pago; la cancelación responde
//    `400 SHIFT_NOT_CANCELLABLE`.
// Sin aislamiento en `cancelShift` (o con las lecturas fuera de la
// transacción) también podían responder `200` las dos, dejando un pago sobre
// un turno `CANCELLED`. Una carrera no es determinista: se repite en varias
// rondas con turnos distintos y cada una comprueba la invariante.
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
const ROUNDS = 12;
// `ROUNDS` carreras seguidas: ~4-6 s medidas en reposo, con poco margen frente al
// `testTimeout` global de 20 s de `vitest.integration.config.mts`, así que esta
// prueba tiene el suyo (CN-20260923-015 BAJO-1).
const RACE_TIMEOUT_MS = 60_000;

describe('cancelShift and resolveAssignment never both win a real concurrent race', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
  });

  let businessToken = '';
  let databaseReady = false;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;

    const salt = 'cancel-resolve-race-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.cancelrace@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de carrera de cancelación',
        identifier: '20777777777',
      },
    });
    const login = await request(app).post('/api/auth/login').send({ email: 'empresa.cancelrace@chambeaya.test', password: 'Empresa123' });
    expect(login.status).toBe(200);
    businessToken = login.body.token as string;
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  // Deja un turno de un cupo con su única asignación en `NO_SHOW` sin resolver:
  // se crea a futuro por la API, se acepta a un trabajador y luego se retrasa el
  // reloj del turno con el cliente `verifier` (simula el paso del tiempo).
  async function shiftWithNoShow(round: number) {
    const now = Date.now();
    const created = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: `Turno de carrera ${round}`,
        location: 'Miraflores, Lima',
        startsAt: new Date(now + 10 * MINUTE).toISOString(),
        endsAt: new Date(now + 8 * HOUR).toISOString(),
        payCents: 12000,
        requiredWorkers: 1,
        description: 'Turno de prueba de integración de la carrera entre cancelar y resolver.',
        requirements: 'Disponibilidad completa para el horario indicado.',
      });
    expect(created.status).toBe(201);
    const shiftId = created.body.id as string;

    const worker = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: `Trabajador de carrera ${round}`,
      email: `trabajador.cancelrace.${round}@chambeaya.test`,
      password: 'Trabajador123',
      dniOrRuc: `5000${String(round).padStart(4, '0')}`,
    });
    expect(worker.status).toBe(201);
    const application = await request(app)
      .post(`/api/shifts/${shiftId}/applications`)
      .set('Authorization', `Bearer ${worker.body.token as string}`)
      .send({ answers: [] });
    expect(application.status).toBe(201);
    const accepted = await request(app)
      .patch(`/api/business/shifts/${shiftId}/applications/${application.body.id as string}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'ACCEPTED' });
    expect(accepted.status).toBe(200);

    const assignment = await verifier.shiftAssignment.findFirstOrThrow({ where: { shiftId } });
    await verifier.shift.update({ where: { id: shiftId }, data: { startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 2 * HOUR) } });
    await verifier.shiftAssignment.update({ where: { id: assignment.id }, data: { assignedAt: new Date(now - 4 * HOUR) } });

    // Abrir las postulaciones ejecuta el ciclo de vida y persiste el `NO_SHOW`.
    const listing = await request(app).get(`/api/business/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${businessToken}`);
    expect(listing.status).toBe(200);
    expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe('NO_SHOW');
    return { shiftId, assignmentId: assignment.id };
  }

  it(`leaves a serial outcome in each of ${ROUNDS} simultaneous cancel/resolve races`, { timeout: RACE_TIMEOUT_MS }, async () => {
    const outcomes: string[] = [];
    for (let round = 1; round <= ROUNDS; round += 1) {
      const { shiftId, assignmentId } = await shiftWithNoShow(round);

      const [cancel, resolve] = await Promise.all([
        request(app)
          .post(`/api/business/shifts/${shiftId}/cancel`)
          .set('Authorization', `Bearer ${businessToken}`)
          .send({ reason: 'La empresa ya no necesita este turno' }),
        request(app)
          .post(`/api/business/shifts/${shiftId}/assignments/${assignmentId}/resolve`)
          .set('Authorization', `Bearer ${businessToken}`)
          .send({ outcome: 'COMPLETED' }),
      ]);

      const assignment = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      const shift = await verifier.shift.findUniqueOrThrow({ where: { id: shiftId } });
      const payments = await verifier.payment.count({ where: { shiftId } });
      const label = `round ${round}: cancel=${cancel.status} resolve=${resolve.status}`;

      if (cancel.status === 200) {
        // Ganó la cancelación: la resolución ya no encuentra nada resoluble.
        outcomes.push('cancel');
        expect(resolve.status, label).toBe(400);
        expect(resolve.body, label).toMatchObject({ error: 'ASSIGNMENT_NOT_RESOLVABLE' });
        expect(assignment.status, label).toBe('CANCELLED');
        expect(shift.status, label).toBe('CANCELLED');
        expect(payments, label).toBe(0);
      } else {
        // Ganó la resolución: el turno ya es terminal y no se puede cancelar.
        outcomes.push('resolve');
        expect(cancel.status, label).toBe(400);
        expect(cancel.body, label).toMatchObject({ error: 'SHIFT_NOT_CANCELLABLE' });
        expect(resolve.status, label).toBe(200);
        expect(assignment.status, label).toBe('COMPLETED');
        expect(shift.status, label).toBe('COMPLETED');
        expect(payments, label).toBe(1);
      }
    }
    expect(outcomes).toHaveLength(ROUNDS);
  });
});
