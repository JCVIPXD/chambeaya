import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

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

describe('vertical marketplace flow with PostgreSQL', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
  });

  let businessToken = '';
  let workerToken = '';
  let shiftId = '';
  let applicationId = '';
  let assignmentId = '';
  let databaseReady = false;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;

    const salt = 'integration-test-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.integration@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de integración',
        identifier: '20123456789',
      },
    });
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  it('persists publication, application, acceptance, coverage and state through real HTTP routes', async () => {
    const businessLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'empresa.integration@chambeaya.test', password: 'Empresa123' });
    expect(businessLogin.status).toBe(200);
    businessToken = businessLogin.body.token;

    const workerRegistration = await request(app)
      .post('/api/auth/register')
      .send({
        role: 'WORKER',
        name: 'Trabajadora de integración',
        email: 'trabajadora.integration@chambeaya.test',
        password: 'Trabajador123',
        dniOrRuc: '12345678',
    });
    expect(workerRegistration.status).toBe(201);
    workerToken = workerRegistration.body.token;
    const workerUserId = workerRegistration.body.userId;
    expect(workerUserId).toEqual(expect.any(String));

    // El check-in real (segunda prueba de este archivo) exige estar dentro
    // de la ventana de tolerancia alrededor de `startsAt` (ver
    // `CHECK_IN_EARLY_TOLERANCE_MS`/`CHECK_IN_LATE_LIMIT_MS` en
    // `shift-state.ts`, 30 y 60 minutos respectivamente): `startsAt` debe
    // quedar cerca de "ahora", no a 48 horas vista como antes de esa regla.
    const start = new Date(Date.now() + 10 * 60 * 1000);
    const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
    const createdShift = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: 'Anfitriona para prueba integrada',
        location: 'Miraflores, Lima',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        payCents: 12500,
        requiredWorkers: 1,
        description: 'Atención de invitados durante la jornada de integración.',
        requirements: 'Disponibilidad completa para el horario indicado.',
      });
    expect(createdShift.status).toBe(201);
    expect(createdShift.body).toMatchObject({ status: 'PUBLISHED', confirmedWorkers: 0, requiredWorkers: 1 });
    shiftId = createdShift.body.id;

    const availableShifts = await request(app).get('/api/shifts');
    expect(availableShifts.status).toBe(200);
    expect(availableShifts.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: shiftId, role: 'Anfitriona para prueba integrada', status: 'PUBLISHED' }),
    ]));

    const application = await request(app)
      .post(`/api/shifts/${shiftId}/applications`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ answers: [] });
    expect(application.status).toBe(201);
    expect(application.body).toMatchObject({ shiftId, status: 'PENDING' });
    applicationId = application.body.id;

    const pendingForBusiness = await request(app)
      .get(`/api/business/shifts/${shiftId}/applications`)
      .set('Authorization', `Bearer ${businessToken}`);
    expect(pendingForBusiness.status).toBe(200);
    expect(pendingForBusiness.body).toEqual([
      expect.objectContaining({ id: applicationId, status: 'PENDING', worker: expect.objectContaining({ email: 'trabajadora.integration@chambeaya.test' }) }),
    ]);

    const accepted = await request(app)
      .patch(`/api/business/shifts/${shiftId}/applications/${applicationId}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'ACCEPTED' });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ id: applicationId, status: 'ACCEPTED' });

    const acceptedForBusiness = await request(app)
      .get(`/api/business/shifts/${shiftId}/applications`)
      .set('Authorization', `Bearer ${businessToken}`);
    expect(acceptedForBusiness.status).toBe(200);
    expect(acceptedForBusiness.body).toEqual([
      expect.objectContaining({
        id: applicationId,
        workerId: workerUserId,
        status: 'ACCEPTED',
        assignment: expect.objectContaining({ status: 'ASSIGNED', workerId: workerUserId }),
      }),
    ]);
    assignmentId = acceptedForBusiness.body[0].assignment.id;

    const workerApplications = await request(app)
      .get('/api/workers/applications')
      .set('Authorization', `Bearer ${workerToken}`);
    expect(workerApplications.status).toBe(200);
    expect(workerApplications.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: applicationId,
        status: 'ACCEPTED',
        assignment: expect.objectContaining({ status: 'ASSIGNED' }),
      }),
    ]));

    const businessShift = await request(app)
      .get(`/api/business/shifts/${shiftId}`)
      .set('Authorization', `Bearer ${businessToken}`);
    expect(businessShift.status).toBe(200);
    expect(businessShift.body).toMatchObject({ id: shiftId, status: 'ASSIGNED', confirmedWorkers: 1, requiredWorkers: 1 });

    const unavailableAfterCoverage = await request(app).get('/api/shifts');
    expect(unavailableAfterCoverage.status).toBe(200);
    expect(Array.isArray(unavailableAfterCoverage.body)).toBe(true);
    expect(unavailableAfterCoverage.body).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: shiftId }),
    ]));

    const persisted = await verifier.shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: { applications: { include: { assignment: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    expect(persisted).toMatchObject({ status: 'ASSIGNED', confirmedWorkers: 1, requiredWorkers: 1 });
    expect(persisted.applications).toEqual([
      expect.objectContaining({
        id: applicationId,
        workerId: workerUserId,
        status: 'ACCEPTED',
        assignment: expect.objectContaining({ status: 'ASSIGNED', workerId: workerUserId }),
      }),
    ]);
    expect(persisted.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'PUBLISHED',
      'APPLICATION_SUBMITTED',
      'APPLICATION_ACCEPTED',
    ]));
  });

  it('permits one review from each participant only after the assignment is completed', async () => {
    const applications = await request(app)
      .get('/api/workers/applications')
      .set('Authorization', `Bearer ${workerToken}`);
    expect(applications.status).toBe(200);
    const credential = applications.body.find((item: { shiftId: string }) => item.shiftId === shiftId)?.assignment?.checkInCredential;
    expect(credential).toEqual(expect.any(String));

    expect((await request(app).post(`/api/shifts/${shiftId}/confirm`).set('Authorization', `Bearer ${workerToken}`)).status).toBe(200);
    expect((await request(app).post(`/api/shifts/${shiftId}/check-in`).set('Authorization', `Bearer ${workerToken}`).send({ credential })).status).toBe(200);
    expect((await request(app).post(`/api/shifts/${shiftId}/check-out`).set('Authorization', `Bearer ${workerToken}`)).status).toBe(200);

    const workerReview = await request(app)
      .post(`/api/assignments/${assignmentId}/reviews`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ rating: 5, comment: 'Turno bien coordinado.' });
    expect(workerReview.status).toBe(201);
    expect(workerReview.body).toMatchObject({ assignmentId, authorRole: 'WORKER', rating: 5 });

    expect((await request(app)
      .post(`/api/assignments/${assignmentId}/reviews`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ rating: 4 })).status).toBe(409);

    const businessReview = await request(app)
      .post(`/api/assignments/${assignmentId}/reviews`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ rating: 4, comment: 'Llegó a tiempo.' });
    expect(businessReview.status).toBe(201);

    const persisted = await verifier.assignmentReview.findMany({ where: { assignmentId }, orderBy: { authorRole: 'asc' } });
    expect(persisted).toEqual([
      expect.objectContaining({ authorRole: 'WORKER', rating: 5 }),
      expect.objectContaining({ authorRole: 'BUSINESS', rating: 4 }),
    ]);
  });
});
