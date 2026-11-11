import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_COMMISSION_BPS,
  DEFAULT_TAX_BPS,
  buildPaymentAmounts,
  getPlatformSettings,
} from '../src/modules/payments/payment-amounts.js';

// Tabla de redondeo: `floor((numerator*bps + 5000) / 10000)`, "la mitad hacia
// arriba" con enteros. Calculada de forma independiente (no reutiliza la
// implementación) para los montos y puntos básicos que pide el alcance.
const ROUNDING_TABLE: { amount: number; bps: number; expected: number }[] = [
  { amount: 0, bps: 0, expected: 0 },
  { amount: 0, bps: 1, expected: 0 },
  { amount: 0, bps: 1000, expected: 0 },
  { amount: 0, bps: 1800, expected: 0 },
  { amount: 0, bps: 5000, expected: 0 },
  { amount: 1, bps: 0, expected: 0 },
  { amount: 1, bps: 1, expected: 0 },
  { amount: 1, bps: 1000, expected: 0 },
  { amount: 1, bps: 1800, expected: 0 },
  { amount: 1, bps: 5000, expected: 1 },
  { amount: 5, bps: 0, expected: 0 },
  { amount: 5, bps: 1, expected: 0 },
  { amount: 5, bps: 1000, expected: 1 },
  { amount: 5, bps: 1800, expected: 1 },
  { amount: 5, bps: 5000, expected: 3 },
  { amount: 9999, bps: 0, expected: 0 },
  { amount: 9999, bps: 1, expected: 1 },
  { amount: 9999, bps: 1000, expected: 1000 },
  { amount: 9999, bps: 1800, expected: 1800 },
  { amount: 9999, bps: 5000, expected: 5000 },
  { amount: 10000, bps: 0, expected: 0 },
  { amount: 10000, bps: 1, expected: 1 },
  { amount: 10000, bps: 1000, expected: 1000 },
  { amount: 10000, bps: 1800, expected: 1800 },
  { amount: 10000, bps: 5000, expected: 5000 },
  { amount: 12345, bps: 0, expected: 0 },
  { amount: 12345, bps: 1, expected: 1 },
  { amount: 12345, bps: 1000, expected: 1235 },
  { amount: 12345, bps: 1800, expected: 2222 },
  { amount: 12345, bps: 5000, expected: 6173 },
];

describe('buildPaymentAmounts', () => {
  it.each(ROUNDING_TABLE)(
    'redondea la comisión de S/$amount céntimos al $bps bps a $expected céntimos',
    ({ amount, bps, expected }) => {
      // `taxBps: 0` aísla `commissionCents` del cálculo del IGV.
      const result = buildPaymentAmounts(amount, bps, 0);
      expect(result.commissionCents).toBe(expected);
      expect(result.taxCents).toBe(0);
      expect(result.totalCents).toBe(amount + expected);
    },
  );

  it.each(ROUNDING_TABLE)(
    'redondea el IGV sobre una comisión de $amount céntimos al $bps bps a $expected céntimos',
    ({ amount, bps, expected }) => {
      // `commissionBps: 10000` (100%) hace que `commissionCents === amount`
      // exactamente, para poder reusar la misma tabla sobre `taxCents`.
      const result = buildPaymentAmounts(amount, 10000, bps);
      expect(result.commissionCents).toBe(amount);
      expect(result.taxCents).toBe(expected);
      expect(result.totalCents).toBe(amount + amount + expected);
    },
  );

  it('reproduce el ejemplo del plan: S/100 + 10% comisión + 18% IGV = S/111.80', () => {
    expect(buildPaymentAmounts(10000, 1000, 1800)).toEqual({
      amountCents: 10000,
      commissionBps: 1000,
      commissionCents: 1000,
      taxBps: 1800,
      taxCents: 180,
      totalCents: 11180,
    });
  });

  it('nunca descuenta del monto del trabajador: amountCents sale intacto', () => {
    const result = buildPaymentAmounts(55555, 1000, 1800);
    expect(result.amountCents).toBe(55555);
  });

  it.each([
    [-1, 1000, 1800],
    [10000, -1, 1800],
    [10000, 1000, -1],
    [1.5, 1000, 1800],
    [10000, 1000.5, 1800],
    [10000, 1000, 1800.5],
  ])('rechaza entradas no enteras o negativas (%p, %p, %p)', (amount, bps, tax) => {
    expect(() => buildPaymentAmounts(amount, bps, tax)).toThrow(RangeError);
  });
});

describe('getPlatformSettings', () => {
  it('devuelve la fila global si existe', async () => {
    const findUnique = vi.fn(async () => ({ commissionBps: 1200, taxBps: 1800 }));
    const settings = await getPlatformSettings({ platformSettings: { findUnique } });
    expect(settings).toEqual({ commissionBps: 1200, taxBps: 1800 });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'global' } });
  });

  it('usa los valores por defecto como defensa si la fila global no existe', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const findUnique = vi.fn(async () => null);
    const settings = await getPlatformSettings({ platformSettings: { findUnique } });
    expect(settings).toEqual({ commissionBps: DEFAULT_COMMISSION_BPS, taxBps: DEFAULT_TAX_BPS });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
