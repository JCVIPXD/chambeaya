import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CURRENCY_CATALOG } from '../src/modules/currency/currency.catalog.js';
import { generateReferralCode, normalizeReferralCode, REFERRAL_CODE_LENGTH } from '../src/modules/currency/currency.referrals.js';
import { CurrencyRewardService, rewardCapSettings, rewardFactKey } from '../src/modules/currency/currency.rewards.js';
import { CURRENCY_SETTING_KEYS, CURRENCY_SETTING_LIMITS, DEFAULT_CURRENCY_SETTINGS } from '../src/modules/currency/currency.settings.js';
import { isProfileComplete, missingProfileSections, PROFILE_BIO_MIN_LENGTH, PROFILE_COMPLETE_SECTIONS, PROFILE_HEADLINE_MIN_LENGTH } from '../src/modules/talent/profile-completeness.js';

import type { ProfileCompletenessInput } from '../src/modules/talent/profile-completeness.js';

const complete: ProfileCompletenessInput = {
  headline: 'Barista con 3 años de experiencia',
  bio: 'Trabajo en cafeterías desde hace años, con experiencia en caja y atención al público.',
  district: 'Miraflores',
  availabilityDays: ['MONDAY'],
  availabilityPeriods: ['MORNING'],
  specialtyCount: 1,
  experienceCount: 1,
  hasCv: true,
  hasPhoto: true,
};

describe('profile completeness criterion (PROFILE_COMPLETE)', () => {
  it('is complete only when every mandatory section is present', () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(missingProfileSections(complete)).toEqual([]);
    const cases: Array<[string, Partial<ProfileCompletenessInput>]> = [
      ['headline', { headline: 'Corto' }],
      ['headline', { headline: null }],
      ['bio', { bio: 'x'.repeat(PROFILE_BIO_MIN_LENGTH - 1) }],
      ['district', { district: '   ' }],
      ['availability', { availabilityDays: [] }],
      ['availability', { availabilityPeriods: [] }],
      ['specialties', { specialtyCount: 0 }],
      ['experience', { experienceCount: 0 }],
      ['cv', { hasCv: false }],
      ['photo', { hasPhoto: false }],
    ];
    for (const [section, change] of cases) {
      expect(missingProfileSections({ ...complete, ...change })).toEqual([section]);
      expect(isProfileComplete({ ...complete, ...change })).toBe(false);
    }
  });

  it('counts the minimum lengths exactly and ignores surrounding blanks', () => {
    expect(missingProfileSections({ ...complete, headline: ` ${'x'.repeat(PROFILE_HEADLINE_MIN_LENGTH)} ` })).toEqual([]);
    expect(missingProfileSections({ ...complete, headline: 'x'.repeat(PROFILE_HEADLINE_MIN_LENGTH - 1) })).toEqual(['headline']);
    expect(missingProfileSections({ ...complete, bio: 'x'.repeat(PROFILE_BIO_MIN_LENGTH) })).toEqual([]);
  });

  it('lists all sections of an empty profile, in the documented order', () => {
    const empty = { headline: null, bio: null, district: null, availabilityDays: [], availabilityPeriods: [], specialtyCount: 0, experienceCount: 0, hasCv: false, hasPhoto: false };
    expect(missingProfileSections(empty)).toEqual([...PROFILE_COMPLETE_SECTIONS]);
  });
});

describe('referral codes', () => {
  it('generates unambiguous codes of the documented length that normalize to themselves', () => {
    for (let index = 0; index < 50; index += 1) {
      const code = generateReferralCode();
      expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
      expect(normalizeReferralCode(code)).toBe(code);
    }
  });

  it('normalizes case and blanks and rejects anything that cannot be a code', () => {
    expect(normalizeReferralCode('  abcd2345 ')).toBe('ABCD2345');
    for (const bad of ['', 'ABC', 'ABCD234', 'ABCD23456', 'ABCD234O', 'ABCD234I', 'ABCD-234', 12345678, null, undefined, {}]) {
      expect(normalizeReferralCode(bad)).toBeNull();
    }
  });
});

describe('reward configuration', () => {
  it('has a default and a limit for every editable setting, within the database CHECK (> 0)', () => {
    for (const key of CURRENCY_SETTING_KEYS) {
      expect(DEFAULT_CURRENCY_SETTINGS[key]).toBeGreaterThan(0);
      const limits = CURRENCY_SETTING_LIMITS[key];
      expect(limits.min).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_CURRENCY_SETTINGS[key]).toBeGreaterThanOrEqual(limits.min);
      expect(DEFAULT_CURRENCY_SETTINGS[key]).toBeLessThanOrEqual(limits.max);
    }
  });

  it('keeps each reward cap able to hold the biggest single reward of its actor', () => {
    for (const actor of ['WORKER', 'COMPANY'] as const) {
      const rewards = DEFAULT_CURRENCY_CATALOG.filter((entry) => entry.actor === actor && entry.kind === 'REWARD' && entry.actionKey !== 'WELCOME_BONUS');
      const biggest = Math.max(...rewards.map((entry) => entry.amount));
      const caps = rewardCapSettings(actor);
      expect(DEFAULT_CURRENCY_SETTINGS[caps.daily]).toBeGreaterThanOrEqual(biggest);
      expect(DEFAULT_CURRENCY_SETTINGS[caps.monthly]).toBeGreaterThanOrEqual(DEFAULT_CURRENCY_SETTINGS[caps.daily]);
    }
  });

  it('builds the fact key from the action and the fact', () => {
    expect(rewardFactKey('PROFILE_COMPLETE', 'user-1')).toBe('PROFILE_COMPLETE:user-1');
  });
});

describe('CurrencyRewardService.tryGrant (savepoint around the reward)', () => {
  const request = {
    actor: 'WORKER' as const, userId: 'u1', subjectId: 'u1', actionKey: 'PROFILE_COMPLETE', fact: 'u1',
    related: { type: 'WorkerTalentProfile', id: 'p1' }, reason: 'Perfil completo',
  };

  function fakeTx(grantError?: unknown) {
    const statements: string[] = [];
    const tx = {
      $executeRawUnsafe: vi.fn(async (sql: string) => { statements.push(sql); }),
      currencyCatalogEntry: { findUnique: vi.fn(async () => { if (grantError) throw grantError; return null; }) },
    };
    return { tx, statements };
  }

  it('releases the savepoint when the reward does not fail (a skipped reward is not an error)', async () => {
    const { tx, statements } = fakeTx();
    const outcome = await new CurrencyRewardService().tryGrant(tx as never, request);
    expect(outcome).toEqual({ granted: false, reason: 'NOT_IN_CATALOG' });
    expect(statements).toEqual(['SAVEPOINT reward_attempt', 'RELEASE SAVEPOINT reward_attempt']);
  });

  it('rolls back only the reward and reports ERROR for a non-retryable failure, keeping the fact', async () => {
    const { tx, statements } = fakeTx(new Error('boom'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await new CurrencyRewardService().tryGrant(tx as never, request);
    expect(outcome).toEqual({ granted: false, reason: 'ERROR' });
    expect(statements).toEqual(['SAVEPOINT reward_attempt', 'ROLLBACK TO SAVEPOINT reward_attempt']);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('propagates serialization failures and deadlocks so the whole transaction (fact and reward) is retried', async () => {
    const serialization = Object.assign(new Error('write conflict'), { code: 'P2034' });
    const { tx, statements } = fakeTx(serialization);
    await expect(new CurrencyRewardService().tryGrant(tx as never, request)).rejects.toBe(serialization);
    expect(statements).toEqual(['SAVEPOINT reward_attempt']);
  });
});
