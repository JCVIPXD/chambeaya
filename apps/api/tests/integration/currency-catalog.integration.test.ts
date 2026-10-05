import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DEFAULT_CURRENCY_CATALOG } from '../../src/modules/currency/currency.catalog.js';
import { CurrencyCatalogService, type CurrencyUsageCounter } from '../../src/modules/currency/currency.catalog.service.js';
import { virtualCurrencyName } from '../../src/modules/currency/currency.config.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;

function requireTestDatabase() {
  if (process.env.CHAMBEAYA_INTEGRATION_TESTS !== 'true') throw new Error('INTEGRATION_TESTS_REQUIRE_EXPLICIT_OPT_IN');
  if (!integrationDatabaseUrl) throw new Error('INTEGRATION_TESTS_REQUIRE_DATABASE_URL');
  const databaseName = new URL(integrationDatabaseUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!databaseName?.endsWith('_test')) throw new Error('INTEGRATION_TESTS_REQUIRE_TEST_DATABASE');
}

const currency = virtualCurrencyName();

describe('currency catalog (M2) under PostgreSQL', () => {
  const prisma = new PrismaClient();
  const usedByUser = new Map<string, number>();
  const usage: CurrencyUsageCounter = { countUsage: async ({ userId }, actionKey) => usedByUser.get(`${userId}:${actionKey}`) ?? 0 };
  const app = createApp({ rateLimit: false, authService: new DatabaseAuthService(prisma), currencyPrisma: prisma, paymentsPrisma: prisma, currencyUsageCounter: usage });
  let adminToken = '';
  let workerToken = '';
  let businessToken = '';
  let adminId = '';
  let workerId = '';
  let businessId = '';
  let databaseReady = false;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const catalog = async () => (await request(app).get('/api/admin/currency/catalog').set(as(adminToken))).body.items as Array<Record<string, any>>;
  const entryOf = async (actionKey: string, actor: string) => (await catalog()).find((item) => item.actionKey === actionKey && item.actor === actor)!;
  const patch = (id: string, body: object, token = adminToken) => request(app).patch(`/api/admin/currency/catalog/${id}`).set(as(token)).send(body);

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    // `TRUNCATE ... CASCADE` de otras suites también vacía el catálogo (tiene FK a
    // User); aquí se restablece exactamente lo que siembra la migración.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;
    await prisma.currencyCatalogEntry.createMany({ data: DEFAULT_CURRENCY_CATALOG.map((entry) => ({ ...entry })) });

    const salt = 'catalog-salt';
    const [admin, worker, business] = await Promise.all([
      prisma.user.create({ data: { email: 'admin.catalog@chambeaya.test', passwordHash: hashPassword('Admin12345', salt), salt, role: 'ADMIN', name: 'Admin del catalogo', identifier: 'ADMIN-CATALOG-0001' } }),
      prisma.user.create({ data: { email: 'worker.catalog@chambeaya.test', passwordHash: hashPassword('Worker123', salt), salt, role: 'WORKER', name: 'Trabajador del catalogo', identifier: '33334444' } }),
      prisma.user.create({ data: { email: 'business.catalog@chambeaya.test', passwordHash: hashPassword('Business123', salt), salt, role: 'BUSINESS', name: 'Empresa del catalogo', identifier: '20555666777' } }),
    ]);
    adminId = admin.id; workerId = worker.id; businessId = business.id;
    const login = async (email: string, password: string) => (await request(app).post('/api/auth/login').send({ email, password })).body.token as string;
    [adminToken, workerToken, businessToken] = await Promise.all([login(admin.email, 'Admin12345'), login(worker.email, 'Worker123'), login(business.email, 'Business123')]);
  }, 30_000);

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await prisma.$disconnect();
  });

  it('lists the whole provisional catalog to the admin and nothing to other roles', async () => {
    const response = await request(app).get('/api/admin/currency/catalog').set(as(adminToken));
    expect(response.status).toBe(200);
    expect(response.body.currency).toBe(currency);
    expect(response.body.items).toHaveLength(DEFAULT_CURRENCY_CATALOG.length);
    expect(response.body.items.every((item: { isProvisional: boolean }) => item.isProvisional)).toBe(true);
    expect((await request(app).get('/api/admin/currency/catalog').set(as(workerToken))).status).toBe(403);
    expect((await request(app).get('/api/admin/currency/catalog').set(as(businessToken))).status).toBe(403);
    expect((await request(app).get('/api/admin/currency/catalog')).status).toBe(401);
    expect((await patch('whatever', { amount: 3, reason: 'Intento no autorizado' }, workerToken)).status).toBe(403);
    expect((await patch('whatever', { amount: 3, reason: 'Intento no autorizado' }, businessToken)).status).toBe(403);
  });

  it('serves each actor only its active entries without internal data', async () => {
    const worker = await request(app).get('/api/workers/currency/catalog').set(as(workerToken));
    expect(worker.status).toBe(200);
    const keys = worker.body.items.map((item: { actionKey: string }) => item.actionKey).sort();
    expect(keys).toEqual(DEFAULT_CURRENCY_CATALOG.filter((entry) => entry.actor === 'WORKER').map((entry) => entry.actionKey).sort());
    expect(worker.body.items.map((item: { actionKey: string }) => item.actionKey)).not.toContain('JOB_HIGHLIGHT');
    const extra = worker.body.items.find((item: { actionKey: string }) => item.actionKey === 'APPLICATION_EXTRA');
    expect(extra).toEqual({ actionKey: 'APPLICATION_EXTRA', kind: 'COST', amount: 5, freeMonthlyQuota: 10, freeRemaining: 10, refundWindowHours: 72 });
    const reward = worker.body.items.find((item: { actionKey: string }) => item.actionKey === 'PROFILE_COMPLETE');
    expect(reward).toEqual({ actionKey: 'PROFILE_COMPLETE', kind: 'REWARD', amount: 20 });
    expect(JSON.stringify(worker.body)).not.toMatch(/isProvisional|updatedBy|updatedAt|"id"/);

    const business = await request(app).get('/api/business/currency/catalog').set(as(businessToken));
    expect(business.status).toBe(200);
    expect(business.body.items.map((item: { actionKey: string }) => item.actionKey)).not.toContain('APPLICATION_EXTRA');
    expect(business.body.items.find((item: { actionKey: string }) => item.actionKey === 'JOB_PUBLISH_EXTRA')).toMatchObject({ amount: 10, freeMonthlyQuota: 3, freeRemaining: 3 });
    expect((await request(app).get('/api/business/currency/catalog').set(as(workerToken))).status).toBe(403);
    expect((await request(app).get('/api/workers/currency/catalog').set(as(businessToken))).status).toBe(403);
  });

  it('records who, when, why and the old and new value of each change', async () => {
    const entry = await entryOf('JOB_HIGHLIGHT', 'COMPANY');
    const before = Date.now();
    const response = await patch(entry.id, { amount: 15, active: false, reason: 'Prueba de precio para destacados' });
    expect(response.status).toBe(200);
    expect(response.body.changed.sort()).toEqual(['active', 'amount']);
    expect(response.body.entry).toMatchObject({ amount: 15, active: false, isProvisional: false, updatedBy: { id: adminId } });

    const history = await request(app).get(`/api/admin/currency/catalog/changes?entryId=${entry.id}`).set(as(adminToken));
    expect(history.status).toBe(200);
    const rows = history.body.items as Array<Record<string, any>>;
    expect(rows).toHaveLength(2);
    const amountRow = rows.find((row) => row.field === 'amount')!;
    expect(amountRow).toMatchObject({ oldValue: '10', newValue: '15', reason: 'Prueba de precio para destacados', actionKey: 'JOB_HIGHLIGHT', actor: 'COMPANY', changedBy: { id: adminId, name: 'Admin del catalogo' } });
    expect(new Date(amountRow.createdAt).getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(rows.find((row) => row.field === 'active')).toMatchObject({ oldValue: 'true', newValue: 'false' });

    // Inactiva: desaparece del catálogo de la empresa, pero sigue para el admin.
    const business = await request(app).get('/api/business/currency/catalog').set(as(businessToken));
    expect(business.body.items.map((item: { actionKey: string }) => item.actionKey)).not.toContain('JOB_HIGHLIGHT');
    expect((await entryOf('JOB_HIGHLIGHT', 'COMPANY')).active).toBe(false);

    // Un cambio sin diferencias no ensucia el historial.
    const same = await patch(entry.id, { amount: 15, reason: 'Mismo valor otra vez' });
    expect(same.status).toBe(200);
    expect(same.body.changed).toEqual([]);
    expect((await request(app).get(`/api/admin/currency/catalog/changes?entryId=${entry.id}`).set(as(adminToken))).body.items).toHaveLength(2);
  });

  it('paginates the change history with a cursor', async () => {
    const entry = await entryOf('TALENT_INVITE', 'COMPANY');
    for (const amount of [6, 7, 8]) expect((await patch(entry.id, { amount, reason: 'Ajuste escalonado' })).status).toBe(200);
    const first = await request(app).get(`/api/admin/currency/catalog/changes?entryId=${entry.id}&limit=2`).set(as(adminToken));
    expect(first.body.items.map((row: { newValue: string }) => row.newValue)).toEqual(['8', '7']);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(app).get(`/api/admin/currency/catalog/changes?entryId=${entry.id}&limit=2&cursor=${first.body.nextCursor}`).set(as(adminToken));
    expect(second.body.items.map((row: { newValue: string }) => row.newValue)).toEqual(['6']);
    expect(second.body.nextCursor).toBeNull();
    expect((await request(app).get(`/api/admin/currency/catalog/changes?entryId=${entry.id}&cursor=nope`).set(as(adminToken))).status).toBe(400);
  });

  it('rejects invalid edits and fields that do not apply to rewards', async () => {
    const reward = await entryOf('REFERRAL', 'WORKER');
    const quota = await patch(reward.id, { freeMonthlyQuota: 2, reason: 'Cuota en un premio' });
    expect(quota.status).toBe(400);
    expect(quota.body).toEqual({ error: 'CATALOG_FIELD_NOT_APPLICABLE' });
    expect((await patch(reward.id, { refundWindowHours: 24, reason: 'Devolucion en un premio' })).status).toBe(400);
    expect((await patch(reward.id, { refundWindowHours: null, amount: 25, reason: 'Subir el premio' })).status).toBe(200);
    expect((await patch(reward.id, { amount: 0, reason: 'Monto en cero' })).status).toBe(400);
    expect((await patch(reward.id, { amount: 5 })).status).toBe(400);
    expect((await patch('no-existe', { amount: 5, reason: 'Entrada inexistente' })).body).toEqual({ error: 'CATALOG_ENTRY_NOT_FOUND' });
    expect((await entryOf('REFERRAL', 'WORKER')).amount).toBe(25);
    // La base también protege (CHECK) aunque se salte la API.
    await expect(prisma.$executeRawUnsafe(`UPDATE "CurrencyCatalogEntry" SET "amount" = 0 WHERE "id" = '${reward.id}'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "CurrencyCatalogEntry" SET "freeMonthlyQuota" = 1 WHERE "id" = '${reward.id}'`)).rejects.toThrow();
  });

  it('chains concurrent edits so every change keeps the real previous value', async () => {
    const entry = await entryOf('CANDIDATE_CONTACT_UNLOCK', 'COMPANY');
    const amounts = [21, 22, 23, 24, 25, 26];
    const responses = await Promise.all(amounts.map((amount) => patch(entry.id, { amount, reason: 'Edicion concurrente' })));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const rows = await prisma.currencyCatalogChange.findMany({ where: { entryId: entry.id, field: 'amount' }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(amounts.length);
    expect(rows[0]!.oldValue).toBe('10');
    rows.slice(1).forEach((row, index) => expect(row.oldValue).toBe(rows[index]!.newValue));
    expect((await entryOf('CANDIDATE_CONTACT_UNLOCK', 'COMPANY')).amount).toBe(Number(rows.at(-1)!.newValue));
  });

  it('keeps the audit trail when the admin who edited is deleted', async () => {
    const entry = await entryOf('PROFILE_HIGHLIGHT', 'WORKER');
    const salt = 'temp-admin';
    const temp = await prisma.user.create({ data: { email: 'temp.admin.catalog@chambeaya.test', passwordHash: hashPassword('Admin12345', salt), salt, role: 'ADMIN', name: 'Admin temporal', identifier: 'ADMIN-CATALOG-0002' } });
    const token = (await request(app).post('/api/auth/login').send({ email: temp.email, password: 'Admin12345' })).body.token as string;
    expect((await patch(entry.id, { amount: 11, reason: 'Cambio de un admin temporal' }, token)).status).toBe(200);
    await prisma.user.delete({ where: { id: temp.id } });
    const row = await prisma.currencyCatalogChange.findFirst({ where: { entryId: entry.id } });
    expect(row).toMatchObject({ oldValue: '10', newValue: '11', changedById: null });
  });

  it('resolves cost, quota and charge without touching the ledger', async () => {
    const service = new CurrencyCatalogService(prisma, usage, currency, () => new Date('2026-11-01T04:59:59Z'));
    const movementsBefore = await prisma.currencyMovement.count();
    usedByUser.set(`${workerId}:APPLICATION_EXTRA`, 9);
    const inside = await service.resolve('APPLICATION_EXTRA', 'WORKER', workerId);
    expect(inside).toMatchObject({ charge: false, amount: 5, refundWindowHours: 72 });
    expect(inside.freeQuota).toMatchObject({ remaining: 1, periodStart: '2026-10-01T05:00:00.000Z', periodEnd: '2026-11-01T05:00:00.000Z' });
    usedByUser.set(`${workerId}:APPLICATION_EXTRA`, 10);
    expect(await service.resolve('APPLICATION_EXTRA', 'WORKER', workerId)).toMatchObject({ charge: true, chargeAmount: 5 });
    // El mismo conteo en la API refleja la cuota restante del usuario.
    const listed = await request(app).get('/api/workers/currency/catalog').set(as(workerToken));
    expect(listed.body.items.find((item: { actionKey: string }) => item.actionKey === 'APPLICATION_EXTRA').freeRemaining).toBe(0);

    expect(await service.resolve('WELCOME_BONUS', 'COMPANY', businessId)).toMatchObject({ kind: 'REWARD', rewardAmount: 50, charge: false });
    // Acción desactivada y acción inexistente: gratuitas, nunca bloquean.
    expect(await service.resolve('JOB_HIGHLIGHT', 'COMPANY', businessId)).toMatchObject({ active: false, charge: false, chargeAmount: 0 });
    expect(await service.resolve('NO_SUCH_ACTION', 'COMPANY', businessId)).toMatchObject({ kind: null, charge: false });
    // Una acción del otro actor no existe para este.
    expect(await service.resolve('APPLICATION_EXTRA', 'COMPANY', businessId)).toMatchObject({ kind: null, charge: false });
    expect(await prisma.currencyMovement.count()).toBe(movementsBefore);
  });
});
