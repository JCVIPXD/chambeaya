const DEFAULT_CURRENCY_NAME = 'Chambitas';

/** Nombre de la moneda mostrado por la API. Se configura por entorno para no
 * acoplar clientes ni datos al nombre de trabajo actual. */
export function virtualCurrencyName(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.VIRTUAL_CURRENCY_NAME?.trim();
  if (configured && configured.length <= 60) return configured;
  return DEFAULT_CURRENCY_NAME;
}
