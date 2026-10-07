import { Prisma, PrismaClient, type CurrencyActionUse } from '@prisma/client';

import { REFUND_RELATED_TYPES } from './currency.actions.js';
import { withSerializableRetry } from '../operations/serializable-retry.js';
import { appendMovementTx } from './currency.service.js';

/**
 * Devolución automática (M4). Un cobro con ventana de devolución en el catálogo
 * (`refundWindowHours`: 72 h provisional) se devuelve al cumplirse el plazo si la
 * otra parte no respondió:
 *  - `TALENT_INVITE`: la invitación no fue respondida a tiempo (el trabajador no
 *    la aceptó ni la rechazó hasta el plazo).
 *  - `APPLICATION_EXTRA` y `APPLICATION_PRIORITY`: la empresa no movió la
 *    postulación (ningún evento de la empresa) hasta el plazo y el trabajador
 *    tampoco se retiró antes.
 * El plazo se congela al cobrar (`CurrencyActionUse.refundDueAt`): cambiar el
 * catálogo después no altera cobros ya hechos.
 *
 * Seguro con varias instancias de la API: cada cobro vencido se reclama en su
 * propia transacción con `FOR UPDATE SKIP LOCKED` (una instancia que ve la fila
 * bloqueada por otra la salta); la unicidad de `refundOfId` y de la clave de
 * idempotencia `refund:{movimiento}` garantiza una sola devolución por cobro
 * aunque todo lo demás fallara. Una transacción por cobro (y no por lote) evita
 * interbloqueos entre instancias que bloquean varias cuentas en distinto orden.
 */
export type RefundSweepResult = { refunded: number; notEligible: number; amount: number };

export const REFUND_BATCH_LIMIT = 200;

export class CurrencyRefundService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Procesa los cobros vencidos (hasta `limit`). Idempotente: una segunda pasada no devuelve nada. */
  async sweep(limit = REFUND_BATCH_LIMIT): Promise<RefundSweepResult> {
    const result: RefundSweepResult = { refunded: 0, notEligible: 0, amount: 0 };
    for (let processed = 0; processed < limit; processed += 1) {
      const outcome = await this.processNext();
      if (outcome === 'EMPTY') break;
      if (outcome.kind === 'REFUNDED') { result.refunded += 1; result.amount += outcome.amount; }
      else result.notEligible += 1;
    }
    return result;
  }

  private async processNext(): Promise<'EMPTY' | { kind: 'REFUNDED'; amount: number } | { kind: 'NOT_ELIGIBLE' }> {
    // Serializable con reintento: un cobro concurrente sobre la misma cuenta no debe dejar un
    // P2002 (accountId, sequence) sin reintentar (BAJO-1 de CN-20261007-044). El reintento vuelve a
    // reclamar la fila, así que no deja nada aplicado ni duplicado.
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      // La columna es `timestamp` sin zona (UTC): el instante se pasa como texto ISO y se convierte con
      // `CAST ... AS timestamp`, que no depende de la zona horaria de la sesión de PostgreSQL.
      const claimed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "CurrencyActionUse"
        WHERE "refundSettledAt" IS NULL AND "refundDueAt" IS NOT NULL AND "refundDueAt" <= CAST(${now.toISOString()} AS timestamp) AND "chargedAmount" > 0
        ORDER BY "refundDueAt" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`);
      if (claimed.length === 0) return 'EMPTY' as const;
      const use = await tx.currencyActionUse.findUniqueOrThrow({ where: { id: claimed[0]!.id } });
      if (!use.movementId || !use.accountId || !(await this.isEligible(tx, use))) {
        await tx.currencyActionUse.update({ where: { id: use.id }, data: { refundSettledAt: now } });
        return { kind: 'NOT_ELIGIBLE' as const };
      }
      const { movement } = await appendMovementTx(tx, {
        accountId: use.accountId,
        quantity: use.chargedAmount,
        action: 'ACTION_REFUND',
        actionKey: use.actionKey,
        reason: 'Devolución automática: la otra parte no respondió a tiempo',
        related: use.relatedEntityType && use.relatedEntityId ? { type: use.relatedEntityType, id: use.relatedEntityId } : null,
        idempotencyKey: `refund:${use.movementId}`,
        refundOfId: use.movementId,
      });
      await tx.currencyActionUse.update({ where: { id: use.id }, data: { refundSettledAt: now, refundMovementId: movement.id } });
      return { kind: 'REFUNDED' as const, amount: use.chargedAmount };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 }));
  }

  /** `true` si, al cumplirse el plazo, la otra parte no había respondido. */
  private async isEligible(tx: Prisma.TransactionClient, use: CurrencyActionUse) {
    const due = use.refundDueAt!;
    if (!use.relatedEntityId) return false;
    if (use.actionKey === 'TALENT_INVITE' && use.relatedEntityType === REFUND_RELATED_TYPES.TALENT_INVITE) {
      const invitation = await tx.talentInvitation.findUnique({ where: { id: use.relatedEntityId }, select: { respondedAt: true } });
      if (!invitation) return false;
      return !(invitation.respondedAt && invitation.respondedAt.getTime() <= due.getTime());
    }
    if ((use.actionKey === 'APPLICATION_EXTRA' || use.actionKey === 'APPLICATION_PRIORITY') && use.relatedEntityType === REFUND_RELATED_TYPES.APPLICATION_EXTRA) {
      const application = await tx.jobApplication.findUnique({ where: { id: use.relatedEntityId }, select: { id: true } });
      if (!application) return false;
      // Respuesta de la empresa (cualquier evento suyo) o retiro del trabajador, ambos
      // dentro del plazo: no hay devolución. Un cambio posterior al plazo no la quita.
      const settledByDeadline = await tx.jobApplicationEvent.count({
        where: {
          applicationId: application.id,
          createdAt: { lte: due },
          OR: [{ actorRole: 'BUSINESS' }, { type: 'WITHDRAWN' }, { type: 'OFFER_DECLINED' }],
        },
      });
      return settledByDeadline === 0;
    }
    return false;
  }
}

/**
 * Tarea programada en proceso. Cada instancia de la API puede ejecutarla: la
 * reclamación con `SKIP LOCKED` evita el doble pago. Un error en una pasada se
 * registra y no detiene las siguientes.
 */
export function startRefundScheduler(service: CurrencyRefundService, intervalMs: number, log: (message: string, error?: unknown) => void = (message, error) => console.error(message, error)) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    service.sweep().catch((error: unknown) => log('[currency] la devolución automática falló', error)).finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
