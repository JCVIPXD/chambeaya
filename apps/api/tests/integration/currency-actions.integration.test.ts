import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { CurrencyActionService } from '../../src/modules/currency/currency.actions.js';
import { DEFAULT_CURRENCY_CATALOG } from '../../src/modules/currency/currency.catalog.js';
import { CurrencyRefundService } from '../../src/modules/currency/currency.refunds.js';
import { DEFAULT_CURRENCY_SETTINGS } from '../../src/modules/currency/currency.settings.js';
import { WelcomeBonusService } from '../../src/modules/currency/currency.welcome.js';
import { DatabaseCandidateUnlockService } from '../../src/modules/talent/candidate_unlock.service.js';
import { PrivateDocumentStorage } from '../../src/modules/talent/private_document_storage.js';
import { DatabaseTalentService } from '../../src/modules/talent/talent.service.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;

function requireTestDatabase() {
  if (process.env.CHAMBEAYA_INTEGRATION_TESTS !== 'true') throw new Error('INTEGRATION_TESTS_REQUIRE_EXPLICIT_OPT_IN');
  if (!integrationDatabaseUrl) throw new Error('INTEGRATION_TESTS_REQUIRE_DATABASE_URL');
  const databaseName = new URL(integrationDatabaseUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!databaseName?.endsWith('_test')) throw new Error('INTEGRATION_TESTS_REQUIRE_TEST_DATABASE');
}

type Account = { id: string; token: string; email: string; companyId?: string };
const FUTURE_START = '2099-01-15';
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);

