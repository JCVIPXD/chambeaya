import type { CurrencyAccountOwnerType, CurrencyCatalogKind } from '@prisma/client';

/** Claves estables de acción del catálogo (M2). Cada clave se conecta a una
 * acción real de producto en M4/M6; el nombre no cambia aunque cambie el monto. */
export const CURRENCY_ACTION_KEYS = [
  'JOB_PUBLISH_EXTRA', 'JOB_HIGHLIGHT', 'TALENT_INVITE', 'CANDIDATE_CONTACT_UNLOCK',
  'APPLICATION_EXTRA', 'APPLICATION_PRIORITY', 'PROFILE_HIGHLIGHT',
  'PROFILE_COMPLETE', 'DOCUMENT_VERIFIED', 'INVITATION_RESPONDED', 'REFERRAL',
  'COMPANY_VERIFIED', 'APPLICANTS_RESPONDED_ON_TIME', 'HIRE_CONFIRMED',
  'WELCOME_BONUS',
] as const;
export type CurrencyActionKey = typeof CURRENCY_ACTION_KEYS[number];

export function isCurrencyActionKey(value: string): value is CurrencyActionKey {
  return (CURRENCY_ACTION_KEYS as readonly string[]).includes(value);
}

export type CatalogDefault = {
  actionKey: CurrencyActionKey;
  actor: CurrencyAccountOwnerType;
  kind: CurrencyCatalogKind;
  amount: number;
  freeMonthlyQuota: number;
  refundWindowHours: number | null;
};

/**
 * VALORES INICIALES PROVISIONALES. Los siembra la migración
 * `20261005120000_currency_catalog` y el dueño del producto los ajustará desde
 * el panel de administración. Principio: lo básico siempre es gratis; solo se
 * cobra el valor extra. Debe coincidir con el `INSERT` de la migración.
 */
export const DEFAULT_CURRENCY_CATALOG: readonly CatalogDefault[] = [
  { actionKey: 'JOB_PUBLISH_EXTRA', actor: 'COMPANY', kind: 'COST', amount: 10, freeMonthlyQuota: 3, refundWindowHours: null },
  { actionKey: 'JOB_HIGHLIGHT', actor: 'COMPANY', kind: 'COST', amount: 10, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'TALENT_INVITE', actor: 'COMPANY', kind: 'COST', amount: 5, freeMonthlyQuota: 0, refundWindowHours: 72 },
  { actionKey: 'CANDIDATE_CONTACT_UNLOCK', actor: 'COMPANY', kind: 'COST', amount: 10, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'APPLICATION_EXTRA', actor: 'WORKER', kind: 'COST', amount: 5, freeMonthlyQuota: 10, refundWindowHours: 72 },
  { actionKey: 'APPLICATION_PRIORITY', actor: 'WORKER', kind: 'COST', amount: 10, freeMonthlyQuota: 0, refundWindowHours: 72 },
  { actionKey: 'PROFILE_HIGHLIGHT', actor: 'WORKER', kind: 'COST', amount: 10, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'PROFILE_COMPLETE', actor: 'WORKER', kind: 'REWARD', amount: 20, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'DOCUMENT_VERIFIED', actor: 'WORKER', kind: 'REWARD', amount: 10, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'INVITATION_RESPONDED', actor: 'WORKER', kind: 'REWARD', amount: 5, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'REFERRAL', actor: 'WORKER', kind: 'REWARD', amount: 20, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'WELCOME_BONUS', actor: 'WORKER', kind: 'REWARD', amount: 50, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'COMPANY_VERIFIED', actor: 'COMPANY', kind: 'REWARD', amount: 20, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'APPLICANTS_RESPONDED_ON_TIME', actor: 'COMPANY', kind: 'REWARD', amount: 5, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'HIRE_CONFIRMED', actor: 'COMPANY', kind: 'REWARD', amount: 20, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'WELCOME_BONUS', actor: 'COMPANY', kind: 'REWARD', amount: 50, freeMonthlyQuota: 0, refundWindowHours: null },
];

