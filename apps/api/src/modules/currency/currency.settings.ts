import { Prisma, PrismaClient } from '@prisma/client';

import { CurrencyError } from './currency.service.js';

/** Ajustes numéricos de la moneda que edita el administrador (M4). */
export const CURRENCY_SETTING_KEYS = [
  'DAILY_SPEND_CAP_WORKER', 'DAILY_SPEND_CAP_COMPANY', 'JOB_HIGHLIGHT_DURATION_HOURS',
  // M6: premios, referidos y destacar el perfil.
  'REWARD_CAP_DAILY_WORKER', 'REWARD_CAP_MONTHLY_WORKER', 'REWARD_CAP_DAILY_COMPANY', 'REWARD_CAP_MONTHLY_COMPANY',
  'REFERRAL_MONTHLY_LIMIT', 'APPLICANT_RESPONSE_WINDOW_HOURS', 'APPLICANT_RESPONSE_MONTHLY_LIMIT',
  'PROFILE_HIGHLIGHT_DURATION_HOURS',
] as const;
export type CurrencySettingKey = typeof CURRENCY_SETTING_KEYS[number];

export function isCurrencySettingKey(value: string): value is CurrencySettingKey {
  return (CURRENCY_SETTING_KEYS as readonly string[]).includes(value);
}

/**
 * VALORES INICIALES PROVISIONALES. Los siembra la migración
 * `20261007100000_currency_actions` y el dueño del producto los ajustará desde
 * la API de administración. Si una fila faltara, el código usa estos mismos
 * valores. Debe coincidir con el `INSERT` de la migración.
 */
export const DEFAULT_CURRENCY_SETTINGS: Readonly<Record<CurrencySettingKey, number>> = {
  /** Tope de gasto por día calendario de Lima y por trabajador (monedas). */
  DAILY_SPEND_CAP_WORKER: 200,
  /** Tope de gasto por día calendario de Lima y por empresa (monedas). */
  DAILY_SPEND_CAP_COMPANY: 200,
  /** Cuánto dura un puesto destacado (168 h = 7 días). */
  JOB_HIGHLIGHT_DURATION_HOURS: 168,
  /** M6: tope de monedas ganadas por premios por día de Lima y por trabajador (no cuenta el bono de bienvenida). */
  REWARD_CAP_DAILY_WORKER: 100,
  /** M6: tope de monedas ganadas por premios por mes de Lima y por trabajador. */
  REWARD_CAP_MONTHLY_WORKER: 600,
  /** M6: tope diario de premios por empresa. */
  REWARD_CAP_DAILY_COMPANY: 100,
  /** M6: tope mensual de premios por empresa. */
  REWARD_CAP_MONTHLY_COMPANY: 600,
  /** M6: referidos premiados por referidor y mes de Lima. */
  REFERRAL_MONTHLY_LIMIT: 5,
  /** M6: horas desde que llega una postulación para que responderla dé premio (72 h). */
  APPLICANT_RESPONSE_WINDOW_HOURS: 72,
  /** M6: premios de respuesta a tiempo por empresa y mes de Lima. */
  APPLICANT_RESPONSE_MONTHLY_LIMIT: 20,
  /** M6: cuánto dura un perfil de trabajador destacado (168 h = 7 días). */
  PROFILE_HIGHLIGHT_DURATION_HOURS: 168,
};

/** Límites de validación de cada ajuste (el CHECK de la base solo exige > 0). */
export const CURRENCY_SETTING_LIMITS: Readonly<Record<CurrencySettingKey, { min: number; max: number }>> = {
  DAILY_SPEND_CAP_WORKER: { min: 1, max: 1_000_000 },
  DAILY_SPEND_CAP_COMPANY: { min: 1, max: 1_000_000 },
  JOB_HIGHLIGHT_DURATION_HOURS: { min: 1, max: 8_760 },
  REWARD_CAP_DAILY_WORKER: { min: 1, max: 1_000_000 },
  REWARD_CAP_MONTHLY_WORKER: { min: 1, max: 1_000_000 },
  REWARD_CAP_DAILY_COMPANY: { min: 1, max: 1_000_000 },
  REWARD_CAP_MONTHLY_COMPANY: { min: 1, max: 1_000_000 },
  REFERRAL_MONTHLY_LIMIT: { min: 1, max: 1_000 },
  APPLICANT_RESPONSE_WINDOW_HOURS: { min: 1, max: 8_760 },
  APPLICANT_RESPONSE_MONTHLY_LIMIT: { min: 1, max: 10_000 },
  PROFILE_HIGHLIGHT_DURATION_HOURS: { min: 1, max: 8_760 },
};

