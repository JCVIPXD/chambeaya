import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { LocalAuthService, type AuthService } from '../src/modules/auth/auth.service.js';
import { createWorkerCurrencyRouter } from '../src/modules/currency/currency.routes.js';
import type { CurrencyLedgerService } from '../src/modules/currency/currency.service.js';
import { createBusinessJobsRouter } from '../src/modules/jobs/jobs.routes.js';
import type { JobService } from '../src/modules/jobs/jobs.service.js';
import { createApp } from '../src/app.js';
import { SERIALIZATION_RETRY_EXHAUSTED, translateTransactionError } from '../src/modules/operations/transaction-errors.js';
import type { TalentOperations } from '../src/modules/talent/talent.service.js';

/** Las tres formas con que Prisma entrega un conflicto de transacción que no se pudo recuperar. */
const serialization = Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' });
const sqlstate = Object.assign(new Error('raw query failed'), { code: 'P2010', meta: { code: '40001' } });
const deadlock = new Error('Invalid prisma.x.update() invocation: PostgresError { code: "40P01", message: "deadlock detected" }');
const exhausted = [['P2034', serialization], ['P2010 con 40001', sqlstate], ['40P01 sin código', deadlock]] as const;

function authFor(role: 'WORKER' | 'BUSINESS') {
  return { restore: vi.fn(async () => ({ userId: `${role.toLowerCase()}-1`, role, name: 'N', identifier: '1' })) } as unknown as AuthService;
}
const auth = { Authorization: 'Bearer t' };

describe('translateTransactionError', () => {
  it.each(exhausted)('maps %s to a retryable 503', (_name, error) => {
    expect(translateTransactionError(error)).toMatchObject({ status: 503, body: { error: SERIALIZATION_RETRY_EXHAUSTED, retryable: true }, retryAfterSeconds: 1 });
  });

  it('maps a missing record to 404 only when the route asks for it, and leaves everything else alone', () => {
    const missing = Object.assign(new Error('fk'), { code: 'P2003' });
    expect(translateTransactionError(missing)).toBeNull();
    expect(translateTransactionError(missing, { missingRecordCode: 'GONE' })).toEqual({ status: 404, body: { error: 'GONE' } });
    expect(translateTransactionError(Object.assign(new Error('x'), { code: 'P2025' }), { missingRecordCode: 'GONE' })).toMatchObject({ status: 404 });
    expect(translateTransactionError(Object.assign(new Error('x'), { code: 'P2002' }), { missingRecordCode: 'GONE' })).toBeNull();
    expect(translateTransactionError(new Error('boom'))).toBeNull();
    expect(translateTransactionError(null)).toBeNull();
    // Un mensaje que solo menciona el código no basta: se exige el formato exacto de PostgresError.
    expect(translateTransactionError(new Error('mencion 40P01 suelta'))).toBeNull();
  });
});

describe('shared mapping of exhausted serialization retries (CN-20261012-049, BAJO-1 y BAJO-2)', () => {
  it.each(exhausted)('currency routes answer 503 SERIALIZATION_RETRY_EXHAUSTED with Retry-After for %s', async (_name, error) => {
    const balanceForWorker = vi.fn(async () => { throw error; });
    const app = express().use(express.json()).use(createWorkerCurrencyRouter(authFor('WORKER'), { balanceForWorker } as unknown as CurrencyLedgerService));
    const response = await request(app).get('/workers/currency/balance').set(auth);
    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toMatchObject({ error: SERIALIZATION_RETRY_EXHAUSTED, retryable: true });
    expect(typeof response.body.message).toBe('string');
  });

  it('currency routes still answer 500 for an unknown failure', async () => {
    const balanceForWorker = vi.fn(async () => { throw new Error('boom'); });
    const app = express().use(express.json()).use(createWorkerCurrencyRouter(authFor('WORKER'), { balanceForWorker } as unknown as CurrencyLedgerService));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await request(app).get('/workers/currency/balance').set(auth);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'INTERNAL_ERROR' });
  });

  it.each(exhausted)('job routes answer 503 for %s', async (_name, error) => {
    const listPostings = vi.fn(async () => { throw error; });
    const app = express().use(express.json()).use(createBusinessJobsRouter(authFor('BUSINESS'), { listPostings } as unknown as JobService));
    const response = await request(app).get('/job-postings').set(auth);
    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('1');
    expect(response.body.error).toBe(SERIALIZATION_RETRY_EXHAUSTED);
  });

  describe('talent routes', () => {
    async function talentApp(updateOwnProfile: () => Promise<unknown>) {
      const authService = new LocalAuthService();
      const worker = await authService.register({ role: 'WORKER', name: 'Ana Torres', email: 'ana@example.com', password: 'ClaveSegura1', dniOrRuc: '12345678' });
      const app = createApp({ authService, rateLimit: false, talentService: { updateOwnProfile, ownProfile: vi.fn(), listSpecialties: vi.fn(), searchTalent: vi.fn() } as unknown as TalentOperations });
      const patch = (body: object = { headline: 'Barista con experiencia' }) => request(app).patch('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`).send(body);
      return { patch };
    }

    it.each(exhausted)('answers 503 (not 400) when the save runs out of retries: %s', async (_name, error) => {
      const { patch } = await talentApp(async () => { throw error; });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = await patch();
      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('1');
      expect(response.body).toMatchObject({ error: SERIALIZATION_RETRY_EXHAUSTED, retryable: true });
    });

    it.each([['P2003'], ['P2025']])('answers 404 RESOURCE_NO_LONGER_EXISTS when the account was already deleted (%s)', async (code) => {
      const { patch } = await talentApp(async () => { throw Object.assign(new Error('gone'), { code }); });
      const response = await patch();
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'RESOURCE_NO_LONGER_EXISTS' });
    });

    it('keeps 400 only for invalid input and answers 500 for an unexpected failure', async () => {
      const { patch } = await talentApp(async () => { throw new Error('boom'); });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect((await patch({ cumpleScore: 100 })).status).toBe(400);
      const unexpected = await patch();
      expect(unexpected.status).toBe(500);
      expect(unexpected.body).toEqual({ error: 'INTERNAL_ERROR' });
    });
  });
});
