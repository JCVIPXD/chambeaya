import { Prisma, PrismaClient, type CurrencyAccountOwnerType, type CurrencyCatalogEntry } from '@prisma/client';

import { CURRENCY_ACTION_KEYS, limaMonthWindow, resolveCatalogAction, type CatalogResolution } from './currency.catalog.js';
import { virtualCurrencyName } from './currency.config.js';
import { CurrencyError } from './currency.service.js';

export type CatalogPatch = {
  amount?: number;
  active?: boolean;
  freeMonthlyQuota?: number;
  refundWindowHours?: number | null;
};
export type CatalogPage = { limit: number; cursor?: string; entryId?: string };

/** Cuántas veces usó el usuario una acción dentro de una ventana de tiempo.
 * M2 no conecta ninguna acción real, así que todavía nadie consume cuota;
 * M4 entrega la implementación que lee los usos reales (gratuitos y cobrados). */
export type CurrencyUsageCounter = {
  countUsage(subject: { actor: CurrencyAccountOwnerType; userId: string }, actionKey: string, window: { start: Date; end: Date }): Promise<number>;
};
export const NO_ACTIONS_CONNECTED_YET: CurrencyUsageCounter = { countUsage: async () => 0 };

const EDITABLE_FIELDS = ['amount', 'active', 'freeMonthlyQuota', 'refundWindowHours'] as const;
const entryInclude = { updatedBy: { select: { id: true, name: true } } } as const;
type EntryWithAuthor = CurrencyCatalogEntry & { updatedBy: { id: string; name: string } | null };

function adminEntryView(entry: EntryWithAuthor) {
  return {
    id: entry.id,
    actionKey: entry.actionKey,
    actor: entry.actor,
    kind: entry.kind,
    amount: entry.amount,
    active: entry.active,
    freeMonthlyQuota: entry.freeMonthlyQuota,
    refundWindowHours: entry.refundWindowHours,
    isProvisional: entry.isProvisional,
    updatedAt: entry.updatedAt,
    updatedBy: entry.updatedBy,
  };
}

function keyOrder(actionKey: string) {
  const index = (CURRENCY_ACTION_KEYS as readonly string[]).indexOf(actionKey);
  return index === -1 ? CURRENCY_ACTION_KEYS.length : index;
}

/**
 * Catálogo de costos y premios (M2). Solo configura y resuelve: ninguna ruta
 * de esta clase escribe en el libro mayor. Las acciones reales (M4/M6) la
 * consultan para saber cuánto cobrar u otorgar.
 */
