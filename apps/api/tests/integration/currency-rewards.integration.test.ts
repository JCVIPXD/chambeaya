import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
const FUTURE_START = '2099-01-15';
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-image-body')]);
const HOUR = 3_600_000;

describe('automatic rewards (M6) under PostgreSQL', () => {
  const prisma = new PrismaClient();
  let storageRoot = '';
  let clockNow: Date | null = null;
  let app: ReturnType<typeof createApp>;
  let admin: Account;
  let specialtyId = '';
  let counter = 0;
  let databaseReady = false;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const clock = () => clockNow ?? new Date();

  async function makeAccount(role: 'WORKER' | 'BUSINESS' | 'ADMIN', label: string): Promise<Account> {
    counter += 1;
    const salt = 'rewards-salt';
    const email = `${label}.${counter}@chambeaya.test`;
    const identifier = role === 'WORKER' ? String(70_000_000 + counter) : role === 'BUSINESS' ? String(20_700_000_000 + counter) : `ADMIN-REWARDS-${counter}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: hashPassword('Password123', salt), salt, role, name: `Cuenta ${label} ${counter}`, identifier },
    });
    const company = role === 'BUSINESS' ? await prisma.company.create({ data: { ownerId: user.id, name: `Empresa ${counter}`, ruc: identifier } }) : null;
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123' });
    return { id: user.id, token: login.body.token as string, email, companyId: company?.id };
  }

  /** Trabajador creado por el registro real (con bono de bienvenida y, opcionalmente, código de referido). */
  async function register(label: string, referralCode?: string) {
    counter += 1;
    const email = `${label}.${counter}@chambeaya.test`;
    const response = await request(app).post('/api/auth/register').send({
      role: 'WORKER', name: `Registrado ${label}`, email, password: 'Password123', dniOrRuc: String(71_000_000 + counter), ...(referralCode === undefined ? {} : { referralCode }),
    });
    return { response, email };
  }
  async function registered(label: string, referralCode?: string): Promise<Account> {
    const { response, email } = await register(label, referralCode);
    expect(response.status).toBe(201);
    return { id: response.body.userId as string, token: response.body.token as string, email };
  }

  const owner = (account: Account) => (account.companyId ? { companyId: account.companyId } : { workerId: account.id });
  const balanceOf = async (account: Account) => (await prisma.currencyMovement.findFirst({ where: { account: owner(account) }, orderBy: { sequence: 'desc' } }))?.balanceAfter ?? 0;
  const rewardMovements = (account: Account, actionKey?: string) => prisma.currencyMovement.findMany({
    where: { account: owner(account), action: 'REWARD', actionKey: actionKey ?? { not: 'WELCOME_BONUS' } }, orderBy: { sequence: 'asc' },
  });
  const grantsOf = (account: Account, actionKey?: string) => prisma.currencyRewardGrant.findMany({ where: { userId: account.id, ...(actionKey ? { actionKey } : {}) } });
  const fund = async (account: Account, quantity: number) => {
    const path = account.companyId ? `companies/${account.companyId}` : `workers/${account.id}`;
    const response = await request(app).post(`/api/admin/currency/${path}/adjustments`).set(as(admin.token))
      .send({ quantity, reason: 'Fondos de prueba', idempotencyKey: `fund-${account.id}-${(counter += 1)}` });
    expect(response.status).toBe(201);
  };
  const setSetting = async (key: string, value: number) => {
    const response = await request(app).patch(`/api/admin/currency/settings/${key}`).set(as(admin.token)).send({ value, reason: 'Ajuste de prueba' });
    expect(response.status).toBe(200);
  };
  const setCatalogActive = (actionKey: string, actor: 'WORKER' | 'COMPANY', active: boolean) =>
    prisma.currencyCatalogEntry.updateMany({ where: { actionKey, actor }, data: { active } });

  const profileBody = (over: Record<string, unknown> = {}) => ({
    headline: 'Barista con tres años de experiencia',
    bio: 'Trabajo en cafeterías desde hace varios años, con experiencia en caja y atención al público.',
    district: 'Miraflores',
    availabilityDays: ['MONDAY', 'TUESDAY'],
    availabilityPeriods: ['MORNING'],
    specialtyIds: [specialtyId],
    ...over,
  });
  const experience = [{ role: 'Barista', employer: 'Café Central', startDate: '2023-01-01' }];
  const patchProfile = (worker: Account, body: Record<string, unknown>) => request(app).patch('/api/workers/me/profile').set(as(worker.token)).send(body);
  const uploadCv = (worker: Account, text = 'cv') => request(app).put('/api/workers/me/cv').set(as(worker.token))
    .set('Content-Type', 'application/pdf').set('X-File-Name', encodeURIComponent('cv.pdf')).send(pdf(text));
  const uploadPhoto = (worker: Account) => request(app).put('/api/workers/me/photo').set(as(worker.token))
    .set('Content-Type', 'image/png').set('X-File-Name', encodeURIComponent('foto.png')).send(png);
  /** Deja el perfil con todo lo obligatorio salvo las secciones indicadas. */
  async function fillProfile(worker: Account, except: Array<'experience' | 'cv' | 'photo'> = []) {
    expect((await patchProfile(worker, profileBody(except.includes('experience') ? {} : { experiences: experience }))).status).toBe(200);
    if (!except.includes('cv')) expect((await uploadCv(worker)).status).toBe(201);
    if (!except.includes('photo')) expect((await uploadPhoto(worker)).status).toBe(201);
  }
  /** Versión opaca del archivo vigente, como la ve el admin al listar los documentos (BAJO-3). */
  const versionOf = async (worker: Account, kind: 'CV' | 'PROFILE_PHOTO') => {
    const listing = await request(app).get(`/api/admin/workers/${worker.id}/documents`).set(as(admin.token));
    return (listing.body.documents as Array<{ kind: string; version: string }> | undefined)?.find((document) => document.kind === kind)?.version ?? 'sin-documento';
  };
  const verifyDocument = async (worker: Account, kind: 'CV' | 'PROFILE_PHOTO', token = admin.token, version?: string) =>
    request(app).post(`/api/admin/workers/${worker.id}/documents/${kind}/verification`).set(as(token)).send({ documentVersion: version ?? await versionOf(worker, kind) });
  const unverifyDocument = (worker: Account, kind: 'CV' | 'PROFILE_PHOTO', token = admin.token, body: Record<string, unknown> = { reason: 'Documento ilegible' }) =>
    request(app).delete(`/api/admin/workers/${worker.id}/documents/${kind}/verification`).set(as(token)).send(body);

  const postingBody = (over: Record<string, unknown> = {}) => ({
    title: 'Cajera de tienda de ropa',
    description: 'Atencion al cliente, caja y reposicion en tienda de ropa en Lima.',
    modality: 'ONSITE', workload: 'FULL_TIME', salaryMinCents: 150000, salaryMaxCents: 200000,
    location: 'Miraflores, Lima', contractType: 'INDEFINITE', vacancies: 3,
    ...over,
  });
  const published = async (company: Account, over: Record<string, unknown> = {}) => {
    const created = await request(app).post('/api/business/job-postings').set(as(company.token)).send(postingBody(over));
    expect(created.status).toBe(201);
    expect((await request(app).post(`/api/business/job-postings/${created.body.id}/publish`).set(as(company.token))).status).toBe(200);
    return created.body.id as string;
  };
  const apply = async (worker: Account, postingId: string) => {
    const response = await request(app).post(`/api/workers/job-postings/${postingId}/applications`).set(as(worker.token)).send({});
    expect([200, 201]).toContain(response.status);
    return response.body.id as string;
  };
  const stage = (company: Account, applicationId: string, status: 'SHORTLISTED' | 'INTERVIEW') =>
    request(app).post(`/api/business/job-applications/${applicationId}/stage`).set(as(company.token)).send({ status });

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    // Otras suites vacian el catalogo y los ajustes con `TRUNCATE ... CASCADE`; se restablece lo sembrado por la migracion.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;
    await prisma.currencyCatalogEntry.createMany({ data: DEFAULT_CURRENCY_CATALOG.map((entry) => ({ ...entry })) });
    await prisma.currencySetting.createMany({ data: Object.entries(DEFAULT_CURRENCY_SETTINGS).map(([key, value]) => ({ key, value })) });
    specialtyId = (await prisma.specialty.upsert({ where: { slug: 'barista-m6' }, create: { slug: 'barista-m6', name: 'Barista M6', category: 'Gastronomía' }, update: {} })).id;
    storageRoot = await mkdtemp(join(tmpdir(), 'chambeaya-rewards-'));
    process.env.DOCUMENT_STORAGE_ROOT = storageRoot;
    const storage = new PrivateDocumentStorage(storageRoot);
    const authService = new DatabaseAuthService(prisma, { onWorkerCreated: async (workerId) => { await new WelcomeBonusService(prisma, new CurrencyActionService(clock)).grantForWorker(workerId); } });
    app = createApp({ rateLimit: false, authService, currencyPrisma: prisma, paymentsPrisma: prisma, jobsPrisma: prisma, currencyClock: clock, jobsStorage: storage });
    // El almacenamiento de documentos del trabajador usa DOCUMENT_STORAGE_ROOT (ya fijado antes de crear la app).
    admin = await makeAccount('ADMIN', 'admin');
  }, 60_000);

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await prisma.$disconnect();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  // ---- PROFILE_COMPLETE -------------------------------------------------------

  it('PROFILE_COMPLETE pays once, exactly when the last mandatory section is completed, and never again', async () => {
    const worker = await registered('pc');
    expect(await balanceOf(worker)).toBe(50);
    expect((await patchProfile(worker, profileBody())).status).toBe(200);
    expect((await patchProfile(worker, { experiences: experience })).status).toBe(200);
    expect((await uploadCv(worker)).status).toBe(201);
    expect(await grantsOf(worker)).toHaveLength(0);
    expect((await uploadPhoto(worker)).status).toBe(201);

    const grants = await grantsOf(worker, 'PROFILE_COMPLETE');
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ amount: 20, actor: 'WORKER', factKey: `PROFILE_COMPLETE:${worker.id}`, relatedEntityType: 'WorkerTalentProfile' });
    expect(await balanceOf(worker)).toBe(70);
    const movements = await request(app).get('/api/workers/currency/movements').set(as(worker.token));
    const reward = movements.body.items.find((item: { actionKey: string }) => item.actionKey === 'PROFILE_COMPLETE');
    expect(reward).toMatchObject({ action: 'REWARD', quantity: 20, balanceAfter: 70, relatedEntity: { type: 'WorkerTalentProfile' } });

    // Editar, borrar una sección y volver a completar no paga otra vez.
    expect((await patchProfile(worker, { headline: 'Barista de especialidad con mucha experiencia' })).status).toBe(200);
    expect((await patchProfile(worker, { experiences: [] })).status).toBe(200);
    expect((await patchProfile(worker, { experiences: experience })).status).toBe(200);
    expect(await grantsOf(worker, 'PROFILE_COMPLETE')).toHaveLength(1);
    expect(await balanceOf(worker)).toBe(70);
  });

  it('two simultaneous saves that complete the profile pay a single reward', async () => {
    const worker = await registered('pcrace');
    await fillProfile(worker, ['experience']);
    expect(await grantsOf(worker)).toHaveLength(0);
    const responses = await Promise.all([1, 2, 3, 4].map(() => patchProfile(worker, { experiences: experience })));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(await grantsOf(worker, 'PROFILE_COMPLETE')).toHaveLength(1);
    expect(await rewardMovements(worker, 'PROFILE_COMPLETE')).toHaveLength(1);
    expect(await balanceOf(worker)).toBe(70);
  }, 40_000);

  it('an inactive catalog entry means no reward; activating it pays on the next qualifying save', async () => {
    const worker = await registered('pcinactive');
    await setCatalogActive('PROFILE_COMPLETE', 'WORKER', false);
    try {
      await fillProfile(worker);
      expect(await grantsOf(worker)).toHaveLength(0);
      expect(await balanceOf(worker)).toBe(50);
    } finally {
      await setCatalogActive('PROFILE_COMPLETE', 'WORKER', true);
    }
    expect((await patchProfile(worker, { headline: 'Barista con otro titular distinto' })).status).toBe(200);
    expect(await grantsOf(worker, 'PROFILE_COMPLETE')).toHaveLength(1);
    expect(await balanceOf(worker)).toBe(70);
  });

  it('a failing reward never loses the profile change (savepoint) and is retried on the next save', async () => {
    const worker = await registered('pcfail');
    await fillProfile(worker, ['photo']);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_reward() RETURNS trigger AS $$ BEGIN
        IF NEW."actionKey" = 'PROFILE_COMPLETE' THEN RAISE EXCEPTION 'TEST_REWARD_FAILURE'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER test_fail_reward BEFORE INSERT ON "CurrencyRewardGrant" FOR EACH ROW EXECUTE FUNCTION test_fail_reward()');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const uploaded = await uploadPhoto(worker);
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.photo).not.toBeNull();
      expect(await prisma.workerDocument.count({ where: { userId: worker.id, kind: 'PROFILE_PHOTO' } })).toBe(1);
      expect(await grantsOf(worker)).toHaveLength(0);
      expect(await balanceOf(worker)).toBe(50);
      expect(log.mock.calls.some((call) => call[0] === 'REWARD_FAILED')).toBe(true);
    } finally {
      log.mockRestore();
      await prisma.$executeRawUnsafe('DROP TRIGGER test_fail_reward ON "CurrencyRewardGrant"');
      await prisma.$executeRawUnsafe('DROP FUNCTION test_fail_reward()');
    }
    expect((await patchProfile(worker, { headline: 'Barista que reintenta el premio pendiente' })).status).toBe(200);
    expect(await grantsOf(worker, 'PROFILE_COMPLETE')).toHaveLength(1);
    expect(await balanceOf(worker)).toBe(70);
  });

  it('answers 503 SERIALIZATION_RETRY_EXHAUSTED (not 400) when the profile save runs out of Serializable retries, with no partial effects (BAJO-2)', async () => {
    const worker = await registered('retry503');
    await fillProfile(worker, ['experience']);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_force_40001() RETURNS trigger AS $$ BEGIN
        RAISE EXCEPTION 'TEST_FORCED_SERIALIZATION_FAILURE' USING ERRCODE = '40001';
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER test_force_40001 BEFORE INSERT ON "CurrencyRewardGrant" FOR EACH ROW EXECUTE FUNCTION test_force_40001()');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // Completa el perfil: el premio choca con el disparador, se agotan los reintentos y el guardado entero se revierte.
      const saved = await patchProfile(worker, { experiences: experience });
      expect(saved.status, JSON.stringify(saved.body)).toBe(503);
      expect(saved.headers['retry-after']).toBe('1');
      expect(saved.body).toMatchObject({ error: 'SERIALIZATION_RETRY_EXHAUSTED', retryable: true });
      expect(await prisma.workerExperience.count({ where: { profile: { userId: worker.id } } })).toBe(0);
      expect(await grantsOf(worker)).toHaveLength(0);
      expect(await balanceOf(worker)).toBe(50);
    } finally {
      log.mockRestore();
      await prisma.$executeRawUnsafe('DROP TRIGGER test_force_40001 ON "CurrencyRewardGrant"');
      await prisma.$executeRawUnsafe('DROP FUNCTION test_force_40001()');
    }
    // Pasada la contención, la misma petición se aplica entera y paga una sola vez.
    expect((await patchProfile(worker, { experiences: experience })).status).toBe(200);
    expect(await grantsOf(worker, 'PROFILE_COMPLETE')).toHaveLength(1);
    expect(await balanceOf(worker)).toBe(70);
  }, 60_000);

  // ---- DOCUMENT_VERIFIED + tope de premios -------------------------------------

  it('DOCUMENT_VERIFIED pays one reward per document TYPE, never twice, and replacing the file resets the verification', async () => {
    const worker = await registered('doc');
    expect((await uploadCv(worker, 'v1')).status).toBe(201);
    expect((await uploadPhoto(worker)).status).toBe(201);

    const first = await verifyDocument(worker, 'CV');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ verified: true, alreadyVerified: false, verifiedById: admin.id, reward: { granted: true, amount: 10 } });
    expect(await balanceOf(worker)).toBe(60);
    const again = await verifyDocument(worker, 'CV');
    expect(again.body).toMatchObject({ alreadyVerified: true, verifiedById: admin.id });
    expect(await grantsOf(worker, 'DOCUMENT_VERIFIED')).toHaveLength(1);

    // Reemplazar el archivo quita la verificación; verificarlo otra vez NO vuelve a pagar.
    expect((await uploadCv(worker, 'v2')).status).toBe(201);
    expect((await prisma.workerDocument.findUniqueOrThrow({ where: { userId_kind: { userId: worker.id, kind: 'CV' } } })).verifiedAt).toBeNull();
    const reverified = await verifyDocument(worker, 'CV');
    expect(reverified.body).toMatchObject({ alreadyVerified: false });
    expect(await grantsOf(worker, 'DOCUMENT_VERIFIED')).toHaveLength(1);
    expect(await balanceOf(worker)).toBe(60);

    // Otro tipo sí paga; con los dos tipos premiados no queda nada más que ganar.
    expect((await verifyDocument(worker, 'PROFILE_PHOTO')).body.reward).toMatchObject({ granted: true, amount: 10 });
    expect(await balanceOf(worker)).toBe(70);
    expect(await grantsOf(worker, 'DOCUMENT_VERIFIED')).toHaveLength(2);

    const unverified = await unverifyDocument(worker, 'CV');
    expect(unverified.body).toEqual({ verified: false, alreadyUnverified: false });
    expect(await balanceOf(worker)).toBe(70);
  });

  it('only an admin can verify; a missing document is 404 and an unknown type is 400', async () => {
    const worker = await registered('docauth');
    const business = await makeAccount('BUSINESS', 'docauthb');
    expect((await uploadCv(worker)).status).toBe(201);
    expect((await verifyDocument(worker, 'CV', worker.token)).status).toBe(403);
    expect((await verifyDocument(worker, 'CV', business.token)).status).toBe(403);
    expect((await request(app).post(`/api/admin/workers/${worker.id}/documents/CV/verification`).send({ documentVersion: 'x' })).status).toBe(401);
    expect((await verifyDocument(worker, 'PROFILE_PHOTO')).body).toEqual({ error: 'DOCUMENT_NOT_FOUND' });
    expect((await request(app).post(`/api/admin/workers/${worker.id}/documents/DNI/verification`).set(as(admin.token)).send({ documentVersion: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/admin/workers/nobody/documents/CV/verification').set(as(admin.token)).send({ documentVersion: 'x' })).status).toBe(404);
    expect(await grantsOf(worker)).toHaveLength(0);
    expect((await unverifyDocument(worker, 'CV', worker.token)).status).toBe(403);
    // Sin la versión revisada no se verifica nada (400) y el cuerpo no admite campos de más.
    expect((await request(app).post(`/api/admin/workers/${worker.id}/documents/CV/verification`).set(as(admin.token))).status).toBe(400);
    expect((await request(app).post(`/api/admin/workers/${worker.id}/documents/CV/verification`).set(as(admin.token)).send({ documentVersion: await versionOf(worker, 'CV'), verifiedById: 'otro' })).status).toBe(400);
  });

  it('two simultaneous verifications of the same document pay once and keep the first author', async () => {
    const worker = await registered('docrace');
    expect((await uploadCv(worker)).status).toBe(201);
    const secondAdmin = await makeAccount('ADMIN', 'admin2');
    const results = await Promise.all([verifyDocument(worker, 'CV'), verifyDocument(worker, 'CV', secondAdmin.token), verifyDocument(worker, 'CV'), verifyDocument(worker, 'CV', secondAdmin.token)]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200]);
    expect(results.filter((result) => result.body.alreadyVerified === false)).toHaveLength(1);
    expect(await grantsOf(worker, 'DOCUMENT_VERIFIED')).toHaveLength(1);
    expect(await rewardMovements(worker, 'DOCUMENT_VERIFIED')).toHaveLength(1);
    expect(await balanceOf(worker)).toBe(60);
    const author = (await prisma.workerDocument.findUniqueOrThrow({ where: { userId_kind: { userId: worker.id, kind: 'CV' } } })).verifiedById;
    expect([admin.id, secondAdmin.id]).toContain(author);
  }, 40_000);

  it('the daily and monthly reward caps skip the reward but keep the fact, and rewards never count as spending', async () => {
    const worker = await registered('caps');
    expect((await uploadCv(worker)).status).toBe(201);
    await fillProfile(worker); // PROFILE_COMPLETE: +20
    expect(await balanceOf(worker)).toBe(70);
    await setSetting('REWARD_CAP_DAILY_WORKER', 25);
    const blocked = await verifyDocument(worker, 'CV');
    expect(blocked.body).toMatchObject({ verified: true, reward: { granted: false, amount: 0, reason: 'CAP_REACHED_DAILY' } });
    expect((await prisma.workerDocument.findUniqueOrThrow({ where: { userId_kind: { userId: worker.id, kind: 'CV' } } })).verifiedAt).not.toBeNull();
    expect(await balanceOf(worker)).toBe(70);

    // Con cupo, repetir la verificación (idempotente) reintenta el premio que no cupo.
    await setSetting('REWARD_CAP_DAILY_WORKER', 100);
    await setSetting('REWARD_CAP_MONTHLY_WORKER', 25);
    const monthly = await verifyDocument(worker, 'CV');
    expect(monthly.body.reward).toMatchObject({ granted: false, reason: 'CAP_REACHED_MONTHLY' });
    clockNow = new Date(Date.now() + 40 * 24 * HOUR);
    try {
      const nextMonth = await verifyDocument(worker, 'CV');
      expect(nextMonth.body.reward).toMatchObject({ granted: true, amount: 10 });
    } finally {
      clockNow = null;
      await setSetting('REWARD_CAP_MONTHLY_WORKER', 600);
    }
    expect(await balanceOf(worker)).toBe(80);

    const quote = await request(app).get('/api/workers/currency/quote').query({ actionKey: 'APPLICATION_EXTRA' }).set(as(worker.token));
    expect(quote.body.dailyCap.spentToday).toBe(0);
  }, 40_000);

  // ---- INVITATION_RESPONDED ----------------------------------------------------

  it('INVITATION_RESPONDED pays once per invitation when accepted or declined in time, never for cancelled, expired or repeated answers', async () => {
    const worker = await registered('inv');
    const company = await makeAccount('BUSINESS', 'invc');
    await fund(company, 100);
    expect((await patchProfile(worker, profileBody())).status).toBe(200);
    const profile = await prisma.workerTalentProfile.findUniqueOrThrow({ where: { userId: worker.id } });
    const invite = async () => {
      const response = await request(app).post('/api/business/talent-invitations').set(as(company.token)).send({ workerTalentProfileId: profile.id });
      expect(response.status).toBe(201);
      return response.body.id as string;
    };
    const respond = (id: string, action: 'accept' | 'decline', token = worker.token) => request(app).post(`/api/workers/me/talent-invitations/${id}/${action}`).set(as(token));

    const accepted = await invite();
    expect((await respond(accepted, 'accept')).status).toBe(200);
    expect(await balanceOf(worker)).toBe(55);
    expect((await respond(accepted, 'accept')).status).toBe(409);
    expect((await respond(accepted, 'decline')).status).toBe(409);
    expect(await grantsOf(worker, 'INVITATION_RESPONDED')).toHaveLength(1);

    // Rechazar también premia (otra invitación, otro hecho). La activa de aceptada impide repetir la misma: se anula primero.
    await prisma.talentInvitation.update({ where: { id: accepted }, data: { status: 'CANCELLED' } });
    const declined = await invite();
    expect((await respond(declined, 'decline')).status).toBe(200);
    expect(await balanceOf(worker)).toBe(60);

    // Anulada o vencida: no se puede responder y no premia.
    await prisma.talentInvitation.update({ where: { id: declined }, data: { status: 'CANCELLED' } });
    const cancelled = await invite();
    await prisma.talentInvitation.update({ where: { id: cancelled }, data: { status: 'CANCELLED' } });
    expect((await respond(cancelled, 'accept')).status).toBe(409);
    const expired = await invite();
    await prisma.talentInvitation.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - HOUR) } });
    expect((await respond(expired, 'accept')).status).toBe(409);
    expect((await prisma.talentInvitation.findUniqueOrThrow({ where: { id: expired } })).status).toBe('EXPIRED');
    expect(await grantsOf(worker, 'INVITATION_RESPONDED')).toHaveLength(2);
    expect(await balanceOf(worker)).toBe(60);

    // Aislamiento: otro trabajador no puede responder la invitación ajena ni cobrar por ella.
    const other = await registered('invother');
    const pending = await invite();
    expect((await respond(pending, 'accept', other.token)).status).toBe(404);
    expect(await grantsOf(other)).toHaveLength(0);
  }, 40_000);

  it('accepting and declining at the same time pays a single reward', async () => {
    const worker = await registered('invrace');
    const company = await makeAccount('BUSINESS', 'invracec');
    await fund(company, 50);
    expect((await patchProfile(worker, profileBody())).status).toBe(200);
    const profile = await prisma.workerTalentProfile.findUniqueOrThrow({ where: { userId: worker.id } });
    const id = (await request(app).post('/api/business/talent-invitations').set(as(company.token)).send({ workerTalentProfileId: profile.id })).body.id as string;
    const results = await Promise.all([
      request(app).post(`/api/workers/me/talent-invitations/${id}/accept`).set(as(worker.token)),
      request(app).post(`/api/workers/me/talent-invitations/${id}/decline`).set(as(worker.token)),
      request(app).post(`/api/workers/me/talent-invitations/${id}/accept`).set(as(worker.token)),
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(2);
    expect(await grantsOf(worker, 'INVITATION_RESPONDED')).toHaveLength(1);
    expect(await balanceOf(worker)).toBe(55);
  }, 40_000);

  // ---- REFERRAL ----------------------------------------------------------------

  it('REFERRAL pays the referrer only when the referred completes the profile, once, and respects the monthly limit', async () => {
    const referrer = await registered('refa');
    const summary = await request(app).get('/api/workers/me/referral').set(as(referrer.token));
    expect(summary.status).toBe(200);
    expect(summary.body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(summary.body).toMatchObject({ referred: 0, rewarded: 0, monthly: { limit: 5, used: 0, remaining: 5 } });
    expect((await request(app).get('/api/workers/me/referral').set(as(referrer.token))).body.code).toBe(summary.body.code);

    // Código inexistente o mal formado: el registro se rechaza y no crea cuenta.
    const bad = await register('refbad', 'ZZZZZZZZ');
    expect(bad.response.status).toBe(400);
    expect(bad.response.body).toEqual({ error: 'INVALID_REFERRAL_CODE' });
    expect(await prisma.user.count({ where: { email: bad.email } })).toBe(0);
    expect((await register('refbad2', 'corto')).response.status).toBe(400);

    const referred = await registered('refb', summary.body.code.toLowerCase());
    expect(await prisma.workerReferral.findMany({ where: { referredId: referred.id } })).toMatchObject([{ referrerId: referrer.id, code: summary.body.code, rewardedAt: null }]);
    // Registrarse no paga nada: solo el bono de bienvenida propio.
    expect(await balanceOf(referrer)).toBe(50);
    expect(await balanceOf(referred)).toBe(50);

    await fillProfile(referred);
    expect(await grantsOf(referrer, 'REFERRAL')).toHaveLength(1);
    expect(await balanceOf(referrer)).toBe(70);
    expect(await balanceOf(referred)).toBe(70);
    expect((await prisma.workerReferral.findUniqueOrThrow({ where: { referredId: referred.id } })).rewardedAt).not.toBeNull();
    // Editar de nuevo no paga otra vez.
    expect((await patchProfile(referred, { headline: 'Barista que sigue editando su perfil' })).status).toBe(200);
    expect(await grantsOf(referrer, 'REFERRAL')).toHaveLength(1);
    const after = await request(app).get('/api/workers/me/referral').set(as(referrer.token));
    expect(after.body).toMatchObject({ referred: 1, rewarded: 1, monthly: { used: 1, remaining: 4 } });
    // El resumen es solo del titular: el referido no ve el de su referidor.
    expect((await request(app).get('/api/workers/me/referral').set(as(referred.token))).body.code).not.toBe(summary.body.code);

    // Un referido solo cuenta una vez: no hay forma de enlazarlo a otro referidor ni auto-referido (CHECK).
    await expect(prisma.workerReferral.create({ data: { referrerId: referrer.id, referredId: referred.id, code: summary.body.code } })).rejects.toThrow();
    await expect(prisma.workerReferral.create({ data: { referrerId: referrer.id, referredId: referrer.id, code: 'AAAAAAAA' } })).rejects.toThrow();
  }, 40_000);

  it('two registrations with the same code create two distinct referrals; with a monthly limit of 1 only one pays', async () => {
    const referrer = await registered('refrace');
    const code = (await request(app).get('/api/workers/me/referral').set(as(referrer.token))).body.code as string;
    const settled = await Promise.all([register('refr1', code), register('refr2', code)]);
    expect(settled.map(({ response }) => response.status)).toEqual([201, 201]);
    const referrals = await prisma.workerReferral.findMany({ where: { referrerId: referrer.id } });
    expect(referrals).toHaveLength(2);
    expect(new Set(referrals.map((referral) => referral.referredId)).size).toBe(2);

    await setSetting('REFERRAL_MONTHLY_LIMIT', 1);
    try {
      const referredAccounts = settled.map(({ response, email }) => ({ id: response.body.userId as string, token: response.body.token as string, email }));
      await Promise.all(referredAccounts.map((account) => fillProfile(account, ['photo'])));
      // Las dos completan a la vez: una sola paga al referidor.
      await Promise.all(referredAccounts.map((account) => uploadPhoto(account)));
      expect(await grantsOf(referrer, 'REFERRAL')).toHaveLength(1);
      expect(await balanceOf(referrer)).toBe(70);
      const pending = await prisma.workerReferral.findMany({ where: { referrerId: referrer.id, rewardedAt: null } });
      expect(pending).toHaveLength(1);
      // Al subir el límite, el referido pendiente se premia la próxima vez que guarde su perfil.
      await setSetting('REFERRAL_MONTHLY_LIMIT', 5);
      const pendingAccount = referredAccounts.find((account) => account.id === pending[0]!.referredId)!;
      expect((await patchProfile(pendingAccount, { headline: 'Barista que completa con cupo nuevo' })).status).toBe(200);
      expect(await grantsOf(referrer, 'REFERRAL')).toHaveLength(2);
      expect(await balanceOf(referrer)).toBe(90);
    } finally {
      await setSetting('REFERRAL_MONTHLY_LIMIT', 5);
    }
  }, 60_000);

  // ---- Verificación ligada al archivo, revisión del admin e historial (CN-20261012-049, BAJO-3) ----

  it('lists and downloads the worker documents only for an ADMIN, without exposing the storage key', async () => {
    const worker = await registered('review');
    const business = await makeAccount('BUSINESS', 'reviewb');
    const content = pdf('contenido-revisable');
    expect((await request(app).put('/api/workers/me/cv').set(as(worker.token)).set('Content-Type', 'application/pdf').set('X-File-Name', encodeURIComponent('mi cv.pdf')).send(content)).status).toBe(201);
    expect((await uploadPhoto(worker)).status).toBe(201);
    const stored = await prisma.workerDocument.findUniqueOrThrow({ where: { userId_kind: { userId: worker.id, kind: 'CV' } } });
    expect(stored.uploadedAt).not.toBeNull();

    const listing = await request(app).get(`/api/admin/workers/${worker.id}/documents`).set(as(admin.token));
    expect(listing.status).toBe(200);
    expect(listing.body.documents.map((document: { kind: string }) => document.kind)).toEqual(['CV', 'PROFILE_PHOTO']);
    const cv = listing.body.documents[0];
    expect(cv).toMatchObject({ kind: 'CV', id: stored.id, originalName: 'mi cv.pdf', mediaType: 'application/pdf', sizeBytes: content.byteLength, verified: false, verifiedAt: null, history: [] });
    expect(cv.version).toMatch(/^[0-9a-f]{32}$/);
    expect(Date.parse(cv.uploadedAt)).not.toBeNaN();
    expect(JSON.stringify(listing.body)).not.toContain(stored.storageKey);
    expect(JSON.stringify(listing.body)).not.toContain('storageKey');

    const file = await request(app).get(`/api/admin/workers/${worker.id}/documents/CV/file`).set(as(admin.token)).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(Buffer.from(file.body as Buffer).equals(content)).toBe(true);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(file.headers['x-document-version']).toBe(cv.version);
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(file.headers)).not.toContain(stored.storageKey);

    // Solo ADMIN: ni el propio trabajador, ni una empresa, ni sin sesión.
    for (const path of [`/api/admin/workers/${worker.id}/documents`, `/api/admin/workers/${worker.id}/documents/CV/file`]) {
      expect((await request(app).get(path).set(as(worker.token))).status).toBe(403);
      expect((await request(app).get(path).set(as(business.token))).status).toBe(403);
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).get(`/api/admin/workers/${worker.id}/documents/DNI/file`).set(as(admin.token))).status).toBe(400);
    expect((await request(app).get('/api/admin/workers/nobody/documents').set(as(admin.token))).status).toBe(404);
    const noPhoto = await registered('reviewnone');
    expect((await request(app).get(`/api/admin/workers/${noPhoto.id}/documents/CV/file`).set(as(admin.token))).body).toEqual({ error: 'DOCUMENT_NOT_FOUND' });
    // Una cuenta de empresa no es un trabajador: no hay documentos que listar.
    expect((await request(app).get(`/api/admin/workers/${business.id}/documents`).set(as(admin.token))).status).toBe(404);
  }, 40_000);

  it('answers 409 DOCUMENT_CHANGED when the file was replaced after the admin reviewed it, and verifies nothing', async () => {
    const worker = await registered('stale');
    expect((await uploadCv(worker, 'v1')).status).toBe(201);
    const reviewed = await versionOf(worker, 'CV');
    expect((await uploadCv(worker, 'v2-distinto')).status).toBe(201);
    const current = await versionOf(worker, 'CV');
    expect(current).not.toBe(reviewed);

    const stale = await verifyDocument(worker, 'CV', admin.token, reviewed);
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: 'DOCUMENT_CHANGED' });
    const row = await prisma.workerDocument.findUniqueOrThrow({ where: { userId_kind: { userId: worker.id, kind: 'CV' } } });
    expect(row.verifiedAt).toBeNull();
    expect(await grantsOf(worker, 'DOCUMENT_VERIFIED')).toHaveLength(0);
    expect(await prisma.workerDocumentVerificationChange.count({ where: { userId: worker.id } })).toBe(0);

    const fresh = await verifyDocument(worker, 'CV', admin.token, current);
    expect(fresh.status).toBe(200);
    expect(fresh.body).toMatchObject({ verified: true, alreadyVerified: false, documentVersion: current });
    // Una versión inventada tampoco sirve, y no se paga dos veces.
    expect((await verifyDocument(worker, 'CV', admin.token, 'a'.repeat(32))).status).toBe(409);
    expect(await grantsOf(worker, 'DOCUMENT_VERIFIED')).toHaveLength(1);
  }, 40_000);

  it('never leaves a verified document whose current file is not the one the admin verified (replacement during verification)', async () => {
    for (let round = 0; round < 6; round += 1) {
      const worker = await registered(`swap${round}`);
      expect((await uploadCv(worker, `original-${round}`)).status).toBe(201);
      const reviewed = await versionOf(worker, 'CV');
      const [verify, upload] = await Promise.all([
        verifyDocument(worker, 'CV', admin.token, reviewed),
        (async () => { await new Promise((resolve) => setTimeout(resolve, round * 12)); return uploadCv(worker, `reemplazo-${round}`); })(),
      ]);
      expect([200, 409, 503], JSON.stringify(verify.body)).toContain(verify.status);
      expect([201, 503], JSON.stringify(upload.body)).toContain(upload.status);
      const row = await prisma.workerDocument.findUniqueOrThrow({ where: { userId_kind: { userId: worker.id, kind: 'CV' } } });
      const currentVersion = await versionOf(worker, 'CV');
      const history = await prisma.workerDocumentVerificationChange.findMany({ where: { userId: worker.id } });
      expect(history.every((change) => change.documentVersion === reviewed), `round ${round}`).toBe(true);
      if (upload.status === 201) {
        // El reemplazo gana al final (borra la verificación) o la verificación nunca se aplicó.
        expect(row.verifiedAt, `round ${round}`).toBeNull();
        expect(currentVersion).not.toBe(reviewed);
        // Y la verificación del archivo viejo no se puede reaplicar al nuevo.
        expect((await verifyDocument(worker, 'CV', admin.token, reviewed)).status).toBe(409);
      } else if (row.verifiedAt !== null) {
        expect(currentVersion).toBe(reviewed);
      }
      if (verify.status !== 200) expect(history).toHaveLength(0);
    }
  }, 120_000);

  it('records who removed a verification, when and why, keeps the history after re-verifying, and never pays twice', async () => {
    const worker = await registered('hist');
    const secondAdmin = await makeAccount('ADMIN', 'admin3');
    expect((await uploadCv(worker, 'h1')).status).toBe(201);
    expect((await uploadPhoto(worker)).status).toBe(201);

    expect((await verifyDocument(worker, 'CV')).status).toBe(200);
    expect((await unverifyDocument(worker, 'CV', admin.token, {})).status).toBe(400);
    expect((await unverifyDocument(worker, 'CV', admin.token, { reason: 'ab' })).status).toBe(400);
    expect((await unverifyDocument(worker, 'CV', admin.token, { reason: 'Documento ilegible', verifiedById: 'x' })).status).toBe(400);
    expect((await unverifyDocument(worker, 'CV', secondAdmin.token, { reason: '  Documento ilegible  ' })).body).toEqual({ verified: false, alreadyUnverified: false });
    // Retirar de nuevo no escribe otra fila.
    expect((await unverifyDocument(worker, 'CV')).body).toEqual({ verified: false, alreadyUnverified: true });
    expect((await unverifyDocument(worker, 'PROFILE_PHOTO')).body).toEqual({ verified: false, alreadyUnverified: true });
    expect((await unverifyDocument({ ...worker, id: 'nobody' }, 'CV')).status).toBe(404);

    const rows = await prisma.workerDocumentVerificationChange.findMany({ where: { userId: worker.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(rows.map((row) => [row.kind, row.action, row.reason, row.changedById])).toEqual([
      ['CV', 'VERIFIED', null, admin.id], ['CV', 'UNVERIFIED', 'Documento ilegible', secondAdmin.id],
    ]);
    expect(rows[1]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[0]!.createdAt.getTime());
    expect(rows[0]!.documentVersion).toBe(rows[1]!.documentVersion);

    // Farmeo: verificar y retirar muchas veces sigue pagando UN premio por tipo (máximo 2 en total).
    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect((await verifyDocument(worker, 'CV')).status).toBe(200);
      expect((await verifyDocument(worker, 'PROFILE_PHOTO')).status).toBe(200);
      expect((await unverifyDocument(worker, 'CV')).status).toBe(200);
      expect((await unverifyDocument(worker, 'PROFILE_PHOTO')).status).toBe(200);
    }
    expect(await grantsOf(worker, 'DOCUMENT_VERIFIED')).toHaveLength(2);
    expect(await rewardMovements(worker, 'DOCUMENT_VERIFIED')).toHaveLength(2);
    expect(await balanceOf(worker)).toBe(70);

    const listing = await request(app).get(`/api/admin/workers/${worker.id}/documents`).set(as(admin.token));
    const cv = listing.body.documents.find((document: { kind: string }) => document.kind === 'CV');
    expect(cv.verified).toBe(false);
    expect(cv.history[0]).toMatchObject({ action: 'UNVERIFIED', reason: 'Documento ilegible', changedById: admin.id });
    expect(cv.history.length).toBe(8);
    expect(JSON.stringify(listing.body)).not.toContain('storageKey');
  }, 60_000);

  it('keeps the history row (author null) when the admin account is later deleted', async () => {
    const worker = await registered('histdel');
    const temporary = await makeAccount('ADMIN', 'admin-temporal');
    expect((await uploadCv(worker, 'd1')).status).toBe(201);
    expect((await verifyDocument(worker, 'CV', temporary.token)).status).toBe(200);
    await prisma.user.delete({ where: { id: temporary.id } });
    const rows = await prisma.workerDocumentVerificationChange.findMany({ where: { userId: worker.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'VERIFIED', changedById: null });
    const row = await prisma.workerDocument.findUniqueOrThrow({ where: { userId_kind: { userId: worker.id, kind: 'CV' } } });
    expect(row.verifiedAt).not.toBeNull();
    expect(row.verifiedById).toBeNull();
  }, 40_000);

  it('replacing a verified file leaves a "verificación retirada por reemplazo" history row (system author, date, reason)', async () => {
    const worker = await registered('replace');
    expect((await uploadCv(worker, 'r1')).status).toBe(201);
    expect((await uploadPhoto(worker)).status).toBe(201);
    const firstVersion = await versionOf(worker, 'CV');
    expect((await verifyDocument(worker, 'CV')).status).toBe(200);

    // Reemplazar un archivo que NO estaba verificado (la foto) no deja fila de retiro.
    expect((await uploadPhoto(worker)).status).toBe(201);
    expect(await prisma.workerDocumentVerificationChange.count({ where: { userId: worker.id, kind: 'PROFILE_PHOTO' } })).toBe(0);

    expect((await uploadCv(worker, 'r2')).status).toBe(201);
    const rows = await prisma.workerDocumentVerificationChange.findMany({ where: { userId: worker.id, kind: 'CV' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(rows.map((row) => [row.action, row.reason, row.changedById])).toEqual([
      ['VERIFIED', null, admin.id], ['UNVERIFIED', 'verificación retirada por reemplazo', null],
    ]);
    // La fila de retiro apunta al archivo que sí se verificó (el anterior), no al nuevo.
    expect(rows[1]!.documentVersion).toBe(firstVersion);
    expect(await versionOf(worker, 'CV')).not.toBe(firstVersion);
    expect(rows[1]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[0]!.createdAt.getTime());
    const stored = await prisma.workerDocument.findUniqueOrThrow({ where: { userId_kind: { userId: worker.id, kind: 'CV' } } });
    expect(stored.verifiedAt).toBeNull();

    // El historial que lee el admin lo muestra y reemplazar otra vez (sin verificación) no escribe más.
    expect((await uploadCv(worker, 'r3')).status).toBe(201);
    expect(await prisma.workerDocumentVerificationChange.count({ where: { userId: worker.id, kind: 'CV' } })).toBe(2);
    const listing = await request(app).get(`/api/admin/workers/${worker.id}/documents`).set(as(admin.token));
    const cv = listing.body.documents.find((document: { kind: string }) => document.kind === 'CV');
    expect(cv.history[0]).toMatchObject({ action: 'UNVERIFIED', reason: 'verificación retirada por reemplazo', changedById: null });
    // El premio ya pagado no se repite al volver a verificar.
    expect((await verifyDocument(worker, 'CV')).status).toBe(200);
    expect(await grantsOf(worker, 'DOCUMENT_VERIFIED')).toHaveLength(1);
  }, 60_000);

  it('paginates the verification history per document and exposes the company history (admin only)', async () => {
    const worker = await registered('page');
    expect((await uploadCv(worker, 'p1')).status).toBe(201);
    expect((await uploadPhoto(worker)).status).toBe(201);
    for (let cycle = 0; cycle < 4; cycle += 1) {
      expect((await verifyDocument(worker, 'CV')).status).toBe(200);
      expect((await unverifyDocument(worker, 'CV', admin.token, { reason: `Ciclo ${cycle}` })).status).toBe(200);
    }
    expect((await verifyDocument(worker, 'PROFILE_PHOTO')).status).toBe(200);
    const history = (kind: string, query = '', token = admin.token) => request(app).get(`/api/admin/workers/${worker.id}/documents/${kind}/history${query}`).set(as(token));

    // El listado trae la primera página de cada documento y su cursor; el historial de uno no recorta el del otro.
    const listing = await request(app).get(`/api/admin/workers/${worker.id}/documents`).set(as(admin.token));
    const cv = listing.body.documents.find((document: { kind: string }) => document.kind === 'CV');
    const photo = listing.body.documents.find((document: { kind: string }) => document.kind === 'PROFILE_PHOTO');
    expect(cv.history).toHaveLength(8);
    expect(cv.historyNextCursor).toBeNull();
    expect(photo.history).toHaveLength(1);
    expect(photo.historyNextCursor).toBeNull();

    const first = await history('CV', '?limit=3');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await history('CV', `?limit=3&cursor=${first.body.nextCursor}`);
    const third = await history('CV', `?limit=3&cursor=${second.body.nextCursor}`);
    expect(second.body.items).toHaveLength(3);
    expect(third.body.items).toHaveLength(2);
    expect(third.body.nextCursor).toBeNull();
    const all = [...first.body.items, ...second.body.items, ...third.body.items] as Array<{ action: string; reason: string | null; createdAt: string }>;
    expect(all).toHaveLength(8);
    expect(all[0]).toMatchObject({ action: 'UNVERIFIED', reason: 'Ciclo 3' });
    expect(all[7]).toMatchObject({ action: 'VERIFIED', reason: null });
    const times = all.map((item) => Date.parse(item.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(JSON.stringify(first.body)).not.toContain('storageKey');

    // Sin saltos ni repeticiones: coincide con la página única.
    const whole = await history('CV', '?limit=100');
    expect(whole.body.items).toEqual(all);
    expect(whole.body.nextCursor).toBeNull();
    // Cursor de otro documento o inexistente y límites inválidos.
    const photoPage = await history('PROFILE_PHOTO', '?limit=1');
    expect(photoPage.body.items).toHaveLength(1);
    expect((await history('CV', `?cursor=${first.body.nextCursor}`, admin.token)).status).toBe(200);
    expect((await history('PROFILE_PHOTO', `?cursor=${first.body.nextCursor}`)).status).toBe(400);
    expect((await history('CV', '?cursor=no-existe')).body).toEqual({ error: 'INVALID_CURSOR' });
    expect((await history('CV', '?limit=0')).status).toBe(400);
    expect((await history('CV', '?limit=101')).status).toBe(400);
    expect((await history('OTHER')).status).toBe(400);
    expect((await request(app).get(`/api/admin/workers/no-existe/documents/CV/history`).set(as(admin.token))).status).toBe(404);
    // Solo ADMIN.
    expect((await history('CV', '', worker.token)).status).toBe(403);
    const business = await makeAccount('BUSINESS', 'pageb');
    expect((await history('CV', '', business.token)).status).toBe(403);
    expect((await request(app).get(`/api/admin/workers/${worker.id}/documents/CV/history`)).status).toBe(401);

    // Historial de la empresa: paginado, más reciente primero, autor/motivo/fecha, solo ADMIN.
    const company = await makeAccount('BUSINESS', 'pagec');
    const companyHistory = (query = '', token = admin.token, id = company.companyId) => request(app).get(`/api/admin/companies/${id}/verification/history${query}`).set(as(token));
    expect((await companyHistory()).body).toEqual({ items: [], nextCursor: null });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect((await request(app).post(`/api/admin/companies/${company.companyId}/verification`).set(as(admin.token))).status).toBe(200);
      expect((await request(app).delete(`/api/admin/companies/${company.companyId}/verification`).set(as(admin.token)).send({ reason: `Revisión ${cycle}` })).status).toBe(200);
    }
    const page1 = await companyHistory('?limit=4');
    expect(page1.body.items).toHaveLength(4);
    expect(page1.body.items[0]).toMatchObject({ action: 'UNVERIFIED', reason: 'Revisión 2', changedById: admin.id });
    const page2 = await companyHistory(`?limit=4&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
    expect(page2.body.items[1]).toMatchObject({ action: 'VERIFIED', reason: null });
    expect((await companyHistory('?cursor=no-existe')).status).toBe(400);
    const other = await makeAccount('BUSINESS', 'pagec2');
    expect((await companyHistory(`?cursor=${page1.body.nextCursor}`, admin.token, other.companyId)).status).toBe(400);
    expect((await companyHistory('', admin.token, 'no-existe')).status).toBe(404);
    expect((await companyHistory('', company.token)).status).toBe(403);
    expect((await companyHistory('', worker.token)).status).toBe(403);
    expect((await request(app).get(`/api/admin/companies/${company.companyId}/verification/history`)).status).toBe(401);
  }, 90_000);

  // ---- COMPANY_VERIFIED ---------------------------------------------------------

  it('COMPANY_VERIFIED pays the company once; the admin route is admin-only and idempotent', async () => {
    const company = await makeAccount('BUSINESS', 'ver');
    const other = await makeAccount('BUSINESS', 'verother');
    const worker = await registered('verw');
    const verify = (companyId: string, token = admin.token) => request(app).post(`/api/admin/companies/${companyId}/verification`).set(as(token));
    const unverify = (companyId: string, body: Record<string, unknown> = { reason: 'Datos desactualizados' }) => request(app).delete(`/api/admin/companies/${companyId}/verification`).set(as(admin.token)).send(body);
    expect((await verify(company.companyId!, company.token)).status).toBe(403);
    expect((await verify(company.companyId!, worker.token)).status).toBe(403);
    expect((await request(app).post(`/api/admin/companies/${company.companyId}/verification`)).status).toBe(401);
    expect((await verify('no-existe')).status).toBe(404);
    expect(await grantsOf(company)).toHaveLength(0);

    const [a, b, c] = await Promise.all([verify(company.companyId!), verify(company.companyId!), verify(company.companyId!)]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect([a, b, c].filter((response) => response.body.alreadyVerified === false)).toHaveLength(1);
    expect(await grantsOf(company, 'COMPANY_VERIFIED')).toHaveLength(1);
    expect(await balanceOf(company)).toBe(20);
    const stored = await prisma.company.findUniqueOrThrow({ where: { id: company.companyId! } });
    expect(stored.verifiedById).toBe(admin.id);
    expect(stored.verifiedAt).not.toBeNull();
    const movement = (await rewardMovements(company, 'COMPANY_VERIFIED'))[0]!;
    expect(movement).toMatchObject({ quantity: 20, relatedEntityType: 'Company', relatedEntityId: company.companyId });

    // Quitar y volver a poner la verificación no paga otra vez; la otra empresa no se ve afectada.
    expect((await unverify(company.companyId!, {})).status).toBe(400);
    expect((await unverify(company.companyId!)).body).toEqual({ verified: false, alreadyUnverified: false });
    expect((await unverify(company.companyId!)).body).toEqual({ verified: false, alreadyUnverified: true });
    expect((await verify(company.companyId!)).body).toMatchObject({ alreadyVerified: false });
    expect(await grantsOf(company, 'COMPANY_VERIFIED')).toHaveLength(1);
    expect(await balanceOf(company)).toBe(20);
    expect(await balanceOf(other)).toBe(0);
    expect((await unverify('no-existe')).status).toBe(404);
    // Historial: verificar y retirar dejan autor, fecha y (al retirar) motivo; repetir no duplica filas.
    const changes = await prisma.companyVerificationChange.findMany({ where: { companyId: company.companyId! }, orderBy: { createdAt: 'asc' } });
    expect(changes.map((change) => [change.action, change.reason, change.changedById])).toEqual([
      ['VERIFIED', null, admin.id], ['UNVERIFIED', 'Datos desactualizados', admin.id], ['VERIFIED', null, admin.id],
    ]);
  }, 40_000);

  // ---- APPLICANTS_RESPONDED_ON_TIME + HIRE_CONFIRMED ----------------------------

  it('APPLICANTS_RESPONDED_ON_TIME pays once per application, only inside the window, and honours the monthly limit', async () => {
    const company = await makeAccount('BUSINESS', 'resp');
    const posting = await published(company, { vacancies: 5 });
    const w1 = await makeAccount('WORKER', 'resp1');
    const w2 = await makeAccount('WORKER', 'resp2');
    const w3 = await makeAccount('WORKER', 'resp3');
    const [a1, a2, a3] = [await apply(w1, posting), await apply(w2, posting), await apply(w3, posting)];

    expect((await stage(company, a1, 'SHORTLISTED')).status).toBe(200);
    expect(await grantsOf(company, 'APPLICANTS_RESPONDED_ON_TIME')).toHaveLength(1);
    expect(await balanceOf(company)).toBe(5);
    // Mover de nuevo la misma postulación (o repetir) no paga más.
    expect((await stage(company, a1, 'INTERVIEW')).status).toBe(200);
    expect((await stage(company, a1, 'INTERVIEW')).status).toBe(200);
    expect(await grantsOf(company, 'APPLICANTS_RESPONDED_ON_TIME')).toHaveLength(1);
    // Retirarse y volver a postular tampoco da otro premio por la misma postulación.
    await request(app).post(`/api/workers/job-applications/${a1}/withdraw`).set(as(w1.token));
    await apply(w1, posting);
    expect((await stage(company, a1, 'SHORTLISTED')).status).toBe(200);
    expect(await grantsOf(company, 'APPLICANTS_RESPONDED_ON_TIME')).toHaveLength(1);

    // Fuera del plazo no hay premio (la postulación llegó hace más de 72 h).
    await prisma.jobApplicationEvent.updateMany({ where: { applicationId: a2 }, data: { createdAt: new Date(Date.now() - 100 * HOUR) } });
    expect((await stage(company, a2, 'SHORTLISTED')).status).toBe(200);
    expect(await grantsOf(company, 'APPLICANTS_RESPONDED_ON_TIME')).toHaveLength(1);

    // Rechazar una postulación recién llegada también es responder, pero el límite mensual (1) ya está agotado.
    await setSetting('APPLICANT_RESPONSE_MONTHLY_LIMIT', 1);
    try {
      expect((await request(app).post(`/api/business/job-applications/${a3}/reject`).set(as(company.token)).send({})).status).toBe(200);
      expect(await grantsOf(company, 'APPLICANTS_RESPONDED_ON_TIME')).toHaveLength(1);
    } finally {
      await setSetting('APPLICANT_RESPONSE_MONTHLY_LIMIT', 20);
    }
    expect(await balanceOf(company)).toBe(5);

    // Un premio de otra empresa o de un trabajador jamás se mezcla.
    expect(await grantsOf(w1)).toHaveLength(0);
  }, 60_000);

  it('the response window is configurable and a late response is simply not rewarded', async () => {
    const company = await makeAccount('BUSINESS', 'win');
    const posting = await published(company, { vacancies: 5 });
    const worker = await makeAccount('WORKER', 'win1');
    const applicationId = await apply(worker, posting);
    await prisma.jobApplicationEvent.updateMany({ where: { applicationId }, data: { createdAt: new Date(Date.now() - 5 * HOUR) } });
    await setSetting('APPLICANT_RESPONSE_WINDOW_HOURS', 4);
    try {
      expect((await stage(company, applicationId, 'SHORTLISTED')).status).toBe(200);
      expect(await grantsOf(company)).toHaveLength(0);
    } finally {
      await setSetting('APPLICANT_RESPONSE_WINDOW_HOURS', 72);
    }
  });

  it('HIRE_CONFIRMED pays once per hire inside the hiring transaction; a double confirmation or a failed hire pays nothing extra', async () => {
    const company = await makeAccount('BUSINESS', 'hire');
    await setSetting('APPLICANT_RESPONSE_MONTHLY_LIMIT', 1); // aísla el premio de contratación del de respuesta
    try {
      const posting = await published(company, { vacancies: 2 });
      const workers = [await makeAccount('WORKER', 'hire1'), await makeAccount('WORKER', 'hire2'), await makeAccount('WORKER', 'hire3')];
      const applications: string[] = [];
      for (const worker of workers) applications.push(await apply(worker, posting));
      const offer = async (applicationId: string, worker: Account) => {
        const issued = await request(app).post(`/api/business/job-applications/${applicationId}/offers`).set(as(company.token)).send({ salaryCents: 180000, contractType: 'INDEFINITE', startDate: FUTURE_START });
        expect(issued.status).toBe(201);
        const accepted = await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${issued.body.offers[0].id}/accept`).set(as(worker.token));
        expect(accepted.status).toBe(200);
      };
      const hire = (applicationId: string) => request(app).post(`/api/business/job-applications/${applicationId}/hire`).set(as(company.token));
      const hireGrants = () => grantsOf(company, 'HIRE_CONFIRMED');

      await offer(applications[0]!, workers[0]!);
      await offer(applications[1]!, workers[1]!);
      const before = await balanceOf(company);
      const doubled = await Promise.all([hire(applications[0]!), hire(applications[0]!), hire(applications[0]!)]);
      expect(doubled.filter((response) => response.status === 200)).toHaveLength(3); // la repetida es idempotente
      expect(doubled.filter((response) => response.body.idempotent === false)).toHaveLength(1);
      expect(await hireGrants()).toHaveLength(1);
      expect(await balanceOf(company)).toBe(before + 20);
      expect((await hireGrants())[0]).toMatchObject({ relatedEntityType: 'JobApplication', relatedEntityId: applications[0], factKey: `HIRE_CONFIRMED:${applications[0]}` });

      expect((await hire(applications[1]!)).status).toBe(200);
      expect(await hireGrants()).toHaveLength(2);
      expect(await balanceOf(company)).toBe(before + 40);

      // El puesto se cubrió: contratar a la tercera falla y no deja premio alguno.
      expect((await hire(applications[2]!)).status).toBe(409);
      expect(await hireGrants()).toHaveLength(2);
      expect(await balanceOf(company)).toBe(before + 40);
      // Una postulación ajena o inexistente no paga.
      const stranger = await makeAccount('BUSINESS', 'hirestranger');
      expect((await request(app).post(`/api/business/job-applications/${applications[0]}/hire`).set(as(stranger.token))).status).toBe(404);
      expect(await grantsOf(stranger)).toHaveLength(0);
    } finally {
      await setSetting('APPLICANT_RESPONSE_MONTHLY_LIMIT', 20);
    }
  }, 60_000);

  // ---- Lista de premios ----------------------------------------------------------

  it('lists only the actor’s own rewards with their state, and never exposes internal keys', async () => {
    const worker = await registered('list');
    const bystander = await registered('listother');
    await fillProfile(worker, ['photo']);
    const before = await request(app).get('/api/workers/currency/rewards').set(as(worker.token));
    expect(before.status).toBe(200);
    const byKey = (body: { items: Array<{ actionKey: string }> }) => Object.fromEntries(body.items.map((item) => [item.actionKey, item]));
    const items = byKey(before.body);
    expect(Object.keys(items).sort()).toEqual(['DOCUMENT_VERIFIED', 'INVITATION_RESPONDED', 'PROFILE_COMPLETE', 'REFERRAL', 'WELCOME_BONUS']);
    expect(items.PROFILE_COMPLETE).toMatchObject({ status: 'AVAILABLE', amount: 20, repeatable: false, earnedCount: 0, missingSections: ['photo'] });
    expect(items.WELCOME_BONUS).toMatchObject({ status: 'EARNED', earnedCount: 1, earnedAmount: 50 });
    expect(items.DOCUMENT_VERIFIED).toMatchObject({ status: 'AVAILABLE', maxRewards: 2, documents: [{ kind: 'CV', uploaded: true, verified: false, rewarded: false }, { kind: 'PROFILE_PHOTO', uploaded: false }] });
    expect(items.REFERRAL).toMatchObject({ monthly: { limit: 5, used: 0, remaining: 5 } });
    expect(before.body.caps).toMatchObject({ daily: { limit: 100, earned: 0, remaining: 100 }, monthly: { limit: 600, earned: 0 } });

    expect((await uploadPhoto(worker)).status).toBe(201);
    await verifyDocument(worker, 'CV');
    const after = byKey((await request(app).get('/api/workers/currency/rewards').set(as(worker.token))).body);
    expect(after.PROFILE_COMPLETE).toMatchObject({ status: 'EARNED', earnedCount: 1, earnedAmount: 20, missingSections: [] });
    expect(after.DOCUMENT_VERIFIED).toMatchObject({ status: 'AVAILABLE', earnedCount: 1, earnedAmount: 10, documents: [{ kind: 'CV', verified: true, rewarded: true }, { kind: 'PROFILE_PHOTO', uploaded: true, rewarded: false }] });

    const raw = JSON.stringify((await request(app).get('/api/workers/currency/rewards').set(as(worker.token))).body);
    for (const internal of ['factKey', 'movementId', 'idempotency', worker.id, bystander.id]) expect(raw).not.toContain(internal);
    const mine = (await request(app).get('/api/workers/currency/rewards').set(as(bystander.token))).body;
    expect(byKey(mine).PROFILE_COMPLETE).toMatchObject({ status: 'AVAILABLE', earnedCount: 0 });
    expect(mine.caps.daily.earned).toBe(0);

    // Una entrada inactiva no aparece: no hay premio.
    await setCatalogActive('INVITATION_RESPONDED', 'WORKER', false);
    try {
      const hidden = byKey((await request(app).get('/api/workers/currency/rewards').set(as(worker.token))).body);
      expect(hidden.INVITATION_RESPONDED).toBeUndefined();
    } finally {
      await setCatalogActive('INVITATION_RESPONDED', 'WORKER', true);
    }

    // Autorización: cada rol solo ve su propia ruta.
    const business = await makeAccount('BUSINESS', 'listb');
    expect((await request(app).get('/api/workers/currency/rewards').set(as(business.token))).status).toBe(403);
    expect((await request(app).get('/api/business/currency/rewards').set(as(worker.token))).status).toBe(403);
    expect((await request(app).get('/api/workers/currency/rewards')).status).toBe(401);
    const companyList = byKey((await request(app).get('/api/business/currency/rewards').set(as(business.token))).body);
    expect(Object.keys(companyList).sort()).toEqual(['APPLICANTS_RESPONDED_ON_TIME', 'COMPANY_VERIFIED', 'HIRE_CONFIRMED', 'WELCOME_BONUS']);
    expect(companyList.COMPANY_VERIFIED).toMatchObject({ status: 'AVAILABLE', verified: false });
    expect(companyList.APPLICANTS_RESPONDED_ON_TIME).toMatchObject({ windowHours: 72, monthly: { limit: 20, used: 0 } });
    await request(app).post(`/api/admin/companies/${business.companyId}/verification`).set(as(admin.token));
    const verified = byKey((await request(app).get('/api/business/currency/rewards').set(as(business.token))).body);
    expect(verified.COMPANY_VERIFIED).toMatchObject({ status: 'EARNED', verified: true, earnedAmount: 20 });
  }, 40_000);

  it('the new editable settings keep history like the rest and reject invalid values', async () => {
    const response = await request(app).patch('/api/admin/currency/settings/REFERRAL_MONTHLY_LIMIT').set(as(admin.token)).send({ value: 3, reason: 'Subir cupo de referidos' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ changed: true, setting: { key: 'REFERRAL_MONTHLY_LIMIT', value: 3, isProvisional: false } });
    const changes = await request(app).get('/api/admin/currency/settings/changes').query({ key: 'REFERRAL_MONTHLY_LIMIT' }).set(as(admin.token));
    expect(changes.body.items[0]).toMatchObject({ key: 'REFERRAL_MONTHLY_LIMIT', oldValue: '5', newValue: '3', reason: 'Subir cupo de referidos' });
    expect((await request(app).patch('/api/admin/currency/settings/REFERRAL_MONTHLY_LIMIT').set(as(admin.token)).send({ value: 5_000, reason: 'Fuera de rango' })).status).toBe(400);
    expect((await request(app).patch('/api/admin/currency/settings/REWARD_CAP_DAILY_WORKER').set(as(admin.token)).send({ value: 0, reason: 'Cero no vale' })).status).toBe(400);
    await setSetting('REFERRAL_MONTHLY_LIMIT', 5);
    const list = await request(app).get('/api/admin/currency/settings').set(as(admin.token));
    expect(list.body.items.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining([
      'REWARD_CAP_DAILY_WORKER', 'REWARD_CAP_MONTHLY_WORKER', 'REWARD_CAP_DAILY_COMPANY', 'REWARD_CAP_MONTHLY_COMPANY',
      'REFERRAL_MONTHLY_LIMIT', 'APPLICANT_RESPONSE_WINDOW_HOURS', 'APPLICANT_RESPONSE_MONTHLY_LIMIT', 'PROFILE_HIGHLIGHT_DURATION_HOURS',
    ]));
  });

  // ---- PROFILE_HIGHLIGHT ----------------------------------------------------------

  it('PROFILE_HIGHLIGHT charges once per active window, orders the search with a stable cursor and cannot be used on a hidden profile', async () => {
    const searcher = await makeAccount('BUSINESS', 'hls');
    const workers: Account[] = [];
    for (let index = 0; index < 5; index += 1) {
      const worker = await registered(`hl${index}`);
      expect((await patchProfile(worker, profileBody({ headline: `Barista destacable numero ${index} del grupo HL` }))).status).toBe(200);
      workers.push(worker);
    }
    const profileIds = await Promise.all(workers.map(async (worker) => (await prisma.workerTalentProfile.findUniqueOrThrow({ where: { userId: worker.id } })).id));
    const search = (cursor?: string) => request(app).get('/api/business/talent').query({ query: 'del grupo HL', limit: 2, ...(cursor ? { cursor } : {}) }).set(as(searcher.token));
    const collect = async (first: ReturnType<typeof search>) => {
      const pages = [await first];
      while (pages.at(-1)!.body.nextCursor) pages.push(await search(pages.at(-1)!.body.nextCursor));
      return pages.flatMap((page) => page.body.items.map((item: { id: string }) => item.id));
    };

    const plain = await collect(search());
    expect(plain).toEqual([...profileIds].sort());

    const target = workers[3]!;
    const targetProfile = profileIds[3]!;
    const quote = await request(app).get('/api/workers/currency/quote').query({ actionKey: 'PROFILE_HIGHLIGHT', targetId: targetProfile }).set(as(target.token));
    expect(quote.body).toMatchObject({ actionKey: 'PROFILE_HIGHLIGHT', active: true, cost: 10, reason: 'CHARGE', sufficientBalance: true });
    const highlight = () => request(app).post('/api/workers/me/profile/highlight').set(as(target.token));
    const [one, two] = await Promise.all([highlight(), highlight()]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect([one.body, two.body].filter((body) => body.idempotent === false)).toHaveLength(1);
    expect(await balanceOf(target)).toBe(40);
    expect(await prisma.currencyActionUse.count({ where: { userId: target.id, actionKey: 'PROFILE_HIGHLIGHT' } })).toBe(1);
    expect((await highlight()).body).toMatchObject({ idempotent: true, chargedAmount: 0 });
    expect(await balanceOf(target)).toBe(40);
    expect((await request(app).get('/api/workers/currency/quote').query({ actionKey: 'PROFILE_HIGHLIGHT', targetId: targetProfile }).set(as(target.token))).body).toMatchObject({ cost: 0, reason: 'ALREADY_REGISTERED' });

    const first = await search();
    expect(first.body.items[0]).toMatchObject({ id: targetProfile, isHighlighted: true });
    const ordered = await collect(search());
    expect(ordered[0]).toBe(targetProfile);
    expect(ordered.slice(1)).toEqual([...profileIds].sort().filter((id) => id !== targetProfile));
    expect(new Set(ordered).size).toBe(profileIds.length);

    // A mitad de la paginación vence el destacado: ninguna fila se repite ni se salta (el cursor fija el instante).
    clockNow = new Date(Date.now() + 200 * HOUR);
    try {
      const pages = [first];
      while (pages.at(-1)!.body.nextCursor) pages.push(await search(pages.at(-1)!.body.nextCursor));
      const ids = pages.flatMap((page) => page.body.items.map((item: { id: string }) => item.id));
      expect(ids).toEqual(ordered);
      // Una búsqueda nueva ya no lo trata como destacado.
      expect((await collect(search()))).toEqual([...profileIds].sort());
      // Vencido el destacado, destacar de nuevo cobra otra vez.
      expect((await highlight()).body).toMatchObject({ idempotent: false, chargedAmount: 10 });
      expect(await balanceOf(target)).toBe(30);
    } finally {
      clockNow = null;
    }

    // Perfil oculto: no se puede destacar y no cobra. Otro rol: 403.
    const hidden = workers[0]!;
    expect((await patchProfile(hidden, { isVisible: false })).status).toBe(200);
    const refused = await request(app).post('/api/workers/me/profile/highlight').set(as(hidden.token));
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: 'PROFILE_NOT_VISIBLE' });
    expect(await balanceOf(hidden)).toBe(50);
    expect((await request(app).post('/api/workers/me/profile/highlight').set(as(searcher.token))).status).toBe(403);
    // Sin saldo suficiente: 409 y el perfil no queda destacado.
    const poor = workers[1]!;
    await fund(poor, -45);
    const insufficient = await request(app).post('/api/workers/me/profile/highlight').set(as(poor.token));
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.error).toBe('INSUFFICIENT_CURRENCY');
    expect((await prisma.workerTalentProfile.findUniqueOrThrow({ where: { userId: poor.id } })).highlightedUntil).toBeNull();
  }, 60_000);
});