describe('currency-connected actions (M4) under PostgreSQL', () => {
  const prisma = new PrismaClient();
  let storageRoot = '';
  let clockNow: Date | null = null;
  let app: ReturnType<typeof createApp>;
  let admin: Account;
  let counter = 0;
  let databaseReady = false;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const clock = () => clockNow ?? new Date();

  async function makeAccount(role: 'WORKER' | 'BUSINESS' | 'ADMIN', label: string): Promise<Account> {
    counter += 1;
    const salt = 'actions-salt';
    const email = `${label}.${counter}@chambeaya.test`;
    const identifier = role === 'WORKER' ? String(50_000_000 + counter) : role === 'BUSINESS' ? String(20_600_000_000 + counter) : `ADMIN-ACTIONS-${counter}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: hashPassword('Password123', salt), salt, role, name: `Cuenta ${label} ${counter}`, identifier },
    });
    const company = role === 'BUSINESS' ? await prisma.company.create({ data: { ownerId: user.id, name: `Empresa ${counter}`, ruc: identifier } }) : null;
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123' });
    return { id: user.id, token: login.body.token as string, email, companyId: company?.id };
  }

  const fund = async (account: Account, quantity: number) => {
    const path = account.companyId ? `companies/${account.companyId}` : `workers/${account.id}`;
    const response = await request(app).post(`/api/admin/currency/${path}/adjustments`).set(as(admin.token))
      .send({ quantity, reason: 'Fondos de prueba', idempotencyKey: `fund-${account.id}-${(counter += 1)}` });
    expect(response.status).toBe(201);
  };
  const balanceOf = async (account: Account) => {
    const last = await prisma.currencyMovement.findFirst({
      where: { account: account.companyId ? { companyId: account.companyId } : { workerId: account.id } },
      orderBy: { sequence: 'desc' },
    });
    return last?.balanceAfter ?? 0;
  };
  const movementsOf = (account: Account) => prisma.currencyMovement.findMany({
    where: { account: account.companyId ? { companyId: account.companyId } : { workerId: account.id } },
    orderBy: { sequence: 'asc' },
  });
  const usesOf = (account: Account, actionKey?: string) => prisma.currencyActionUse.findMany({ where: { userId: account.id, ...(actionKey ? { actionKey } : {}) } });

  const postingBody = (over: Record<string, unknown> = {}) => ({
    title: 'Cajera de tienda de ropa',
    description: 'Atencion al cliente, caja y reposicion en tienda de ropa en Lima.',
    modality: 'ONSITE', workload: 'FULL_TIME', salaryMinCents: 150000, salaryMaxCents: 200000,
    location: 'Miraflores, Lima', contractType: 'INDEFINITE', vacancies: 3,
    ...over,
  });
  const draft = async (company: Account, over: Record<string, unknown> = {}) => {
    const created = await request(app).post('/api/business/job-postings').set(as(company.token)).send(postingBody(over));
    expect(created.status).toBe(201);
    return created.body.id as string;
  };
  const publish = (company: Account, postingId: string) => request(app).post(`/api/business/job-postings/${postingId}/publish`).set(as(company.token));
  const published = async (company: Account, over: Record<string, unknown> = {}) => {
    const id = await draft(company, over);
    expect((await publish(company, id)).status).toBe(200);
    return id;
  };
  const apply = (worker: Account, postingId: string, body: Record<string, unknown> = {}) =>
    request(app).post(`/api/workers/job-postings/${postingId}/applications`).set(as(worker.token)).send(body);
  const withdraw = (worker: Account, applicationId: string) =>
    request(app).post(`/api/workers/job-applications/${applicationId}/withdraw`).set(as(worker.token));

  /** Registra `count` usos gratuitos del mes para agotar la cuota sin pasar por la API. */
  async function exhaustQuota(account: Account, actionKey: string, count: number, at = new Date()) {
    await prisma.currencyActionUse.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        userId: account.id, actor: account.companyId ? 'COMPANY' as const : 'WORKER' as const, actionKey, instanceKey: `seed:${account.id}:${actionKey}:${index}`, chargedAmount: 0, occurredAt: at,
      })),
    });
  }

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    // Otras suites vacian el catalogo y los ajustes con `TRUNCATE ... CASCADE`; se restablece lo sembrado por la migracion.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;
    await prisma.currencyCatalogEntry.createMany({ data: DEFAULT_CURRENCY_CATALOG.map((entry) => ({ ...entry })) });
    await prisma.currencySetting.createMany({ data: Object.entries(DEFAULT_CURRENCY_SETTINGS).map(([key, value]) => ({ key, value })) });
    storageRoot = await mkdtemp(join(tmpdir(), 'chambeaya-actions-'));
    process.env.DOCUMENT_STORAGE_ROOT = storageRoot;
    const storage = new PrivateDocumentStorage(storageRoot);
    app = createApp({
      rateLimit: false,
      authService: new DatabaseAuthService(prisma, { onWorkerCreated: async (workerId) => { await new WelcomeBonusService(prisma, new CurrencyActionService(clock)).grantForWorker(workerId); } }),
      currencyPrisma: prisma,
      paymentsPrisma: prisma,
      jobsPrisma: prisma,
      currencyClock: clock,
      talentService: new DatabaseTalentService(prisma, storage),
      candidateUnlockService: new DatabaseCandidateUnlockService(prisma, new CurrencyActionService(clock), storage),
    });
    admin = await makeAccount('ADMIN', 'admin');
  }, 60_000);

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await prisma.$disconnect();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Bono de bienvenida
  // -------------------------------------------------------------------------

  it('grants the welcome bonus once when a worker registers or an admin creates a company, and regularizes old accounts idempotently', async () => {
    const registered = await request(app).post('/api/auth/register').send({ role: 'WORKER', name: 'Nuevo Trabajador', email: 'nuevo.trabajador@chambeaya.test', password: 'Password123', dniOrRuc: '61000001' });
    expect(registered.status).toBe(201);
    const workerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'nuevo.trabajador@chambeaya.test' } })).id;
    const bonus = await prisma.currencyMovement.findMany({ where: { account: { workerId } } });
    expect(bonus).toHaveLength(1);
    expect(bonus[0]).toMatchObject({ quantity: 50, balanceAfter: 50, action: 'REWARD', actionKey: 'WELCOME_BONUS', idempotencyKey: `welcome-bonus:WORKER:${workerId}` });
    const balance = await request(app).get('/api/workers/currency/balance').set(as(registered.body.token));
    expect(balance.body.balance).toBe(50);
    // Un segundo intento (reintento, ruta de regularizacion) no paga otra vez.
    const welcome = new WelcomeBonusService(prisma, new CurrencyActionService());
    expect((await welcome.grantForWorker(workerId)).idempotent).toBe(true);

    const created = await request(app).post('/api/admin/companies').set(as(admin.token))
      .send({ name: 'Empresa Nueva SAC', ruc: '20611111111', email: 'empresa.nueva@chambeaya.test', password: 'Password123' });
    expect(created.status).toBe(201);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: created.body.id as string } });
    expect((await prisma.currencyMovement.findMany({ where: { account: { companyId: company.id } } })).map((movement) => movement.balanceAfter)).toEqual([50]);

    // Cuentas anteriores a M4 (creadas sin bono): la ruta de administracion las regulariza una sola vez.
    const oldWorker = await makeAccount('WORKER', 'antiguo');
    const oldCompany = await makeAccount('BUSINESS', 'antigua');
    expect(await balanceOf(oldWorker)).toBe(0);
    const first = await request(app).post('/api/admin/currency/welcome-bonus/backfill').set(as(admin.token));
    expect(first.status).toBe(200);
    expect(first.body.workers.granted).toBeGreaterThanOrEqual(1);
    expect(first.body.companies.granted).toBeGreaterThanOrEqual(1);
    expect([await balanceOf(oldWorker), await balanceOf(oldCompany)]).toEqual([50, 50]);
    const second = await request(app).post('/api/admin/currency/welcome-bonus/backfill').set(as(admin.token));
    expect(second.body.workers.granted).toBe(0);
    expect(second.body.companies.granted).toBe(0);
    expect([await balanceOf(oldWorker), await balanceOf(oldCompany)]).toEqual([50, 50]);
    const worker = await makeAccount('WORKER', 'sin-permiso');
    expect((await request(app).post('/api/admin/currency/welcome-bonus/backfill').set(as(worker.token))).status).toBe(403);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Publicar y postular: cuota gratuita, cobro y atomicidad
  // -------------------------------------------------------------------------

  it('publishes within the monthly free quota, then charges the catalog cost with 409 INSUFFICIENT_CURRENCY and no side effects', async () => {
    const company = await makeAccount('BUSINESS', 'cuota-empresa');
    for (let index = 0; index < 3; index += 1) {
      const response = await publish(company, await draft(company));
      expect([response.status, response.body.chargedAmount]).toEqual([200, 0]);
    }
    expect(await prisma.currencyMovement.count({ where: { account: { companyId: company.companyId } } })).toBe(0);
    expect((await usesOf(company, 'JOB_PUBLISH_EXTRA')).map((use) => use.chargedAmount)).toEqual([0, 0, 0]);

    // La cuarta publicacion cuesta 10 y no hay saldo: nada cambia.
    const fourth = await draft(company);
    const rejected = await publish(company, fourth);
    expect([rejected.status, rejected.body]).toMatchObject([409, { error: 'INSUFFICIENT_CURRENCY', cost: 10, balance: 0 }]);
    expect((await prisma.jobPosting.findUniqueOrThrow({ where: { id: fourth } })).status).toBe('DRAFT');
    expect(await usesOf(company, 'JOB_PUBLISH_EXTRA')).toHaveLength(3);

    await fund(company, 10);
    const paid = await publish(company, fourth);
    expect([paid.status, paid.body.chargedAmount, paid.body.status]).toEqual([200, 10, 'PUBLISHED']);
    expect(await balanceOf(company)).toBe(0);
    const charge = (await movementsOf(company)).at(-1)!;
    expect(charge).toMatchObject({ quantity: -10, action: 'ACTION_CHARGE', actionKey: 'JOB_PUBLISH_EXTRA', relatedEntityType: 'JobPosting', relatedEntityId: fourth, idempotencyKey: `charge:job-publish:${fourth}` });
    // Repetir el clic o pausar y volver a publicar no cobra otra vez.
    expect((await publish(company, fourth)).body.idempotent).toBe(true);
    expect((await request(app).post(`/api/business/job-postings/${fourth}/pause`).set(as(company.token))).status).toBe(200);
    expect((await publish(company, fourth)).body.chargedAmount).toBe(0);
    expect(await balanceOf(company)).toBe(0);
    expect(await prisma.currencyMovement.count({ where: { account: { companyId: company.companyId }, actionKey: 'JOB_PUBLISH_EXTRA' } })).toBe(1);
  }, 60_000);

  it('never overdraws or double charges when two postings are published at once with exactly one charge of balance', async () => {
    const company = await makeAccount('BUSINESS', 'carrera-publicar');
    await exhaustQuota(company, 'JOB_PUBLISH_EXTRA', 3);
    await fund(company, 10);
    const [first, second] = [await draft(company), await draft(company)];
    const results = await Promise.all([publish(company, first), publish(company, second)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(results.find((response) => response.status === 409)?.body.error).toBe('INSUFFICIENT_CURRENCY');
    expect(await balanceOf(company)).toBe(0);
    const statuses = (await prisma.jobPosting.findMany({ where: { id: { in: [first, second] } } })).map((posting) => posting.status).sort();
    expect(statuses).toEqual(['DRAFT', 'PUBLISHED']);
    expect(await prisma.currencyMovement.count({ where: { account: { companyId: company.companyId }, action: 'ACTION_CHARGE' } })).toBe(1);

    // El mismo puesto publicado dos veces a la vez: un solo cobro.
    await fund(company, 30);
    const same = await draft(company);
    const both = await Promise.all([publish(company, same), publish(company, same)]);
    expect(both.map((response) => response.status)).toEqual([200, 200]);
    expect(await prisma.currencyMovement.count({ where: { account: { companyId: company.companyId }, relatedEntityId: same, action: 'ACTION_CHARGE' } })).toBe(1);
    expect(await balanceOf(company)).toBe(20);
  }, 60_000);

  it('keeps the balance exact under a burst: eight simultaneous publications with balance for four charge exactly four, never overdraw and never answer 500', async () => {
    const company = await makeAccount('BUSINESS', 'rafaga');
    await exhaustQuota(company, 'JOB_PUBLISH_EXTRA', 3);
    await fund(company, 40);
    const ids = [] as string[];
    for (let index = 0; index < 8; index += 1) ids.push(await draft(company));
    const results = await Promise.all(ids.map((id) => publish(company, id)));
    expect(results.filter((response) => response.status === 200)).toHaveLength(4);
    expect(results.filter((response) => response.status === 409).map((response) => response.body.error)).toEqual(Array(4).fill('INSUFFICIENT_CURRENCY'));
    expect(await balanceOf(company)).toBe(0);
    const charges = await prisma.currencyMovement.findMany({ where: { account: { companyId: company.companyId }, action: 'ACTION_CHARGE' }, orderBy: { sequence: 'asc' } });
    expect(charges).toHaveLength(4);
    expect((await movementsOf(company)).map((movement) => movement.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(await prisma.jobPosting.count({ where: { id: { in: ids }, status: 'PUBLISHED' } })).toBe(4);
  }, 60_000);

  it('applies within the free quota, charges beyond it, keeps the same application on re-apply and never charges twice for it', async () => {
    const company = await makeAccount('BUSINESS', 'postulacion-empresa');
    const posting = await published(company, { vacancies: 5 });
    const worker = await makeAccount('WORKER', 'postulante');
    await exhaustQuota(worker, 'APPLICATION_EXTRA', 10);

    // Sin saldo: 409 y la postulacion no existe.
    const blocked = await apply(worker, posting);
    expect([blocked.status, blocked.body]).toMatchObject([409, { error: 'INSUFFICIENT_CURRENCY', cost: 5, balance: 0 }]);
    expect(await prisma.jobApplication.count({ where: { workerId: worker.id } })).toBe(0);

    await fund(worker, 7);
    const applied = await apply(worker, posting);
    expect([applied.status, applied.body.status, applied.body.chargedAmount]).toEqual([201, 'APPLIED', 5]);
    expect(await balanceOf(worker)).toBe(2);
    const applicationId = applied.body.id as string;
    const charge = (await movementsOf(worker)).at(-1)!;
    expect(charge).toMatchObject({ quantity: -5, actionKey: 'APPLICATION_EXTRA', relatedEntityType: 'JobApplication', relatedEntityId: applicationId });

    // Reintento y clic doble: idempotentes, sin nuevo cobro.
    expect((await apply(worker, posting)).body).toMatchObject({ idempotent: true, chargedAmount: 0 });
    // Retirarse y volver a postular reactiva la MISMA fila y no cobra (ya pago por esa postulacion).
    expect((await withdraw(worker, applicationId)).body.status).toBe('WITHDRAWN');
    const reopened = await apply(worker, posting);
    expect([reopened.status, reopened.body.id, reopened.body.status, reopened.body.reopened, reopened.body.chargedAmount]).toEqual([200, applicationId, 'APPLIED', true, 0]);
    expect(reopened.body.events.map((event: { type: string }) => event.type)).toEqual(['APPLIED', 'WITHDRAWN', 'APPLICATION_REOPENED']);
    expect(await balanceOf(worker)).toBe(2);
    expect(await prisma.currencyMovement.count({ where: { account: { workerId: worker.id }, action: 'ACTION_CHARGE' } })).toBe(1);
  }, 60_000);

  it('does not let a simultaneous double application or two applications with balance for one overspend', async () => {
    const company = await makeAccount('BUSINESS', 'carrera-postular');
    const [postingA, postingB] = [await published(company, { vacancies: 5 }), await published(company, { vacancies: 5 })];
    const worker = await makeAccount('WORKER', 'carrera-postulante');
    await exhaustQuota(worker, 'APPLICATION_EXTRA', 10);
    await fund(worker, 5);
    const results = await Promise.all([apply(worker, postingA), apply(worker, postingB)]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await balanceOf(worker)).toBe(0);
    expect(await prisma.currencyMovement.count({ where: { account: { workerId: worker.id }, action: 'ACTION_CHARGE' } })).toBe(1);
    expect(await prisma.jobApplication.count({ where: { workerId: worker.id } })).toBe(1);

    await fund(worker, 20);
    const twice = await Promise.all([apply(worker, postingA), apply(worker, postingB)]);
    expect(twice.every((response) => [200, 201].includes(response.status))).toBe(true);
    const charges = await prisma.currencyMovement.findMany({ where: { account: { workerId: worker.id }, action: 'ACTION_CHARGE' } });
    expect(new Set(charges.map((movement) => movement.idempotencyKey)).size).toBe(charges.length);
    expect((await balanceOf(worker))).toBe(25 - 5 * charges.length);
  }, 60_000);

  it('is atomic: a priority apply that cannot pay for the priority rolls back the application charge too', async () => {
    const company = await makeAccount('BUSINESS', 'atomica-empresa');
    const posting = await published(company, { vacancies: 5 });
    const worker = await makeAccount('WORKER', 'atomica-postulante');
    await exhaustQuota(worker, 'APPLICATION_EXTRA', 10);
    await fund(worker, 7); // alcanza para postular (5) pero no para postular con prioridad (5 + 10)
    const response = await apply(worker, posting, { priority: true });
    expect([response.status, response.body.error]).toEqual([409, 'INSUFFICIENT_CURRENCY']);
    expect(await prisma.jobApplication.count({ where: { workerId: worker.id } })).toBe(0);
    expect(await balanceOf(worker)).toBe(7);
    expect(await usesOf(worker, 'APPLICATION_EXTRA')).toHaveLength(10);
    expect(await prisma.currencyMovement.count({ where: { account: { workerId: worker.id }, action: 'ACTION_CHARGE' } })).toBe(0);

    await fund(worker, 8);
    const ok = await apply(worker, posting, { priority: true });
    expect([ok.status, ok.body.isPriority, ok.body.chargedAmount]).toEqual([201, true, 15]);
    expect(await balanceOf(worker)).toBe(0);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Valor extra: destacar, prioridad, desbloqueo
  // -------------------------------------------------------------------------

  it('highlights a posting for the configured duration, orders the search with highlighted first across pages and never charges a live highlight twice', async () => {
    const company = await makeAccount('BUSINESS', 'destacar');
    const [older, middle, newer] = [await published(company, { title: 'Puesto antiguo destacado' }), await published(company, { title: 'Puesto intermedio' }), await published(company, { title: 'Puesto nuevo' })];
    const worker = await makeAccount('WORKER', 'buscador');
    const titles = async (query: string) => {
      const items: string[] = [];
      let cursor: string | null = null;
      do {
        const page: { body: { items: Array<{ title: string; isHighlighted: boolean }>; nextCursor: string | null } } = await request(app).get('/api/workers/job-postings').set(as(worker.token)).query({ query, limit: 2, ...(cursor ? { cursor } : {}) });
        items.push(...page.body.items.map((item) => `${item.title}${item.isHighlighted ? '*' : ''}`));
        cursor = page.body.nextCursor;
      } while (cursor);
      return items;
    };
    expect(await titles('Puesto')).toEqual(['Puesto nuevo', 'Puesto intermedio', 'Puesto antiguo destacado']);

    const noFunds = await request(app).post(`/api/business/job-postings/${older}/highlight`).set(as(company.token));
    expect([noFunds.status, noFunds.body.error, noFunds.body.cost]).toEqual([409, 'INSUFFICIENT_CURRENCY', 10]);
    expect((await prisma.jobPosting.findUniqueOrThrow({ where: { id: older } })).highlightedUntil).toBeNull();

    await fund(company, 25);
    const before = Date.now();
    const highlighted = await request(app).post(`/api/business/job-postings/${older}/highlight`).set(as(company.token));
    expect([highlighted.status, highlighted.body.chargedAmount, highlighted.body.idempotent]).toEqual([200, 10, false]);
    const until = new Date(highlighted.body.highlightedUntil as string).getTime();
    expect(until - before).toBeGreaterThanOrEqual(168 * 3600_000 - 5_000);
    expect(until - before).toBeLessThanOrEqual(168 * 3600_000 + 60_000);
    expect(await titles('Puesto')).toEqual(['Puesto antiguo destacado*', 'Puesto nuevo', 'Puesto intermedio']);
    // Doble clic (secuencial y simultaneo): un solo cobro y sin extender el plazo.
    const again = await Promise.all([1, 2].map(() => request(app).post(`/api/business/job-postings/${older}/highlight`).set(as(company.token))));
    expect(again.map((response) => response.body.chargedAmount)).toEqual([0, 0]);
    expect(await balanceOf(company)).toBe(15);
    expect(await prisma.currencyMovement.count({ where: { account: { companyId: company.companyId }, actionKey: 'JOB_HIGHLIGHT' } })).toBe(1);
    // Solo un puesto publicado se destaca.
    const unpublished = await draft(company);
    expect((await request(app).post(`/api/business/job-postings/${unpublished}/highlight`).set(as(company.token))).body.error).toBe('POSTING_NOT_PUBLISHED');
    // Un destacado vencido deja de ordenar primero y se puede volver a comprar (otra instancia).
    await prisma.jobPosting.update({ where: { id: older }, data: { highlightedUntil: new Date(Date.now() - 1000) } });
    expect(await titles('Puesto')).toEqual(['Puesto nuevo', 'Puesto intermedio', 'Puesto antiguo destacado']);
    expect((await request(app).post(`/api/business/job-postings/${older}/highlight`).set(as(company.token))).body.chargedAmount).toBe(10);
    expect(await balanceOf(company)).toBe(5);
    expect(middle).not.toBe(newer);
  }, 60_000);

  it('puts priority applications first for the company with stable cursors, and charges priority once per application', async () => {
    const company = await makeAccount('BUSINESS', 'prioridad-empresa');
    const posting = await published(company, { vacancies: 5 });
    const workers = [] as Account[];
    for (let index = 0; index < 4; index += 1) workers.push(await makeAccount('WORKER', `prioridad-${index}`));
    const ids: string[] = [];
    for (const worker of workers) ids.push((await apply(worker, posting)).body.id as string);

    const noFunds = await request(app).post(`/api/workers/job-applications/${ids[0]}/priority`).set(as(workers[0]!.token));
    expect([noFunds.status, noFunds.body.error]).toEqual([409, 'INSUFFICIENT_CURRENCY']);
    await fund(workers[0]!, 30);
    const prioritized = await request(app).post(`/api/workers/job-applications/${ids[0]}/priority`).set(as(workers[0]!.token));
    expect([prioritized.status, prioritized.body.isPriority, prioritized.body.chargedAmount]).toEqual([200, true, 10]);
    const twice = await Promise.all([1, 2].map(() => request(app).post(`/api/workers/job-applications/${ids[0]}/priority`).set(as(workers[0]!.token))));
    expect(twice.map((response) => response.body.chargedAmount)).toEqual([0, 0]);
    expect(await balanceOf(workers[0]!)).toBe(20);
    await fund(workers[2]!, 10);
    expect((await request(app).post(`/api/workers/job-applications/${ids[2]}/priority`).set(as(workers[2]!.token))).status).toBe(200);

    const listed: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: Array<{ id: string; isPriority: boolean }>; nextCursor: string | null } } = await request(app)
        .get(`/api/business/job-postings/${posting}/applications`).set(as(company.token)).query({ limit: 1, ...(cursor ? { cursor } : {}) });
      listed.push(...page.body.items.map((item) => item.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    // Con prioridad primero (la mas antigua de ellas primero entre iguales no importa: createdAt desc), luego el resto.
    expect(new Set(listed).size).toBe(4);
    expect(new Set(listed.slice(0, 2))).toEqual(new Set([ids[0], ids[2]]));
    expect(listed.slice(2)).toEqual([ids[3], ids[1]]);

    // Una postulacion que la empresa ya movio no se puede priorizar.
    await request(app).post(`/api/business/job-applications/${ids[1]}/stage`).set(as(company.token)).send({ status: 'SHORTLISTED' });
    await fund(workers[1]!, 10);
    const late = await request(app).post(`/api/workers/job-applications/${ids[1]}/priority`).set(as(workers[1]!.token));
    expect([late.status, late.body.error]).toEqual([409, 'PRIORITY_NOT_AVAILABLE']);
    expect(await balanceOf(workers[1]!)).toBe(10);
  }, 60_000);

  it('unlocks a candidate contact and CV once per company, even with two simultaneous clicks, and keeps the consent rules', async () => {
    const company = await makeAccount('BUSINESS', 'desbloqueo-empresa');
    const other = await makeAccount('BUSINESS', 'desbloqueo-otra');
    const candidate = await makeAccount('WORKER', 'candidato');
    const profile = await request(app).patch('/api/workers/me/profile').set(as(candidate.token)).send({ headline: 'Barista con experiencia', isVisible: true });
    expect(profile.status).toBe(200);
    const profileId = profile.body.id as string;
    const upload = await request(app).put('/api/workers/me/cv').set(as(candidate.token)).set('Content-Type', 'application/pdf').set('X-File-Name', 'cv.pdf').send(pdf('mi cv'));
    expect(upload.status).toBe(201);

    // Sin desbloqueo no hay contacto ni CV.
    expect((await request(app).get(`/api/business/talent/${profileId}/contact`).set(as(company.token))).status).toBe(403);
    expect((await request(app).get(`/api/business/talent/${profileId}/cv`).set(as(company.token))).status).toBe(403);
    const noFunds = await request(app).post(`/api/business/talent/${profileId}/unlock-contact`).set(as(company.token));
    expect([noFunds.status, noFunds.body.error, noFunds.body.cost]).toEqual([409, 'INSUFFICIENT_CURRENCY', 10]);
    expect(await prisma.candidateContactUnlock.count({ where: { companyId: company.companyId } })).toBe(0);

    await fund(company, 25);
    const clicks = await Promise.all([1, 2].map(() => request(app).post(`/api/business/talent/${profileId}/unlock-contact`).set(as(company.token))));
    expect(clicks.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(clicks.map((response) => response.body.chargedAmount).sort()).toEqual([0, 10]);
    expect(clicks[0]!.body.contact).toEqual({ name: expect.any(String), email: candidate.email });
    expect(JSON.stringify(clicks[0]!.body)).not.toMatch(/identifier|dni|passwordHash/i);
    expect(await balanceOf(company)).toBe(15);
    expect(await prisma.currencyMovement.count({ where: { account: { companyId: company.companyId }, actionKey: 'CANDIDATE_CONTACT_UNLOCK' } })).toBe(1);
    expect(await prisma.candidateContactUnlock.count({ where: { companyId: company.companyId } })).toBe(1);

    expect((await request(app).get(`/api/business/talent/${profileId}/contact`).set(as(company.token))).body.contact.email).toBe(candidate.email);
    const cv = await request(app).get(`/api/business/talent/${profileId}/cv`).set(as(company.token)).buffer(true);
    expect(cv.status).toBe(200);
    expect(cv.headers['content-type']).toContain('application/pdf');
    const listed = await request(app).get('/api/business/talent-unlocks').set(as(company.token));
    expect(listed.body.items).toEqual([{ workerTalentProfileId: profileId, unlockedAt: expect.any(String) }]);

    // Aislamiento: otra empresa no hereda el acceso; un trabajador no usa las rutas.
    expect((await request(app).get(`/api/business/talent/${profileId}/contact`).set(as(other.token))).status).toBe(403);
    expect((await request(app).post(`/api/business/talent/${profileId}/unlock-contact`).set(as(candidate.token))).status).toBe(403);
    // Si el candidato oculta su perfil, el acceso (ya pagado) deja de leerse; ocultar no devuelve el cobro.
    await request(app).patch('/api/workers/me/profile').set(as(candidate.token)).send({ isVisible: false });
    expect((await request(app).get(`/api/business/talent/${profileId}/contact`).set(as(company.token))).status).toBe(404);
    expect((await request(app).post(`/api/business/talent/${profileId}/unlock-contact`).set(as(other.token))).status).toBe(404);
    expect(await balanceOf(company)).toBe(15);

    // Un candidato que ya postulo a la empresa no se cobra.
    const applicant = await makeAccount('WORKER', 'candidato-postulado');
    const applicantProfile = (await request(app).patch('/api/workers/me/profile').set(as(applicant.token)).send({ headline: 'Cajera', isVisible: true })).body.id as string;
    const posting = await published(company);
    expect((await apply(applicant, posting)).status).toBe(201);
    const free = await request(app).post(`/api/business/talent/${applicantProfile}/unlock-contact`).set(as(company.token));
    expect([free.status, free.body.chargedAmount, free.body.viaApplication]).toEqual([201, 0, true]);
    expect(await balanceOf(company)).toBe(15);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Devolucion automatica y tope diario
  // -------------------------------------------------------------------------

  async function makeInvitation(company: Account, label: string) {
    const candidate = await makeAccount('WORKER', label);
    const profile = await request(app).patch('/api/workers/me/profile').set(as(candidate.token)).send({ headline: 'Candidata', isVisible: true });
    const created = await request(app).post('/api/business/talent-invitations').set(as(company.token)).send({ workerTalentProfileId: profile.body.id, message: 'Te invitamos' });
    return { candidate, created };
  }
  /** Un barredor cuyo reloj ya paso el plazo de 72 h (las respuestas hechas ahora quedan DENTRO del plazo). */
  const lateSweeper = () => new CurrencyRefundService(prisma, () => new Date(Date.now() + 73 * 3_600_000));

  it('charges a talent invitation atomically and refunds it once when unanswered, never when answered, even with two workers sweeping at once', async () => {
    const company = await makeAccount('BUSINESS', 'invitar');
    const noFunds = await makeInvitation(company, 'invitado-sin-saldo');
    expect([noFunds.created.status, noFunds.created.body.error, noFunds.created.body.cost]).toEqual([409, 'INSUFFICIENT_CURRENCY', 5]);
    expect(await prisma.talentInvitation.count({ where: { companyId: company.companyId! } })).toBe(0);

    await fund(company, 20);
    const unanswered = await makeInvitation(company, 'invitado-callado');
    const answered = await makeInvitation(company, 'invitado-responde');
    expect([unanswered.created.status, unanswered.created.body.chargedAmount]).toEqual([201, 5]);
    expect(await balanceOf(company)).toBe(10);
    const acceptedBody = await request(app).post(`/api/workers/me/talent-invitations/${answered.created.body.id}/accept`).set(as(answered.candidate.token));
    expect(acceptedBody.status).toBe(200);
    // La accion basica del trabajador (responder) nunca se cobra ni se bloquea.
    expect(await balanceOf(answered.candidate)).toBe(0);

    // Antes del plazo no se devuelve nada.
    expect((await new CurrencyRefundService(prisma).sweep()).refunded).toBe(0);
    // El barrido es global (cobros vencidos de cualquier cuenta): se verifica sobre esta empresa.
    await Promise.all([lateSweeper().sweep(), lateSweeper().sweep()]);
    expect(await balanceOf(company)).toBe(15);
    expect(await prisma.currencyMovement.count({ where: { account: { companyId: company.companyId }, action: 'ACTION_REFUND' } })).toBe(1);
    const original = (await movementsOf(company)).find((movement) => movement.relatedEntityId === unanswered.created.body.id && movement.action === 'ACTION_CHARGE')!;
    const refund = (await movementsOf(company)).find((movement) => movement.action === 'ACTION_REFUND')!;
    expect(refund).toMatchObject({ quantity: 5, refundOfId: original.id, actionKey: 'TALENT_INVITE', idempotencyKey: `refund:${original.id}` });
    // Una segunda pasada no devuelve de nuevo y la unicidad lo respalda aunque se forzara.
    expect(await lateSweeper().sweep()).toEqual({ refunded: 0, notEligible: 0, amount: 0 });
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "CurrencyMovement" ("id","accountId","sequence","quantity","balanceAfter","action","idempotencyKey","refundOfId") SELECT 'dup', "accountId", 999, 5, 20, 'ACTION_REFUND', 'dup-key', '${original.id}' FROM "CurrencyMovement" WHERE "id" = '${original.id}'`)).rejects.toThrow();
    expect(await prisma.currencyActionUse.count({ where: { userId: company.id, refundSettledAt: null, refundDueAt: { not: null } } })).toBe(0);
    // El admin tambien puede ejecutar la pasada (la tarea programada hace lo mismo).
    expect((await request(app).post('/api/admin/currency/refunds/run').set(as(admin.token))).status).toBe(200);
    expect((await request(app).post('/api/admin/currency/refunds/run').set(as(company.token))).status).toBe(403);
  }, 90_000);

  it('refunds an extra application only if the company did not move it by the deadline, with several workers racing', async () => {
    const company = await makeAccount('BUSINESS', 'devolver-postulacion');
    const posting = await published(company, { vacancies: 9 });
    const specs = ['ignorada', 'movida', 'retirada', 'prioridad'];
    const people = [] as Account[];
    const ids: string[] = [];
    for (const spec of specs) {
      const worker = await makeAccount('WORKER', `devolver-${spec}`);
      await exhaustQuota(worker, 'APPLICATION_EXTRA', 10);
      await fund(worker, 30);
      const applied = await apply(worker, posting, { priority: spec === 'prioridad' });
      expect(applied.status).toBe(201);
      people.push(worker);
      ids.push(applied.body.id as string);
    }
    expect((await balanceOf(people[3]!))).toBe(15);
    // La empresa mueve la segunda; la tercera se retira; ambas ANTES del plazo.
    await request(app).post(`/api/business/job-applications/${ids[1]}/stage`).set(as(company.token)).send({ status: 'SHORTLISTED' });
    expect((await withdraw(people[2]!, ids[2]!)).status).toBe(200);
    await Promise.all([lateSweeper(), lateSweeper(), lateSweeper()].map((service) => service.sweep()));
    // ignorada (5) y prioridad (5 + 10) se devuelven; la movida por la empresa y la retirada no.
    expect(await balanceOf(people[0]!)).toBe(30);
    expect(await balanceOf(people[1]!)).toBe(25);
    expect(await balanceOf(people[2]!)).toBe(25);
    expect(await balanceOf(people[3]!)).toBe(30);
    for (const worker of people) {
      const movements = await movementsOf(worker);
      const refunds = movements.filter((movement) => movement.action === 'ACTION_REFUND');
      expect(new Set(refunds.map((movement) => movement.refundOfId)).size).toBe(refunds.length);
      for (const movement of movements) expect(movement.balanceAfter).toBeGreaterThanOrEqual(0);
    }
  }, 90_000);

  it('enforces the configurable daily spend cap with 409 DAILY_SPEND_CAP_REACHED, never on refunds or free actions, and keeps a settings history', async () => {
    const company = await makeAccount('BUSINESS', 'tope');
    await exhaustQuota(company, 'JOB_PUBLISH_EXTRA', 3);
    await fund(company, 100);
    const patch = await request(app).patch('/api/admin/currency/settings/DAILY_SPEND_CAP_COMPANY').set(as(admin.token)).send({ value: 15, reason: 'Prueba del tope diario' });
    expect([patch.status, patch.body.changed, patch.body.setting.value, patch.body.setting.isProvisional]).toEqual([200, true, 15, false]);
    try {
      expect((await publish(company, await draft(company))).body.chargedAmount).toBe(10);
      const capped = await publish(company, await draft(company));
      expect([capped.status, capped.body]).toMatchObject([409, { error: 'DAILY_SPEND_CAP_REACHED', cost: 10, dailyCap: 15, spentToday: 10 }]);
      expect(await balanceOf(company)).toBe(90);
      // Una accion gratuita (guardar un borrador, pausar) no se frena por el tope.
      const free = await draft(company);
      expect(free).toBeTruthy();
      // Una devolucion nunca se frena por el tope: invitar (5) y devolver con el tope agotado.
      const { created } = await makeInvitation(company, 'tope-invitado');
      expect([created.status, created.body.chargedAmount]).toEqual([201, 5]);
      await lateSweeper().sweep();
      expect(await prisma.currencyMovement.count({ where: { account: { companyId: company.companyId }, action: 'ACTION_REFUND' } })).toBe(1);
      expect(await balanceOf(company)).toBe(90);
    } finally {
      await request(app).patch('/api/admin/currency/settings/DAILY_SPEND_CAP_COMPANY').set(as(admin.token)).send({ value: 200, reason: 'Restablecer el tope' });
    }
    const settings = await request(app).get('/api/admin/currency/settings').set(as(admin.token));
    expect(settings.body.items.map((item: { key: string }) => item.key)).toEqual(['DAILY_SPEND_CAP_WORKER', 'DAILY_SPEND_CAP_COMPANY', 'JOB_HIGHLIGHT_DURATION_HOURS']);
    const history = await request(app).get('/api/admin/currency/settings/changes').set(as(admin.token)).query({ key: 'DAILY_SPEND_CAP_COMPANY' });
    expect(history.body.items.map((item: { oldValue: string; newValue: string }) => [item.oldValue, item.newValue])).toEqual([['15', '200'], ['200', '15']]);
    expect(history.body.items[1]).toMatchObject({ reason: 'Prueba del tope diario', changedBy: { id: admin.id } });
    expect((await request(app).patch('/api/admin/currency/settings/DAILY_SPEND_CAP_COMPANY').set(as(admin.token)).send({ value: 0, reason: 'Valor invalido' })).status).toBe(400);
    expect((await request(app).patch('/api/admin/currency/settings/UNKNOWN').set(as(admin.token)).send({ value: 5, reason: 'Clave desconocida' })).status).toBe(404);
    expect((await request(app).patch('/api/admin/currency/settings/DAILY_SPEND_CAP_COMPANY').set(as(company.token)).send({ value: 5, reason: 'Sin permiso' })).status).toBe(403);
  }, 90_000);

  it('uses a configurable highlight duration', async () => {
    const company = await makeAccount('BUSINESS', 'duracion');
    await fund(company, 20);
    const posting = await published(company);
    await request(app).patch('/api/admin/currency/settings/JOB_HIGHLIGHT_DURATION_HOURS').set(as(admin.token)).send({ value: 2, reason: 'Destacado corto de prueba' });
    try {
      const response = await request(app).post(`/api/business/job-postings/${posting}/highlight`).set(as(company.token));
      const hours = (new Date(response.body.highlightedUntil as string).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(1.9);
      expect(hours).toBeLessThan(2.1);
    } finally {
      await request(app).patch('/api/admin/currency/settings/JOB_HIGHLIGHT_DURATION_HOURS').set(as(admin.token)).send({ value: 168, reason: 'Restablecer la duracion' });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Lectura previa (quote), mes de Lima y aislamiento
  // -------------------------------------------------------------------------

  it('quotes the cost, remaining free quota, balance and daily cap without any side effect', async () => {
    const company = await makeAccount('BUSINESS', 'cotizar');
    const before = [await prisma.currencyAccount.count(), await prisma.currencyActionUse.count(), await prisma.currencyMovement.count()];
    const free = await request(app).get('/api/business/currency/quote').set(as(company.token)).query({ actionKey: 'JOB_PUBLISH_EXTRA' });
    expect(free.status).toBe(200);
    expect(free.body).toMatchObject({
      actionKey: 'JOB_PUBLISH_EXTRA', active: true, cost: 0, catalogAmount: 10, reason: 'FREE_QUOTA', balance: 0, sufficientBalance: true,
      freeQuota: { monthlyLimit: 3, used: 0, remaining: 3 }, dailyCap: { limit: 200, spentToday: 0, remaining: 200 }, canExecute: true,
    });
    await exhaustQuota(company, 'JOB_PUBLISH_EXTRA', 3);
    const paid = await request(app).get('/api/business/currency/quote').set(as(company.token)).query({ actionKey: 'JOB_PUBLISH_EXTRA' });
    expect(paid.body).toMatchObject({ cost: 10, reason: 'CHARGE', sufficientBalance: false, canExecute: false, freeQuota: { remaining: 0 } });
    const afterSeed = [await prisma.currencyAccount.count(), await prisma.currencyMovement.count()];
    expect(afterSeed).toEqual([before[0], before[2]]); // cotizar no crea cuentas ni movimientos
    // Con un destino ya registrado el costo es 0.
    await fund(company, 10);
    const posting = await published(company);
    const registered = await request(app).get('/api/business/currency/quote').set(as(company.token)).query({ actionKey: 'JOB_PUBLISH_EXTRA', targetId: posting });
    expect([registered.body.cost, registered.body.reason]).toEqual([0, 'ALREADY_REGISTERED']);
    // Acciones que no existen para ese actor o no son cotizables.
    expect((await request(app).get('/api/business/currency/quote').set(as(company.token)).query({ actionKey: 'APPLICATION_EXTRA' })).status).toBe(404);
    expect((await request(app).get('/api/business/currency/quote').set(as(company.token)).query({ actionKey: 'WELCOME_BONUS' })).status).toBe(404);
    const worker = await makeAccount('WORKER', 'cotizar-trabajador');
    expect((await request(app).get('/api/workers/currency/quote').set(as(worker.token)).query({ actionKey: 'APPLICATION_EXTRA' })).body).toMatchObject({ cost: 0, freeQuota: { monthlyLimit: 10, remaining: 10 } });
    expect((await request(app).get('/api/workers/currency/quote').set(as(worker.token)).query({ actionKey: 'JOB_PUBLISH_EXTRA' })).status).toBe(404);
    expect((await request(app).get('/api/workers/currency/quote').set(as(company.token)).query({ actionKey: 'APPLICATION_EXTRA' })).status).toBe(403);
    expect((await request(app).get('/api/workers/currency/quote').query({ actionKey: 'APPLICATION_EXTRA' })).status).toBe(401);
  }, 60_000);

  it('resets the free quota at the Lima calendar month boundary (UTC-5)', async () => {
    const worker = await makeAccount('WORKER', 'borde-mes');
    // 30 sep 2026 23:59 hora de Lima = 1 oct 2026 04:59 UTC: ultimo minuto de septiembre.
    await exhaustQuota(worker, 'APPLICATION_EXTRA', 10, new Date('2026-10-01T04:59:00.000Z'));
    try {
      clockNow = new Date('2026-10-01T04:59:59.000Z');
      const september = await request(app).get('/api/workers/currency/quote').set(as(worker.token)).query({ actionKey: 'APPLICATION_EXTRA' });
      expect(september.body).toMatchObject({ cost: 5, freeQuota: { used: 10, remaining: 0, periodStart: '2026-09-01T05:00:00.000Z', periodEnd: '2026-10-01T05:00:00.000Z' } });
      clockNow = new Date('2026-10-01T05:00:00.000Z');
      const october = await request(app).get('/api/workers/currency/quote').set(as(worker.token)).query({ actionKey: 'APPLICATION_EXTRA' });
      expect(october.body).toMatchObject({ cost: 0, reason: 'FREE_QUOTA', freeQuota: { used: 0, remaining: 10, periodStart: '2026-10-01T05:00:00.000Z', periodEnd: '2026-11-01T05:00:00.000Z' } });
    } finally {
      clockNow = null;
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // Re-postulacion, caducados y constancia
  // -------------------------------------------------------------------------

  it('lets a withdrawn application be reopened safely against a simultaneous withdrawal, but never a company rejection', async () => {
    const company = await makeAccount('BUSINESS', 'reabrir-empresa');
    const posting = await published(company, { vacancies: 5 });
    const [leaver, rejected] = [await makeAccount('WORKER', 'reabrir-retiro'), await makeAccount('WORKER', 'reabrir-rechazado')];
    const applicationId = (await apply(leaver, posting)).body.id as string;
    expect((await withdraw(leaver, applicationId)).status).toBe(200);

    // Re-postulacion y retiro simultaneos: el resultado es siempre uno de los dos ordenes validos, sin errores 500.
    const [reapply, drop] = await Promise.all([apply(leaver, posting), withdraw(leaver, applicationId)]);
    expect([200, 201]).toContain(reapply.status);
    expect(drop.status).toBe(200);
    const row = await prisma.jobApplication.findUniqueOrThrow({ where: { postingId_workerId: { postingId: posting, workerId: leaver.id } } });
    expect(row.id).toBe(applicationId);
    expect(['APPLIED', 'WITHDRAWN']).toContain(row.status);
    expect(await prisma.jobApplication.count({ where: { workerId: leaver.id } })).toBe(1);
    const types = (await prisma.jobApplicationEvent.findMany({ where: { applicationId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((event) => event.type);
    expect(types.filter((type) => type === 'APPLICATION_REOPENED').length).toBeLessThanOrEqual(1);

    // Tras rechazar una oferta tambien puede volver a postular; tras un rechazo de la empresa, no.
    const rejectedId = (await apply(rejected, posting)).body.id as string;
    expect((await request(app).post(`/api/business/job-applications/${rejectedId}/reject`).set(as(company.token)).send({ reason: 'No cumple' })).status).toBe(200);
    const blocked = await apply(rejected, posting);
    expect([blocked.status, blocked.body.error, blocked.body.status]).toEqual([409, 'ALREADY_APPLIED', 'REJECTED']);

    const decliner = await makeAccount('WORKER', 'reabrir-oferta');
    const declinerId = (await apply(decliner, posting)).body.id as string;
    const offer = await request(app).post(`/api/business/job-applications/${declinerId}/offers`).set(as(company.token)).send({ salaryCents: 180000, contractType: 'INDEFINITE', startDate: FUTURE_START });
    const offerId = offer.body.offers[0].id as string;
    expect((await request(app).post(`/api/workers/job-applications/${declinerId}/offers/${offerId}/decline`).set(as(decliner.token))).body.status).toBe('WITHDRAWN');
    const back = await apply(decliner, posting);
    expect([back.status, back.body.id, back.body.status, back.body.currentOfferId]).toEqual([200, declinerId, 'APPLIED', null]);
    // El historial se conserva: la oferta rechazada sigue en la linea de tiempo.
    expect(back.body.offers.map((item: { status: string }) => item.status)).toEqual(['DECLINED']);
    expect(back.body.events.map((event: { type: string }) => event.type)).toContain('OFFER_DECLINED');
  }, 60_000);

  it('resolves accepted-but-not-hired applications when the posting closes or fills, hides them from the worker lists by default and notifies the worker', async () => {
    const company = await makeAccount('BUSINESS', 'caducados');
    const closing = await published(company, { vacancies: 2 });
    const worker = await makeAccount('WORKER', 'caducado');
    const applicationId = (await apply(worker, closing)).body.id as string;
    const offer = await request(app).post(`/api/business/job-applications/${applicationId}/offers`).set(as(company.token)).send({ salaryCents: 180000, contractType: 'INDEFINITE', startDate: FUTURE_START });
    const offerId = offer.body.offers[0].id as string;
    expect((await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${offerId}/accept`).set(as(worker.token))).status).toBe(200);
    const stillOpen = await request(app).get('/api/workers/job-applications').set(as(worker.token));
    expect(stillOpen.body.items.map((item: { id: string }) => item.id)).toEqual([applicationId]);

    expect((await request(app).post(`/api/business/job-postings/${closing}/close`).set(as(company.token))).status).toBe(200);
    expect(await prisma.jobApplication.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ status: 'REJECTED', autoClosedReason: 'POSTING_CLOSED' });
    const event = (await prisma.jobApplicationEvent.findMany({ where: { applicationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }))[0]!;
    expect([event.type, event.detail, event.toStatus]).toEqual(['REJECTED', 'POSTING_CLOSED', 'REJECTED']);
    // La constancia de la oferta aceptada queda intacta.
    expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe('ACCEPTED');

    expect((await request(app).get('/api/workers/job-applications').set(as(worker.token))).body.items).toEqual([]);
    const history = await request(app).get('/api/workers/job-applications').set(as(worker.token)).query({ history: 'true' });
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({ id: applicationId, status: 'REJECTED', autoClosedReason: 'POSTING_CLOSED' });
    expect((await request(app).get(`/api/workers/job-applications/${applicationId}`).set(as(worker.token))).status).toBe(200);
    // Una rechazada por la empresa a mano si se sigue mostrando.
    const other = await makeAccount('WORKER', 'rechazado-a-mano');
    const manualPosting = await published(company, { vacancies: 2 });
    const manualId = (await apply(other, manualPosting)).body.id as string;
    await request(app).post(`/api/business/job-applications/${manualId}/reject`).set(as(company.token)).send({});
    expect((await request(app).get('/api/workers/job-applications').set(as(other.token))).body.items.map((item: { id: string }) => item.id)).toEqual([manualId]);
  }, 60_000);

  it('deletes accounts without accepted offers (removing their job records) and keeps accounts with accepted offers, with no file deleted by a blocked delete', async () => {
    const company = await makeAccount('BUSINESS', 'borrar-empresa');
    const posting = await published(company, { vacancies: 2 });
    const free = await makeAccount('WORKER', 'borrar-libre');
    const applicationId = (await apply(free, posting)).body.id as string;
    expect(applicationId).toBeTruthy();
    // Sin ofertas aceptadas el trabajador se puede borrar y sus postulaciones se van con el.
    const deleted = await request(app).delete(`/api/admin/workers/${free.id}`).set(as(admin.token));
    expect(deleted.status).toBe(204);
    expect(await prisma.jobApplication.count({ where: { id: applicationId } })).toBe(0);
    expect(await prisma.jobPosting.count({ where: { id: posting } })).toBe(1);

    // Una empresa sin ofertas aceptadas tambien: se borran sus puestos y las postulaciones recibidas.
    const other = await makeAccount('WORKER', 'borrar-otro');
    await apply(other, posting);
    const companyDelete = await request(app).delete(`/api/admin/companies/${company.companyId}`).set(as(admin.token));
    expect(companyDelete.status).toBe(204);
    expect(await prisma.jobPosting.count({ where: { id: posting } })).toBe(0);
    expect(await prisma.jobApplication.count({ where: { workerId: other.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: other.id } })).toBe(1);
  }, 60_000);

  // -------------------------------------------------------------------------
  // CN-20261007-045: correcciones de la auditoria CN-20261007-044
  // -------------------------------------------------------------------------

  it('does not reopen an application that has an accepted offer, and never answers 500 when issuing an offer on one (MEDIO-1)', async () => {
    const company = await makeAccount('BUSINESS', 'oferta-aceptada');
    const posting = await published(company, { vacancies: 3 });
    const worker = await makeAccount('WORKER', 'retira-aceptada');
    const applicationId = (await apply(worker, posting)).body.id as string;
    const offer = await request(app).post(`/api/business/job-applications/${applicationId}/offers`).set(as(company.token)).send({ salaryCents: 180000, contractType: 'INDEFINITE', startDate: FUTURE_START });
    const offerId = offer.body.offers[0].id as string;
    expect((await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${offerId}/accept`).set(as(worker.token))).status).toBe(200);
    expect((await withdraw(worker, applicationId)).body.status).toBe('WITHDRAWN');
    const eventsBefore = await prisma.jobApplicationEvent.count({ where: { applicationId } });

    const reapply = await apply(worker, posting);
    expect([reapply.status, reapply.body.error, reapply.body.status]).toEqual([409, 'APPLICATION_HAS_ACCEPTED_OFFER', 'WITHDRAWN']);
    // La postulacion y su constancia quedan como estan: sin reabrir, sin evento nuevo.
    expect(await prisma.jobApplication.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ status: 'WITHDRAWN' });
    expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe('ACCEPTED');
    expect(await prisma.jobApplicationEvent.count({ where: { applicationId } })).toBe(eventsBefore);
    expect(await prisma.jobApplication.count({ where: { workerId: worker.id } })).toBe(1);
    // La empresa no puede emitir otra oferta sobre una retirada, y no es un 500.
    const blockedOffer = await request(app).post(`/api/business/job-applications/${applicationId}/offers`).set(as(company.token)).send({ salaryCents: 190000, contractType: 'INDEFINITE', startDate: FUTURE_START });
    expect(blockedOffer.status).toBe(409);

    // Defensa en profundidad: aunque una fila heredada estuviera en APPLIED con la oferta aceptada, ofertar es 409 (no 500 por el indice unico).
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: 'APPLIED' } });
    const legacyOffer = await request(app).post(`/api/business/job-applications/${applicationId}/offers`).set(as(company.token)).send({ salaryCents: 190000, contractType: 'INDEFINITE', startDate: FUTURE_START });
    expect([legacyOffer.status, legacyOffer.body.error]).toEqual([409, 'APPLICATION_HAS_ACCEPTED_OFFER']);
    expect((await prisma.jobOffer.findMany({ where: { applicationId } })).map((item) => item.status)).toEqual(['ACCEPTED']);
  }, 60_000);

  it('lets a welcome-bonus-only account be deleted but keeps 409 for any other movement; the trigger still blocks arbitrary SQL deletes (MEDIO-2)', async () => {
    const registered = await request(app).post('/api/auth/register').send({ role: 'WORKER', name: 'Recien Registrado', email: 'recien.registrado@chambeaya.test', password: 'Password123', dniOrRuc: '61000002' });
    expect(registered.status).toBe(201);
    const workerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'recien.registrado@chambeaya.test' } })).id;
    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { workerId } });
    expect(await prisma.currencyMovement.count({ where: { accountId: account.id } })).toBe(1);
    const welcome = await prisma.currencyMovement.findFirstOrThrow({ where: { accountId: account.id } });
    const sqlInTx = (accountSetting: string, statement: string) => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('chambeaya.welcome_bonus_delete_account', '${accountSetting}', true)`);
      await tx.$executeRawUnsafe(statement);
    });

    // Por SQL directo el trigger sigue bloqueando: sin permiso, con permiso de otra cuenta y la actualizacion.
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "CurrencyMovement" WHERE "id" = '${welcome.id}'`)).rejects.toThrow(/CURRENCY_MOVEMENT_APPEND_ONLY/);
    await expect(sqlInTx('otra-cuenta', `DELETE FROM "CurrencyMovement" WHERE "id" = '${welcome.id}'`)).rejects.toThrow(/CURRENCY_MOVEMENT_APPEND_ONLY/);
    await expect(sqlInTx(account.id, `UPDATE "CurrencyMovement" SET "quantity" = 99 WHERE "id" = '${welcome.id}'`)).rejects.toThrow(/CURRENCY_MOVEMENT_APPEND_ONLY/);
    expect(await prisma.currencyMovement.count({ where: { id: welcome.id } })).toBe(1);

    // Cualquier otro movimiento (aqui un ajuste) mantiene el 409, y tampoco se puede borrar el bono por SQL aunque haya permiso.
    await fund({ id: workerId, token: '', email: '' }, 7);
    const blocked = await request(app).delete(`/api/admin/workers/${workerId}`).set(as(admin.token));
    expect([blocked.status, blocked.body.error]).toEqual([409, 'CURRENCY_LEDGER_RETAINED']);
    expect(await prisma.currencyMovement.count({ where: { accountId: account.id } })).toBe(2);
    await expect(sqlInTx(account.id, `DELETE FROM "CurrencyMovement" WHERE "id" = '${welcome.id}'`)).rejects.toThrow(/CURRENCY_MOVEMENT_APPEND_ONLY/);
    const adjustment = await prisma.currencyMovement.findFirstOrThrow({ where: { accountId: account.id, action: 'ADMIN_ADJUSTMENT' } });
    await expect(sqlInTx(account.id, `DELETE FROM "CurrencyMovement" WHERE "id" = '${adjustment.id}'`)).rejects.toThrow(/CURRENCY_MOVEMENT_APPEND_ONLY/);

    // Una cuenta recien registrada sin otros movimientos se borra: el bono desaparece con ella.
    const fresh = await request(app).post('/api/auth/register').send({ role: 'WORKER', name: 'Borrable Limpio', email: 'borrable.limpio@chambeaya.test', password: 'Password123', dniOrRuc: '61000003' });
    expect(fresh.status).toBe(201);
    const freshId = (await prisma.user.findUniqueOrThrow({ where: { email: 'borrable.limpio@chambeaya.test' } })).id;
    const freshAccount = await prisma.currencyAccount.findUniqueOrThrow({ where: { workerId: freshId } });
    expect((await request(app).delete(`/api/admin/workers/${freshId}`).set(as(admin.token))).status).toBe(204);
    expect(await prisma.user.count({ where: { id: freshId } })).toBe(0);
    expect(await prisma.currencyAccount.count({ where: { id: freshAccount.id } })).toBe(0);
    expect(await prisma.currencyMovement.count({ where: { accountId: freshAccount.id } })).toBe(0);
    // El permiso era local a la transaccion: ya no existe y borrar otro bono por SQL sigue bloqueado.
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "CurrencyMovement" WHERE "id" = '${welcome.id}'`)).rejects.toThrow(/CURRENCY_MOVEMENT_APPEND_ONLY/);

    // Empresa recien creada por el administrador: bono unico, se borra con 204.
    const created = await request(app).post('/api/admin/companies').set(as(admin.token))
      .send({ name: 'Empresa Borrable SAC', ruc: '20622222222', email: 'empresa.borrable@chambeaya.test', password: 'Password123' });
    expect(created.status).toBe(201);
    const companyId = created.body.id as string;
    expect(await prisma.currencyMovement.count({ where: { account: { companyId } } })).toBe(1);
    expect((await request(app).delete(`/api/admin/companies/${companyId}`).set(as(admin.token))).status).toBe(204);
    expect(await prisma.currencyAccount.count({ where: { companyId } })).toBe(0);

    // Empresa con el bono mas un gasto: 409 y nada se borra.
    const spender = await request(app).post('/api/admin/companies').set(as(admin.token))
      .send({ name: 'Empresa Gastadora SAC', ruc: '20633333333', email: 'empresa.gastadora@chambeaya.test', password: 'Password123' });
    expect(spender.status).toBe(201);
    const spenderCompanyId = spender.body.id as string;
    const spenderAccount = await prisma.currencyAccount.findUniqueOrThrow({ where: { companyId: spenderCompanyId } });
    await prisma.currencyMovement.create({ data: { accountId: spenderAccount.id, sequence: 2, quantity: -5, balanceAfter: 45, action: 'ACTION_CHARGE', actionKey: 'JOB_PUBLISH_EXTRA', idempotencyKey: 'charge:borrado-gasto' } });
    const spendBlocked = await request(app).delete(`/api/admin/companies/${spenderCompanyId}`).set(as(admin.token));
    expect([spendBlocked.status, spendBlocked.body.error]).toEqual([409, 'CURRENCY_LEDGER_RETAINED']);
    expect(await prisma.currencyMovement.count({ where: { accountId: spenderAccount.id } })).toBe(2);

    // Un premio que no es el bono tambien retiene (REWARD con otra clave de accion).
    const other = await request(app).post('/api/auth/register').send({ role: 'WORKER', name: 'Otro Premio', email: 'otro.premio@chambeaya.test', password: 'Password123', dniOrRuc: '61000004' });
    expect(other.status).toBe(201);
    const otherId = (await prisma.user.findUniqueOrThrow({ where: { email: 'otro.premio@chambeaya.test' } })).id;
    const otherAccount = await prisma.currencyAccount.findUniqueOrThrow({ where: { workerId: otherId } });
    await prisma.currencyMovement.create({ data: { accountId: otherAccount.id, sequence: 2, quantity: 10, balanceAfter: 60, action: 'REWARD', actionKey: 'PROFILE_HIGHLIGHT', idempotencyKey: 'reward:otro-premio' } });
    expect((await request(app).delete(`/api/admin/workers/${otherId}`).set(as(admin.token))).status).toBe(409);
    expect(await prisma.currencyMovement.count({ where: { accountId: otherAccount.id } })).toBe(2);
  }, 60_000);

  it('answers 409, never 500, when a movement is committed while a welcome-only account is being deleted (MEDIO-2 race)', async () => {
    const worker = await request(app).post('/api/auth/register').send({ role: 'WORKER', name: 'Carrera Bono', email: 'carrera.bono@chambeaya.test', password: 'Password123', dniOrRuc: '61000005' });
    expect(worker.status).toBe(201);
    const workerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'carrera.bono@chambeaya.test' } })).id;
    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { workerId } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let inserted!: () => void;
    const insertedPromise = new Promise<void>((resolve) => { inserted = resolve; });
    const writer = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CurrencyAccount" WHERE "id" = ${account.id} FOR UPDATE`;
      await tx.currencyMovement.create({ data: { accountId: account.id, sequence: 2, quantity: 5, balanceAfter: 55, action: 'ADMIN_ADJUSTMENT', idempotencyKey: 'race-welcome-1', reason: 'Movimiento de la carrera' } });
      inserted();
      await gate;
    });
    await insertedPromise;
    let settled = false;
    const deletion = request(app).delete(`/api/admin/workers/${workerId}`).set(as(admin.token)).then((response) => { settled = true; return response; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled, 'el borrado debe esperar a la cuenta bloqueada').toBe(false);
    release();
    await writer;
    const response = await deletion;
    expect([response.status, response.body.error]).toEqual([409, 'CURRENCY_LEDGER_RETAINED']);
    expect(await prisma.user.count({ where: { id: workerId } })).toBe(1);
    expect(await prisma.currencyMovement.count({ where: { accountId: account.id } })).toBe(2);
  }, 30_000);

  it('counts an existing welcome bonus as already granted even after the amount is edited, and keeps going with mixed accounts (MEDIO-3)', async () => {
    const before = await makeAccount('WORKER', 'bono-antes');
    const welcome = new WelcomeBonusService(prisma, new CurrencyActionService());
    expect((await welcome.grantForWorker(before.id)).amount).toBe(50);
    const entries = await prisma.currencyCatalogEntry.findMany({ where: { actionKey: 'WELCOME_BONUS' } });
    try {
      await prisma.currencyCatalogEntry.updateMany({ where: { actionKey: 'WELCOME_BONUS' }, data: { amount: 80 } });
      // Cuentas mixtas: una ya tenia el bono (con el monto viejo) y otras aun no.
      const missingWorker = await makeAccount('WORKER', 'bono-despues');
      const missingCompany = await makeAccount('BUSINESS', 'bono-despues-empresa');
      const run = await request(app).post('/api/admin/currency/welcome-bonus/backfill').set(as(admin.token));
      expect(run.status, JSON.stringify(run.body)).toBe(200);
      expect(run.body.workers.alreadyHad).toBeGreaterThanOrEqual(1);
      expect(run.body.workers.granted).toBeGreaterThanOrEqual(1);
      expect(run.body.companies.granted).toBeGreaterThanOrEqual(1);
      expect(await balanceOf(before)).toBe(50);
      expect(await balanceOf(missingWorker)).toBe(80);
      expect(await balanceOf(missingCompany)).toBe(80);
      // La pasada siguiente no cambia nada ni falla.
      const again = await request(app).post('/api/admin/currency/welcome-bonus/backfill').set(as(admin.token));
      expect([again.status, again.body.workers.granted, again.body.companies.granted]).toEqual([200, 0, 0]);
      // El alta de una cuenta nueva con el monto editado tampoco falla.
      const registered = await request(app).post('/api/auth/register').send({ role: 'WORKER', name: 'Alta Editada', email: 'alta.editada@chambeaya.test', password: 'Password123', dniOrRuc: '61000006' });
      expect(registered.status).toBe(201);
      const newId = (await prisma.user.findUniqueOrThrow({ where: { email: 'alta.editada@chambeaya.test' } })).id;
      expect((await prisma.currencyMovement.findMany({ where: { account: { workerId: newId } } })).map((movement) => movement.quantity)).toEqual([80]);
    } finally {
      for (const entry of entries) await prisma.currencyCatalogEntry.update({ where: { id: entry.id }, data: { amount: entry.amount } });
    }
  }, 60_000);

  it('keeps refund sweeps and simultaneous charges on the same account free of 500s and the ledger consistent (BAJO-1)', async () => {
    const company = await makeAccount('BUSINESS', 'barrido-concurrente');
    const worker = await makeAccount('WORKER', 'barrido-cobros');
    await exhaustQuota(worker, 'APPLICATION_EXTRA', 10);
    await fund(worker, 1000);
    await fund(company, 1000);
    const caps = await prisma.currencySetting.findMany({ where: { key: { in: ['DAILY_SPEND_CAP_WORKER', 'DAILY_SPEND_CAP_COMPANY'] } } });
    await prisma.currencySetting.updateMany({ where: { key: { in: ['DAILY_SPEND_CAP_WORKER', 'DAILY_SPEND_CAP_COMPANY'] } }, data: { value: 100_000 } });
    try {
      for (let round = 0; round < 4; round += 1) {
        const ids = [] as string[];
        for (let index = 0; index < 6; index += 1) ids.push(await published(company, { vacancies: 5 }));
        // Cobros que el reloj adelantado ya considera vencidos (con prioridad).
        for (const id of ids.slice(0, 3)) expect((await apply(worker, id, { priority: true })).status).toBe(201);
        const [sweepA, sweepB, ...applies] = await Promise.all([
          lateSweeper().sweep(), lateSweeper().sweep(),
          ...ids.slice(3).map((id) => apply(worker, id, { priority: true })),
        ]);
        expect(sweepA.refunded + sweepB.refunded).toBeGreaterThanOrEqual(0);
        for (const response of applies as Array<Awaited<ReturnType<typeof apply>>>) expect([response.status, response.body.error], JSON.stringify(response.body)).toEqual([201, undefined]);
      }
      await lateSweeper().sweep();
      const movements = await movementsOf(worker);
      let running = 0;
      movements.forEach((movement, index) => {
        running += movement.quantity;
        expect(movement.sequence).toBe(index + 1);
        expect(movement.balanceAfter).toBe(running);
        expect(running).toBeGreaterThanOrEqual(0);
      });
      const refunds = movements.filter((movement) => movement.action === 'ACTION_REFUND');
      expect(new Set(refunds.map((movement) => movement.refundOfId)).size).toBe(refunds.length);
    } finally {
      for (const cap of caps) await prisma.currencySetting.update({ where: { key: cap.key }, data: { value: cap.value } });
    }
  }, 180_000);
});
