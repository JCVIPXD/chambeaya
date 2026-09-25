// Fechas de los fixtures, siempre relativas al reloj actual. La interfaz
// compara varias con "ahora" (`isShiftExpired`, el filtro de periodo "Esta
// semana" de los pagos, la vigencia de invitaciones), así que una fecha fija
// termina cruzando ese límite con el paso del tiempo y la prueba caduca
// (BAJO-1 de CN-20260923-017). Ninguna fecha nueva debe escribirse literal.

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** ISO de `Date.now() + offsetMs` (negativo = pasado). Se evalúa en cada llamada, no al cargar el módulo. */
export function isoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}
