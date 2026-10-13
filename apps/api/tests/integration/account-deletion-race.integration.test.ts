import { appendFileSync } from 'node:fs';
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
import { DEFAULT_CURRENCY_SETTINGS } from '../../src/modules/currency/currency.settings.js';
import { WelcomeBonusService } from '../../src/modules/currency/currency.welcome.js';
import { PrivateDocumentStorage } from '../../src/modules/talent/private_document_storage.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;

function requireTestDatabase() {
  if (process.env.CHAMBEAYA_INTEGRATION_TESTS !== 'true') throw new Error('INTEGRATION_TESTS_REQUIRE_EXPLICIT_OPT_IN');
  if (!integrationDatabaseUrl) throw new Error('INTEGRATION_TESTS_REQUIRE_DATABASE_URL');
  const databaseName = new URL(integrationDatabaseUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!databaseName?.endsWith('_test')) throw new Error('INTEGRATION_TESTS_REQUIRE_TEST_DATABASE');
}

type Account = { id: string; token: string; email: string; companyId?: string };

/**
 * BAJO-A de CN-20261007-046: el borrado de una cuenta bajo concurrencia nunca responde 500.
 * Borrados simultáneos del mismo titular: un 204 y el resto 404 (antes: P2025 como 500). Un borrado
 * simultáneo con una acción del propio titular: ni interbloqueo (40P01) ni FK (P2003) como 500, ni
 * en el borrado ni en la acción; el estado final es coherente y el libro de las demás cuentas
 * queda intacto.
 */