// Perú no observa horario de verano: -05:00 todo el año (igual que el panel de
// comisiones). El mes de cuota es el calendario de Lima, no el UTC.
const LIMA_OFFSET_HOURS = 5;

/** Ventana [start, end) del mes calendario de Lima que contiene `now`. */
export function limaMonthWindow(now: Date): { start: Date; end: Date } {
  const lima = new Date(now.getTime() - LIMA_OFFSET_HOURS * 3_600_000);
  const year = lima.getUTCFullYear();
  const month = lima.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, LIMA_OFFSET_HOURS)),
    end: new Date(Date.UTC(year, month + 1, 1, LIMA_OFFSET_HOURS)),
  };
}

export type CatalogEntryRule = {
  actionKey: string;
  actor: CurrencyAccountOwnerType;
  kind: CurrencyCatalogKind;
  amount: number;
  active: boolean;
  freeMonthlyQuota: number;
  refundWindowHours: number | null;
};

export type CatalogResolution = {
  actionKey: string;
  actor: CurrencyAccountOwnerType;
  kind: CurrencyCatalogKind | null;
  /** La acción está en el catálogo y activa. Si no, es gratuita y no otorga nada. */
  active: boolean;
  /** Monto vigente del catálogo (0 si no hay entrada o está inactiva). */
  amount: number;
  /** true solo si ejecutar la acción ahora debe debitar `chargeAmount`. */
  charge: boolean;
  chargeAmount: number;
  /** Premio que otorgaría la acción (REWARD activo); si no, 0. */
  rewardAmount: number;
  freeQuota: { monthlyLimit: number; used: number; remaining: number; periodStart: string; periodEnd: string } | null;
  refundWindowHours: number | null;
};

/**
 * Resolución pura, sin efectos sobre el libro. `usedThisMonth` son los usos de
 * la acción por el usuario en el mes de Lima. Lo básico nunca se bloquea: una
 * entrada ausente o inactiva resuelve como gratuita (`charge: false`).
 */
export function resolveCatalogAction(
  actionKey: string,
  actor: CurrencyAccountOwnerType,
  entry: CatalogEntryRule | null | undefined,
  usedThisMonth: number,
  now: Date,
): CatalogResolution {
  const base = { actionKey, actor, charge: false, chargeAmount: 0, rewardAmount: 0, freeQuota: null, refundWindowHours: null };
  if (!entry) return { ...base, kind: null, active: false, amount: 0 };
  if (!entry.active) return { ...base, kind: entry.kind, active: false, amount: 0 };
  if (entry.kind === 'REWARD') return { ...base, kind: 'REWARD', active: true, amount: entry.amount, rewardAmount: entry.amount };
  const used = Math.max(0, Math.floor(usedThisMonth));
  const window = limaMonthWindow(now);
  const remaining = Math.max(0, entry.freeMonthlyQuota - used);
  const charge = used >= entry.freeMonthlyQuota;
  return {
    ...base,
    kind: 'COST',
    active: true,
    amount: entry.amount,
    charge,
    chargeAmount: charge ? entry.amount : 0,
    freeQuota: { monthlyLimit: entry.freeMonthlyQuota, used, remaining, periodStart: window.start.toISOString(), periodEnd: window.end.toISOString() },
    refundWindowHours: entry.refundWindowHours,
  };
}

/** Ventana [start, end) del día calendario de Lima que contiene `now` (base del tope de gasto diario). */
export function limaDayWindow(now: Date): { start: Date; end: Date } {
  const lima = new Date(now.getTime() - LIMA_OFFSET_HOURS * 3_600_000);
  const start = Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate(), LIMA_OFFSET_HOURS);
  return { start: new Date(start), end: new Date(start + 24 * 3_600_000) };
}
