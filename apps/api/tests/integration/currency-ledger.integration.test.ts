import { PrismaClient } from '@prisma/client';
import { mkdtempSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { virtualCurrencyName } from '../../src/modules/currency/currency.config.js';
import { PrivateDocumentStorage } from '../../src/modules/talent/private_document_storage.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;

function requireTestDatabase() {
  if (process.env.CHAMBEAYA_INTEGRATION_TESTS !== 'true') throw new Error('INTEGRATION_TESTS_REQUIRE_EXPLICIT_OPT_IN');
  if (!integrationDatabaseUrl) throw new Error('INTEGRATION_TESTS_REQUIRE_DATABASE_URL');
  const databaseName = new URL(integrationDatabaseUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!databaseName?.endsWith('_test')) throw new Error('INTEGRATION_TESTS_REQUIRE_TEST_DATABASE');
}

// El almacenamiento privado del router de admin usa DOCUMENT_STORAGE_ROOT al
// construirse; se aísla en un directorio temporal para las pruebas de borrado.
const documentRoot = mkdtempSync(join(tmpdir(), 'chambeaya-currency-docs-'));
process.env.DOCUMENT_STORAGE_ROOT = documentRoot;
const currency = virtualCurrencyName();

describe('currency ledger under PostgreSQL concurrency', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    rateLimit: false,
    authService: new DatabaseAuthService(prisma),
    currencyPrisma: prisma,
    paymentsPrisma: prisma,
  });
  let adminToken = '';
  let workerToken = '';
  let businessToken = '';
  let workerId = '';
  let companyId = '';
  let databaseReady = false;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;

    const adminSalt = 'currency-admin-salt';
    const workerSalt = 'currency-worker-salt';
    const businessSalt = 'currency-business-salt';
    const [admin, worker, business] = await Promise.all([
      prisma.user.create({ data: { email: 'admin.currency@chambeaya.test', passwordHash: hashPassword('Admin12345', adminSalt), salt: adminSalt, role: 'ADMIN', name: 'Admin de moneda', identifier: 'ADMIN-CURRENCY-0001' } }),
      prisma.user.create({ data: { email: 'worker.currency@chambeaya.test', passwordHash: hashPassword('Worker123', workerSalt), salt: workerSalt, role: 'WORKER', name: 'Trabajador de moneda', identifier: '11112222' } }),
      prisma.user.create({ data: { email: 'business.currency@chambeaya.test', passwordHash: hashPassword('Business123', businessSalt), salt: businessSalt, role: 'BUSINESS', name: 'Empresa de moneda', identifier: '20987654321' } }),
    ]);
    workerId = worker.id;
    const company = await prisma.company.create({ data: { ownerId: business.id, name: 'Empresa de moneda', ruc: '20987654321' } });
    companyId = company.id;
    const login = async (email: string, password: string) => (await request(app).post('/api/auth/login').send({ email, password })).body.token as string;
    [adminToken, workerToken, businessToken] = await Promise.all([
      login(admin.email, 'Admin12345'), login(worker.email, 'Worker123'), login(business.email, 'Business123'),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
    await rm(documentRoot, { recursive: true, force: true });
  });

  const adminAdjustment = (path: string, quantity: number, key: string, reason = 'Ajuste de prueba con motivo') => request(app)
    .post(path).set('Authorization', `Bearer ${adminToken}`).send({ quantity, reason, idempotencyKey: key });

  it('keeps legacy wallet data separate and serves the right account to each role', async () => {
    expect((await request(app).get('/api/workers/currency/balance').set('Authorization', `Bearer ${workerToken}`)).body).toEqual({ currency, balance: 0 });
    expect((await request(app).get('/api/business/currency/balance').set('Authorization', `Bearer ${businessToken}`)).body).toEqual({ currency, balance: 0 });
    expect((await request(app).get('/api/business/currency/balance').set('Authorization', `Bearer ${workerToken}`)).status).toBe(403);

    const workerCredit = await adminAdjustment(`/api/admin/currency/workers/${workerId}/adjustments`, 50, 'currency-worker-credit-001');
    expect(workerCredit.status).toBe(201);
    expect(workerCredit.body.movement).toMatchObject({ quantity: 50, balanceAfter: 50, action: 'ADMIN_ADJUSTMENT', reason: 'Ajuste de prueba con motivo', actor: { id: expect.any(String) } });

    const companyCredit = await adminAdjustment(`/api/admin/currency/companies/${companyId}/adjustments`, 9, 'currency-company-credit-001');
    expect(companyCredit.status).toBe(201);
    expect((await request(app).get('/api/business/currency/balance').set('Authorization', `Bearer ${businessToken}`)).body).toEqual({ currency, balance: 9 });
    expect(await verifier.walletMovement.count()).toBe(0);
  });

  it('is idempotent, paginates its append-only movements, and rejects an overdraw', async () => {
    const same = '/api/admin/currency/workers/' + workerId + '/adjustments';
    const replay = await adminAdjustment(same, 50, 'currency-worker-credit-001');
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);

    const overdraw = await adminAdjustment(same, -51, 'currency-worker-overdraw-001');
    expect(overdraw.status).toBe(409);
    expect(overdraw.body).toEqual({ error: 'INSUFFICIENT_CURRENCY_BALANCE' });

    expect((await adminAdjustment(same, 1, 'currency-worker-page-001')).status).toBe(201);
    expect((await adminAdjustment(same, 1, 'currency-worker-page-002')).status).toBe(201);
    const first = await request(app).get('/api/workers/currency/movements?limit=2').set('Authorization', `Bearer ${workerToken}`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await request(app).get(`/api/workers/currency/movements?limit=2&cursor=${first.body.nextCursor}`).set('Authorization', `Bearer ${workerToken}`);
    expect(second.status).toBe(200);
    expect(second.body.items.length).toBeGreaterThan(0);
  });

  it('serializes concurrent debits so no request can create a negative balance or a duplicate spend', async () => {
    const path = `/api/admin/currency/workers/${workerId}/adjustments`;
    // El saldo llega a 52 tras los dos créditos de la prueba anterior. Cinco
    // débitos de 10 pueden ganar; las demás solicitudes concurrentes deben
    // perder con 409, nunca con 500 ni con un saldo negativo.
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => adminAdjustment(path, -10, `currency-concurrent-debit-${index}`)));
    expect(responses.every((response) => [201, 409].includes(response.status))).toBe(true);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(5);

    const balance = await request(app).get('/api/workers/currency/balance').set('Authorization', `Bearer ${workerToken}`);
    expect(balance.body.balance).toBe(2);
    const movements = await verifier.currencyMovement.findMany({ where: { account: { workerId } }, orderBy: { sequence: 'asc' } });
    expect(movements.every((movement) => movement.balanceAfter >= 0)).toBe(true);
    expect(movements.map((movement) => movement.sequence)).toEqual(movements.map((_, index) => index + 1));
  }, 30_000);

  describe('superadmin deletion of holders with a currency account (CN-20261001-035)', () => {
    const storage = new PrivateDocumentStorage(documentRoot);
    const exists = (key: string) => access(join(documentRoot, key)).then(() => true, () => false);
    const del = (path: string) => request(app).delete(path).set('Authorization', `Bearer ${adminToken}`);

    async function newWorker(tag: string, withDocument: boolean) {
      const user = await prisma.user.create({ data: { email: `worker.${tag}@chambeaya.test`, passwordHash: 'x', salt: 'x', role: 'WORKER', name: `Trabajador ${tag}`, identifier: `9${Math.floor(1e7 + Math.random() * 9e7)}` } });
      let storageKey: string | null = null;
      if (withDocument) {
        const stored = await storage.put({ originalName: 'cv.pdf', mediaType: 'application/pdf', sizeBytes: 3, bytes: Buffer.from('cv!'), extension: 'pdf' });
        storageKey = stored.storageKey;
        await prisma.workerDocument.create({ data: { userId: user.id, kind: 'CV', storageKey, originalName: 'cv.pdf', mediaType: 'application/pdf', sizeBytes: 3 } });
      }
      return { user, storageKey };
    }

    it('answers 409 and keeps rows and files when the worker has ledger movements', async () => {
      const { user, storageKey } = await newWorker('ledger', true);
      expect((await adminAdjustment(`/api/admin/currency/workers/${user.id}/adjustments`, 5, 'currency-delete-worker-001')).status).toBe(201);

      const response = await del(`/api/admin/workers/${user.id}`);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'CURRENCY_LEDGER_RETAINED' });
      expect(await exists(storageKey!)).toBe(true);
      expect(await verifier.workerDocument.count({ where: { userId: user.id } })).toBe(1);
      expect(await verifier.user.count({ where: { id: user.id } })).toBe(1);
      expect(await verifier.currencyMovement.count({ where: { account: { workerId: user.id } } })).toBe(1);
    });

    it('deletes a worker without ledger history, its empty account and its files', async () => {
      const { user, storageKey } = await newWorker('clean', true);
      await prisma.currencyAccount.create({ data: { ownerType: 'WORKER', workerId: user.id } });

      const response = await del(`/api/admin/workers/${user.id}`);

      expect(response.status).toBe(204);
      expect(await exists(storageKey!)).toBe(false);
      expect(await verifier.user.count({ where: { id: user.id } })).toBe(0);
      expect(await verifier.currencyAccount.count({ where: { workerId: user.id } })).toBe(0);
    });

    it('answers 409 for a company with ledger movements and deletes one without', async () => {
      const owner = await prisma.user.create({ data: { email: 'owner.ledger@chambeaya.test', passwordHash: 'x', salt: 'x', role: 'BUSINESS', name: 'Empresa con libro', identifier: '20111111111' } });
      const company = await prisma.company.create({ data: { ownerId: owner.id, name: 'Empresa con libro', ruc: '20111111111' } });
      expect((await adminAdjustment(`/api/admin/currency/companies/${company.id}/adjustments`, 7, 'currency-delete-company-001')).status).toBe(201);

      const blocked = await del(`/api/admin/companies/${company.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body).toEqual({ error: 'CURRENCY_LEDGER_RETAINED' });
      expect(await verifier.company.count({ where: { id: company.id } })).toBe(1);
      expect(await verifier.user.count({ where: { id: owner.id } })).toBe(1);

      const cleanOwner = await prisma.user.create({ data: { email: 'owner.clean@chambeaya.test', passwordHash: 'x', salt: 'x', role: 'BUSINESS', name: 'Empresa limpia', identifier: '20222222222' } });
      const cleanCompany = await prisma.company.create({ data: { ownerId: cleanOwner.id, name: 'Empresa limpia', ruc: '20222222222' } });
      await prisma.currencyAccount.create({ data: { ownerType: 'COMPANY', companyId: cleanCompany.id } });
      expect((await del(`/api/admin/companies/${cleanCompany.id}`)).status).toBe(204);
      expect(await verifier.company.count({ where: { id: cleanCompany.id } })).toBe(0);
      expect(await verifier.currencyAccount.count({ where: { companyId: cleanCompany.id } })).toBe(0);
    });
  });
});
