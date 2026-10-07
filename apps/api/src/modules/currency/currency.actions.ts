import { Prisma, type CurrencyAccountOwnerType } from '@prisma/client';

import { limaDayWindow, limaMonthWindow, resolveCatalogAction, type CatalogResolution } from './currency.catalog.js';
import { appendMovementTx, balanceTx, CurrencyError } from './currency.service.js';
import { readCurrencySetting } from './currency.settings.js';

type Tx = Prisma.TransactionClient;

/** Quién actúa: el trabajador (su usuario) o la empresa (identificada por su `id`; su usuario dueño lleva el tope diario). */
export type ActionSubject = { actor: CurrencyAccountOwnerType; userId: string; subjectId: string };

export type ChargeRequest = ActionSubject & {
  actionKey: string;
  /** Identifica la instancia de la acción (`job-publish:{postingId}`...). Reintentos y clics repetidos nunca cobran dos veces. */
  instanceKey: string;
  related?: { type: string; id: string };
  reason: string;
};

export type ChargeResult = {
  /** Monedas debitadas ahora (0 si estaba dentro de la cuota, ya pagada o la acción es gratuita). */
  amount: number;
  /** La instancia ya estaba registrada: no se escribió nada nuevo. */
  idempotent: boolean;
  /** Se usó la cuota gratuita mensual. */
  usedFreeQuota: boolean;
  movementId: string | null;
  balanceAfter: number | null;
};

export type ActionQuote = {
  actionKey: string;
  actor: CurrencyAccountOwnerType;
  /** La acción tiene costo activo en el catálogo; si no, es gratuita. */
  active: boolean;
  /** Monedas que se debitarían si la acción se ejecutara ahora (0 si es gratuita o ya está pagada). */
  cost: number;
  catalogAmount: number;
  /** Motivo de `cost`: `CHARGE`, `FREE_QUOTA`, `ALREADY_REGISTERED`, `FREE_ACTION`. */
  reason: 'CHARGE' | 'FREE_QUOTA' | 'ALREADY_REGISTERED' | 'FREE_ACTION';
  freeQuota: CatalogResolution['freeQuota'];
  balance: number;
  sufficientBalance: boolean;
  dailyCap: { limit: number; spentToday: number; remaining: number };
  withinDailyCap: boolean;
  /** `true` si ejecutarla ahora no fallaría por saldo ni por tope. */
  canExecute: boolean;
  refundWindowHours: number | null;
};

const REFUND_RELATED_TYPES = { TALENT_INVITE: 'TalentInvitation', APPLICATION_EXTRA: 'JobApplication', APPLICATION_PRIORITY: 'JobApplication' } as const;
export { REFUND_RELATED_TYPES };

/**
 * Cobro y premios de las acciones de producto (M4), siempre DENTRO de la
 * transacción de la acción: si la acción falla, el cobro se revierte, y si el
 * cobro falla (saldo, tope), la acción no ocurre. Todos los métodos reciben el
 * cliente transaccional y no abren transacciones propias. La transacción de
 * quien llama debe ser `Serializable` con reintento (`withSerializableRetry`):
 * esa es la garantía de la cuota y del tope bajo concurrencia, junto con el
 * bloqueo de la cuenta y los únicos de `instanceKey` y `(accountId, sequence)`.
 */
export class CurrencyActionService {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  now() {
    return this.clock();
  }

  private async accountId(tx: Tx, subject: ActionSubject, create: boolean) {
    if (subject.actor === 'WORKER') {
      const account = create
        ? await tx.currencyAccount.upsert({ where: { workerId: subject.subjectId }, create: { ownerType: 'WORKER', workerId: subject.subjectId }, update: {} })
        : await tx.currencyAccount.findUnique({ where: { workerId: subject.subjectId } });
      return account?.id ?? null;
    }
    const account = create
      ? await tx.currencyAccount.upsert({ where: { companyId: subject.subjectId }, create: { ownerType: 'COMPANY', companyId: subject.subjectId }, update: {} })
      : await tx.currencyAccount.findUnique({ where: { companyId: subject.subjectId } });
    return account?.id ?? null;
  }

