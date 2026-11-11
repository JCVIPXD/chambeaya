import type { Response } from 'express';

import { isRetryableTransactionError } from './serializable-retry.js';

/**
 * Traducción HTTP común de los fallos de transacción que NO son un defecto del
 * cliente ni un error de negocio (CN-20261012-049, BAJO-1 y BAJO-2). Las rutas de
 * moneda, puestos fijos, talento y administración la comparten para no repetir
 * (ni olvidar) el mapeo:
 *
 *  - Reintentos `Serializable` agotados (`P2034`, o `40001`/`40P01` que
 *    `withSerializableRetry` no logró recuperar): `503 SERIALIZATION_RETRY_EXHAUSTED`
 *    con `Retry-After`. PostgreSQL abortó la transacción entera, así que ningún
 *    efecto quedó aplicado y el cliente puede repetir la petición tal cual
 *    (las acciones con cobro son idempotentes por su clave).
 *  - Registro ya borrado (`P2003` de clave foránea o `P2025`), solo en las rutas
 *    que lo piden con `missingRecordCode`: `404` con ese código. Es la carrera
 *    «la cuenta se borró mientras llegaba la acción».
 *
 * Cualquier otro error devuelve `null`: quien llama decide (validación `400`,
 * error de negocio o `500`).
 */
export const SERIALIZATION_RETRY_EXHAUSTED = 'SERIALIZATION_RETRY_EXHAUSTED';
/** Segundos que se sugieren esperar antes de repetir una petición cuyos reintentos se agotaron. */
export const SERIALIZATION_RETRY_AFTER_SECONDS = 1;
const SERIALIZATION_RETRY_MESSAGE = 'El servidor está atendiendo muchas operaciones sobre los mismos datos y no pudo completar la tuya. No se aplicó ningún cambio; vuelve a intentarlo en unos segundos.';

export type TranslatedTransactionError = {
  status: 404 | 503;
  body: { error: string; message?: string; retryable?: true };
  retryAfterSeconds?: number;
};

function prismaCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined;
}

export function translateTransactionError(error: unknown, options: { missingRecordCode?: string } = {}): TranslatedTransactionError | null {
  if (isRetryableTransactionError(error)) {
    return {
      status: 503,
      body: { error: SERIALIZATION_RETRY_EXHAUSTED, message: SERIALIZATION_RETRY_MESSAGE, retryable: true },
      retryAfterSeconds: SERIALIZATION_RETRY_AFTER_SECONDS,
    };
  }
  const code = prismaCode(error);
  if (options.missingRecordCode && (code === 'P2003' || code === 'P2025')) {
    return { status: 404, body: { error: options.missingRecordCode } };
  }
  return null;
}

/** Responde con la traducción si el error es de transacción; devuelve `false` si no lo es. */
export function sendTransactionError(response: Response, error: unknown, options: { missingRecordCode?: string } = {}): boolean {
  const translated = translateTransactionError(error, options);
  if (!translated) return false;
  if (translated.status === 503) console.error('Transaction gave up after repeated serialization conflicts or deadlocks', error);
  if (translated.retryAfterSeconds !== undefined) response.set('Retry-After', String(translated.retryAfterSeconds));
  response.status(translated.status).json(translated.body);
  return true;
}
