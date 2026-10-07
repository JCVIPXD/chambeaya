import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { refundSchedulerIntervalMs } from '../src/modules/currency/currency.config.js';
import { CurrencyActionService, instanceKeys } from '../src/modules/currency/currency.actions.js';
import { DEFAULT_CURRENCY_CATALOG, limaDayWindow, limaMonthWindow } from '../src/modules/currency/currency.catalog.js';
import { CurrencyError } from '../src/modules/currency/currency.service.js';
import { CurrencySettingsService, DEFAULT_CURRENCY_SETTINGS } from '../src/modules/currency/currency.settings.js';
import { canPrioritizeApplication, canReopenApplication, canTransition } from '../src/modules/jobs/job-state.js';

type Use = { id: string; userId: string; actor: string; actionKey: string; instanceKey: string; accountId: string | null; chargedAmount: number; movementId: string | null; occurredAt: Date; refundDueAt: Date | null };
type Movement = { id: string; accountId: string; sequence: number; quantity: number; balanceAfter: number; action: string; actionKey: string | null; idempotencyKey: string; createdAt: Date; refundOfId: string | null };

/** Cliente transaccional en memoria con solo lo que usa `CurrencyActionService`. */
function fakeTx(options: { catalog?: Array<Record<string, unknown>>; settings?: Record<string, number>; balance?: number } = {}) {
  const catalog = (options.catalog ?? DEFAULT_CURRENCY_CATALOG.map((entry) => ({ ...entry, active: true }))) as Array<Record<string, unknown> & { actionKey: string; actor: string }>;
  const uses: Use[] = [];
  const movements: Movement[] = [];
  const accounts: Array<{ id: string; workerId: string | null; companyId: string | null }> = [];
  const settings = options.settings ?? {};
  let counter = 0;
  const account = (where: { workerId?: string; companyId?: string }) => accounts.find((item) => (where.workerId ? item.workerId === where.workerId : item.companyId === where.companyId));
  const tx = {
    $queryRaw: async () => [],
    currencyAccount: {
      upsert: async ({ where, create }: { where: { workerId?: string; companyId?: string }; create: { workerId?: string; companyId?: string } }) => {
        let found = account(where);
        if (!found) {
          found = { id: `acct-${(counter += 1)}`, workerId: create.workerId ?? null, companyId: create.companyId ?? null };
          accounts.push(found);
          // Toda cuenta nueva arranca con el saldo inicial de la prueba.
          if (options.balance) movements.push({ id: `seed-${found.id}`, accountId: found.id, sequence: 1, quantity: options.balance, balanceAfter: options.balance, action: 'ADMIN_ADJUSTMENT', actionKey: null, idempotencyKey: `seed-${found.id}`, createdAt: new Date(), refundOfId: null });
        }
        return found;
      },
      findUnique: async ({ where }: { where: { workerId?: string; companyId?: string } }) => account(where) ?? null,
    },
    currencyCatalogEntry: {
      findUnique: async ({ where }: { where: { actionKey_actor: { actionKey: string; actor: string } } }) =>
        catalog.find((entry) => entry.actionKey === where.actionKey_actor.actionKey && entry.actor === where.actionKey_actor.actor) ?? null,
    },
    currencyActionUse: {
      findUnique: async ({ where }: { where: { instanceKey: string } }) => uses.find((use) => use.instanceKey === where.instanceKey) ?? null,
      count: async ({ where }: { where: { userId: string; actionKey: string; occurredAt: { gte: Date; lt: Date } } }) =>
        uses.filter((use) => use.userId === where.userId && use.actionKey === where.actionKey && use.occurredAt >= where.occurredAt.gte && use.occurredAt < where.occurredAt.lt).length,
      aggregate: async ({ where }: { where: { userId: string; occurredAt: { gte: Date; lt: Date } } }) => ({
        _sum: { chargedAmount: uses.filter((use) => use.userId === where.userId && use.occurredAt >= where.occurredAt.gte && use.occurredAt < where.occurredAt.lt).reduce((total, use) => total + use.chargedAmount, 0) },
      }),
      create: async ({ data }: { data: Omit<Use, 'id'> & { refundDueAt?: Date | null; movementId?: string | null } }) => {
        const row = { ...data, refundDueAt: data.refundDueAt ?? null, movementId: data.movementId ?? null, id: `use-${(counter += 1)}` } as Use;
        uses.push(row);
        return row;
      },
    },
    currencySetting: { findUnique: async ({ where }: { where: { key: string } }) => (settings[where.key] === undefined ? null : { key: where.key, value: settings[where.key] }) },
    currencyMovement: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => movements.find((movement) => movement.idempotencyKey === where.idempotencyKey) ?? null,
      findFirst: async ({ where }: { where: { accountId: string } }) => [...movements].filter((movement) => movement.accountId === where.accountId).sort((a, b) => b.sequence - a.sequence)[0] ?? null,
      create: async ({ data }: { data: Omit<Movement, 'id' | 'createdAt'> }) => {
        const row = { ...data, id: `mov-${(counter += 1)}`, createdAt: new Date() } as Movement;
        movements.push(row);
        return row;
      },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, uses, movements };
}

