import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { JobEvents } from '../../src/modules/jobs/jobs.events.js';
import type { JobHooks } from '../../src/modules/jobs/jobs.service.js';
import { PrivateDocumentStorage } from '../../src/modules/talent/private_document_storage.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;

function requireTestDatabase() {
  if (process.env.CHAMBEAYA_INTEGRATION_TESTS !== 'true') throw new Error('INTEGRATION_TESTS_REQUIRE_EXPLICIT_OPT_IN');
  if (!integrationDatabaseUrl) throw new Error('INTEGRATION_TESTS_REQUIRE_DATABASE_URL');
  const databaseName = new URL(integrationDatabaseUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!databaseName?.endsWith('_test')) throw new Error('INTEGRATION_TESTS_REQUIRE_TEST_DATABASE');
}

type Account = { id: string; token: string; email: string; identifier: string; name: string };
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
const FUTURE_START = '2099-01-15';

describe('fixed job postings (M3) under PostgreSQL', () => {
  const prisma = new PrismaClient();
  const events = new JobEvents();
  const hookCalls: string[] = [];
  let failNextPublish = false;
  const hooks: JobHooks = {
    beforePublish: async ({ firstPublication }) => {
      hookCalls.push(`publish:${firstPublication}`);
      if (failNextPublish) { failNextPublish = false; throw new Error('HOOK_REJECTED'); }
    },
    beforeApply: async () => { hookCalls.push('apply'); },
    afterHire: async () => { hookCalls.push('hire'); },
  };
  let storageRoot = '';
  let app: ReturnType<typeof createApp>;
  let companyA: Account;
  let companyB: Account;
  let admin: Account;
  const workers: Account[] = [];
  let databaseReady = false;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function makeAccount(role: 'WORKER' | 'BUSINESS' | 'ADMIN', label: string, identifier: string): Promise<Account> {
    const salt = 'jobs-salt';
    const email = `${label}@chambeaya.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: hashPassword('Password123', salt), salt, role, name: `Cuenta ${label}`, identifier },
    });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123' });
    return { id: user.id, token: login.body.token as string, email, identifier, name: user.name };
  }

  const postingBody = (over: Record<string, unknown> = {}) => ({
    title: 'Cajera de tienda de ropa',
    description: 'Atencion al cliente, caja y reposicion en tienda de ropa en Lima.',
    responsibilities: 'Cobrar, ordenar y atender.',
    requirements: 'Secundaria completa.',
    benefits: 'Seguro, bono por metas.',
    modality: 'ONSITE',
    workload: 'FULL_TIME',
    salaryMinCents: 150000,
    salaryMaxCents: 200000,
    location: 'Miraflores, Lima',
    contractType: 'INDEFINITE',
    vacancies: 1,
    ...over,
  });

  async function createPosting(token: string, over: Record<string, unknown> = {}, publish = true): Promise<string> {
    const created = await request(app).post('/api/business/job-postings').set(as(token)).send(postingBody(over));
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    if (publish) expect((await request(app).post(`/api/business/job-postings/${id}/publish`).set(as(token))).status).toBe(200);
    return id;
  }

  async function apply(workerToken: string, postingId: string, answers: unknown[] = []) {
    return request(app).post(`/api/workers/job-postings/${postingId}/applications`).set(as(workerToken)).send({ answers });
  }

  async function issueOffer(companyToken: string, applicationId: string, over: Record<string, unknown> = {}) {
    return request(app).post(`/api/business/job-applications/${applicationId}/offers`).set(as(companyToken))
      .send({ salaryCents: 180000, contractType: 'INDEFINITE', startDate: FUTURE_START, ...over });
  }

  /** Postula, emite oferta y la acepta: deja la postulación en `ACCEPTED`. */
  async function toAccepted(companyToken: string, workerToken: string, postingId: string, answers: unknown[] = []) {
    const applied = await apply(workerToken, postingId, answers);
    expect(applied.status).toBe(201);
    const applicationId = applied.body.id as string;
    const offered = await issueOffer(companyToken, applicationId);
    expect(offered.status).toBe(201);
    const offerId = offered.body.offers.at(-1).id as string;
    const accepted = await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${offerId}/accept`).set(as(workerToken));
    expect(accepted.status).toBe(200);
    return { applicationId, offerId };
  }

  const applicationRow = (id: string) => prisma.jobApplication.findUniqueOrThrow({ where: { id } });
  const postingRow = (id: string) => prisma.jobPosting.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;
    storageRoot = await mkdtemp(join(tmpdir(), 'chambeaya-jobs-'));
    app = createApp({
      rateLimit: false,
      authService: new DatabaseAuthService(prisma),
      currencyPrisma: prisma,
      paymentsPrisma: prisma,
      jobsPrisma: prisma,
      jobsStorage: new PrivateDocumentStorage(storageRoot),
      jobsHooks: hooks,
      jobsEvents: events,
    });
    companyA = await makeAccount('BUSINESS', 'empresa.a', '20111111111');
    companyB = await makeAccount('BUSINESS', 'empresa.b', '20222222222');
    admin = await makeAccount('ADMIN', 'admin.jobs', 'ADMIN-JOBS-0001');
    for (let index = 1; index <= 6; index += 1) workers.push(await makeAccount('WORKER', `trabajador.${index}`, `4000000${index}`));
  }, 60_000);

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await prisma.$disconnect();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('runs the whole funnel, derives vacancies from confirmed hires and closes the posting when full', async () => {
    hookCalls.length = 0;
    const postingId = await createPosting(companyA.token, {
      vacancies: 2,
      screeningQuestions: ['Tienes experiencia en caja registradora?'],
    });
    expect(hookCalls).toEqual(['publish:true']);
    const [first, second, third] = workers;

    // Postular exige responder las preguntas de filtro.
    expect((await apply(first!.token, postingId, [])).status).toBe(400);
    const applied = await apply(first!.token, postingId, [{ question: 'Tienes experiencia en caja registradora?', answer: 'Si, dos anios.' }]);
    expect(applied.status).toBe(201);
    expect(applied.body.status).toBe('APPLIED');
    expect(hookCalls).toContain('apply');
    const applicationId = applied.body.id as string;

    const base = `/api/business/job-applications/${applicationId}`;
    expect((await request(app).post(`${base}/stage`).set(as(companyA.token)).send({ status: 'SHORTLISTED' })).body.status).toBe('SHORTLISTED');
    const interviewAt = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const interview = await request(app).post(`${base}/interview`).set(as(companyA.token)).send({ scheduledAt: interviewAt, mode: 'VIDEO', note: 'Enlace por correo' });
    expect(interview.status).toBe(200);
    expect(interview.body).toMatchObject({ status: 'INTERVIEW', interview: { mode: 'VIDEO', note: 'Enlace por correo' } });
    expect(new Date(interview.body.interview.scheduledAt).toISOString()).toBe(interviewAt);

    // Un trabajador no contrata ni se acepta a si mismo antes de tener oferta.
    const offered = await issueOffer(companyA.token, applicationId, { note: 'Bienvenida al equipo' });
    expect(offered.status).toBe(201);
    const offerId = offered.body.offers[0].id as string;
    expect((await request(app).post(`${base}/hire`).set(as(companyA.token))).status).toBe(409);
    expect((await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${offerId}/accept`).set(as(first!.token))).status).toBe(200);
    expect((await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${offerId}/accept`).set(as(first!.token))).body.idempotent).toBe(true);

    const hired = await request(app).post(`${base}/hire`).set(as(companyA.token));
    expect(hired.status).toBe(200);
    expect(hired.body).toMatchObject({ status: 'HIRED', idempotent: false });
    expect(hookCalls).toContain('hire');
    expect((await request(app).post(`${base}/hire`).set(as(companyA.token))).body.idempotent).toBe(true);
    let posting = await request(app).get(`/api/business/job-postings/${postingId}`).set(as(companyA.token));
    expect(posting.body).toMatchObject({ status: 'PUBLISHED', vacancies: 2, filledVacancies: 1 });
    expect(posting.body.applicantCounts).toEqual({ HIRED: 1 });

    // Segunda contratacion: llena el puesto y cierra el embudo para nuevos candidatos.
    await toAccepted(companyA.token, second!.token, postingId, [{ question: 'Tienes experiencia en caja registradora?', answer: 'Si' }]).then(async ({ applicationId: secondId }) => {
      expect((await request(app).post(`/api/business/job-applications/${secondId}/hire`).set(as(companyA.token))).status).toBe(200);
    });
    posting = await request(app).get(`/api/business/job-postings/${postingId}`).set(as(companyA.token));
    expect(posting.body).toMatchObject({ status: 'FILLED', filledVacancies: 2 });
    expect(posting.body.closedAt).not.toBeNull();
    const late = await apply(third!.token, postingId, [{ question: 'Tienes experiencia en caja registradora?', answer: 'Si' }]);
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('POSTING_FILLED');
    expect((await request(app).get(`/api/workers/job-postings/${postingId}`).set(as(third!.token))).status).toBe(404);

    // Linea de tiempo del trabajador, en orden, con actor y fecha.
    const mine = await request(app).get(`/api/workers/job-applications/${applicationId}`).set(as(first!.token));
    expect(mine.body.events.map((event: { type: string }) => event.type)).toEqual(['APPLIED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'OFFER_ISSUED', 'OFFER_ACCEPTED', 'HIRED']);
    expect(mine.body.events.map((event: { actorRole: string }) => event.actorRole)).toEqual(['WORKER', 'BUSINESS', 'BUSINESS', 'BUSINESS', 'WORKER', 'BUSINESS']);
    const row = await prisma.jobPosting.findUniqueOrThrow({ where: { id: postingId }, include: { applications: true } });
    expect(row.filledVacancies).toBe(row.applications.filter((item) => item.status === 'HIRED').length);
  });

  it('keeps an accepted offer immutable, with a snapshot, a versioned history and a verifiable document', async () => {
    const postingId = await createPosting(companyA.token, { title: 'Recepcionista con oferta documentada', vacancies: 2 });
    const worker = workers[0]!;
    const applied = await apply(worker.token, postingId);
    const applicationId = applied.body.id as string;
    const documentBytes = pdf('condiciones de la oferta');
    const upload = await request(app).put(`/api/business/job-applications/${applicationId}/offer-documents`)
      .set(as(companyA.token)).set('Content-Type', 'application/pdf').set('X-File-Name', encodeURIComponent('Oferta Lucia.pdf')).send(documentBytes);
    expect(upload.status).toBe(201);
    expect(upload.body.sha256).toBe(createHash('sha256').update(documentBytes).digest('hex'));
    expect(JSON.stringify(upload.body)).not.toContain('storageKey');

    const v1 = await issueOffer(companyA.token, applicationId, { salaryCents: 170000, documentId: upload.body.id });
    expect(v1.status).toBe(201);
    expect(v1.body.status).toBe('OFFER');
    // El documento se consume: no se reutiliza en otra oferta.
    expect((await issueOffer(companyA.token, applicationId, { salaryCents: 171000, documentId: upload.body.id })).body.error).toBe('OFFER_DOCUMENT_NOT_AVAILABLE');

    // Reenvio identico = sin version nueva; condiciones distintas = version 2 y la 1 queda reemplazada.
    expect((await issueOffer(companyA.token, applicationId, { salaryCents: 170000 })).body.idempotent).toBe(true);
    const v2 = await issueOffer(companyA.token, applicationId, { salaryCents: 190000, contractType: 'FIXED_TERM', note: 'Plazo de seis meses' });
    expect(v2.status).toBe(201);
    expect(v2.body.offers.map((offer: { version: number; status: string }) => [offer.version, offer.status])).toEqual([[1, 'SUPERSEDED'], [2, 'PENDING']]);
    const oldOfferId = v2.body.offers[0].id as string;
    const currentOfferId = v2.body.offers[1].id as string;

    // Una version reemplazada ya no se puede aceptar.
    const stale = await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${oldOfferId}/accept`).set(as(worker.token));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('OFFER_NOT_PENDING');
    // Ni otra empresa ni otro trabajador la ven ni la aceptan.
    expect((await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${currentOfferId}/accept`).set(as(workers[1]!.token))).status).toBe(404);

    const accepted = await request(app).post(`/api/workers/job-applications/${applicationId}/offers/${currentOfferId}/accept`).set(as(worker.token));
    expect(accepted.status).toBe(200);
    const snapshot = accepted.body.offers[1].acceptanceSnapshot;
    expect(snapshot).toMatchObject({
      offerVersion: 2,
      company: { name: 'Cuenta empresa.a', ruc: companyA.identifier },
      worker: { name: worker.name, identifier: worker.identifier },
      posting: { title: 'Recepcionista con oferta documentada' },
      conditions: { salaryCents: 190000, currency: 'PEN', contractType: 'FIXED_TERM', startDate: FUTURE_START, note: 'Plazo de seis meses' },
    });
    expect(new Date(snapshot.acceptedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    // Tras aceptar: ni emitir otra oferta, ni editar por SQL (trigger), ni borrar el snapshot.
    expect((await issueOffer(companyA.token, applicationId, { salaryCents: 1 })).status).toBe(409);
    await expect(prisma.$executeRawUnsafe(`UPDATE "JobOffer" SET "salaryCents" = 1 WHERE "id" = '${currentOfferId}'`)).rejects.toThrow(/JOB_OFFER_ACCEPTED_IS_IMMUTABLE/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "JobOffer" SET "acceptanceSnapshot" = '{}' WHERE "id" = '${currentOfferId}'`)).rejects.toThrow(/JOB_OFFER_ACCEPTED_IS_IMMUTABLE/);
    expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id: currentOfferId } })).salaryCents).toBe(190000);

    // El documento de la version 1 se descarga con sesion: la empresa dueña y el trabajador, nadie mas.
    const v1Id = oldOfferId;
    const byCompany = await request(app).get(`/api/business/job-applications/${applicationId}/offers/${v1Id}/document`).set(as(companyA.token)).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(byCompany.status).toBe(200);
    expect(byCompany.headers['content-type']).toContain('application/pdf');
    expect(byCompany.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(byCompany.body).equals(documentBytes)).toBe(true);
    expect((await request(app).get(`/api/workers/job-applications/${applicationId}/offers/${v1Id}/document`).set(as(worker.token))).status).toBe(200);
    expect((await request(app).get(`/api/business/job-applications/${applicationId}/offers/${v1Id}/document`).set(as(companyB.token))).status).toBe(404);
    expect((await request(app).get(`/api/workers/job-applications/${applicationId}/offers/${v1Id}/document`).set(as(workers[1]!.token))).status).toBe(404);
    // Una oferta sin documento responde 404, no un archivo vacio.
    expect((await request(app).get(`/api/workers/job-applications/${applicationId}/offers/${currentOfferId}/document`).set(as(worker.token))).status).toBe(404);
  });

  it('isolates companies and workers and never leaks other candidates', async () => {
    const postingId = await createPosting(companyA.token, { title: 'Puesto privado de la empresa A' });
    const draftId = await createPosting(companyA.token, { title: 'Borrador privado de la empresa A' }, false);
    const [w1, w2] = workers;
    const appOne = (await apply(w1!.token, postingId)).body.id as string;
    const appTwo = (await apply(w2!.token, postingId)).body.id as string;

    // Empresa B: todo es 404 (no se enumera), nunca 403 ni datos.
    const foreign = [
      request(app).get(`/api/business/job-postings/${postingId}`),
      request(app).patch(`/api/business/job-postings/${postingId}`).send({ vacancies: 5 }),
      request(app).post(`/api/business/job-postings/${postingId}/publish`),
      request(app).post(`/api/business/job-postings/${postingId}/close`),
      request(app).get(`/api/business/job-postings/${postingId}/applications`),
      request(app).get(`/api/business/job-applications/${appOne}`),
      request(app).post(`/api/business/job-applications/${appOne}/stage`).send({ status: 'SHORTLISTED' }),
      request(app).post(`/api/business/job-applications/${appOne}/reject`).send({ reason: 'No' }),
      request(app).post(`/api/business/job-applications/${appOne}/hire`),
      request(app).get(`/api/business/job-applications/${appOne}/cv`),
    ];
    for (const call of foreign) expect((await call.set(as(companyB.token))).status).toBe(404);
    expect((await request(app).get('/api/business/job-postings').set(as(companyB.token))).body.items).toEqual([]);
    expect((await postingRow(postingId)).vacancies).toBe(1);
    expect((await applicationRow(appOne)).status).toBe('APPLIED');

    // Trabajador 2 no ve ni toca la postulacion del trabajador 1.
    for (const call of [
      request(app).get(`/api/workers/job-applications/${appOne}`),
      request(app).post(`/api/workers/job-applications/${appOne}/withdraw`),
      request(app).post(`/api/workers/job-applications/${appOne}/offers/cualquiera/accept`),
    ]) expect((await call.set(as(w2!.token))).status).toBe(404);
    const mine = await request(app).get('/api/workers/job-applications?limit=100').set(as(w2!.token));
    const mineIds = mine.body.items.map((item: { id: string }) => item.id);
    expect(mineIds).toContain(appTwo);
    expect(mineIds).not.toContain(appOne);
    expect(JSON.stringify(mine.body)).not.toContain(w1!.name);
    expect(JSON.stringify(mine.body)).not.toContain(w1!.email);

    // Detalle del puesto para el trabajador: sin datos de otros candidatos; el borrador no existe.
    const detail = await request(app).get(`/api/workers/job-postings/${postingId}`).set(as(w2!.token));
    expect(detail.status).toBe(200);
    expect(detail.body.myApplication).toEqual({ id: appTwo, status: 'APPLIED' });
    expect(JSON.stringify(detail.body)).not.toMatch(new RegExp(`${w1!.name}|${w1!.email}|filledVacancies|companyId|"vacancies"`));
    expect((await request(app).get(`/api/workers/job-postings/${draftId}`).set(as(w2!.token))).status).toBe(404);
    expect((await apply(w2!.token, draftId)).status).toBe(404);
    const search = await request(app).get('/api/workers/job-postings?query=privado&limit=100').set(as(w2!.token));
    expect(search.body.items.map((item: { id: string }) => item.id)).toEqual([postingId]);

    // La empresa dueña ve sus candidatos sin correo ni documento de identidad.
    const applicants = await request(app).get(`/api/business/job-postings/${postingId}/applications`).set(as(companyA.token));
    expect(applicants.body.items).toHaveLength(2);
    const serialized = JSON.stringify(applicants.body);
    for (const worker of [w1!, w2!]) {
      expect(serialized).not.toContain(worker.email);
      expect(serialized).not.toContain(worker.identifier);
    }
    expect(applicants.body.items[0].worker).toEqual(expect.objectContaining({ name: expect.any(String), hasCv: false }));

    // Roles cruzados y sin sesion.
    expect((await request(app).get('/api/business/job-postings').set(as(w1!.token))).status).toBe(403);
    expect((await request(app).get('/api/workers/job-postings').set(as(companyA.token))).status).toBe(403);
    expect((await request(app).get('/api/workers/job-applications').set(as(admin.token))).status).toBe(403);
    expect((await request(app).get('/api/business/job-postings').set(as(admin.token))).status).toBe(403);
    expect((await request(app).get('/api/business/job-postings')).status).toBe(401);
    expect((await request(app).get('/api/workers/job-postings')).status).toBe(401);
  });

  it('paginates, filters and orders the published postings', async () => {
    const tag = 'Zeta9';
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(await createPosting(companyA.token, {
        title: `Vendedor ${tag} numero ${index}`,
        modality: index % 2 === 0 ? 'REMOTE' : 'HYBRID',
        workload: index === 4 ? 'PART_TIME' : 'FULL_TIME',
        salaryMinCents: 100000 + index * 50000,
        salaryMaxCents: 120000 + index * 50000,
      }));
    }
    await createPosting(companyA.token, { title: `Vendedor ${tag} pausado` }).then((id) => request(app).post(`/api/business/job-postings/${id}/pause`).set(as(companyA.token)));
    await createPosting(companyA.token, { title: `Vendedor ${tag} borrador` }, false);
    const worker = workers[2]!;

    const collected: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 6; pages += 1) {
      const response = await request(app).get('/api/workers/job-postings').query({ query: tag, limit: 2, ...(cursor ? { cursor } : {}) }).set(as(worker.token));
      expect(response.status).toBe(200);
      collected.push(...response.body.items.map((item: { id: string }) => item.id));
      cursor = response.body.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(collected).toEqual([...ids].reverse());
    expect(new Set(collected).size).toBe(5);

    const filtered = async (query: Record<string, string>) => (await request(app).get('/api/workers/job-postings').query({ query: tag, ...query }).set(as(worker.token))).body.items.length;
    expect(await filtered({ modality: 'REMOTE' })).toBe(3);
    expect(await filtered({ modality: 'HYBRID' })).toBe(2);
    expect(await filtered({ workload: 'PART_TIME' })).toBe(1);
    expect(await filtered({ contractType: 'FIXED_TERM' })).toBe(0);
    // El rango del puesto alcanza al menos el minimo buscado (max = 120000 + 50000 * i).
    expect(await filtered({ minSalaryCents: '250000' })).toBe(2);
    expect(await filtered({ location: 'miraflores' })).toBe(5);
    expect(await filtered({ location: 'Cusco' })).toBe(0);
    expect((await request(app).get('/api/workers/job-postings').query({ cursor: 'basura' }).set(as(worker.token))).body.error).toBe('INVALID_CURSOR');
    const page = await request(app).get('/api/workers/job-postings').query({ query: tag, limit: 1 }).set(as(worker.token));
    expect(page.body.items[0]).toEqual(expect.objectContaining({
      salary: { minCents: 300000, maxCents: 320000, currency: 'PEN' },
      vacanciesRemaining: 1,
      company: { name: 'Cuenta empresa.a' },
      myApplication: null,
    }));
  });

  it('applies the posting lifecycle and edit rules', async () => {
    const postingId = await createPosting(companyA.token, { vacancies: 2, screeningQuestions: ['Puedes trabajar fines de semana?'] }, false);
    const route = (suffix: string) => `/api/business/job-postings/${postingId}${suffix}`;
    // Un borrador se edita; no se publica una segunda vez ni se pausa.
    expect((await request(app).patch(route('')).set(as(companyA.token)).send({ title: 'Cajera con titulo corregido' })).body.title).toBe('Cajera con titulo corregido');
    expect((await request(app).patch(route('')).set(as(companyA.token)).send({ salaryMinCents: 500000 })).body.error).toBe('INVALID_SALARY_RANGE');
    expect((await request(app).post(route('/pause')).set(as(companyA.token))).status).toBe(409);
    failNextPublish = true;
    expect((await request(app).post(route('/publish')).set(as(companyA.token))).status).toBe(500);
    expect((await postingRow(postingId)).status).toBe('DRAFT'); // el gancho fallido revierte la publicacion
    expect((await postingRow(postingId)).publishedAt).toBeNull();
    const published = await request(app).post(route('/publish')).set(as(companyA.token));
    expect(published.body).toMatchObject({ status: 'PUBLISHED', idempotent: false });
    expect((await request(app).post(route('/publish')).set(as(companyA.token))).body.idempotent).toBe(true);
    const publishedAt = (await postingRow(postingId)).publishedAt;
    // Publicado: no se edita sin pausar.
    expect((await request(app).patch(route('')).set(as(companyA.token)).send({ title: 'No deberia cambiar' })).body.error).toBe('POSTING_NOT_EDITABLE');

    const worker = workers[3]!;
    expect((await apply(worker.token, postingId, [{ question: 'Puedes trabajar fines de semana?', answer: 'Si' }])).status).toBe(201);
    expect((await request(app).post(route('/pause')).set(as(companyA.token))).body.status).toBe('PAUSED');
    // En pausa no recibe postulaciones nuevas, pero conserva las existentes y ya no aparece en la busqueda.
    const paused = await apply(workers[4]!.token, postingId, [{ question: 'Puedes trabajar fines de semana?', answer: 'Si' }]);
    expect([paused.status, paused.body.error]).toEqual([409, 'POSTING_NOT_PUBLISHED']);
    expect((await request(app).get(`/api/workers/job-postings/${postingId}`).set(as(workers[4]!.token))).status).toBe(404);
    // Reanudar conserva la primera fecha de publicacion; con postulaciones no se cambian las preguntas.
    expect((await request(app).patch(route('')).set(as(companyA.token)).send({ screeningQuestions: ['Otra pregunta distinta aqui'] })).body.error).toBe('POSTING_HAS_APPLICATIONS');
    expect((await request(app).patch(route('')).set(as(companyA.token)).send({ vacancies: 4, benefits: null })).status).toBe(200);
    expect((await request(app).post(route('/publish')).set(as(companyA.token))).body.status).toBe('PUBLISHED');
    expect((await postingRow(postingId)).publishedAt?.getTime()).toBe(publishedAt?.getTime());

    // Cerrar es terminal: no se reabre ni acepta postulaciones y las vacantes no bajan de lo cubierto.
    const closed = await request(app).post(route('/close')).set(as(companyA.token));
    expect(closed.body).toMatchObject({ status: 'CLOSED', idempotent: false });
    expect((await request(app).post(route('/close')).set(as(companyA.token))).body.idempotent).toBe(true);
    expect((await request(app).post(route('/publish')).set(as(companyA.token))).status).toBe(409);
    expect((await request(app).post(route('/pause')).set(as(companyA.token))).status).toBe(409);
    const afterClose = await apply(workers[4]!.token, postingId, [{ question: 'Puedes trabajar fines de semana?', answer: 'Si' }]);
    expect(afterClose.status).toBe(409);
    expect((await request(app).get('/api/business/job-postings').query({ status: 'CLOSED', limit: 100 }).set(as(companyA.token))).body.items.some((item: { id: string }) => item.id === postingId)).toBe(true);

    // Las vacantes no bajan de lo ya cubierto.
    const covered = await createPosting(companyA.token, { vacancies: 3, title: 'Puesto con contrataciones previas' });
    for (const candidate of [workers[0]!, workers[1]!]) {
      const { applicationId } = await toAccepted(companyA.token, candidate.token, covered);
      expect((await request(app).post(`/api/business/job-applications/${applicationId}/hire`).set(as(companyA.token))).status).toBe(200);
    }
    await request(app).post(`/api/business/job-postings/${covered}/pause`).set(as(companyA.token));
    expect((await request(app).patch(`/api/business/job-postings/${covered}`).set(as(companyA.token)).send({ vacancies: 1 })).body.error).toBe('VACANCIES_BELOW_FILLED');
    // Igualar lo cubierto tampoco: el puesto quedaria abierto sin vacantes libres (se cierra con la transicion).
    expect((await request(app).patch(`/api/business/job-postings/${covered}`).set(as(companyA.token)).send({ vacancies: 2 })).body.error).toBe('VACANCIES_BELOW_FILLED');
    expect((await request(app).patch(`/api/business/job-postings/${covered}`).set(as(companyA.token)).send({ vacancies: 3 })).status).toBe(200);
    // Las vacantes cubiertas jamas se envian en una edicion.
    expect((await request(app).patch(`/api/business/job-postings/${covered}`).set(as(companyA.token)).send({ filledVacancies: 0 })).status).toBe(400);
    expect((await postingRow(covered)).filledVacancies).toBe(2);
  });

  it('never leaves a posting open without free vacancies (audit probe CN-20261006-040)', async () => {
    const postingId = await createPosting(companyA.token, { vacancies: 2, title: 'Sin vacantes libres' });
    const { applicationId } = await toAccepted(companyA.token, workers[0]!.token, postingId);
    expect((await request(app).post(`/api/business/job-applications/${applicationId}/hire`).set(as(companyA.token))).status).toBe(200);
    const route = (suffix: string) => `/api/business/job-postings/${postingId}${suffix}`;
    expect((await request(app).post(route('/pause')).set(as(companyA.token))).body.status).toBe('PAUSED');
    const lowered = await request(app).patch(route('')).set(as(companyA.token)).send({ vacancies: 1 });
    expect([lowered.status, lowered.body.error]).toEqual([400, 'VACANCIES_BELOW_FILLED']);
    expect((await postingRow(postingId)).vacancies).toBe(2);
    // Con vacantes libres sigue funcionando.
    expect((await request(app).patch(route('')).set(as(companyA.token)).send({ vacancies: 3 })).status).toBe(200);
    expect((await request(app).post(route('/publish')).set(as(companyA.token))).body.status).toBe('PUBLISHED');
    // Defensa en profundidad: aun forzando el estado por SQL, ni publicar ni postular.
    await request(app).post(route('/pause')).set(as(companyA.token));
    await prisma.$executeRawUnsafe(`UPDATE "JobPosting" SET "vacancies" = 1 WHERE "id" = '${postingId}'`);
    const publish = await request(app).post(route('/publish')).set(as(companyA.token));
    expect([publish.status, publish.body.error]).toEqual([409, 'POSTING_FILLED']);
    expect((await postingRow(postingId)).status).toBe('PAUSED');
    await prisma.jobPosting.update({ where: { id: postingId }, data: { status: 'PUBLISHED' } });
    const late = await apply(workers[1]!.token, postingId);
    expect([late.status, late.body.error]).toEqual([409, 'POSTING_FILLED']);
    expect(await prisma.jobApplication.count({ where: { postingId, workerId: workers[1]!.id } })).toBe(0);
  });

  it('withdraws pending offers and notifies the worker when the posting is closed or filled', async () => {
    // Cierre: la oferta pendiente se retira, la postulacion sale del proceso y el trabajador lo ve en su linea de tiempo.
    const closing = await createPosting(companyA.token, { vacancies: 2, title: 'Cierra con oferta pendiente' });
    const waiting = (await apply(workers[2]!.token, closing)).body.id as string;
    const waitingOffer = (await issueOffer(companyA.token, waiting)).body.offers.at(-1).id as string;
    const untouched = (await apply(workers[3]!.token, closing)).body.id as string;
    const seen: Array<{ applicationId: string; type: string; recipientUserId: string }> = [];
    const unsubscribe = events.subscribe((event) => seen.push(event));
    expect((await request(app).post(`/api/business/job-postings/${closing}/close`).set(as(companyA.token))).body.status).toBe('CLOSED');
    unsubscribe();
    expect((await applicationRow(waiting)).status).toBe('REJECTED');
    expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id: waitingOffer } })).status).toBe('WITHDRAWN');
    expect((await applicationRow(untouched)).status).toBe('APPLIED');
    expect(seen).toEqual([expect.objectContaining({ applicationId: waiting, type: 'REJECTED', recipientUserId: workers[2]!.id })]);
    const timeline = (await request(app).get(`/api/workers/job-applications/${waiting}`).set(as(workers[2]!.token))).body;
    expect(timeline.currentOfferId).toBeNull();
    expect(timeline.events.at(-1)).toMatchObject({ type: 'REJECTED', toStatus: 'REJECTED' });
    const event = await prisma.jobApplicationEvent.findFirstOrThrow({ where: { applicationId: waiting, type: 'REJECTED' } });
    expect(event.detail).toBe('POSTING_CLOSED');
    const accept = await request(app).post(`/api/workers/job-applications/${waiting}/offers/${waitingOffer}/accept`).set(as(workers[2]!.token));
    expect(accept.status).toBe(409);

    // Cubierto: la ultima contratacion retira las ofertas pendientes de los demas; una aceptada sin contratar no se toca.
    const filling = await createPosting(companyA.token, { vacancies: 1, title: 'Se cubre con otra oferta pendiente' });
    const { applicationId: winner } = await toAccepted(companyA.token, workers[4]!.token, filling);
    const loser = (await apply(workers[5]!.token, filling)).body.id as string;
    const loserOffer = (await issueOffer(companyA.token, loser)).body.offers.at(-1).id as string;
    expect((await request(app).post(`/api/business/job-applications/${winner}/hire`).set(as(companyA.token))).status).toBe(200);
    expect((await postingRow(filling)).status).toBe('FILLED');
    expect((await applicationRow(loser)).status).toBe('REJECTED');
    expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id: loserOffer } })).status).toBe('WITHDRAWN');
    expect((await prisma.jobApplicationEvent.findFirstOrThrow({ where: { applicationId: loser, type: 'REJECTED' } })).detail).toBe('POSTING_FILLED');
    expect((await applicationRow(winner)).status).toBe('HIRED');
  });

  it('handles interviews, rejections and withdrawals idempotently and hides the rejection reason from the worker', async () => {
    const postingId = await createPosting(companyA.token, { vacancies: 3 });
    const [w1, w2, w3] = [workers[0]!, workers[1]!, workers[2]!];
    const id1 = (await apply(w1.token, postingId)).body.id as string;
    const id2 = (await apply(w2.token, postingId)).body.id as string;
    const id3 = (await apply(w3.token, postingId)).body.id as string;
    const company = (path: string) => `/api/business/job-applications/${path}`;

    const past = await request(app).post(company(`${id1}/interview`)).set(as(companyA.token)).send({ scheduledAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(past.body.error).toBe('INVALID_INTERVIEW_DATE');
    const farFuture = await request(app).post(company(`${id1}/interview`)).set(as(companyA.token)).send({ scheduledAt: new Date(Date.now() + 800 * 24 * 3600_000).toISOString() });
    expect(farFuture.body.error).toBe('INVALID_INTERVIEW_DATE');
    const at = new Date(Date.now() + 24 * 3600_000).toISOString();
    expect((await request(app).post(company(`${id1}/interview`)).set(as(companyA.token)).send({ scheduledAt: at })).body.idempotent).toBe(false);
    expect((await request(app).post(company(`${id1}/interview`)).set(as(companyA.token)).send({ scheduledAt: at })).body.idempotent).toBe(true);
    const moved = await request(app).post(company(`${id1}/interview`)).set(as(companyA.token)).send({ scheduledAt: new Date(Date.now() + 48 * 3600_000).toISOString(), mode: 'PHONE' });
    expect(moved.body.events.filter((event: { type: string }) => event.type === 'INTERVIEW_SCHEDULED')).toHaveLength(2);

    // Preseleccionar dos veces no duplica eventos; no se retrocede de etapa.
    expect((await request(app).post(company(`${id2}/stage`)).set(as(companyA.token)).send({ status: 'SHORTLISTED' })).body.idempotent).toBe(false);
    expect((await request(app).post(company(`${id2}/stage`)).set(as(companyA.token)).send({ status: 'SHORTLISTED' })).body.idempotent).toBe(true);
    expect((await request(app).post(company(`${id1}/stage`)).set(as(companyA.token)).send({ status: 'SHORTLISTED' })).body.error).toBe('INVALID_STATE_TRANSITION');
    expect((await prisma.jobApplicationEvent.count({ where: { applicationId: id2, type: 'SHORTLISTED' } })).valueOf()).toBe(1);

    // Rechazo con una oferta pendiente: la oferta se retira; el motivo es interno.
    const offer = await issueOffer(companyA.token, id3);
    const offerId = offer.body.offers[0].id as string;
    const rejected = await request(app).post(company(`${id3}/reject`)).set(as(companyA.token)).send({ reason: 'Perfil no encaja con el puesto' });
    expect(rejected.body).toMatchObject({ status: 'REJECTED', decisionReason: 'Perfil no encaja con el puesto', idempotent: false });
    expect(rejected.body.offers[0].status).toBe('WITHDRAWN');
    expect((await request(app).post(company(`${id3}/reject`)).set(as(companyA.token)).send({})).body.idempotent).toBe(true);
    const workerView = await request(app).get(`/api/workers/job-applications/${id3}`).set(as(w3.token));
    expect(workerView.body.status).toBe('REJECTED');
    expect(JSON.stringify(workerView.body)).not.toContain('Perfil no encaja');
    expect(workerView.body.events.at(-1)).toMatchObject({ type: 'REJECTED', detail: null });
    // Con la postulacion rechazada ya no se acepta, ni se retira, ni se emiten ofertas.
    expect((await request(app).post(`/api/workers/job-applications/${id3}/offers/${offerId}/accept`).set(as(w3.token))).status).toBe(409);
    expect((await request(app).post(`/api/workers/job-applications/${id3}/withdraw`).set(as(w3.token))).status).toBe(409);
    expect((await issueOffer(companyA.token, id3)).status).toBe(409);
    expect((await request(app).post(company(`${id3}/stage`)).set(as(companyA.token)).send({ status: 'SHORTLISTED' })).status).toBe(409);

    // Retirada del trabajador (idempotente). Volver a postular reactiva la MISMA postulacion (M4).
    expect((await request(app).post(`/api/workers/job-applications/${id1}/withdraw`).set(as(w1.token))).body).toMatchObject({ status: 'WITHDRAWN', idempotent: false });
    expect((await request(app).post(`/api/workers/job-applications/${id1}/withdraw`).set(as(w1.token))).body.idempotent).toBe(true);
    const again = await apply(w1.token, postingId);
    expect([again.status, again.body.id, again.body.status, again.body.reopened]).toEqual([200, id1, 'APPLIED', true]);
    expect(again.body.events.at(-1).type).toBe('APPLICATION_REOPENED');
    expect((await apply(w1.token, postingId)).body.idempotent).toBe(true);
    // Se retira otra vez: una postulacion retirada no admite acciones de la empresa.
    expect((await request(app).post(`/api/workers/job-applications/${id1}/withdraw`).set(as(w1.token))).body).toMatchObject({ status: 'WITHDRAWN', idempotent: false });
    expect((await request(app).post(company(`${id1}/reject`)).set(as(companyA.token)).send({})).status).toBe(409);

    // Rechazar la oferta equivale a retirarse, con su propio evento.
    const decliner = (await apply(workers[4]!.token, postingId)).body.id as string;
    const declineOffer = (await issueOffer(companyA.token, decliner)).body.offers[0].id as string;
    const declined = await request(app).post(`/api/workers/job-applications/${decliner}/offers/${declineOffer}/decline`).set(as(workers[4]!.token));
    expect(declined.body).toMatchObject({ status: 'WITHDRAWN', idempotent: false });
    expect(declined.body.offers[0].status).toBe('DECLINED');
    expect(declined.body.events.at(-1).type).toBe('OFFER_DECLINED');
    expect((await request(app).post(`/api/workers/job-applications/${decliner}/offers/${declineOffer}/decline`).set(as(workers[4]!.token))).body.idempotent).toBe(true);
    expect((await request(app).post(`/api/workers/job-applications/${decliner}/offers/${declineOffer}/accept`).set(as(workers[4]!.token))).status).toBe(409);

    // Filtro por etapa del listado de postulantes.
    const byStage = await request(app).get(`/api/business/job-postings/${postingId}/applications`).query({ status: 'REJECTED,WITHDRAWN' }).set(as(companyA.token));
    expect(byStage.body.items.map((item: { status: string }) => item.status).sort()).toEqual(['REJECTED', 'WITHDRAWN', 'WITHDRAWN']);
    expect((await request(app).get(`/api/business/job-postings/${postingId}/applications`).query({ status: 'NOPE' }).set(as(companyA.token))).status).toBe(400);
  });

  it('refuses to hire above the vacancies when two hires race for the last one', async () => {
    const postingId = await createPosting(companyA.token, { title: 'Ultima vacante en disputa', vacancies: 1 });
    const [first, second] = [workers[0]!, workers[1]!];
    const a = await toAccepted(companyA.token, first.token, postingId);
    const b = await toAccepted(companyA.token, second.token, postingId);

    const results = await Promise.all([a, b].map(({ applicationId }) => request(app).post(`/api/business/job-applications/${applicationId}/hire`).set(as(companyA.token))));
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(results.find((response) => response.status === 409)?.body.error).toBe('POSTING_FILLED');
    expect(await postingRow(postingId)).toMatchObject({ status: 'FILLED', filledVacancies: 1 });
    const statuses = (await Promise.all([a, b].map(({ applicationId }) => applicationRow(applicationId)))).map((row) => row.status).sort();
    // La que perdio la carrera ya no queda "Aceptada" sobre un puesto cubierto: el sistema la resuelve (M4).
    expect(statuses).toEqual(['HIRED', 'REJECTED']);
  }, 30_000);

  it('never exceeds the vacancies with many simultaneous hires, and the counter always equals the hires', async () => {
    const postingId = await createPosting(companyA.token, { title: 'Dos vacantes cuatro candidatos', vacancies: 2 });
    const accepted = [];
    for (const candidate of workers.slice(0, 4)) accepted.push(await toAccepted(companyA.token, candidate.token, postingId));
    const results = await Promise.all(accepted.map(({ applicationId }) => request(app).post(`/api/business/job-applications/${applicationId}/hire`).set(as(companyA.token))));
    expect(results.filter((response) => response.status === 200)).toHaveLength(2);
    expect(results.filter((response) => response.status === 409).map((response) => response.body.error)).toEqual(['POSTING_FILLED', 'POSTING_FILLED']);
    const row = await prisma.jobPosting.findUniqueOrThrow({ where: { id: postingId }, include: { applications: true } });
    expect(row).toMatchObject({ status: 'FILLED', filledVacancies: 2 });
    expect(row.applications.filter((application) => application.status === 'HIRED')).toHaveLength(2);
    // La base se defiende sola: ni siquiera por SQL se supera la vacante.
    await expect(prisma.$executeRawUnsafe(`UPDATE "JobPosting" SET "filledVacancies" = 3 WHERE "id" = '${postingId}'`)).rejects.toThrow();
  }, 40_000);

  it('turns a simultaneous double application into one application and an idempotent answer', async () => {
    const postingId = await createPosting(companyA.token, { title: 'Doble postulacion simultanea', vacancies: 3 });
    const worker = workers[5]!;
    const results = await Promise.all(Array.from({ length: 6 }, () => apply(worker.token, postingId)));
    expect(results.map((response) => response.status).filter((status) => status === 201)).toHaveLength(1);
    expect(results.every((response) => response.status === 201 || response.status === 200)).toBe(true);
    expect(new Set(results.map((response) => response.body.id)).size).toBe(1);
    expect(await prisma.jobApplication.count({ where: { postingId, workerId: worker.id } })).toBe(1);
    expect(await prisma.jobApplicationEvent.count({ where: { application: { postingId, workerId: worker.id }, type: 'APPLIED' } })).toBe(1);
  }, 30_000);

  it('resolves a simultaneous acceptance and withdrawal into exactly one consistent outcome', async () => {
    for (let round = 0; round < 4; round += 1) {
      const postingId = await createPosting(companyA.token, { title: `Aceptar contra retirar ${round}`, vacancies: 1 });
      const worker = workers[round % workers.length]!;
      const applicationId = (await apply(worker.token, postingId)).body.id as string;
      const offerId = (await issueOffer(companyA.token, applicationId)).body.offers[0].id as string;

      const [accept, withdraw] = await Promise.all([
        request(app).post(`/api/workers/job-applications/${applicationId}/offers/${offerId}/accept`).set(as(worker.token)),
        request(app).post(`/api/workers/job-applications/${applicationId}/withdraw`).set(as(worker.token)),
      ]);
      const row = await applicationRow(applicationId);
      const offer = await prisma.jobOffer.findUniqueOrThrow({ where: { id: offerId } });
      if (accept.status === 200) {
        // La aceptacion gano: la retirada llego despues sobre ACCEPTED y tambien es valida (el trabajador se arrepiente).
        expect(accept.body.status).toBe('ACCEPTED');
        expect(offer.status).toBe('ACCEPTED');
        expect(offer.acceptanceSnapshot).not.toBeNull();
        expect([200, 409]).toContain(withdraw.status);
        expect(['ACCEPTED', 'WITHDRAWN']).toContain(row.status);
      } else {
        // La retirada gano: la oferta queda retirada, sin snapshot, y la aceptacion es un conflicto, no un 500.
        expect(accept.status).toBe(409);
        expect(withdraw.status).toBe(200);
        expect(row.status).toBe('WITHDRAWN');
        expect(offer.status).toBe('WITHDRAWN');
        expect(offer.acceptanceSnapshot).toBeNull();
      }
      // Nunca hay una oferta aceptada con la postulacion fuera del proceso sin evento que lo explique.
      const eventTypes = (await prisma.jobApplicationEvent.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } })).map((event) => event.type);
      expect(eventTypes.filter((type) => type === 'OFFER_ACCEPTED').length).toBe(offer.status === 'ACCEPTED' ? 1 : 0);
    }
  }, 60_000);

  it('serializes a simultaneous rejection by the company and acceptance by the worker', async () => {
    const postingId = await createPosting(companyA.token, { title: 'Rechazo contra aceptacion', vacancies: 1 });
    const worker = workers[1]!;
    const applicationId = (await apply(worker.token, postingId)).body.id as string;
    const offerId = (await issueOffer(companyA.token, applicationId)).body.offers[0].id as string;
    const [accept, reject] = await Promise.all([
      request(app).post(`/api/workers/job-applications/${applicationId}/offers/${offerId}/accept`).set(as(worker.token)),
      request(app).post(`/api/business/job-applications/${applicationId}/reject`).set(as(companyA.token)).send({ reason: 'Cambio de planes' }),
    ]);
    expect(reject.status).toBe(200); // la empresa siempre puede rechazar (tambien tras la aceptacion)
    expect([200, 409]).toContain(accept.status);
    expect((await applicationRow(applicationId)).status).toBe('REJECTED');
    const offer = await prisma.jobOffer.findUniqueOrThrow({ where: { id: offerId } });
    expect(offer.status).toBe(accept.status === 200 ? 'ACCEPTED' : 'WITHDRAWN');
  }, 30_000);

  it('does not hire when the posting was closed after the acceptance', async () => {
    const postingId = await createPosting(companyA.token, { title: 'Cerrado antes de contratar', vacancies: 1 });
    const { applicationId } = await toAccepted(companyA.token, workers[2]!.token, postingId);
    await request(app).post(`/api/business/job-postings/${postingId}/close`).set(as(companyA.token));
    const hire = await request(app).post(`/api/business/job-applications/${applicationId}/hire`).set(as(companyA.token));
    expect([hire.status, hire.body.error]).toEqual([409, 'POSTING_NOT_OPEN']);
    expect((await postingRow(postingId)).filledVacancies).toBe(0);
    // Lo caducado no se queda en "Aceptada": el cierre la resuelve y la constancia se conserva (M4).
    expect(await applicationRow(applicationId)).toMatchObject({ status: 'REJECTED', autoClosedReason: 'POSTING_CLOSED' });
    expect((await request(app).post(`/api/workers/job-applications/${applicationId}/withdraw`).set(as(workers[2]!.token))).status).toBe(409);
  });

  it('pushes real-time notices only to the counterpart over the SSE stream', async () => {
    const postingId = await createPosting(companyA.token, { title: 'Aviso en tiempo real', vacancies: 1 });
    const worker = workers[3]!;
    const server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const open = (token: string) => new Promise<{ chunks: string[]; close: () => void }>((resolve, reject) => {
      const chunks: string[] = [];
      const clientRequest = http.get({ host: '127.0.0.1', port, path: '/api/job-events', headers: { Authorization: `Bearer ${token}` } }, (response) => {
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/event-stream');
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => chunks.push(chunk));
        resolve({ chunks, close: () => clientRequest.destroy() });
      });
      clientRequest.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error); });
    });
    const base = events.subscriberCount;
    const workerStream = await open(worker.token);
    const companyStream = await open(companyA.token);
    await vi.waitFor(() => expect(events.subscriberCount).toBe(base + 2));

    const applicationId = (await apply(worker.token, postingId)).body.id as string;
    await request(app).post(`/api/business/job-applications/${applicationId}/stage`).set(as(companyA.token)).send({ status: 'SHORTLISTED' });
    await vi.waitFor(() => {
      expect(workerStream.chunks.join('')).toContain('"type":"SHORTLISTED"');
      expect(companyStream.chunks.join('')).toContain('"type":"APPLIED"');
    });
    const toWorker = workerStream.chunks.join('');
    const toCompany = companyStream.chunks.join('');
    // Cada parte recibe solo el aviso de la otra, y el destinatario no se expone en el mensaje.
    expect(toWorker).not.toContain('"type":"APPLIED"');
    expect(toCompany).not.toContain('"type":"SHORTLISTED"');
    expect(toWorker).toContain('event: job');
    expect(toWorker).toContain(`"applicationId":"${applicationId}"`);
    expect(toWorker).not.toContain('recipientUserId');

    workerStream.close();
    companyStream.close();
    await vi.waitFor(() => expect(events.subscriberCount).toBe(base));
    await new Promise((resolve) => server.close(resolve));
  }, 30_000);

  it('retains the acceptance record: an account with an accepted offer cannot be deleted (RESTRICT, CONTRACT_RECORDS_RETAINED)', async () => {
    const leaver = await makeAccount('WORKER', 'trabajador.baja', '40009999');
    const owner = await makeAccount('BUSINESS', 'empresa.baja', '20333333333');
    const postingId = await createPosting(owner.token, { title: 'Puesto de una empresa que se da de baja', vacancies: 2 });
    const { applicationId, offerId } = await toAccepted(owner.token, leaver.token, postingId);
    const hired = await request(app).post(`/api/business/job-applications/${applicationId}/hire`).set(as(owner.token));
    expect(hired.status).toBe(200);

    // Las FK RESTRICT respaldan la regla aunque otra ruta intentara borrar directamente.
    await expect(prisma.user.delete({ where: { id: leaver.id } })).rejects.toThrow(/RESTRICT|23001/);
    await expect(prisma.jobPosting.delete({ where: { id: postingId } })).rejects.toThrow(/RESTRICT|23001/);

    // La ruta de administracion responde 409 sin borrar nada.
    const workerDelete = await request(app).delete(`/api/admin/workers/${leaver.id}`).set(as(admin.token));
    expect([workerDelete.status, workerDelete.body]).toEqual([409, { error: 'CONTRACT_RECORDS_RETAINED' }]);
    const companyId = (await prisma.company.findUniqueOrThrow({ where: { ownerId: owner.id } })).id;
    const companyDelete = await request(app).delete(`/api/admin/companies/${companyId}`).set(as(admin.token));
    expect([companyDelete.status, companyDelete.body]).toEqual([409, { error: 'CONTRACT_RECORDS_RETAINED' }]);
    expect(await prisma.jobOffer.count({ where: { id: offerId, status: 'ACCEPTED' } })).toBe(1);
    expect(await prisma.jobApplication.count({ where: { id: applicationId } })).toBe(1);
    expect(await prisma.jobPosting.count({ where: { id: postingId } })).toBe(1);
    expect(await prisma.user.count({ where: { id: { in: [leaver.id, owner.id] } } })).toBe(2);
  }, 30_000);
});
