const DEFAULT_CURRENCY_NAME = 'Chambitas';

/** Nombre de la moneda mostrado por la API. Se configura por entorno para no
 * acoplar clientes ni datos al nombre de trabajo actual. */
export function virtualCurrencyName(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.VIRTUAL_CURRENCY_NAME?.trim();
  if (configured && configured.length <= 60) return configured;
  return DEFAULT_CURRENCY_NAME;
}

const DEFAULT_REFUND_INTERVAL_MS = 5 * 60_000;
const MIN_REFUND_INTERVAL_MS = 1_000;

/**
 * Intervalo (ms) de la tarea programada de devolución automática. Se configura con
 * `CURRENCY_REFUND_INTERVAL_MS`; `0`, `off` o `false` la desactivan (también bajo
 * pruebas: `VITEST` o `NODE_ENV=test`). Devuelve `null` si está desactivada.
 */
export function refundSchedulerIntervalMs(env: NodeJS.ProcessEnv = process.env): number | null {
  if (env.VITEST || env.NODE_ENV === 'test') return null;
  const raw = env.CURRENCY_REFUND_INTERVAL_MS?.trim().toLowerCase();
  if (raw === undefined || raw === '') return DEFAULT_REFUND_INTERVAL_MS;
  if (raw === '0' || raw === 'off' || raw === 'false') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_REFUND_INTERVAL_MS) return DEFAULT_REFUND_INTERVAL_MS;
  return Math.floor(value);
}