  private async lockAccount(tx: Tx, accountId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CurrencyAccount" WHERE "id" = ${accountId} FOR UPDATE`);
  }

  /** Lectura común del cobro y de la cotización: nada se escribe. */
  private async evaluate(tx: Tx, subject: ActionSubject, actionKey: string, instanceKey: string | null, accountId: string | null) {
    const now = this.now();
    const [entry, prior] = await Promise.all([
      tx.currencyCatalogEntry.findUnique({ where: { actionKey_actor: { actionKey, actor: subject.actor } } }),
      instanceKey ? tx.currencyActionUse.findUnique({ where: { instanceKey } }) : Promise.resolve(null),
    ]);
    const month = limaMonthWindow(now);
    const used = entry?.kind === 'COST' && entry.active
      ? await tx.currencyActionUse.count({ where: { userId: subject.userId, actionKey, occurredAt: { gte: month.start, lt: month.end } } })
      : 0;
    const resolution = resolveCatalogAction(actionKey, subject.actor, entry, used, now);
    const day = limaDayWindow(now);
    const spent = await tx.currencyActionUse.aggregate({
      _sum: { chargedAmount: true },
      where: { userId: subject.userId, occurredAt: { gte: day.start, lt: day.end } },
    });
    const dailyCap = await readCurrencySetting(tx, subject.actor === 'WORKER' ? 'DAILY_SPEND_CAP_WORKER' : 'DAILY_SPEND_CAP_COMPANY');
    const balance = accountId ? await balanceTx(tx, accountId) : 0;
    return { now, entry, prior, resolution, spentToday: spent._sum.chargedAmount ?? 0, dailyCap, balance };
  }

  /**
   * Cobra (o registra como gratuita) una instancia de acción. Idempotente por
   * `instanceKey`: repetirla devuelve el resultado anterior sin tocar el libro.
   * Lanza `INSUFFICIENT_CURRENCY` (409) o `DAILY_SPEND_CAP_REACHED` (409) sin
   * dejar ningún efecto. Una acción sin costo activo en el catálogo es gratuita.
   */
  async charge(tx: Tx, request: ChargeRequest): Promise<ChargeResult> {
    const accountId = (await this.accountId(tx, request, true))!;
    await this.lockAccount(tx, accountId);
    const state = await this.evaluate(tx, request, request.actionKey, request.instanceKey, accountId);
    if (state.prior) {
      if (state.prior.userId !== request.userId || state.prior.actionKey !== request.actionKey) throw new CurrencyError('IDEMPOTENCY_KEY_REUSED', 409);
      // Nada se debita ahora: el cobro (si hubo) ya ocurrió con la primera ejecución.
      return { amount: 0, idempotent: true, usedFreeQuota: state.prior.chargedAmount === 0, movementId: state.prior.movementId, balanceAfter: null };
    }
    const { resolution, entry } = state;
    if (!resolution.active || resolution.kind !== 'COST' || !entry) {
      return { amount: 0, idempotent: false, usedFreeQuota: false, movementId: null, balanceAfter: null };
    }
    const base = {
      userId: request.userId,
      actor: request.actor,
      actionKey: request.actionKey,
      instanceKey: request.instanceKey,
      accountId,
      relatedEntityType: request.related?.type ?? null,
      relatedEntityId: request.related?.id ?? null,
      occurredAt: state.now,
    };
    if (!resolution.charge) {
      await tx.currencyActionUse.create({ data: { ...base, chargedAmount: 0 } });
      return { amount: 0, idempotent: false, usedFreeQuota: true, movementId: null, balanceAfter: null };
    }
    const amount = resolution.chargeAmount;
    if (state.spentToday + amount > state.dailyCap) {
      throw new CurrencyError('DAILY_SPEND_CAP_REACHED', 409, { cost: amount, dailyCap: state.dailyCap, spentToday: state.spentToday });
    }
    const { movement } = await appendMovementTx(tx, {
      accountId,
      quantity: -amount,
      action: 'ACTION_CHARGE',
      actionKey: request.actionKey,
      reason: request.reason,
      related: request.related ?? null,
      idempotencyKey: `charge:${request.instanceKey}`,
      createdById: request.userId,
    });
    const refundDueAt = entry.refundWindowHours ? new Date(state.now.getTime() + entry.refundWindowHours * 3_600_000) : null;
    await tx.currencyActionUse.create({ data: { ...base, chargedAmount: amount, movementId: movement.id, refundDueAt } });
    return { amount, idempotent: false, usedFreeQuota: false, movementId: movement.id, balanceAfter: movement.balanceAfter };
  }