type Reader = Pick<Prisma.TransactionClient, 'currencySetting'>;

/** Valor vigente de un ajuste (o su valor por defecto si la fila faltara). */
export async function readCurrencySetting(client: Reader, key: CurrencySettingKey): Promise<number> {
  const row = await client.currencySetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULT_CURRENCY_SETTINGS[key];
}

const settingInclude = { updatedBy: { select: { id: true, name: true } } } as const;

export type SettingChangePage = { limit: number; cursor?: string; key?: string };

/**
 * Ajustes editables con historial (misma técnica que el catálogo): cada cambio
 * guarda quién, cuándo, motivo y valor anterior y nuevo.
 */
export class CurrencySettingsService {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  async list() {
    const rows = await this.prisma.currencySetting.findMany({ include: settingInclude });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return {
      items: CURRENCY_SETTING_KEYS.map((key) => {
        const row = byKey.get(key);
        return {
          key,
          value: row?.value ?? DEFAULT_CURRENCY_SETTINGS[key],
          isProvisional: row?.isProvisional ?? true,
          updatedAt: row?.updatedAt ?? null,
          updatedBy: row?.updatedBy ?? null,
        };
      }),
    };
  }

  async update(key: CurrencySettingKey, value: number, reason: string, adminId: string) {
    const limits = CURRENCY_SETTING_LIMITS[key];
    if (!Number.isInteger(value) || value < limits.min || value > limits.max) throw new CurrencyError('INVALID_SETTING_VALUE', 400, limits);
    return this.prisma.$transaction(async (tx) => {
      // Garantiza la fila y la bloquea: dos cambios simultáneos se encadenan y cada
      // historial guarda el valor anterior real.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CurrencySetting" ("key", "value", "updatedAt") VALUES (${key}, ${DEFAULT_CURRENCY_SETTINGS[key]}, NOW())
        ON CONFLICT ("key") DO NOTHING`);
      await tx.$queryRaw(Prisma.sql`SELECT "key" FROM "CurrencySetting" WHERE "key" = ${key} FOR UPDATE`);
      const current = await tx.currencySetting.findUniqueOrThrow({ where: { key } });
      if (current.value === value) {
        const unchanged = await tx.currencySetting.findUniqueOrThrow({ where: { key }, include: settingInclude });
        return { changed: false, setting: view(unchanged) };
      }
      const updated = await tx.currencySetting.update({ where: { key }, data: { value, isProvisional: false, updatedById: adminId }, include: settingInclude });
      await tx.currencySettingChange.create({
        data: { key, oldValue: String(current.value), newValue: String(value), reason, changedById: adminId },
      });
      return { changed: true, setting: view(updated) };
    });
  }

  async changes(page: SettingChangePage) {
    let cursorRow: { createdAt: Date; id: string } | null = null;
    if (page.cursor) {
      cursorRow = await this.prisma.currencySettingChange.findFirst({
        where: { id: page.cursor, ...(page.key ? { key: page.key } : {}) },
        select: { createdAt: true, id: true },
      });
      if (!cursorRow) throw new CurrencyError('INVALID_CURSOR', 400);
    }
    const rows = await this.prisma.currencySettingChange.findMany({
      where: {
        ...(page.key ? { key: page.key } : {}),
        ...(cursorRow ? { OR: [{ createdAt: { lt: cursorRow.createdAt } }, { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } }] } : {}),
      },
      include: { changedBy: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });
    const hasNext = rows.length > page.limit;
    const items = rows.slice(0, page.limit);
    return {
      items: items.map((row) => ({ id: row.id, key: row.key, oldValue: row.oldValue, newValue: row.newValue, reason: row.reason, changedBy: row.changedBy, createdAt: row.createdAt })),
      nextCursor: hasNext ? items.at(-1)?.id ?? null : null,
    };
  }
}

function view(row: { key: string; value: number; isProvisional: boolean; updatedAt: Date; updatedBy: { id: string; name: string } | null }) {
  return { key: row.key, value: row.value, isProvisional: row.isProvisional, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}