describe('account deletion under concurrency (BAJO-A)', () => {
  const prisma = new PrismaClient();
  let storageRoot = '';
  let app: ReturnType<typeof createApp>;
  let admin: Account;
  let counter = 0;
  let databaseReady = false;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function makeAccount(role: 'BUSINESS' | 'ADMIN', label: string): Promise<Account> {
    counter += 1;
    const salt = 'deletion-salt';
    const email = `${label}.${counter}@chambeaya.test`;
    const identifier = role === 'BUSINESS' ? String(20_800_000_000 + counter) : `ADMIN-DELETION-${counter}`;
    const user = await prisma.user.create({ data: { email, passwordHash: hashPassword('Password123', salt), salt, role, name: `Cuenta ${label} ${counter}`, identifier } });
    const company = role === 'BUSINESS' ? await prisma.company.create({ data: { ownerId: user.id, name: `Empresa ${counter}`, ruc: identifier } }) : null;
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123' });
    return { id: user.id, token: login.body.token as string, email, companyId: company?.id };
  }
  async function registered(label: string): Promise<Account> {
    counter += 1;
    const email = `${label}.${counter}@chambeaya.test`;
    const response = await request(app).post('/api/auth/register').send({ role: 'WORKER', name: `Registrado ${label}`, email, password: 'Password123', dniOrRuc: String(72_000_000 + counter) });
    expect(response.status).toBe(201);
    return { id: response.body.userId as string, token: response.body.token as string, email };
  }

  const fund = async (account: Account, quantity: number) => {
    const path = account.companyId ? `companies/${account.companyId}` : `workers/${account.id}`;
    expect((await request(app).post(`/api/admin/currency/${path}/adjustments`).set(as(admin.token)).send({ quantity, reason: 'Fondos de prueba', idempotencyKey: `fund-${account.id}-${(counter += 1)}` })).status).toBe(201);
  };
  const published = async (company: Account) => {
    const created = await request(app).post('/api/business/job-postings').set(as(company.token)).send({
      title: 'Cajera de tienda de ropa', description: 'Atencion al cliente, caja y reposicion en tienda de ropa en Lima.',
      modality: 'ONSITE', workload: 'FULL_TIME', salaryMinCents: 150000, salaryMaxCents: 200000, location: 'Miraflores, Lima', contractType: 'INDEFINITE', vacancies: 50,
    });
    expect(created.status).toBe(201);
    expect((await request(app).post(`/api/business/job-postings/${created.body.id}/publish`).set(as(company.token))).status).toBe(200);
    return created.body.id as string;
  };
  const deleteWorker = (id: string) => request(app).delete(`/api/admin/workers/${id}`).set(as(admin.token));
  const deleteCompany = (id: string) => request(app).delete(`/api/admin/companies/${id}`).set(as(admin.token));
  const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
  /** Desfases (ms) entre el inicio de las acciones y el del borrado: recorren los entrelazados posibles. */
  const DELAYS = [0, 2, 5, 9, 14, 20, 30, 45];
  /**
   * Resultado válido de contención: ni `500` ni un `503` cualquiera. `503 SERIALIZATION_RETRY_EXHAUSTED`
   * (con `retryable: true`) es la respuesta contractual cuando los reintentos `Serializable` se agotan:
   * la transacción se revirtió entera y repetir es seguro.
   */
  const isContentionRetry = (response: { status: number; body: unknown }) => response.status === 503
    && (response.body as { error?: string }).error === 'SERIALIZATION_RETRY_EXHAUSTED'
    && (response.body as { retryable?: boolean }).retryable === true;
  const expectNoServerError = (response: { status: number; body: unknown }) => {
    expect(response.status < 500 || isContentionRetry(response), `${response.status} ${JSON.stringify(response.body)}`).toBe(true);
  };

  /** Las cadenas `sequence`/`balanceAfter` de todas las cuentas siguen siendo consistentes. */
  async function assertLedgerChains() {
    const broken = await prisma.$queryRawUnsafe<Array<{ accountId: string }>>(`
      SELECT m."accountId" FROM "CurrencyMovement" m
      LEFT JOIN "CurrencyMovement" p ON p."accountId" = m."accountId" AND p."sequence" = m."sequence" - 1
      WHERE (m."sequence" = 1 AND m."balanceAfter" <> m."quantity")
         OR (m."sequence" > 1 AND (p."id" IS NULL OR m."balanceAfter" <> p."balanceAfter" + m."quantity"))`);
    expect(broken).toEqual([]);
  }

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;
    await prisma.currencyCatalogEntry.createMany({ data: DEFAULT_CURRENCY_CATALOG.map((entry) => ({ ...entry })) });
    await prisma.currencySetting.createMany({ data: Object.entries(DEFAULT_CURRENCY_SETTINGS).map(([key, value]) => ({ key, value })) });
    storageRoot = await mkdtemp(join(tmpdir(), 'chambeaya-deletion-'));
    process.env.DOCUMENT_STORAGE_ROOT = storageRoot;
    const storage = new PrivateDocumentStorage(storageRoot);
    const authService = new DatabaseAuthService(prisma, { onWorkerCreated: async (workerId) => { await new WelcomeBonusService(prisma, new CurrencyActionService()).grantForWorker(workerId); } });
    app = createApp({ rateLimit: false, authService, currencyPrisma: prisma, paymentsPrisma: prisma, jobsPrisma: prisma, jobsStorage: storage });
    admin = await makeAccount('ADMIN', 'admin');
  }, 60_000);

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await prisma.$disconnect();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('simultaneous deletions of the same worker give one 204 and the rest 404, never a 500', async () => {
    for (let round = 0; round < 4; round += 1) {
      const worker = await registered(`dw${round}`);
      const responses = await Promise.all([1, 2, 3, 4, 5].map(() => deleteWorker(worker.id)));
      responses.forEach(expectNoServerError);
      const deleted = responses.filter((candidate) => candidate.status === 204).length;
      expect(deleted).toBeLessThanOrEqual(1);
      for (const response of responses.filter((candidate) => candidate.status === 404)) expect(response.body).toEqual({ error: 'WORKER_NOT_FOUND' });
      // Todo lo demás es contención reintentable (nada a medias): o se borró entero, o sigue entero.
      expect(responses.filter((candidate) => ![204, 404].includes(candidate.status)).every(isContentionRetry)).toBe(true);
      if (deleted === 1) {
        expect(await prisma.user.count({ where: { id: worker.id } })).toBe(0);
        expect(await prisma.currencyAccount.count({ where: { workerId: worker.id } })).toBe(0);
      } else {
        // Ninguno ganó: la cuenta sigue completa y borrarla de nuevo funciona.
        expect(await prisma.user.count({ where: { id: worker.id } })).toBe(1);
        expect(await prisma.currencyAccount.count({ where: { workerId: worker.id } })).toBe(1);
        expect((await deleteWorker(worker.id)).status).toBe(204);
      }
    }
    await assertLedgerChains();
  }, 60_000);

  it('simultaneous deletions of the same company give one 204 and the rest 404, never a 500', async () => {
    for (let round = 0; round < 4; round += 1) {
      const company = await makeAccount('BUSINESS', `dc${round}`);
      await published(company);
      const responses = await Promise.all([1, 2, 3, 4, 5].map(() => deleteCompany(company.companyId!)));
      responses.forEach(expectNoServerError);
      const deleted = responses.filter((candidate) => candidate.status === 204).length;
      expect(deleted).toBeLessThanOrEqual(1);
      for (const response of responses.filter((candidate) => candidate.status === 404)) expect(response.body).toEqual({ error: 'COMPANY_NOT_FOUND' });
      expect(responses.filter((candidate) => ![204, 404].includes(candidate.status)).every(isContentionRetry)).toBe(true);
      if (deleted === 1) {
        expect(await prisma.company.count({ where: { id: company.companyId! } })).toBe(0);
        expect(await prisma.user.count({ where: { id: company.id } })).toBe(0);
        expect(await prisma.jobPosting.count({ where: { companyId: company.companyId! } })).toBe(0);
      } else {
        // Ninguno ganó: la empresa sigue entera (con su puesto) y borrarla de nuevo funciona.
        expect(await prisma.company.count({ where: { id: company.companyId! } })).toBe(1);
        expect(await prisma.jobPosting.count({ where: { companyId: company.companyId! } })).toBeGreaterThan(0);
        expect((await deleteCompany(company.companyId!)).status).toBe(204);
      }
    }
    await assertLedgerChains();
  }, 60_000);

  it('a deletion racing the holder’s own actions never answers 500 (no deadlock, no FK error) and leaves a coherent state', async () => {
    const company = await makeAccount('BUSINESS', 'race-owner');
    await fund(company, 5_000);
    const outcomes: string[] = [];
    // Dos puestos con vacantes de sobra para todas las rondas (publicar cuesta moneda y el tope diario es finito).
    const posting = await published(company);
    const posting2 = await published(company);
    for (let round = 0; round < 16; round += 1) {
      const worker = await registered(`race${round}`);
      const applied = await request(app).post(`/api/workers/job-postings/${posting}/applications`).set(as(worker.token)).send({});
      expect(applied.status).toBe(201);
      const applicationId = applied.body.id as string;
      const [deletion, ...actions] = await Promise.all([
        sleep(DELAYS[round % DELAYS.length]!).then(() => deleteWorker(worker.id)),
        // Acciones propias que bloquean la postulación, la cuenta de moneda y luego insertan eventos o filas con FK al usuario.
        request(app).post(`/api/workers/job-applications/${applicationId}/withdraw`).set(as(worker.token)),
        request(app).post(`/api/workers/job-postings/${posting2}/applications`).set(as(worker.token)).send({}),
        request(app).post(`/api/workers/job-applications/${applicationId}/priority`).set(as(worker.token)),
      ]);
      outcomes.push(`${deletion.status}|${actions.map((action) => action.status).join(',')}`);
      expectNoServerError(deletion);
      expect(deletion.status === 503 ? isContentionRetry(deletion) : [204, 404, 409].includes(deletion.status), JSON.stringify(deletion.body)).toBe(true);
      actions.forEach(expectNoServerError);
      // Sin parcial: el trabajador se borró entero o sigue entero (también tras un 503 del borrado).
      const exists = await prisma.user.count({ where: { id: worker.id } });
      if (deletion.status === 204) {
        expect(exists).toBe(0);
        expect(await prisma.jobApplication.count({ where: { workerId: worker.id } })).toBe(0);
        expect(await prisma.currencyAccount.count({ where: { workerId: worker.id } })).toBe(0);
      } else {
        expect(exists).toBe(1);
        expect(await prisma.currencyAccount.count({ where: { workerId: worker.id } })).toBe(1);
        expect(await prisma.jobApplication.count({ where: { id: applicationId } })).toBe(1);
      }
    }
    if (process.env.RACE_LOG) appendFileSync(process.env.RACE_LOG, `RACE_OUTCOMES ${JSON.stringify(outcomes)}\n`);
    await assertLedgerChains();
  }, 120_000);

  it('a company deletion racing the company’s own actions never answers 500', async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < 12; round += 1) {
      const company = await makeAccount('BUSINESS', `race-co${round}`);
      const posting = await published(company);
      const draft = (await request(app).post('/api/business/job-postings').set(as(company.token)).send({
        title: 'Otro puesto del mismo dia', description: 'Atencion al cliente, caja y reposicion en tienda de ropa en Lima.',
        modality: 'ONSITE', workload: 'FULL_TIME', salaryMinCents: 150000, salaryMaxCents: 200000, location: 'Miraflores, Lima', contractType: 'INDEFINITE', vacancies: 2,
      })).body.id as string;
      const worker = await registered(`race-cow${round}`);
      const applied = await request(app).post(`/api/workers/job-postings/${posting}/applications`).set(as(worker.token)).send({});
      const [deletion, ...actions] = await Promise.all([
        sleep(DELAYS[round % DELAYS.length]!).then(() => deleteCompany(company.companyId!)),
        request(app).post(`/api/business/job-postings/${draft}/publish`).set(as(company.token)),
        request(app).post(`/api/business/job-postings/${posting}/highlight`).set(as(company.token)),
        request(app).post(`/api/business/job-applications/${applied.body.id}/stage`).set(as(company.token)).send({ status: 'SHORTLISTED' }),
      ]);
      outcomes.push(`${deletion.status}|${actions.map((action) => action.status).join(',')}`);
      expectNoServerError(deletion);
      actions.forEach(expectNoServerError);
      const exists = await prisma.user.count({ where: { id: company.id } });
      if (deletion.status === 204) {
        expect(exists).toBe(0);
        expect(await prisma.jobPosting.count({ where: { companyId: company.companyId! } })).toBe(0);
      } else {
        // Un 503 (o un 409) del borrado no deja nada a medias: la empresa y su puesto original siguen.
        expect(exists).toBe(1);
        expect(await prisma.jobPosting.count({ where: { id: posting } })).toBe(1);
      }
    }
    if (process.env.RACE_LOG) appendFileSync(process.env.RACE_LOG, `RACE_OUTCOMES_COMPANY ${JSON.stringify(outcomes)}\n`);
    await assertLedgerChains();
  }, 120_000);

  it('still refuses to delete accounts with retained records and deletes welcome-only ones', async () => {
    const worker = await registered('retained');
    await fund(worker, 10);
    const blocked = await deleteWorker(worker.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ error: 'CURRENCY_LEDGER_RETAINED' });
    expect(await prisma.user.count({ where: { id: worker.id } })).toBe(1);
    const fresh = await registered('welcomeonly');
    expect((await deleteWorker(fresh.id)).status).toBe(204);
    expect((await deleteWorker(fresh.id)).status).toBe(404);
    expect((await deleteCompany('no-existe')).status).toBe(404);
  });
});
