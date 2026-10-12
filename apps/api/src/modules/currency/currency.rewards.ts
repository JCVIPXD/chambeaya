import { Prisma, type CurrencyAccountOwnerType } from '@prisma/client';

import { isRetryableTransactionError } from '../operations/serializable-retry.js';
import type { ActionSubject } from './currency.actions.js';
import { limaDayWindow, limaMonthWindow } from './currency.catalog.js';
import { appendMovementTx } from './currency.service.js';
import { readCurrencySetting, type CurrencySettingKey } from './currency.settings.js';

type Tx = Prisma.TransactionClient;

/**
 * Premios automáticos (M6). Cada premio sale de un HECHO identificado por una
 * clave estable (`{actionKey}:{id del hecho}`): el mismo hecho nunca paga dos
 * veces, aunque lo procesen dos transacciones a la vez (único `factKey`, clave
 * de idempotencia del movimiento y bloqueo de la cuenta).
 *
 * Reglas comunes (el monto sale del catálogo vigente, nunca del código):
 *  - Entrada ausente, inactiva o que no es REWARD: no hay premio (`NOT_IN_CATALOG`).
 *  - Tope diario y mensual de premios por titular (ajustes `REWARD_CAP_*`, día y mes
 *    de Lima). Excluye el bono de bienvenida (no se registra aquí). Si el premio no
 *    cabe entero, no se otorga (`CAP_REACHED_*`): el hecho se conserva y, si el
 *    hecho puede volver a evaluarse (perfil, verificación), se reintenta después.
 *  - Límite mensual por acción opcional (referidos, respuestas a tiempo).
 *  - Los premios NO cuentan para el tope de gasto (`CurrencyActionUse`).
 *
 * Todo ocurre DENTRO de la transacción del hecho que lo dispara: si el hecho se
 * revierte, el premio desaparece con él. `tryGrant` además aísla un fallo del
 * premio con un SAVEPOINT para no perder el hecho (ver su documentación).
 */
export type RewardRequest = ActionSubject & {
  actionKey: string;
  /** Identifica el hecho dentro de la acción (`{userId}`, `{invitationId}`...). */
  fact: string;
  related: { type: string; id: string };
  reason: string;
  /** Límite de premios de esta acción por titular y mes de Lima, tomado de un ajuste. */
  monthlyLimit?: CurrencySettingKey;
};

export type RewardSkipReason = 'NOT_IN_CATALOG' | 'CAP_REACHED_DAILY' | 'CAP_REACHED_MONTHLY' | 'LIMIT_REACHED' | 'ERROR';
export type RewardOutcome =
  | { granted: true; idempotent: boolean; amount: number }
  | { granted: false; reason: RewardSkipReason };

export const rewardFactKey = (actionKey: string, fact: string) => `${actionKey}:${fact}`;

const CAP_SETTINGS: Readonly<Record<CurrencyAccountOwnerType, { daily: CurrencySettingKey; monthly: CurrencySettingKey }>> = {
  WORKER: { daily: 'REWARD_CAP_DAILY_WORKER', monthly: 'REWARD_CAP_MONTHLY_WORKER' },
  COMPANY: { daily: 'REWARD_CAP_DAILY_COMPANY', monthly: 'REWARD_CAP_MONTHLY_COMPANY' },
};

export function rewardCapSettings(actor: CurrencyAccountOwnerType) {
  return CAP_SETTINGS[actor];
}

export class CurrencyRewardService {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  now() {
    return this.clock();
  }

  private async accountId(tx: Tx, subject: ActionSubject) {
    const account = subject.actor === 'WORKER'
      ? await tx.currencyAccount.upsert({ where: { workerId: subject.subjectId }, create: { ownerType: 'WORKER', workerId: subject.subjectId }, update: {} })
      : await tx.currencyAccount.upsert({ where: { companyId: subject.subjectId }, create: { ownerType: 'COMPANY', companyId: subject.subjectId }, update: {} });
    return account.id;
  }

  /** Monedas ganadas por premios por el titular entre `start` (incluido) y `end` (excluido). */
  private async earned(tx: Tx, userId: string, actor: CurrencyAccountOwnerType, window: { start: Date; end: Date }) {
    const sum = await tx.currencyRewardGrant.aggregate({
      _sum: { amount: true },
      where: { userId, actor, occurredAt: { gte: window.start, lt: window.end } },
    });
    return sum._sum.amount ?? 0;
  }

