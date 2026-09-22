import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';
import { PrivateDocumentStorage } from '../../src/modules/talent/private_document_storage.js';
import { DatabaseTalentService } from '../../src/modules/talent/talent.service.js';

// La empresa lee el CV de un postulante contra PostgreSQL real: valida que las
// consultas anidadas de Prisma (`documents where kind`, `talentProfile`,
// `shift.company.ownerId`) son válidas y aplican la regla de `cv_access.ts`.
// Solo corre con opt-in explícito y contra una base cuyo nombre termina en
// `_test` (mismo guardia que `vertical-marketplace-flow.integration.test.ts`).

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

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');

describe('CV de un postulante con PostgreSQL', () => {
  const prisma = new PrismaClient();
  let storageRoot = '';
  let app: ReturnType<typeof createApp>;
  let databaseReady = false;

  let businessToken = '';
  let otherBusinessToken = '';
  let workerToken = '';
  let workerWithoutCvToken = '';
  let shiftId = '';
  let cvApplicationId = '';
  let noCvApplicationId = '';

  const cvPath = (id: string, shift = shiftId) => `/api/business/shifts/${shift}/applications/${id}/cv`;
  const asBusiness = (path: string, token = businessToken) => request(app).get(path).set('Authorization', `Bearer ${token}`);
  const listed = async () => {
    const response = await asBusiness(`/api/business/shifts/${shiftId}/applications`);
    expect(response.status).toBe(200);
    return Object.fromEntries(
      (response.body as Array<{ id: string; worker: Record<string, unknown> }>).map((item) => [item.id, item.worker]),
    );
  };

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;
    storageRoot = await mkdtemp(join(tmpdir(), 'chambeaya-cv-integration-'));
    app = createApp({
      authService: new DatabaseAuthService(prisma),
      businessService: new DatabaseBusinessService(prisma),
      marketplaceService: new DatabaseMarketplaceService(prisma),
      talentService: new DatabaseTalentService(prisma, new PrivateDocumentStorage(storageRoot)),
    });

    // Las cuentas de empresa no se registran por la API pública: se crean como
    // en `vertical-marketplace-flow.integration.test.ts`.
    const salt = 'integration-test-salt';
    for (const [email, name, identifier] of [
      ['empresa.cv@chambeaya.test', 'Empresa CV', '20123456789'],
      ['otra.cv@chambeaya.test', 'Otra empresa', '20987654321'],
    ]) {
      await prisma.user.create({
        data: { email, passwordHash: hashPassword('Empresa123', salt), salt, role: 'BUSINESS', name, identifier },
      });
    }
    const login = async (email: string) => {
      const response = await request(app).post('/api/auth/login').send({ email, password: 'Empresa123' });
      expect(response.status).toBe(200);
      return response.body.token as string;
    };
    const register = async (body: Record<string, string>) => {
      const response = await request(app).post('/api/auth/register').send({ password: 'ClaveSegura1', ...body });
      expect(response.status).toBe(201);
      return response.body.token as string;
    };
    businessToken = await login('empresa.cv@chambeaya.test');
    otherBusinessToken = await login('otra.cv@chambeaya.test');
    workerToken = await register({ role: 'WORKER', name: 'Ana con CV', email: 'ana.cv@chambeaya.test', dniOrRuc: '12345678' });
    workerWithoutCvToken = await register({ role: 'WORKER', name: 'Luis sin CV', email: 'luis.cv@chambeaya.test', dniOrRuc: '87654321' });
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await prisma.$disconnect();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('prepara el turno, las dos postulaciones y el CV de la trabajadora', async () => {
    const start = new Date(Date.now() + 10 * 60 * 1000);
    const created = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: 'Mesera para prueba de CV',
        location: 'Miraflores, Lima',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 6 * 60 * 60 * 1000).toISOString(),
        payCents: 9000,
        requiredWorkers: 2,
        description: 'Atención de mesas durante la jornada de integración.',
        requirements: 'Disponibilidad completa.',
      });
    expect(created.status).toBe(201);
    shiftId = created.body.id;

    const upload = await request(app)
      .put('/api/workers/me/cv')
      .set('Authorization', `Bearer ${workerToken}`)
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', encodeURIComponent('cv-ana.pdf'))
      .send(PDF);
    expect(upload.status).toBe(201);

    for (const token of [workerToken, workerWithoutCvToken]) {
      const applied = await request(app).post(`/api/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${token}`).send({ answers: [] });
      expect(applied.status).toBe(201);
    }
    const applications = await asBusiness(`/api/business/shifts/${shiftId}/applications`);
    const byName = Object.fromEntries((applications.body as Array<{ id: string; worker: { name: string } }>).map((item) => [item.worker.name, item.id]));
    cvApplicationId = byName['Ana con CV'];
    noCvApplicationId = byName['Luis sin CV'];
    expect(cvApplicationId).toEqual(expect.any(String));
    expect(noCvApplicationId).toEqual(expect.any(String));
  });

  it('lista solo un indicador hasCv y sirve el PDF bajo demanda a la empresa dueña', async () => {
    const workers = await listed();
    expect(workers[cvApplicationId]).toMatchObject({ name: 'Ana con CV', hasCv: true });
    expect(workers[noCvApplicationId]).toMatchObject({ name: 'Luis sin CV', hasCv: false });
    expect(Object.keys(workers[cvApplicationId]).sort()).toEqual(['email', 'hasCv', 'id', 'identifier', 'name']);

    const response = await asBusiness(cvPath(cvApplicationId)).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
    expect(response.status).toBe(200);
    expect((response.body as Buffer).equals(PDF)).toBe(true);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('un postulante sin CV, otra empresa y un trabajador no obtienen el archivo', async () => {
    const noCv = await asBusiness(cvPath(noCvApplicationId));
    expect(noCv.status).toBe(404);
    expect(noCv.body).toEqual({ error: 'CV_NOT_AVAILABLE' });

    const foreign = await asBusiness(cvPath(cvApplicationId), otherBusinessToken);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: 'APPLICATION_NOT_FOUND' });

    const asWorker = await request(app).get(cvPath(cvApplicationId)).set('Authorization', `Bearer ${workerToken}`);
    expect(asWorker.status).toBe(403);
    expect((await request(app).get(cvPath(cvApplicationId))).status).toBe(401);
  });

  it('ocultar el perfil retira el CV al instante y volver a mostrarlo lo devuelve', async () => {
    const hide = await request(app).patch('/api/workers/me/profile').set('Authorization', `Bearer ${workerToken}`).send({ isVisible: false });
    expect(hide.status).toBe(200);

    expect((await listed())[cvApplicationId]).toMatchObject({ hasCv: false });
    const hidden = await asBusiness(cvPath(cvApplicationId));
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual({ error: 'CV_NOT_AVAILABLE' });

    const show = await request(app).patch('/api/workers/me/profile').set('Authorization', `Bearer ${workerToken}`).send({ isVisible: true });
    expect(show.status).toBe(200);
    expect((await listed())[cvApplicationId]).toMatchObject({ hasCv: true });
    expect((await asBusiness(cvPath(cvApplicationId))).status).toBe(200);
  });

  it('una postulación rechazada deja de dar acceso al CV', async () => {
    const rejected = await request(app)
      .patch(`/api/business/shifts/${shiftId}/applications/${cvApplicationId}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'REJECTED', reason: 'No cumple el perfil.' });
    expect(rejected.status).toBe(200);

    expect((await listed())[cvApplicationId]).toMatchObject({ hasCv: false });
    const response = await asBusiness(cvPath(cvApplicationId));
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'CV_NOT_AVAILABLE' });
  });
});
