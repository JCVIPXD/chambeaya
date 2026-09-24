import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  SERIALIZABLE_BACKOFF_BASE_MS,
  SERIALIZABLE_MAX_ATTEMPTS,
  isRetryableTransactionError,
  withSerializableRetry,
} from '../src/modules/operations/serializable-retry.js';

// `withSerializableRetry` reintenta los conflictos que PostgreSQL resuelve
// abortando la transacción sin efectos (`P2034` y, desde CN-20260923-013, el
// interbloqueo `40P01` en sus tres formas de Prisma) y, desde CN-20260923-012,
// con espera aleatoria entre intentos y 6 intentos: reintentar de inmediato
// hacía que las transacciones que chocaron volvieran a chocar entre sí y, con 4
// o más simultáneas, agotaba los 3 intentos anteriores.
const conflict = () => Object.assign(new Error('write conflict'), { code: 'P2034' });

// Las formas reales con que Prisma 6 entrega un interbloqueo (medidas contra
// PostgreSQL 16, CN-20260923-013): `$queryRaw` -> `P2010` con `meta.code`;
// `updateMany`/`update`/`create` -> error sin `code` cuyo mensaje trae el SQLSTATE.
const deadlockFromQueryRaw = () => new Prisma.PrismaClientKnownRequestError(
  'Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected`',
  { code: 'P2010', clientVersion: 'test', meta: { code: '40P01', message: 'ERROR: deadlock detected' } },
);
const deadlockFromWrite = () => new Prisma.PrismaClientUnknownRequestError(
  'Invalid `tx.shiftApplication.updateMany()` invocation\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })',
  { clientVersion: 'test' },
);

