import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AuthError, type AuthService } from '../src/modules/auth/auth.service.js';
import { JobError } from '../src/modules/jobs/jobs.errors.js';
import { JobEvents } from '../src/modules/jobs/jobs.events.js';
import { createBusinessJobsRouter, createJobEventsRouter, createWorkerJobsRouter } from '../src/modules/jobs/jobs.routes.js';
import type { JobService } from '../src/modules/jobs/jobs.service.js';

type Role = 'WORKER' | 'BUSINESS' | 'ADMIN';

function authFor(role: Role) {
  return { restore: vi.fn(async () => ({ userId: `${role.toLowerCase()}-1`, role, name: 'N', identifier: '1' })) } as unknown as AuthService;
}
const noSession = { restore: vi.fn(async () => { throw new AuthError('INVALID_SESSION'); }) } as unknown as AuthService;

const business = (service: object, role: Role = 'BUSINESS') => express().use(express.json()).use(createBusinessJobsRouter(authFor(role), service as JobService));
const worker = (service: object, role: Role = 'WORKER') => express().use(express.json()).use(createWorkerJobsRouter(authFor(role), service as JobService));
const auth = { Authorization: 'Bearer t' };

const validPosting = {
  title: 'Cajera de tienda', description: 'Atencion al cliente y manejo de caja en tienda.', modality: 'ONSITE', workload: 'FULL_TIME',
  salaryMinCents: 150000, salaryMaxCents: 200000, location: 'Lima, Miraflores', contractType: 'INDEFINITE', vacancies: 2,
};

