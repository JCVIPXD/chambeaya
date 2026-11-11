import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  CURRENCY_ACTION_KEYS, DEFAULT_CURRENCY_CATALOG, limaMonthWindow, resolveCatalogAction, type CatalogEntryRule,
} from '../src/modules/currency/currency.catalog.js';
import type { CurrencyCatalogService } from '../src/modules/currency/currency.catalog.service.js';
import { createAdminCurrencyRouter, createBusinessCurrencyRouter, createWorkerCurrencyRouter } from '../src/modules/currency/currency.routes.js';
import type { CurrencyLedgerService } from '../src/modules/currency/currency.service.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';

const cost = (overrides: Partial<CatalogEntryRule> = {}): CatalogEntryRule => ({
  actionKey: 'APPLICATION_EXTRA', actor: 'WORKER', kind: 'COST', amount: 5, active: true, freeMonthlyQuota: 10, refundWindowHours: 72, ...overrides,
});

describe('limaMonthWindow', () => {
  it('uses the Lima calendar month, not the UTC month', () => {
    // 2026-11-01 04:59:59 UTC es 2026-10-31 23:59:59 en Lima: sigue en octubre.
    const lastSecond = limaMonthWindow(new Date('2026-11-01T04:59:59.999Z'));
    expect(lastSecond.start.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(lastSecond.end.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    // Un instante después ya es noviembre en Lima.
    const firstSecond = limaMonthWindow(new Date('2026-11-01T05:00:00.000Z'));
    expect(firstSecond.start.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(firstSecond.end.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });

  it('rolls over the year and handles short months', () => {
    expect(limaMonthWindow(new Date('2026-12-31T20:00:00Z')).end.toISOString()).toBe('2027-01-01T05:00:00.000Z');
    const newYearUtc = limaMonthWindow(new Date('2027-01-01T04:59:59Z'));
    expect(newYearUtc.start.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    const february = limaMonthWindow(new Date('2028-02-15T12:00:00Z'));
    expect(february.start.toISOString()).toBe('2028-02-01T05:00:00.000Z');
    expect(february.end.toISOString()).toBe('2028-03-01T05:00:00.000Z');
  });
});

describe('resolveCatalogAction', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('is free while the monthly quota lasts and charges after it', () => {
    const inside = resolveCatalogAction('APPLICATION_EXTRA', 'WORKER', cost(), 9, now);
    expect(inside).toMatchObject({ charge: false, chargeAmount: 0, amount: 5, kind: 'COST', refundWindowHours: 72 });
    expect(inside.freeQuota).toMatchObject({ monthlyLimit: 10, used: 9, remaining: 1 });
    const outside = resolveCatalogAction('APPLICATION_EXTRA', 'WORKER', cost(), 10, now);
    expect(outside).toMatchObject({ charge: true, chargeAmount: 5 });
    expect(outside.freeQuota).toMatchObject({ remaining: 0 });
    expect(resolveCatalogAction('APPLICATION_EXTRA', 'WORKER', cost(), 99, now).freeQuota?.remaining).toBe(0);
  });

  it('charges every use when the action has no free quota', () => {
    const resolution = resolveCatalogAction('JOB_HIGHLIGHT', 'COMPANY', cost({ actionKey: 'JOB_HIGHLIGHT', actor: 'COMPANY', freeMonthlyQuota: 0, amount: 10 }), 0, now);
    expect(resolution).toMatchObject({ charge: true, chargeAmount: 10 });
  });

  it('reports the Lima month window of the quota', () => {
    const edge = resolveCatalogAction('APPLICATION_EXTRA', 'WORKER', cost(), 0, new Date('2026-11-01T04:59:59Z'));
    expect(edge.freeQuota).toMatchObject({ periodStart: '2026-10-01T05:00:00.000Z', periodEnd: '2026-11-01T05:00:00.000Z' });
  });

  it('grants a reward without charging and never reports a quota', () => {
    const reward = resolveCatalogAction('PROFILE_COMPLETE', 'WORKER', cost({ actionKey: 'PROFILE_COMPLETE', kind: 'REWARD', amount: 20, freeMonthlyQuota: 0, refundWindowHours: null }), 4, now);
    expect(reward).toMatchObject({ charge: false, chargeAmount: 0, rewardAmount: 20, amount: 20, freeQuota: null });
  });

  it('never blocks: a missing or inactive entry resolves as free and grants nothing', () => {
    expect(resolveCatalogAction('JOB_HIGHLIGHT', 'COMPANY', null, 0, now)).toMatchObject({ kind: null, active: false, charge: false, chargeAmount: 0, rewardAmount: 0 });
    const inactiveCost = resolveCatalogAction('APPLICATION_EXTRA', 'WORKER', cost({ active: false }), 50, now);
    expect(inactiveCost).toMatchObject({ active: false, charge: false, chargeAmount: 0, amount: 0, freeQuota: null });
    const inactiveReward = resolveCatalogAction('REFERRAL', 'WORKER', cost({ actionKey: 'REFERRAL', kind: 'REWARD', active: false, freeMonthlyQuota: 0, refundWindowHours: null }), 0, now);
    expect(inactiveReward.rewardAmount).toBe(0);
  });
});

describe('provisional defaults', () => {
  it('covers every action key and respects the catalog invariants', () => {
    const keys = new Set(DEFAULT_CURRENCY_CATALOG.map((entry) => entry.actionKey));
    expect([...keys].sort()).toEqual([...CURRENCY_ACTION_KEYS].sort());
    const pairs = DEFAULT_CURRENCY_CATALOG.map((entry) => `${entry.actionKey}:${entry.actor}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const entry of DEFAULT_CURRENCY_CATALOG) {
      expect(entry.amount).toBeGreaterThan(0);
      if (entry.kind === 'REWARD') expect(entry.freeMonthlyQuota === 0 && entry.refundWindowHours === null).toBe(true);
    }
  });

  it('matches the product decisions of the owner brief', () => {
    const find = (actionKey: string, actor: string) => DEFAULT_CURRENCY_CATALOG.find((entry) => entry.actionKey === actionKey && entry.actor === actor)!;
    expect(find('WELCOME_BONUS', 'WORKER').amount).toBe(50);
    expect(find('WELCOME_BONUS', 'COMPANY').amount).toBe(50);
    expect(find('JOB_PUBLISH_EXTRA', 'COMPANY').freeMonthlyQuota).toBe(3);
    expect(find('APPLICATION_EXTRA', 'WORKER').freeMonthlyQuota).toBe(10);
    for (const entry of DEFAULT_CURRENCY_CATALOG.filter((item) => item.refundWindowHours !== null)) expect(entry.refundWindowHours).toBe(72);
  });

  it('is exactly what the migration seeds', () => {
    const sql = readFileSync(join(__dirname, '../prisma/migrations/20261005120000_currency_catalog/migration.sql'), 'utf8');
    const rows = [...sql.matchAll(/\('([A-Z_]+)', '(COMPANY|WORKER)', '(COST|REWARD)', (\d+), (\d+), (NULL::integer|\d+)\)/g)].map((match) => ({
      actionKey: match[1], actor: match[2], kind: match[3], amount: Number(match[4]), freeMonthlyQuota: Number(match[5]),
      refundWindowHours: match[6]!.startsWith('NULL') ? null : Number(match[6]),
    }));
    expect(rows).toEqual(DEFAULT_CURRENCY_CATALOG.map((entry) => ({ ...entry })));
  });
});

function appFor(role: 'WORKER' | 'BUSINESS' | 'ADMIN', catalog: Partial<CurrencyCatalogService>) {
  const auth = { restore: vi.fn(async () => ({ userId: `${role.toLowerCase()}-1`, role })) } as unknown as AuthService;
  const ledger = {} as CurrencyLedgerService;
  const service = catalog as CurrencyCatalogService;
  return express().use(express.json())
    .use(createWorkerCurrencyRouter(auth, ledger, service))
    .use('/business', createBusinessCurrencyRouter(auth, ledger, service))
    .use('/admin', createAdminCurrencyRouter(auth, ledger, service));
}

describe('currency catalog routes', () => {
  const bearer = { Authorization: 'Bearer t' };

  it('serves each actor its own catalog and rejects the other roles', async () => {
    const listForActor = vi.fn(async () => ({ currency: 'Chambitas', items: [] }));
    const worker = appFor('WORKER', { listForActor });
    expect((await request(worker).get('/workers/currency/catalog').set(bearer)).status).toBe(200);
    expect(listForActor).toHaveBeenCalledWith('WORKER', 'worker-1');
    expect((await request(worker).get('/business/currency/catalog').set(bearer)).status).toBe(403);
    expect((await request(worker).get('/admin/currency/catalog').set(bearer)).status).toBe(403);

    const business = appFor('BUSINESS', { listForActor });
    expect((await request(business).get('/business/currency/catalog').set(bearer)).status).toBe(200);
    expect(listForActor).toHaveBeenLastCalledWith('COMPANY', 'business-1');
    expect((await request(business).get('/workers/currency/catalog').set(bearer)).status).toBe(403);
  });

  it('lets only an admin list, edit and read the history', async () => {
    const update = vi.fn(async () => ({ changed: ['amount'], entry: {} }));
    const listForAdmin = vi.fn(async () => ({ currency: 'Chambitas', items: [] }));
    const changes = vi.fn(async () => ({ items: [], nextCursor: null }));
    const service = { update, listForAdmin, changes } as unknown as Partial<CurrencyCatalogService>;
    const admin = appFor('ADMIN', service);
    expect((await request(admin).get('/admin/currency/catalog').set(bearer)).status).toBe(200);
    expect((await request(admin).get('/admin/currency/catalog/changes?limit=5&entryId=abc').set(bearer)).status).toBe(200);
    expect(changes).toHaveBeenCalledWith({ limit: 5, entryId: 'abc' });
    const patched = await request(admin).patch('/admin/currency/catalog/entry-1').set(bearer).send({ amount: 12, reason: 'Ajuste de precio' });
    expect(patched.status).toBe(200);
    expect(update).toHaveBeenCalledWith('entry-1', { amount: 12 }, 'Ajuste de precio', 'admin-1');

    for (const role of ['WORKER', 'BUSINESS'] as const) {
      const other = appFor(role, service);
      expect((await request(other).patch('/admin/currency/catalog/entry-1').set(bearer).send({ amount: 1, reason: 'Intento no autorizado' })).status).toBe(403);
      expect((await request(other).get('/admin/currency/catalog/changes').set(bearer)).status).toBe(403);
    }
  });

  it('validates the edit strictly before reaching the service', async () => {
    const update = vi.fn(async () => ({ changed: [], entry: {} }));
    const admin = appFor('ADMIN', { update } as unknown as Partial<CurrencyCatalogService>);
    const send = (body: unknown) => request(admin).patch('/admin/currency/catalog/entry-1').set(bearer).send(body as object);
    const invalid = [
      { amount: 5 },
      { amount: 5, reason: 'ab' },
      { reason: 'Sin ningun campo' },
      { amount: 0, reason: 'Monto en cero' },
      { amount: -3, reason: 'Monto negativo' },
      { amount: 1.5, reason: 'Monto decimal' },
      { amount: 1_000_001, reason: 'Monto excesivo' },
      { amount: '5', reason: 'Monto como texto' },
      { freeMonthlyQuota: -1, reason: 'Cuota negativa' },
      { refundWindowHours: 0, reason: 'Devolucion en cero' },
      { refundWindowHours: 9000, reason: 'Devolucion enorme' },
      { active: 'si', reason: 'Estado invalido' },
      { amount: 5, reason: 'Campo extra', kind: 'REWARD' },
      { amount: 5, reason: 'Campo extra', actionKey: 'JOB_HIGHLIGHT' },
    ];
    for (const body of invalid) {
      const response = await send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error).toBe('INVALID_INPUT');
    }
    expect(update).not.toHaveBeenCalled();
    expect((await send({ refundWindowHours: null, reason: 'Sin devolucion automatica' })).status).toBe(200);
    expect(update).toHaveBeenCalledWith('entry-1', { refundWindowHours: null }, 'Sin devolucion automatica', 'admin-1');
  });
});
