import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AuthError, type AuthService } from '../src/modules/auth/auth.service.js';
import { createAdminCurrencyRouter, createBusinessCurrencyRouter, createWorkerCurrencyRouter } from '../src/modules/currency/currency.routes.js';
import type { CurrencyQuoteService } from '../src/modules/currency/currency.quote.js';
import { CurrencyError, type CurrencyLedgerService } from '../src/modules/currency/currency.service.js';
import type { CurrencySettingsService } from '../src/modules/currency/currency.settings.js';
import type { WelcomeBonusService } from '../src/modules/currency/currency.welcome.js';
import { createBusinessJobsRouter, createWorkerJobsRouter } from '../src/modules/jobs/jobs.routes.js';
import type { JobService } from '../src/modules/jobs/jobs.service.js';
import { CandidateUnlockError } from '../src/modules/talent/candidate_unlock.service.js';
import { createTalentRouter } from '../src/modules/talent/talent.routes.js';

type Role = 'WORKER' | 'BUSINESS' | 'ADMIN';
const authFor = (role: Role) => ({ restore: vi.fn(async () => ({ userId: `${role.toLowerCase()}-1`, role, name: 'N', identifier: '1' })) }) as unknown as AuthService;
const noSession = { restore: vi.fn(async () => { throw new AuthError('INVALID_SESSION'); }) } as unknown as AuthService;
const auth = { Authorization: 'Bearer t' };
const appWith = (router: express.Router) => express().use(express.json()).use(router);

describe('M4 job routes', () => {
  it('maps a rejected charge to its status with cost and balance, for publish and highlight', async () => {
    const insufficient = new CurrencyError('INSUFFICIENT_CURRENCY', 409, { cost: 10, balance: 3 });
    const service = { publishPosting: vi.fn(async () => { throw insufficient; }), highlightPosting: vi.fn(async () => { throw new CurrencyError('DAILY_SPEND_CAP_REACHED', 409, { cost: 10, dailyCap: 200, spentToday: 200 }); }) };
    const app = appWith(createBusinessJobsRouter(authFor('BUSINESS'), service as unknown as JobService));
    const publish = await request(app).post('/job-postings/p1/publish').set(auth);
    expect([publish.status, publish.body]).toEqual([409, { error: 'INSUFFICIENT_CURRENCY', cost: 10, balance: 3 }]);
    const highlight = await request(app).post('/job-postings/p1/highlight').set(auth);
    expect([highlight.status, highlight.body]).toEqual([409, { error: 'DAILY_SPEND_CAP_REACHED', cost: 10, dailyCap: 200, spentToday: 200 }]);
  });

  it('keeps highlight and priority behind the right role and the session', async () => {
    const service = { highlightPosting: vi.fn(async () => ({ id: 'p1' })), prioritizeApplication: vi.fn(async () => ({ id: 'a1' })) } as unknown as JobService;
    expect((await request(appWith(createBusinessJobsRouter(authFor('WORKER'), service))).post('/job-postings/p1/highlight').set(auth)).status).toBe(403);
    expect((await request(appWith(createBusinessJobsRouter(noSession, service))).post('/job-postings/p1/highlight')).status).toBe(401);
    expect((await request(appWith(createWorkerJobsRouter(authFor('BUSINESS'), service))).post('/job-applications/a1/priority').set(auth)).status).toBe(403);
    expect((await request(appWith(createWorkerJobsRouter(noSession, service))).post('/job-applications/a1/priority')).status).toBe(401);
    expect((service.highlightPosting as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    const ok = await request(appWith(createWorkerJobsRouter(authFor('WORKER'), service))).post('/job-applications/a1/priority').set(auth);
    expect(ok.status).toBe(200);
    expect((service.prioritizeApplication as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.objectContaining({ userId: 'worker-1' }), 'a1');
  });

  it('accepts a boolean priority on apply and rejects anything else, and passes the history flag to the worker list', async () => {
    const apply = vi.fn(async () => ({ id: 'a1', created: true }));
    const listMyApplications = vi.fn(async () => ({ items: [], nextCursor: null }));
    const app = appWith(createWorkerJobsRouter(authFor('WORKER'), { apply, listMyApplications } as unknown as JobService));
    expect((await request(app).post('/job-postings/p1/applications').set(auth).send({ priority: true })).status).toBe(201);
    expect(apply).toHaveBeenCalledWith(expect.anything(), 'p1', [], { priority: true });
    expect((await request(app).post('/job-postings/p1/applications').set(auth).send({ priority: 'yes' })).status).toBe(400);
    expect((await request(app).post('/job-postings/p1/applications').set(auth).send({ cost: 0 })).status).toBe(400);

    await request(app).get('/job-applications').set(auth);
    expect(listMyApplications).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ history: false }));
    await request(app).get('/job-applications?history=true').set(auth);
    expect(listMyApplications).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ history: true }));
    expect((await request(app).get('/job-applications?history=maybe').set(auth)).status).toBe(400);
  });
});