describe('withSerializableRetry', () => {
  it('returns the result of the first attempt without waiting', async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi.fn(async () => 'listo');

    await expect(withSerializableRetry(operation, SERIALIZABLE_MAX_ATTEMPTS, { sleep })).resolves.toBe('listo');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a serialization conflict and returns the result of the attempt that succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts += 1;
      if (attempts < 4) throw conflict();
      return attempts;
    });

    await expect(withSerializableRetry(operation, SERIALIZABLE_MAX_ATTEMPTS, { sleep })).resolves.toBe(4);
    expect(operation).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('gives up after the maximum number of attempts and propagates the last conflict', async () => {
    const sleep = vi.fn(async () => undefined);
    const last = conflict();
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts += 1;
      throw attempts === SERIALIZABLE_MAX_ATTEMPTS ? last : conflict();
    });

    await expect(withSerializableRetry(operation, SERIALIZABLE_MAX_ATTEMPTS, { sleep })).rejects.toBe(last);
    expect(SERIALIZABLE_MAX_ATTEMPTS).toBe(6);
    expect(operation).toHaveBeenCalledTimes(SERIALIZABLE_MAX_ATTEMPTS);
    // No se espera tras el último intento fallido.
    expect(sleep).toHaveBeenCalledTimes(SERIALIZABLE_MAX_ATTEMPTS - 1);
  });

  it('waits a random time that grows exponentially, within [0, base * 2^attempt) after each failed attempt', async () => {
    const delays: number[] = [];
    const sleep = async (milliseconds: number) => { delays.push(milliseconds); };

    // Aleatoriedad en el punto medio: la espera es la mitad del tope.
    await expect(withSerializableRetry(async () => { throw conflict(); }, SERIALIZABLE_MAX_ATTEMPTS, { sleep, random: () => 0.5 }))
      .rejects.toMatchObject({ code: 'P2034' });
    expect(delays).toEqual([1, 2, 3, 4, 5].map((attempt) => 0.5 * SERIALIZABLE_BACKOFF_BASE_MS * 2 ** attempt));

    // Aleatoriedad casi 1: nunca supera el tope; con 0: espera cero (el jitter es total).
    delays.length = 0;
    await expect(withSerializableRetry(async () => { throw conflict(); }, 4, { sleep, random: () => 0.999 })).rejects.toMatchObject({ code: 'P2034' });
    expect(delays).toHaveLength(3);
    delays.forEach((delay, index) => {
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(SERIALIZABLE_BACKOFF_BASE_MS * 2 ** (index + 1));
    });
    delays.length = 0;
    await expect(withSerializableRetry(async () => { throw conflict(); }, 3, { sleep, random: () => 0 })).rejects.toMatchObject({ code: 'P2034' });
    expect(delays).toEqual([0, 0]);
  });

  it('spreads concurrent retries in time instead of retrying them all at once', async () => {
    // Con la espera real (jitter), las esperas de operaciones que chocaron a la vez difieren.
    const delays = new Set<number>();
    const sleep = async (milliseconds: number) => { delays.add(milliseconds); };
    await Promise.all(Array.from({ length: 10 }, () => withSerializableRetry(async () => { throw conflict(); }, 2, { sleep }).catch(() => undefined)));

    expect(delays.size).toBeGreaterThan(1);
  });

  it('retries a deadlock (40P01) in both Prisma shapes and returns the result of the attempt that succeeds', async () => {
    for (const deadlock of [deadlockFromQueryRaw, deadlockFromWrite]) {
      const sleep = vi.fn(async () => undefined);
      let attempts = 0;
      const operation = vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) throw deadlock();
        return 'listo';
      });

      await expect(withSerializableRetry(operation, SERIALIZABLE_MAX_ATTEMPTS, { sleep })).resolves.toBe('listo');
      expect(operation).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    }
  });

  it('gives up on a deadlock that repeats through every attempt and propagates it', async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi.fn(async () => { throw deadlockFromQueryRaw(); });

    await expect(withSerializableRetry(operation, SERIALIZABLE_MAX_ATTEMPTS, { sleep })).rejects.toMatchObject({ code: 'P2010' });
    expect(operation).toHaveBeenCalledTimes(SERIALIZABLE_MAX_ATTEMPTS);
    expect(isRetryableTransactionError(deadlockFromQueryRaw())).toBe(true);
  });

  it('classifies retryable transaction errors and nothing else', () => {
    expect(isRetryableTransactionError(conflict())).toBe(true);
    expect(isRetryableTransactionError(deadlockFromQueryRaw())).toBe(true);
    expect(isRetryableTransactionError(deadlockFromWrite())).toBe(true);
    // Fallo de serialización crudo (`40001`) de una consulta `$queryRaw`.
    expect(isRetryableTransactionError(Object.assign(new Error('raw'), { code: 'P2010', meta: { code: '40001' } }))).toBe(true);

    // Otros errores de consulta cruda, de Prisma o de negocio: no se reintentan.
    expect(isRetryableTransactionError(Object.assign(new Error('raw'), { code: 'P2010', meta: { code: '42P01' } }))).toBe(false);
    expect(isRetryableTransactionError(Object.assign(new Error('raw'), { code: 'P2010' }))).toBe(false);
    expect(isRetryableTransactionError(Object.assign(new Error('unique'), { code: 'P2002' }))).toBe(false);
    expect(isRetryableTransactionError(Object.assign(new Error('missing'), { code: 'P2025' }))).toBe(false);
    expect(isRetryableTransactionError(Object.assign(new Error('40P01'), { code: 'ASSIGNMENT_NOT_FOUND' }))).toBe(false);
    // Un error sin código solo cuenta si trae el SQLSTATE con el formato de Prisma, no cualquier mención.
    expect(isRetryableTransactionError(new Error('boom'))).toBe(false);
    expect(isRetryableTransactionError(new Error('code 40P01 mentioned in passing'))).toBe(false);
    expect(isRetryableTransactionError(new Prisma.PrismaClientUnknownRequestError('PostgresError { code: "23505" }', { clientVersion: 'test' }))).toBe(false);
    expect(isRetryableTransactionError(null)).toBe(false);
    expect(isRetryableTransactionError(undefined)).toBe(false);
    expect(isRetryableTransactionError('40P01')).toBe(false);
  });

  it('never retries or waits on errors other than serialization conflicts and deadlocks, including business errors', async () => {
    const sleep = vi.fn(async () => undefined);
    const business = Object.assign(new Error('ASSIGNMENT_NOT_FOUND'), { code: 'ASSIGNMENT_NOT_FOUND' });
    const operation = vi.fn(async () => { throw business; });

    await expect(withSerializableRetry(operation, SERIALIZABLE_MAX_ATTEMPTS, { sleep })).rejects.toBe(business);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();

    const plain = new Error('boom');
    await expect(withSerializableRetry(async () => { throw plain; }, SERIALIZABLE_MAX_ATTEMPTS, { sleep })).rejects.toBe(plain);
    await expect(withSerializableRetry(async () => { throw 'texto'; }, SERIALIZABLE_MAX_ATTEMPTS, { sleep })).rejects.toBe('texto');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('defaults to the maximum attempts and a real timer between them', async () => {
    let attempts = 0;
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    await expect(withSerializableRetry(async () => { attempts += 1; throw conflict(); })).rejects.toMatchObject({ code: 'P2034' });
    random.mockRestore();
    expect(attempts).toBe(SERIALIZABLE_MAX_ATTEMPTS);
  });
});
