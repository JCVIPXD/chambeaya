import { describe, expect, it } from 'vitest';

import { temporaryShiftsEnabled } from '../src/modules/temporary-shifts.js';
import { virtualCurrencyName } from '../src/modules/currency/currency.config.js';

// `tests/setup.ts` fuerza TEMPORARY_SHIFTS_ENABLED=true para la cobertura
// histórica; aquí se pasa un `env` explícito para comprobar el valor por
// defecto real (apagado) sin depender de ese setup.
describe('temporaryShiftsEnabled', () => {
  it('is off when the variable is absent, empty or not the literal "true"', () => {
    expect(temporaryShiftsEnabled({})).toBe(false);
    for (const value of ['', 'false', 'TRUE', 'True', '1', 'yes', ' true', 'true ']) {
      expect(temporaryShiftsEnabled({ TEMPORARY_SHIFTS_ENABLED: value })).toBe(false);
    }
  });

  it('turns on only with the literal "true"', () => {
    expect(temporaryShiftsEnabled({ TEMPORARY_SHIFTS_ENABLED: 'true' })).toBe(true);
  });
});

describe('virtualCurrencyName', () => {
  it('defaults to Chambitas and honours a valid configured name', () => {
    expect(virtualCurrencyName({})).toBe('Chambitas');
    expect(virtualCurrencyName({ VIRTUAL_CURRENCY_NAME: '  Chispas ' })).toBe('Chispas');
    expect(virtualCurrencyName({ VIRTUAL_CURRENCY_NAME: 'x'.repeat(61) })).toBe('Chambitas');
  });
});