const NOW = new Date('2026-10-15T12:00:00.000Z');
const actions = new CurrencyActionService(() => NOW);
const company = { actor: 'COMPANY' as const, userId: 'owner-1', subjectId: 'company-1' };
const worker = { actor: 'WORKER' as const, userId: 'worker-1', subjectId: 'worker-1' };
const charge = (tx: Prisma.TransactionClient, who: typeof company | typeof worker, actionKey: string, instanceKey: string) =>
  actions.charge(tx, { ...who, actionKey, instanceKey, reason: 'Prueba' });

describe('Lima calendar windows', () => {
  it('computes the day window in UTC-5 and rolls over at 05:00 UTC', () => {
    expect(limaDayWindow(new Date('2026-10-15T04:59:59.999Z'))).toEqual({ start: new Date('2026-10-14T05:00:00.000Z'), end: new Date('2026-10-15T05:00:00.000Z') });
    expect(limaDayWindow(new Date('2026-10-15T05:00:00.000Z'))).toEqual({ start: new Date('2026-10-15T05:00:00.000Z'), end: new Date('2026-10-16T05:00:00.000Z') });
  });

  it('computes month windows at month, year and leap-year boundaries', () => {
    expect(limaMonthWindow(new Date('2026-10-01T04:59:59.000Z'))).toEqual({ start: new Date('2026-09-01T05:00:00.000Z'), end: new Date('2026-10-01T05:00:00.000Z') });
    expect(limaMonthWindow(new Date('2026-10-01T05:00:00.000Z'))).toEqual({ start: new Date('2026-10-01T05:00:00.000Z'), end: new Date('2026-11-01T05:00:00.000Z') });
    expect(limaMonthWindow(new Date('2027-01-01T04:59:59.000Z')).end).toEqual(new Date('2027-01-01T05:00:00.000Z'));
    expect(limaMonthWindow(new Date('2028-03-01T04:59:59.000Z'))).toEqual({ start: new Date('2028-02-01T05:00:00.000Z'), end: new Date('2028-03-01T05:00:00.000Z') });
  });
});