describe('M4 currency routes', () => {
  const ledger = {} as CurrencyLedgerService;

  it('serves the quote to each actor with its own account and validates the query', async () => {
    const quote = vi.fn(async () => ({ cost: 5 }));
    const quotes = { quote } as unknown as CurrencyQuoteService;
    const workerApp = appWith(createWorkerCurrencyRouter(authFor('WORKER'), ledger, undefined, quotes));
    expect((await request(workerApp).get('/workers/currency/quote?actionKey=APPLICATION_EXTRA&targetId=p1').set(auth)).body).toEqual({ cost: 5 });
    expect(quote).toHaveBeenCalledWith('WORKER', 'worker-1', 'APPLICATION_EXTRA', 'p1');
    expect((await request(workerApp).get('/workers/currency/quote').set(auth)).status).toBe(400);
    expect((await request(workerApp).get('/workers/currency/quote?actionKey=X&extra=1').set(auth)).status).toBe(400);
    expect((await request(appWith(createWorkerCurrencyRouter(authFor('BUSINESS'), ledger, undefined, quotes))).get('/workers/currency/quote?actionKey=X').set(auth)).status).toBe(403);
    const businessApp = appWith(createBusinessCurrencyRouter(authFor('BUSINESS'), ledger, undefined, quotes));
    await request(businessApp).get('/currency/quote?actionKey=JOB_HIGHLIGHT').set(auth);
    expect(quote).toHaveBeenLastCalledWith('COMPANY', 'business-1', 'JOB_HIGHLIGHT', undefined);
  });

  it('keeps settings, welcome backfill and refund runs admin-only and validates values', async () => {
    const settings = { update: vi.fn(async () => ({ changed: true })), list: vi.fn(async () => ({ items: [] })), changes: vi.fn(async () => ({ items: [] })) };
    const welcome = { backfill: vi.fn(async () => ({})) };
    const refunds = { sweep: vi.fn(async () => ({ refunded: 0, notEligible: 0, amount: 0 })) };
    const extras = { settings: settings as unknown as CurrencySettingsService, welcome: welcome as unknown as WelcomeBonusService, refunds: refunds as never };
    const adminApp = appWith(createAdminCurrencyRouter(authFor('ADMIN'), ledger, undefined, extras));
    expect((await request(adminApp).patch('/currency/settings/DAILY_SPEND_CAP_WORKER').set(auth).send({ value: 150, reason: 'Ajuste de prueba' })).status).toBe(200);
    expect(settings.update).toHaveBeenCalledWith('DAILY_SPEND_CAP_WORKER', 150, 'Ajuste de prueba', 'admin-1');
    for (const body of [{ value: 0, reason: 'Motivo valido' }, { value: 5 }, { value: 5, reason: 'ab' }, { value: 5.5, reason: 'Motivo valido' }, { value: 5, reason: 'Motivo valido', key: 'x' }]) {
      expect((await request(adminApp).patch('/currency/settings/DAILY_SPEND_CAP_WORKER').set(auth).send(body)).status).toBe(400);
    }
    expect((await request(adminApp).patch('/currency/settings/NOT_A_SETTING').set(auth).send({ value: 5, reason: 'Motivo valido' })).status).toBe(404);
    expect(settings.update).toHaveBeenCalledTimes(1);
    expect((await request(adminApp).post('/currency/welcome-bonus/backfill').set(auth)).status).toBe(200);
    expect((await request(adminApp).post('/currency/refunds/run').set(auth)).status).toBe(200);
    for (const role of ['WORKER', 'BUSINESS'] as const) {
      const other = appWith(createAdminCurrencyRouter(authFor(role), ledger, undefined, extras));
      expect((await request(other).get('/currency/settings').set(auth)).status).toBe(403);
      expect((await request(other).post('/currency/welcome-bonus/backfill').set(auth)).status).toBe(403);
      expect((await request(other).post('/currency/refunds/run').set(auth)).status).toBe(403);
    }
    expect(welcome.backfill).toHaveBeenCalledTimes(1);
    expect(refunds.sweep).toHaveBeenCalledTimes(1);
  });
});

