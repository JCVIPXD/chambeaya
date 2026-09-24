/**
 * Reintenta los conflictos de transacción que ocurren bajo concurrencia real
 * y que PostgreSQL resuelve abortando una de las transacciones, sin haber
 * aplicado ningún efecto de ella. Compartido por los módulos de marketplace y
 * de empresa.
 *
 * Errores reintentables (`isRetryableTransactionError`):
 *  - `P2034`: fallo de serialización (`40001`) de una transacción `Serializable`.
 *  - `40P01` (`deadlock detected`): PostgreSQL abortó esta transacción para
 *    romper un interbloqueo. Prisma lo entrega con tres formas distintas
 *    según la sentencia que lo detecta: `PrismaClientKnownRequestError` `P2010`
 *    con `meta.code` `40P01` (`$queryRaw`, p. ej. los bloqueos de fila del
 *    trabajador), `PrismaClientUnknownRequestError` sin `code` cuyo mensaje
 *    incluye `code: "40P01"` (`updateMany`/`update`/`create`, p. ej. `cancelShift`
 *    de la empresa). Antes solo se reintentaba `P2034` y un interbloqueo
 *    terminaba en `500` (CN-20260923-013, MEDIO-1).
 * Es seguro reintentar ambos: la transacción abortada no dejó nada aplicado.
 *
 * Contrato para quien lo use: `operation` debe ABRIR la transacción y releer
 * dentro de ella todo el estado del que depende su decisión (asignación,
 * turno, postulación). Una lectura hecha fuera de la transacción queda
 * obsoleta al reintentar y reaplicaría una decisión ya invalidada por la
 * transacción ganadora (CN-20260923-008/010). El resto de errores, incluidos
 * los de negocio lanzados dentro de la transacción, se propagan de inmediato.
 *
 * Los interbloqueos NO se resuelven de inmediato: PostgreSQL espera
 * `deadlock_timeout` (1 s por defecto) antes de detectarlos, así que un
 * reintento por `40P01` cuesta ese segundo más la espera aleatoria. Por eso el
 * primer remedio es un orden de bloqueo global consistente (ver
 * `docs/reference/api.md`, "Orden de bloqueo") y este reintento es la red de
 * seguridad para los entrelazados que ese orden no puede evitar.
 *
 * Espera aleatoria entre intentos (CN-20260923-012): reintentar de inmediato
 * hace que las transacciones que chocaron vuelvan a chocar entre sí, y cada
 * ronda deja pasar solo una. Con 4 o más operaciones `Serializable`
 * simultáneas de trabajadores o empresas distintos (aunque cada una actuara
 * sobre su propio turno) tres intentos inmediatos se agotaban y el resto
 * fallaba. Una espera con jitter total (uniforme en `[0, BASE * 2^intento)`)
 * dispersa los reintentos; con 6 intentos las ráfagas de 10 operaciones
 * medidas terminan casi siempre bien. La espera máxima acumulada es de ~1,2 s.
 */
export const SERIALIZABLE_MAX_ATTEMPTS = 6;
export const SERIALIZABLE_BACKOFF_BASE_MS = 20;

export type SerializableRetryOptions = {
  /** Espera entre intentos; se inyecta en pruebas. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Fuente de aleatoriedad en `[0, 1)`; se inyecta en pruebas. */
  random?: () => number;
};

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });

/** Códigos SQLSTATE que PostgreSQL resuelve abortando la transacción sin efectos: fallo de serialización y interbloqueo. */
const RETRYABLE_SQLSTATES = ['40001', '40P01'] as const;

function readProperty(error: object, key: string): unknown {
  return key in error ? (error as Record<string, unknown>)[key] : undefined;
}

/**
 * `true` si el error indica que PostgreSQL abortó la transacción por un fallo
 * de serialización o por un interbloqueo (ver la lista de formas arriba).
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = readProperty(error, 'code');
  if (code === 'P2034') return true;
  if (code === 'P2010') {
    const meta = readProperty(error, 'meta');
    const sqlstate = typeof meta === 'object' && meta !== null ? readProperty(meta, 'code') : undefined;
    return typeof sqlstate === 'string' && (RETRYABLE_SQLSTATES as readonly string[]).includes(sqlstate);
  }
  if (code === undefined) {
    // `PrismaClientUnknownRequestError`: el SQLSTATE solo aparece en el mensaje
    // (`PostgresError { code: "40P01", ... }`). Se exige ese formato exacto para
    // no reintentar un error cualquiera que mencione "40P01" en otro contexto.
    const message = readProperty(error, 'message');
    return typeof message === 'string' && RETRYABLE_SQLSTATES.some((sqlstate) => message.includes(`PostgresError { code: "${sqlstate}"`));
  }
  return false;
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = SERIALIZABLE_MAX_ATTEMPTS,
  { sleep = defaultSleep, random = Math.random }: SerializableRetryOptions = {},
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === maxAttempts) throw error;
      await sleep(random() * SERIALIZABLE_BACKOFF_BASE_MS * 2 ** attempt);
    }
  }
  throw new Error('UNREACHABLE');
}