describe('CurrencyActionService.charge', () => {
  it('does not charge inside the free monthly quota but records the use, then charges the catalog cost beyond it', async () => {
    const { tx, uses, movements } = fakeTx({ balance: 100 });
    for (let index = 0; index < 3; index += 1) {
      expect(await charge(tx, company, 'JOB_PUBLISH_EXTRA', `job-publish:p${index}`)).toMatchObject({ amount: 0, usedFreeQuota: true, idempotent: false, movementId: null });
    }
    expect(movements).toHaveLength(1); // solo el saldo inicial
    expect(uses.map((use) => use.chargedAmount)).toEqual([0, 0, 0]);
    const paid = await charge(tx, company, 'JOB_PUBLISH_EXTRA', 'job-publish:p3');
    expect(paid).toMatchObject({ amount: 10, usedFreeQuota: false, idempotent: false, balanceAfter: 90 });
    expect(movements.at(-1)).toMatchObject({ quantity: -10, action: 'ACTION_CHARGE', actionKey: 'JOB_PUBLISH_EXTRA', idempotencyKey: 'charge:job-publish:p3' });
    expect(uses.at(-1)).toMatchObject({ chargedAmount: 10, movementId: movements.at(-1)!.id, refundDueAt: null });
  });

  it('is idempotent per instance: repeating a charge debits nothing and writes nothing', async () => {
    const { tx, uses, movements } = fakeTx({ balance: 100 });
    for (let index = 0; index < 10; index += 1) await charge(tx, worker, 'APPLICATION_EXTRA', `job-apply:p${index}:worker-1`);
    const first = await charge(tx, worker, 'APPLICATION_EXTRA', 'job-apply:p10:worker-1');
    expect(first.amount).toBe(5);
    const useCount = uses.length;
    const movementCount = movements.length;
    const again = await charge(tx, worker, 'APPLICATION_EXTRA', 'job-apply:p10:worker-1');
    expect(again).toMatchObject({ amount: 0, idempotent: true, movementId: first.movementId });
    expect([uses.length, movements.length]).toEqual([useCount, movementCount]);
    // Una clave de otro usuario con la misma instancia es un conflicto, nunca un cobro compartido.
    await expect(charge(tx, { ...worker, userId: 'worker-2', subjectId: 'worker-2' }, 'APPLICATION_EXTRA', 'job-apply:p10:worker-1')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', statusCode: 409 });
  });

  it('freezes the refund deadline from the catalog window only for refundable actions', async () => {
    const { tx, uses } = fakeTx({ balance: 100 });
    for (let index = 0; index < 10; index += 1) await charge(tx, worker, 'APPLICATION_EXTRA', `job-apply:q${index}:worker-1`);
    await charge(tx, worker, 'APPLICATION_EXTRA', 'job-apply:extra:worker-1');
    await charge(tx, worker, 'APPLICATION_PRIORITY', 'job-priority:app-1');
    await charge(tx, worker, 'PROFILE_HIGHLIGHT' as never, 'x');
    const extra = uses.find((use) => use.instanceKey === 'job-apply:extra:worker-1')!;
    expect(extra.refundDueAt).toEqual(new Date(NOW.getTime() + 72 * 3_600_000));
    expect(uses.find((use) => use.instanceKey === 'job-priority:app-1')!.refundDueAt).toEqual(new Date(NOW.getTime() + 72 * 3_600_000));
    expect(uses.find((use) => use.instanceKey === 'x')?.refundDueAt ?? null).toBeNull();
  });

  it('answers 409 INSUFFICIENT_CURRENCY with cost and balance and leaves no use behind', async () => {
    const { tx, uses, movements } = fakeTx({ balance: 7 });
    await expect(charge(tx, company, 'JOB_HIGHLIGHT', 'job-highlight:p1:1')).rejects.toMatchObject({ code: 'INSUFFICIENT_CURRENCY', statusCode: 409, details: { cost: 10, balance: 7 } });
    expect(uses).toHaveLength(0);
    expect(movements).toHaveLength(1);
  });

  it('enforces the daily cap by actor with its own configurable value and never on free usage', async () => {
    const { tx, uses } = fakeTx({ balance: 1_000, settings: { DAILY_SPEND_CAP_COMPANY: 25, DAILY_SPEND_CAP_WORKER: 5 } });
    await charge(tx, company, 'JOB_HIGHLIGHT', 'h1');
    await charge(tx, company, 'JOB_HIGHLIGHT', 'h2');
    await expect(charge(tx, company, 'JOB_HIGHLIGHT', 'h3')).rejects.toMatchObject({ code: 'DAILY_SPEND_CAP_REACHED', statusCode: 409, details: { cost: 10, dailyCap: 25, spentToday: 20 } });
    // Cinco monedas cabrian; diez no: el tope exacto se respeta (suma <= tope).
    await charge(tx, company, 'TALENT_INVITE', 'i1');
    await expect(charge(tx, company, 'TALENT_INVITE', 'i2')).rejects.toBeInstanceOf(CurrencyError);
    expect(uses.reduce((total, use) => total + use.chargedAmount, 0)).toBe(25);
    // El tope del trabajador es independiente y las acciones dentro de cuota no lo consumen.
    for (let index = 0; index < 10; index += 1) await charge(tx, worker, 'APPLICATION_EXTRA', `free${index}`);
    await expect(charge(tx, worker, 'APPLICATION_PRIORITY', 'p1')).rejects.toMatchObject({ code: 'DAILY_SPEND_CAP_REACHED', details: { dailyCap: 5 } });
    expect(await charge(tx, worker, 'APPLICATION_EXTRA', 'extra1')).toMatchObject({ amount: 5 });
  });

  it('counts the daily cap per Lima day, so spending resets at 05:00 UTC', async () => {
    const { tx, uses } = fakeTx({ balance: 1_000, settings: { DAILY_SPEND_CAP_COMPANY: 10 } });
    const clockAt = (iso: string) => new CurrencyActionService(() => new Date(iso));
    const request = (service: CurrencyActionService, key: string) => service.charge(tx, { ...company, actionKey: 'JOB_HIGHLIGHT', instanceKey: key, reason: 'Prueba' });
    await request(clockAt('2026-10-15T04:59:00.000Z'), 'late');
    await expect(request(clockAt('2026-10-15T04:59:30.000Z'), 'late2')).rejects.toMatchObject({ code: 'DAILY_SPEND_CAP_REACHED' });
    await request(clockAt('2026-10-15T05:00:00.000Z'), 'next-day');
    expect(uses).toHaveLength(2);
  });

  it('treats an inactive or missing catalog entry as a free action without recording a use', async () => {
    const inactive = DEFAULT_CURRENCY_CATALOG.map((entry) => ({ ...entry, active: entry.actionKey !== 'JOB_HIGHLIGHT' }));
    const { tx, uses, movements } = fakeTx({ catalog: inactive, balance: 0 });
    expect(await charge(tx, company, 'JOB_HIGHLIGHT', 'free-highlight')).toMatchObject({ amount: 0, idempotent: false, usedFreeQuota: false });
    expect(await charge(tx, company, 'UNKNOWN_ACTION', 'unknown')).toMatchObject({ amount: 0 });
    expect(uses).toHaveLength(0);
    expect(movements).toHaveLength(0);
  });

  it('quotes cost, quota, balance and cap without writing anything', async () => {
    const { tx, uses, movements } = fakeTx({ balance: 8 });
    for (let index = 0; index < 3; index += 1) await charge(tx, company, 'JOB_PUBLISH_EXTRA', `job-publish:z${index}`);
    const before = [uses.length, movements.length];
    const quote = await actions.quote(tx, company, 'JOB_PUBLISH_EXTRA', instanceKeys.jobPublish('new'));
    expect(quote).toMatchObject({ cost: 10, reason: 'CHARGE', sufficientBalance: false, canExecute: false, balance: 8, freeQuota: { remaining: 0 }, dailyCap: { limit: 200, spentToday: 0, remaining: 200 } });
    expect(await actions.quote(tx, company, 'JOB_PUBLISH_EXTRA', 'job-publish:z1')).toMatchObject({ cost: 0, reason: 'ALREADY_REGISTERED', canExecute: true });
    expect(await actions.quote(tx, company, 'WELCOME_BONUS', null)).toMatchObject({ cost: 0, active: false, reason: 'FREE_ACTION' });
    expect([uses.length, movements.length]).toEqual(before);
  });
});

describe('welcome bonus (grantReward)', () => {
  it('grants the active catalog reward once and ignores costs and inactive rewards', async () => {
    const { tx, movements } = fakeTx();
    const first = await actions.grantReward(tx, worker, 'WELCOME_BONUS', 'welcome-bonus:WORKER:worker-1', 'Bono de bienvenida');
    expect(first).toMatchObject({ granted: true, idempotent: false, amount: 50 });
    expect(movements.at(-1)).toMatchObject({ quantity: 50, action: 'REWARD', actionKey: 'WELCOME_BONUS' });
    expect(await actions.grantReward(tx, worker, 'WELCOME_BONUS', 'welcome-bonus:WORKER:worker-1', 'Bono de bienvenida')).toMatchObject({ granted: true, idempotent: true });
    expect(movements).toHaveLength(1);
    expect(await actions.grantReward(tx, worker, 'JOB_HIGHLIGHT', 'x', 'No es un premio')).toMatchObject({ granted: false });
    const inactive = fakeTx({ catalog: DEFAULT_CURRENCY_CATALOG.map((entry) => ({ ...entry, active: false })) });
    expect(await actions.grantReward(inactive.tx, worker, 'WELCOME_BONUS', 'k', 'Bono')).toMatchObject({ granted: false });
    expect(inactive.movements).toHaveLength(0);
  });
});

describe('currency settings and scheduler configuration', () => {
  it('keeps the provisional defaults documented in the product notes', () => {
    expect(DEFAULT_CURRENCY_SETTINGS).toEqual({ DAILY_SPEND_CAP_WORKER: 200, DAILY_SPEND_CAP_COMPANY: 200, JOB_HIGHLIGHT_DURATION_HOURS: 168 });
  });

  it('rejects out-of-range setting values before touching the database', async () => {
    const service = new CurrencySettingsService({} as never);
    for (const value of [0, -1, 1.5, 1_000_001]) {
      await expect(service.update('DAILY_SPEND_CAP_COMPANY', value, 'Motivo valido', 'admin-1')).rejects.toMatchObject({ code: 'INVALID_SETTING_VALUE', statusCode: 400 });
    }
    await expect(service.update('JOB_HIGHLIGHT_DURATION_HOURS', 8_761, 'Motivo valido', 'admin-1')).rejects.toMatchObject({ code: 'INVALID_SETTING_VALUE' });
  });

  it('resolves the refund interval from the environment and disables it under tests or with 0/off', () => {
    expect(refundSchedulerIntervalMs({})).toBe(300_000);
    expect(refundSchedulerIntervalMs({ CURRENCY_REFUND_INTERVAL_MS: '60000' })).toBe(60_000);
    expect(refundSchedulerIntervalMs({ CURRENCY_REFUND_INTERVAL_MS: '0' })).toBeNull();
    expect(refundSchedulerIntervalMs({ CURRENCY_REFUND_INTERVAL_MS: 'off' })).toBeNull();
    expect(refundSchedulerIntervalMs({ CURRENCY_REFUND_INTERVAL_MS: 'false' })).toBeNull();
    expect(refundSchedulerIntervalMs({ VITEST: 'true' })).toBeNull();
    expect(refundSchedulerIntervalMs({ NODE_ENV: 'test' })).toBeNull();
    expect(refundSchedulerIntervalMs({ CURRENCY_REFUND_INTERVAL_MS: '10' })).toBe(300_000);
    expect(refundSchedulerIntervalMs({ CURRENCY_REFUND_INTERVAL_MS: 'abc' })).toBe(300_000);
  });
});

describe('job re-application and priority rules', () => {
  it('lets only a withdrawn application be reopened, never a company rejection', () => {
    expect(canReopenApplication('WITHDRAWN')).toBe(true);
    for (const status of ['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'HIRED', 'REJECTED'] as const) expect(canReopenApplication(status)).toBe(false);
    // La reactivacion es una operacion propia: la maquina de estados sigue sin salidas desde WITHDRAWN.
    expect(canTransition('WITHDRAWN', 'APPLIED', 'WORKER')).toBe(false);
  });

  it('allows priority only while the company has not moved the application', () => {
    expect(canPrioritizeApplication('APPLIED')).toBe(true);
    for (const status of ['SHORTLISTED', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'HIRED', 'REJECTED', 'WITHDRAWN'] as const) expect(canPrioritizeApplication(status)).toBe(false);
  });
});