describe('M4 candidate unlock routes', () => {
  const unlocks = (overrides: Record<string, unknown> = {}) => ({
    unlock: vi.fn(async () => ({ unlocked: true, idempotent: false })),
    contact: vi.fn(async () => ({ unlocked: true })),
    downloadCv: vi.fn(async () => ({ originalName: 'cv.pdf', mediaType: 'application/pdf', bytes: Buffer.from('%PDF-1.4') })),
    list: vi.fn(async () => ({ items: [] })),
    ...overrides,
  });
  const talentApp = (role: Role, ops: ReturnType<typeof unlocks>) => appWith(createTalentRouter(authFor(role), {} as never, {} as never, ops as never));

  it('answers 201 for a new unlock, 200 for a repeat and requires a business session', async () => {
    const ops = unlocks();
    expect((await request(talentApp('BUSINESS', ops)).post('/business/talent/profile-1/unlock-contact').set(auth)).status).toBe(201);
    const repeat = unlocks({ unlock: vi.fn(async () => ({ unlocked: true, idempotent: true })) });
    expect((await request(talentApp('BUSINESS', repeat)).post('/business/talent/profile-1/unlock-contact').set(auth)).status).toBe(200);
    for (const path of ['/business/talent/profile-1/contact', '/business/talent/profile-1/cv', '/business/talent-unlocks']) {
      expect((await request(talentApp('WORKER', ops)).get(path).set(auth)).status).toBe(403);
    }
    expect((await request(talentApp('WORKER', ops)).post('/business/talent/profile-1/unlock-contact').set(auth)).status).toBe(403);
    expect(ops.unlock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'business-1' }), 'profile-1');
  });

  it('maps unlock and charge errors and serves the CV inline without caching', async () => {
    const failing = unlocks({
      unlock: vi.fn(async () => { throw new CurrencyError('INSUFFICIENT_CURRENCY', 409, { cost: 10, balance: 2 }); }),
      contact: vi.fn(async () => { throw new CandidateUnlockError('CONTACT_NOT_UNLOCKED'); }),
      downloadCv: vi.fn(async () => { throw new CandidateUnlockError('CV_NOT_AVAILABLE'); }),
    });
    const unlock = await request(talentApp('BUSINESS', failing)).post('/business/talent/profile-1/unlock-contact').set(auth);
    expect([unlock.status, unlock.body]).toEqual([409, { error: 'INSUFFICIENT_CURRENCY', cost: 10, balance: 2 }]);
    expect((await request(talentApp('BUSINESS', failing)).get('/business/talent/profile-1/contact').set(auth)).status).toBe(403);
    expect((await request(talentApp('BUSINESS', failing)).get('/business/talent/profile-1/cv').set(auth)).status).toBe(404);
    const cv = await request(talentApp('BUSINESS', unlocks())).get('/business/talent/profile-1/cv').set(auth);
    expect(cv.status).toBe(200);
    expect(cv.headers['cache-control']).toBe('private, no-store');
    expect(cv.headers['content-type']).toContain('application/pdf');
  });
});
