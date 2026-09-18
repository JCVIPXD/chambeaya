import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Prueba de concurrencia real (no simulada): ejercita el límite de cupos de
// un turno con dos decisiones de aceptación disparadas a la vez con
// `Promise.all` sobre conexiones de Postgres reales, para confirmar que la
// transacción serializable + reintento de `decideShiftApplication`
// (`business.service.ts`) impide que dos trabajadores queden asignados al
// único cupo disponible. El resto de la suite (`business.service.test.ts`)
// cubre la misma regla con Prisma simulado, pero eso solo prueba la lógica
// del código, no el comportamiento real de aislamiento de la base de datos
// bajo una carrera legítima.
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

describe('shift capacity stays consistent under a real concurrent race', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
  });
  let databaseReady = false;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;

    const salt = 'race-test-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.race@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de carrera',
        identifier: '20999999999',
      },
    });
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  it('accepts exactly one of two simultaneous acceptances for the last available slot', async () => {
    const businessLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'empresa.race@chambeaya.test', password: 'Empresa123' });
    expect(businessLogin.status).toBe(200);
    const businessToken = businessLogin.body.token as string;

    const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
    const createdShift = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: 'Anfitriona para prueba de carrera',
        location: 'San Isidro, Lima',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        payCents: 11000,
        requiredWorkers: 1,
        description: 'Un único cupo disputado por dos postulaciones simultáneas.',
        requirements: 'Disponibilidad completa para el horario indicado.',
      });
    expect(createdShift.status).toBe(201);
    const shiftId = createdShift.body.id as string;

    const workerRegistrations = await Promise.all([1, 2].map((index) => request(app)
      .post('/api/auth/register')
      .send({
        role: 'WORKER',
        name: `Trabajadora de carrera ${index}`,
        email: `trabajadora.race.${index}@chambeaya.test`,
        password: 'Trabajador123',
        dniOrRuc: `1234567${index}`,
      })));
    expect(workerRegistrations.map((response) => response.status)).toEqual([201, 201]);
    const workerTokens = workerRegistrations.map((response) => response.body.token as string);

    const applications = await Promise.all(workerTokens.map((token) => request(app)
      .post(`/api/shifts/${shiftId}/applications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [] })));
    expect(applications.map((response) => response.status)).toEqual([201, 201]);
    const applicationIds = applications.map((response) => response.body.id as string);

    // El punto bajo prueba: dos decisiones de aceptación para el mismo turno
    // de un único cupo, disparadas a la vez con `Promise.all` contra la
    // misma base de datos real.
    const decisions = await Promise.all(applicationIds.map((applicationId) => request(app)
      .patch(`/api/business/shifts/${shiftId}/applications/${applicationId}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'ACCEPTED' })));

    const statuses = decisions.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 400]);
    const rejected = decisions.find((response) => response.status === 400);
    expect(rejected?.body).toMatchObject({ error: 'SHIFT_FULL' });
    const accepted = decisions.find((response) => response.status === 200);
    expect(accepted?.body).toMatchObject({ status: 'ACCEPTED' });

    const persistedAssignments = await verifier.shiftAssignment.findMany({ where: { shiftId } });
    expect(persistedAssignments).toHaveLength(1);
    expect(persistedAssignments[0]).toMatchObject({ status: 'ASSIGNED', workerId: expect.any(String) });

    const persistedShift = await verifier.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(persistedShift).toMatchObject({ status: 'ASSIGNED', confirmedWorkers: 1, requiredWorkers: 1 });
  });
});