export class CurrencyCatalogService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly usage: CurrencyUsageCounter = NO_ACTIONS_CONNECTED_YET,
    private readonly currencyName = virtualCurrencyName(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listForAdmin() {
    const rows = await this.prisma.currencyCatalogEntry.findMany({ include: entryInclude });
    rows.sort((a, b) => (a.actor === b.actor ? 0 : a.actor === 'COMPANY' ? -1 : 1) || a.kind.localeCompare(b.kind) || keyOrder(a.actionKey) - keyOrder(b.actionKey));
    return { currency: this.currencyName, items: rows.map(adminEntryView) };
  }

  async update(entryId: string, patch: CatalogPatch, reason: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Bloquea la fila: dos cambios simultáneos se encadenan y cada historial
      // guarda el valor anterior real (misma técnica que `PATCH /settings`).
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "CurrencyCatalogEntry" WHERE "id" = ${entryId} FOR UPDATE`);
      if (locked.length === 0) throw new CurrencyError('CATALOG_ENTRY_NOT_FOUND', 404);
      const current = await tx.currencyCatalogEntry.findUniqueOrThrow({ where: { id: entryId } });

      if (current.kind === 'REWARD' && (patch.freeMonthlyQuota !== undefined || (patch.refundWindowHours !== undefined && patch.refundWindowHours !== null))) {
        // Una cuota gratuita o una devolución no tienen sentido en un premio.
        throw new CurrencyError('CATALOG_FIELD_NOT_APPLICABLE', 400);
      }

      const changes: { field: string; oldValue: string; newValue: string }[] = [];
      const data: Prisma.CurrencyCatalogEntryUncheckedUpdateInput = {};
      for (const field of EDITABLE_FIELDS) {
        const next = patch[field];
        if (next === undefined || next === current[field]) continue;
        (data as Record<string, unknown>)[field] = next;
        changes.push({ field, oldValue: String(current[field]), newValue: String(next) });
      }
      if (changes.length === 0) {
        const unchanged = await tx.currencyCatalogEntry.findUniqueOrThrow({ where: { id: entryId }, include: entryInclude });
        return { changed: [] as string[], entry: adminEntryView(unchanged) };
      }
      const updated = await tx.currencyCatalogEntry.update({
        where: { id: entryId },
        data: { ...data, isProvisional: false, updatedById: adminId },
        include: entryInclude,
      });
      await tx.currencyCatalogChange.createMany({
        data: changes.map((change) => ({
          entryId,
          actionKey: current.actionKey,
          actor: current.actor,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          reason,
          changedById: adminId,
        })),
      });
      return { changed: changes.map((change) => change.field), entry: adminEntryView(updated) };
    });
  }

  async changes(page: CatalogPage) {
    let cursorRow: { createdAt: Date; id: string } | null = null;
    if (page.cursor) {
      cursorRow = await this.prisma.currencyCatalogChange.findFirst({
        where: { id: page.cursor, ...(page.entryId ? { entryId: page.entryId } : {}) },
        select: { createdAt: true, id: true },
      });
      if (!cursorRow) throw new CurrencyError('INVALID_CURSOR', 400);
    }
    const rows = await this.prisma.currencyCatalogChange.findMany({
      where: {
        ...(page.entryId ? { entryId: page.entryId } : {}),
        ...(cursorRow
          ? { OR: [{ createdAt: { lt: cursorRow.createdAt } }, { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } }] }
          : {}),
      },
      include: { changedBy: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });
    const hasNext = rows.length > page.limit;
    const items = rows.slice(0, page.limit);
    return {
      items: items.map((row) => ({
        id: row.id,
        entryId: row.entryId,
        actionKey: row.actionKey,
        actor: row.actor,
        field: row.field,
        oldValue: row.oldValue,
        newValue: row.newValue,
        reason: row.reason,
        changedBy: row.changedBy,
        createdAt: row.createdAt,
      })),
      nextCursor: hasNext ? items.at(-1)?.id ?? null : null,
    };
  }

  /** Dueño de la cuenta en el catálogo: el usuario trabajador o la empresa
   * (identificada por el id de su usuario dueño). */
  async resolve(actionKey: string, actor: CurrencyAccountOwnerType, userId: string): Promise<CatalogResolution> {
    const now = this.clock();
    const entry = await this.prisma.currencyCatalogEntry.findUnique({ where: { actionKey_actor: { actionKey, actor } } });
    const used = entry?.kind === 'COST' && entry.active
      ? await this.usage.countUsage({ actor, userId }, actionKey, limaMonthWindow(now))
      : 0;
    return resolveCatalogAction(actionKey, actor, entry, used, now);
  }

  /** Catálogo visible para un actor: solo entradas activas de su tipo y sin
   * datos internos (autor, ids, bandera provisional). */
  async listForActor(actor: CurrencyAccountOwnerType, userId: string) {
    const rows = await this.prisma.currencyCatalogEntry.findMany({ where: { actor, active: true } });
    rows.sort((a, b) => a.kind.localeCompare(b.kind) || keyOrder(a.actionKey) - keyOrder(b.actionKey));
    const now = this.clock();
    const window = limaMonthWindow(now);
    const items = await Promise.all(rows.map(async (row) => {
      const used = row.kind === 'COST' ? await this.usage.countUsage({ actor, userId }, row.actionKey, window) : 0;
      const resolution = resolveCatalogAction(row.actionKey, actor, row, used, now);
      return {
        actionKey: row.actionKey,
        kind: row.kind,
        amount: row.amount,
        ...(row.kind === 'COST'
          ? { freeMonthlyQuota: row.freeMonthlyQuota, freeRemaining: resolution.freeQuota?.remaining ?? 0, refundWindowHours: row.refundWindowHours }
          : {}),
      };
    }));
    return { currency: this.currencyName, items };
  }
}
