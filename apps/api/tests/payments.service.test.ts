import { afterEach, describe, expect, it } from 'vitest';

import {
  activePaymentProviderName,
  assertPaymentConfig,
  PaymentConfigError,
  paymentCheckoutTtlMinutes,
  resetPaymentProviderCacheForTests,
  resolvePaymentProvider,
  UnknownPaymentProviderError,
} from '../src/modules/payments/payments.service.js';

const WEBHOOK_SECRET = 'x'.repeat(40);
const SHORT_SECRET = 'x'.repeat(31);

afterEach(() => {
  resetPaymentProviderCacheForTests();
});

describe('activePaymentProviderName / resolvePaymentProvider', () => {
  it('defaults to "manual" when PAYMENT_PROVIDER is unset', () => {
    expect(activePaymentProviderName({} as NodeJS.ProcessEnv)).toBe('manual');
  });

  it('accepts "simulated"', () => {
    expect(activePaymentProviderName({ PAYMENT_PROVIDER: 'simulated' } as NodeJS.ProcessEnv)).toBe('simulated');
  });

  it('rejects an unknown provider name', () => {
    expect(() => activePaymentProviderName({ PAYMENT_PROVIDER: 'mercadopago' } as NodeJS.ProcessEnv)).toThrow(
      UnknownPaymentProviderError,
    );
  });

  it('resolves a ManualPaymentProvider by default', () => {
    const provider = resolvePaymentProvider({} as NodeJS.ProcessEnv);
    expect(provider.name).toBe('manual');
  });

  it('resolves a SimulatedPaymentProvider when configured', () => {
    const provider = resolvePaymentProvider({ PAYMENT_PROVIDER: 'simulated' } as NodeJS.ProcessEnv);
    expect(provider.name).toBe('simulated');
  });
});

describe('paymentCheckoutTtlMinutes', () => {
  it('defaults to 30 minutes', () => {
    expect(paymentCheckoutTtlMinutes({} as NodeJS.ProcessEnv)).toBe(30);
  });

  it('reads a configured positive value', () => {
    expect(paymentCheckoutTtlMinutes({ PAYMENT_CHECKOUT_TTL_MINUTES: '45' } as NodeJS.ProcessEnv)).toBe(45);
  });

  it('falls back to the default for a non-positive or invalid value', () => {
    expect(paymentCheckoutTtlMinutes({ PAYMENT_CHECKOUT_TTL_MINUTES: '0' } as NodeJS.ProcessEnv)).toBe(30);
    expect(paymentCheckoutTtlMinutes({ PAYMENT_CHECKOUT_TTL_MINUTES: 'abc' } as NodeJS.ProcessEnv)).toBe(30);
  });
});

describe('assertPaymentConfig (guardas de arranque)', () => {
  it('passes for "manual" without any webhook secret', () => {
    expect(() => assertPaymentConfig({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('fails for an unknown PAYMENT_PROVIDER value', () => {
    expect(() => assertPaymentConfig({ PAYMENT_PROVIDER: 'nope' } as NodeJS.ProcessEnv)).toThrow(PaymentConfigError);
  });

  it('fails for "simulated" without PAYMENT_WEBHOOK_SECRET', () => {
    expect(() => assertPaymentConfig({ PAYMENT_PROVIDER: 'simulated' } as NodeJS.ProcessEnv)).toThrow(PaymentConfigError);
  });

  it('fails for "simulated" with a webhook secret shorter than 32 chars', () => {
    expect(() =>
      assertPaymentConfig({ PAYMENT_PROVIDER: 'simulated', PAYMENT_WEBHOOK_SECRET: SHORT_SECRET } as NodeJS.ProcessEnv),
    ).toThrow(PaymentConfigError);
  });

  it('passes for "simulated" with a valid webhook secret outside production', () => {
    expect(() =>
      assertPaymentConfig({
        PAYMENT_PROVIDER: 'simulated',
        PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
        NODE_ENV: 'development',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('fails for "simulated" in production without PAYMENT_SIMULATION_ALLOWED=true', () => {
    expect(() =>
      assertPaymentConfig({
        PAYMENT_PROVIDER: 'simulated',
        PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toThrow(PaymentConfigError);
  });

  it('passes for "simulated" in production with PAYMENT_SIMULATION_ALLOWED=true', () => {
    expect(() =>
      assertPaymentConfig({
        PAYMENT_PROVIDER: 'simulated',
        PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
        NODE_ENV: 'production',
        PAYMENT_SIMULATION_ALLOWED: 'true',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('passes for "manual" in production regardless of PAYMENT_SIMULATION_ALLOWED', () => {
    expect(() => assertPaymentConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
