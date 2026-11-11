import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createAdminCurrencyRouter, createBusinessCurrencyRouter, createWorkerCurrencyRouter } from '../src/modules/currency/currency.routes.js';
import type { CurrencyLedgerService } from '../src/modules/currency/currency.service.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';

function appFor(router: express.Router) {
  return express().use(express.json()).use(router);
}

function authFor(role: 'WORKER' | 'BUSINESS' | 'ADMIN') {
  return {
    restore: vi.fn(async () => ({ userId: `${role.toLowerCase()}-1`, role })),
  } as unknown as AuthService;
}

describe('currency ledger routes', () => {
  it('only exposes a worker balance to the authenticated worker', async () => {
    const auth = authFor('WORKER');
    const balanceForWorker = vi.fn(async () => ({ currency: 'Chambitas', balance: 14 }));
    const app = appFor(createWorkerCurrencyRouter(auth, { balanceForWorker } as unknown as CurrencyLedgerService));

    const response = await request(app).get('/workers/currency/balance').set('Authorization', 'Bearer test');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ currency: 'Chambitas', balance: 14 });
    expect(balanceForWorker).toHaveBeenCalledWith('worker-1');
  });

  it('rejects an adjustment without a reason before it reaches the ledger', async () => {
    const auth = authFor('ADMIN');
    const adjust = vi.fn();
    const app = appFor(createAdminCurrencyRouter(auth, { adjust } as unknown as CurrencyLedgerService));

    const response = await request(app)
      .post('/currency/workers/worker-1/adjustments')
      .set('Authorization', 'Bearer test')
      .send({ quantity: 10, idempotencyKey: 'currency-test-001' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_INPUT');
    expect(adjust).not.toHaveBeenCalled();
  });

  it('does not let a worker read a company account', async () => {
    const auth = authFor('WORKER');
    const app = appFor(createBusinessCurrencyRouter(auth, {} as CurrencyLedgerService));

    const response = await request(app).get('/currency/balance').set('Authorization', 'Bearer test');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'BUSINESS_ACCOUNT_REQUIRED' });
  });
});