  /**
   * Otorga el premio del hecho dentro de la transacción en curso. Idempotente:
   * repetirlo devuelve `granted: true, idempotent: true` sin escribir nada. No
   * lanza por reglas de negocio (catálogo, topes); solo por fallos técnicos.
   */
  async grant(tx: Tx, request: RewardRequest): Promise<RewardOutcome> {
    const entry = await tx.currencyCatalogEntry.findUnique({ where: { actionKey_actor: { actionKey: request.actionKey, actor: request.actor } } });
    if (!entry || !entry.active || entry.kind !== 'REWARD') return { granted: false, reason: 'NOT_IN_CATALOG' };
    const factKey = rewardFactKey(request.actionKey, request.fact);
    // Camino frecuente (guardar un perfil ya premiado): el hecho ya pagó, no hace falta tocar ni bloquear la cuenta.
    const already = await tx.currencyRewardGrant.findUnique({ where: { factKey } });
    if (already) return { granted: true, idempotent: true, amount: already.amount };
    const accountId = await this.accountId(tx, request);
    // Cuenta bloqueada: dos premios del mismo titular se encadenan y ven el tope ya consumido.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CurrencyAccount" WHERE "id" = ${accountId} FOR UPDATE`);
    const existing = await tx.currencyRewardGrant.findUnique({ where: { factKey } });
    if (existing) return { granted: true, idempotent: true, amount: existing.amount };

    const now = this.now();
    const caps = CAP_SETTINGS[request.actor];
    const [dailyCap, monthlyCap] = await Promise.all([readCurrencySetting(tx, caps.daily), readCurrencySetting(tx, caps.monthly)]);
    if (await this.earned(tx, request.userId, request.actor, limaDayWindow(now)) + entry.amount > dailyCap) return { granted: false, reason: 'CAP_REACHED_DAILY' };
    if (await this.earned(tx, request.userId, request.actor, limaMonthWindow(now)) + entry.amount > monthlyCap) return { granted: false, reason: 'CAP_REACHED_MONTHLY' };
    if (request.monthlyLimit) {
      const limit = await readCurrencySetting(tx, request.monthlyLimit);
      const month = limaMonthWindow(now);
      const used = await tx.currencyRewardGrant.count({ where: { userId: request.userId, actor: request.actor, actionKey: request.actionKey, occurredAt: { gte: month.start, lt: month.end } } });
      if (used >= limit) return { granted: false, reason: 'LIMIT_REACHED' };
    }

    const { movement } = await appendMovementTx(tx, {
      accountId,
      quantity: entry.amount,
      action: 'REWARD',
      actionKey: request.actionKey,
      reason: request.reason,
      related: request.related,
      idempotencyKey: `reward:${factKey}`,
    });
    await tx.currencyRewardGrant.create({
      data: {
        userId: request.userId,
        actor: request.actor,
        actionKey: request.actionKey,
        factKey,
        amount: movement.quantity,
        movementId: movement.id,
        relatedEntityType: request.related.type,
        relatedEntityId: request.related.id,
        occurredAt: now,
      },
    });
    return { granted: true, idempotent: false, amount: movement.quantity };
  }

  /**
   * Igual que `grant`, pero un fallo técnico del premio NO deshace el hecho que lo
   * disparó: el intento corre dentro de un SAVEPOINT y, si falla, se revierte solo
   * el premio (se registra `REWARD_FAILED` y se devuelve `ERROR`). Los conflictos de
   * serialización y los interbloqueos SÍ se propagan: abortan la transacción entera
   * y quien la ejecutó la reintenta completa (hecho y premio juntos).
   */
  async tryGrant(tx: Tx, request: RewardRequest): Promise<RewardOutcome> {
    await tx.$executeRawUnsafe('SAVEPOINT reward_attempt');
    try {
      const outcome = await this.grant(tx, request);
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT reward_attempt');
      return outcome;
    } catch (error) {
      if (isRetryableTransactionError(error)) throw error;
      try {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT reward_attempt');
      } catch {
        // No se pudo aislar el fallo: la transacción ya no es utilizable, que lo gestione quien la abrió.
        throw error;
      }
      console.error('REWARD_FAILED', request.actionKey, request.fact, error);
      return { granted: false, reason: 'ERROR' };
    }
  }
}