  /** Costo previo de una acción para el actor, sin ningún efecto. */
  async quote(tx: Tx, subject: ActionSubject, actionKey: string, instanceKey: string | null): Promise<ActionQuote> {
    const accountId = await this.accountId(tx, subject, false);
    const state = await this.evaluate(tx, subject, actionKey, instanceKey, accountId);
    const { resolution } = state;
    const costly = resolution.active && resolution.kind === 'COST';
    let reason: ActionQuote['reason'] = 'FREE_ACTION';
    let cost = 0;
    if (costly) {
      if (state.prior) reason = 'ALREADY_REGISTERED';
      else if (!resolution.charge) reason = 'FREE_QUOTA';
      else { reason = 'CHARGE'; cost = resolution.chargeAmount; }
    }
    const sufficientBalance = state.balance >= cost;
    const withinDailyCap = cost === 0 || state.spentToday + cost <= state.dailyCap;
    return {
      actionKey,
      actor: subject.actor,
      active: costly,
      cost,
      catalogAmount: resolution.amount,
      reason,
      freeQuota: resolution.freeQuota,
      balance: state.balance,
      sufficientBalance,
      dailyCap: { limit: state.dailyCap, spentToday: state.spentToday, remaining: Math.max(0, state.dailyCap - state.spentToday) },
      withinDailyCap,
      canExecute: sufficientBalance && withinDailyCap,
      refundWindowHours: resolution.refundWindowHours,
    };
  }

  /**
   * Otorga el premio vigente del catálogo (hoy solo `WELCOME_BONUS`). Idempotente
   * por `idempotencyKey`. Devuelve `granted: false` si la acción no es un premio
   * activo del catálogo para el actor.
   */
  async grantReward(tx: Tx, subject: ActionSubject, actionKey: string, idempotencyKey: string, reason: string) {
    const entry = await tx.currencyCatalogEntry.findUnique({ where: { actionKey_actor: { actionKey, actor: subject.actor } } });
    if (!entry || !entry.active || entry.kind !== 'REWARD') return { granted: false as const, idempotent: false, amount: 0 };
    const accountId = (await this.accountId(tx, subject, true))!;
    // Un premio ya otorgado cuenta como otorgado aunque el monto del catálogo se haya editado
    // después: la clave identifica al premio, no su monto (la regularización no debe abortar).
    await this.lockAccount(tx, accountId);
    const existing = await tx.currencyMovement.findUnique({ where: { idempotencyKey } });
    if (existing && existing.accountId === accountId) return { granted: true as const, idempotent: true, amount: existing.quantity };
    const { movement, idempotent } = await appendMovementTx(tx, {
      accountId,
      quantity: entry.amount,
      action: 'REWARD',
      actionKey,
      reason,
      related: { type: subject.actor === 'WORKER' ? 'User' : 'Company', id: subject.subjectId },
      idempotencyKey,
    });
    return { granted: true as const, idempotent, amount: movement.quantity };
  }
}

/** Claves de instancia estables de cada acción (idempotencia y devolución). */
export const instanceKeys = {
  jobPublish: (postingId: string) => `job-publish:${postingId}`,
  jobHighlight: (postingId: string, sequence: number) => `job-highlight:${postingId}:${sequence}`,
  jobApply: (postingId: string, workerId: string) => `job-apply:${postingId}:${workerId}`,
  jobPriority: (applicationId: string) => `job-priority:${applicationId}`,
  talentInvite: (invitationId: string) => `talent-invite:${invitationId}`,
  contactUnlock: (companyId: string, workerUserId: string) => `contact-unlock:${companyId}:${workerUserId}`,
  welcomeBonus: (actor: CurrencyAccountOwnerType, subjectId: string) => `welcome-bonus:${actor}:${subjectId}`,
} as const;