describe('job routes: validation and authorization before reaching the service', () => {
  it('rejects a salary range where the minimum exceeds the maximum', async () => {
    const createPosting = vi.fn();
    const response = await request(business({ createPosting })).post('/job-postings').set(auth).send({ ...validPosting, salaryMinCents: 300000 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_INPUT');
    expect(createPosting).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown field (filledVacancies is derived, not editable)', { ...validPosting, filledVacancies: 5 }],
    ['status chosen by the client', { ...validPosting, status: 'PUBLISHED' }],
    ['zero vacancies', { ...validPosting, vacancies: 0 }],
    ['fractional vacancies', { ...validPosting, vacancies: 1.5 }],
    ['invalid modality', { ...validPosting, modality: 'MOON' }],
    ['title too short', { ...validPosting, title: 'abc' }],
    ['description too long', { ...validPosting, description: 'x'.repeat(5_001) }],
    ['negative salary', { ...validPosting, salaryMinCents: -1 }],
    ['absurd salary', { ...validPosting, salaryMaxCents: 99_999_999_999 }],
    ['more than five screening questions', { ...validPosting, screeningQuestions: Array.from({ length: 6 }, (_, index) => `Pregunta numero ${index} aqui`) }],
    ['duplicate screening questions', { ...validPosting, screeningQuestions: ['Tienes experiencia previa?', 'Tienes experiencia previa?'] }],
    ['malformed start date', { ...validPosting, expectedStartDate: '2026-13-45' }],
  ])('rejects %s', async (_name, body) => {
    const createPosting = vi.fn();
    const response = await request(business({ createPosting })).post('/job-postings').set(auth).send(body);
    expect(response.status).toBe(400);
    expect(createPosting).not.toHaveBeenCalled();
  });

  it('rejects a patch that tries to change derived or lifecycle fields', async () => {
    const updatePosting = vi.fn(async () => ({ id: 'p' }));
    const app = business({ updatePosting });
    for (const body of [{ filledVacancies: 1 }, { status: 'FILLED' }, { companyId: 'x' }, {}]) {
      expect((await request(app).patch('/job-postings/p').set(auth).send(body)).status).toBe(400);
    }
    expect((await request(app).patch('/job-postings/p').set(auth).send({ salaryMinCents: 9, salaryMaxCents: 5 })).status).toBe(400);
    expect((await request(app).patch('/job-postings/p').set(auth).send({ vacancies: 3 })).status).toBe(200);
    expect(updatePosting).toHaveBeenCalledTimes(1);
  });

  it('forbids a worker from using company routes and a company from using worker routes', async () => {
    const service = { createPosting: vi.fn(), searchPostings: vi.fn() };
    expect((await request(business(service, 'WORKER')).post('/job-postings').set(auth).send(validPosting)).status).toBe(403);
    expect((await request(worker(service, 'BUSINESS')).get('/job-postings').set(auth)).status).toBe(403);
    expect((await request(worker(service, 'ADMIN')).get('/job-postings').set(auth)).status).toBe(403);
    expect(service.createPosting).not.toHaveBeenCalled();
    expect(service.searchPostings).not.toHaveBeenCalled();
  });

  it('answers 401 without a valid session', async () => {
    const app = express().use(express.json()).use(createWorkerJobsRouter(noSession, {} as JobService));
    expect((await request(app).get('/job-postings')).status).toBe(401);
  });

  it('bounds pagination and validates filters', async () => {
    const searchPostings = vi.fn(async () => ({ items: [], nextCursor: null }));
    const app = worker({ searchPostings });
    expect((await request(app).get('/job-postings?limit=101').set(auth)).status).toBe(400);
    expect((await request(app).get('/job-postings?limit=0').set(auth)).status).toBe(400);
    expect((await request(app).get('/job-postings?modality=NOPE').set(auth)).status).toBe(400);
    expect((await request(app).get('/job-postings?minSalaryCents=abc').set(auth)).status).toBe(400);
    const ok = await request(app).get('/job-postings?limit=10&modality=REMOTE&minSalaryCents=100000&query=cajera').set(auth);
    expect(ok.status).toBe(200);
    expect(searchPostings).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 10, modality: 'REMOTE', minSalaryCents: 100000, query: 'cajera' }));
  });

  it('only accepts SHORTLISTED or INTERVIEW as a stage move (offer and hire have their own routes)', async () => {
    const moveStage = vi.fn(async () => ({ id: 'a' }));
    const app = business({ moveStage });
    for (const status of ['OFFER', 'HIRED', 'ACCEPTED', 'WITHDRAWN', 'REJECTED', 'APPLIED']) {
      expect((await request(app).post('/job-applications/a/stage').set(auth).send({ status })).status).toBe(400);
    }
    expect((await request(app).post('/job-applications/a/stage').set(auth).send({ status: 'SHORTLISTED' })).status).toBe(200);
    expect(moveStage).toHaveBeenCalledTimes(1);
  });

  it('validates the offer body strictly', async () => {
    const issueOffer = vi.fn(async () => ({ id: 'a', idempotent: false }));
    const app = business({ issueOffer });
    const valid = { salaryCents: 180000, contractType: 'FIXED_TERM', startDate: '2026-12-01' };
    expect((await request(app).post('/job-applications/a/offers').set(auth).send({ ...valid, salaryCents: 0 })).status).toBe(400);
    expect((await request(app).post('/job-applications/a/offers').set(auth).send({ ...valid, startDate: 'manana' })).status).toBe(400);
    expect((await request(app).post('/job-applications/a/offers').set(auth).send({ ...valid, status: 'ACCEPTED' })).status).toBe(400);
    expect((await request(app).post('/job-applications/a/offers').set(auth).send({ ...valid, note: 'x'.repeat(1_001) })).status).toBe(400);
    expect((await request(app).post('/job-applications/a/offers').set(auth).send(valid)).status).toBe(201);
  });

  it('validates the offer document upload: PDF magic bytes, name and size', async () => {
    const uploadOfferDocument = vi.fn(async () => ({ id: 'u' }));
    const app = business({ uploadOfferDocument });
    const upload = (body: Buffer, type: string, name?: string) => {
      const call = request(app).put('/job-applications/a/offer-documents').set(auth).set('Content-Type', type);
      return (name ? call.set('X-File-Name', encodeURIComponent(name)) : call).send(body);
    };
    expect((await upload(Buffer.from('%PDF-1.4 ok'), 'application/pdf', 'oferta.pdf')).status).toBe(201);
    expect((await upload(Buffer.from('not a pdf at all'), 'application/pdf', 'oferta.pdf')).status).toBe(400);
    expect((await upload(Buffer.from('%PDF-1.4 ok'), 'application/pdf')).status).toBe(400);
    expect((await upload(Buffer.from('%PDF-1.4 ok'), 'application/pdf', 'oferta.exe')).status).toBe(400);
    expect((await upload(Buffer.from('%PDF-1.4 ok'), 'image/png', 'oferta.pdf')).status).toBe(400);
    const tooBig = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.alloc(5 * 1024 * 1024)]);
    const big = await upload(tooBig, 'application/pdf', 'grande.pdf');
    expect(big.status).toBe(413);
    expect(big.body.error).toBe('OFFER_DOCUMENT_TOO_LARGE');
    expect(uploadOfferDocument).toHaveBeenCalledTimes(1);
  });

  it('maps business errors to their status and extra details', async () => {
    const confirmHire = vi.fn(async () => { throw new JobError('INVALID_STATE_TRANSITION', 409, { status: 'OFFER', requested: 'HIRED' }); });
    const response = await request(business({ confirmHire })).post('/job-applications/a/hire').set(auth);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'INVALID_STATE_TRANSITION', status: 'OFFER', requested: 'HIRED' });
    const missing = vi.fn(async () => { throw new JobError('JOB_APPLICATION_NOT_FOUND', 404); });
    expect((await request(worker({ getMyApplication: missing })).get('/job-applications/zzz').set(auth)).status).toBe(404);
  });

  it('answers 201 for a new application and 200 for an idempotent repeat', async () => {
    const apply = vi.fn()
      .mockResolvedValueOnce({ id: 'a', created: true })
      .mockResolvedValueOnce({ id: 'a', created: false });
    const app = worker({ apply });
    expect((await request(app).post('/job-postings/p/applications').set(auth).send({ answers: [] })).status).toBe(201);
    expect((await request(app).post('/job-postings/p/applications').set(auth).send({})).status).toBe(200);
    expect((await request(app).post('/job-postings/p/applications').set(auth).send({ answers: [{ question: 'q', answer: '' }] })).status).toBe(400);
    expect((await request(app).post('/job-postings/p/applications').set(auth).send({ answers: [], workerId: 'otro' })).status).toBe(400);
  });
});

describe('job events stream', () => {
  it('requires a session', async () => {
    const app = express().use(createJobEventsRouter(noSession, new JobEvents()));
    expect((await request(app).get('/job-events')).status).toBe(401);
  });
});
