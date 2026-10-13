// Formatos de dinero y fecha del panel de puestos fijos. Todas las fechas se muestran en hora de Lima,
// igual que la cuota mensual y el tope diario de la API.

const TIME_ZONE = 'America/Lima';

const moneyFormat = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TIME_ZONE });
const dateTimeFormat = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TIME_ZONE,
});
const limaParts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIME_ZONE });

/** Céntimos de sol a texto: `150000` -> `S/ 1,500`. */
export function formatCents(cents: number, currency = 'PEN'): string {
  const symbol = currency === 'PEN' ? 'S/' : currency;
  return `${symbol} ${moneyFormat.format(cents / 100)}`;
}

export function formatSalaryRange(minCents: number, maxCents: number, currency = 'PEN'): string {
  return minCents === maxCents ? formatCents(minCents, currency) : `${formatCents(minCents, currency)} – ${formatCents(maxCents, currency)}`;
}

/** Monedas virtuales con el nombre que entrega la API: `12` y `Chambitas` -> `12 Chambitas`. */
export function formatCoins(amount: number, currencyName: string): string {
  return `${new Intl.NumberFormat('es-PE').format(amount)} ${currencyName}`;
}

export function formatSignedCoins(amount: number): string {
  const text = new Intl.NumberFormat('es-PE').format(Math.abs(amount));
  return amount > 0 ? `+${text}` : amount < 0 ? `−${text}` : text;
}

/** Una fecha de calendario (`YYYY-MM-DD` o ISO a medianoche UTC) sin correrla por zona horaria. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '—';
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? '—' : dateFormat.format(parsed);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : dateFormat.format(parsed);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : dateTimeFormat.format(parsed);
}

/** Fecha de hoy en Lima (`YYYY-MM-DD`): la API compara fechas de ingreso contra ese día. */
export function limaToday(now: Date = new Date()): string {
  return limaParts.format(now);
}

/** Texto de soles ("1500" o "1 500,50") a céntimos; `null` si no es un monto válido. */
export function parseSolesToCents(input: string): number | null {
  const text = input.trim().replace(/\s/g, '').replace(/^S\/\.?/i, '');
  if (!text) return null;
  const normalized = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Céntimos a un valor editable de soles (`150000` -> `1500`, `150050` -> `1500.50`). */
export function centsToSolesInput(cents: number): string {
  const soles = cents / 100;
  return Number.isInteger(soles) ? String(soles) : soles.toFixed(2);
}

/** Valor de `<input type="datetime-local">` (hora local del navegador) a ISO UTC. */
export function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
