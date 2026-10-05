import { Prisma, PrismaClient, type CurrencyAccountOwnerType, type CurrencyMovement } from '@prisma/client';

import { withSerializableRetry } from '../operations/serializable-retry.js';
import { virtualCurrencyName } from './currency.config.js';

export class CurrencyError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number) {
    super(code);
  }
}

export type CurrencyMovementPage = { limit: number; cursor?: string };
export type CurrencyAdjustment = {
  quantity: number;
  reason: string;
  idempotencyKey: string;
  actorId: string;
};

type Subject = { ownerType: CurrencyAccountOwnerType; workerId?: string; companyId?: string };
type MovementWithActor = CurrencyMovement & { createdBy: { id: string; name: string } | null };

const movementInclude = { createdBy: { select: { id: true, name: true } } } as const;
const MAX_CURRENCY_BALANCE = 2_147_483_647;

function asSubject(ownerType: CurrencyAccountOwnerType, id: string): Subject {
  return ownerType === 'WORKER' ? { ownerType, workerId: id } : { ownerType, companyId: id };
}

function movementView(movement: MovementWithActor) {
  return {
    id: movement.id,
    sequence: movement.sequence,
    quantity: movement.quantity,
    balanceAfter: movement.balanceAfter,
    action: movement.action,
    reason: movement.reason,
    relatedEntity: movement.relatedEntityType && movement.relatedEntityId
      ? { type: movement.relatedEntityType, id: movement.relatedEntityId }
      : null,
    actor: movement.createdBy,
    createdAt: movement.createdAt,
  };
}

/**
 * Libro mayor de Chambitas. No mantiene una columna de saldo: cada escritura
 * relee el último movimiento de la cuenta y agrega una fila. La corrección
 * bajo concurrencia (sin saldo negativo ni doble gasto) NO la da el bloqueo de
 * fila: la sostienen el aislamiento `Serializable` (SSI aborta con 40001 a
 * quien leyó un saldo ya superado y `withSerializableRetry` reintenta), el
 * índice único `(accountId, sequence)` y el `CHECK balanceAfter >= 0`. Con
 * mucha contención sobre una misma cuenta los reintentos pueden agotarse y
 * responder 500; el estado final sigue siendo correcto. M1 y los débitos de M4
 * usan este mismo camino.
 */
export class CurrencyLedgerService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly currencyName = virtualCurrencyName(),
  ) {}

  private async accountFor(subject: Subject, create: boolean) {
    if (subject.ownerType === 'WORKER') {
      if (!subject.workerId) throw new Error('INVALID_CURRENCY_SUBJECT');
      return create
        ? this.prisma.currencyAccount.upsert({ where: { workerId: subject.workerId }, create: { ownerType: 'WORKER', workerId: subject.workerId }, update: {} })
        : this.prisma.currencyAccount.findUnique({ where: { workerId: subject.workerId } });
    }
    if (!subject.companyId) throw new Error('INVALID_CURRENCY_SUBJECT');
    return create
      ? this.prisma.currencyAccount.upsert({ where: { companyId: subject.companyId }, create: { ownerType: 'COMPANY', companyId: subject.companyId }, update: {} })
      : this.prisma.currencyAccount.findUnique({ where: { companyId: subject.companyId } });
  }

  private async subjectExists(subject: Subject) {
    if (subject.ownerType === 'WORKER') {
      const worker = await this.prisma.user.findFirst({ where: { id: subject.workerId, role: 'WORKER' }, select: { id: true } });
      if (!worker) throw new CurrencyError('WORKER_NOT_FOUND', 404);
      return;
    }
    const company = await this.prisma.company.findUnique({ where: { id: subject.companyId }, select: { id: true } });
    if (!company) throw new CurrencyError('COMPANY_NOT_FOUND', 404);
  }

  private async latestBalance(accountId: string) {
    const latest = await this.prisma.currencyMovement.findFirst({ where: { accountId }, orderBy: { sequence: 'desc' }, select: { balanceAfter: true } });
    return latest?.balanceAfter ?? 0;
  }

  async balanceForWorker(workerId: string) {
    const account = await this.accountFor(asSubject('WORKER', workerId), false);
    return { currency: this.currencyName, balance: account ? await this.latestBalance(account.id) : 0 };
  }

  async balanceForBusiness(ownerId: string) {
    const company = await this.prisma.company.findUnique({ where: { ownerId }, select: { id: true } });
    if (!company) return { currency: this.currencyName, balance: 0 };
    const account = await this.accountFor(asSubject('COMPANY', company.id), false);
    return { currency: this.currencyName, balance: account ? await this.latestBalance(account.id) : 0 };
  }

  private async movementPage(subject: Subject, page: CurrencyMovementPage) {
    const account = await this.accountFor(subject, false);
    if (!account) return { currency: this.currencyName, items: [], nextCursor: null };
    let cursorSequence: number | undefined;
    if (page.cursor) {
      const cursor = await this.prisma.currencyMovement.findFirst({ where: { id: page.cursor, accountId: account.id }, select: { sequence: true } });
      if (!cursor) throw new CurrencyError('INVALID_CURSOR', 400);
      cursorSequence = cursor.sequence;
    }
    const rows = await this.prisma.currencyMovement.findMany({
      where: { accountId: account.id, ...(cursorSequence === undefined ? {} : { sequence: { lt: cursorSequence } }) },
      include: movementInclude,
      orderBy: { sequence: 'desc' },
      take: page.limit + 1,
    });
    const hasNext = rows.length > page.limit;
    const items = rows.slice(0, page.limit) as MovementWithActor[];
    return { currency: this.currencyName, items: items.map(movementView), nextCursor: hasNext ? items.at(-1)?.id ?? null : null };
  }

  movementsForWorker(workerId: string, page: CurrencyMovementPage) {
    return this.movementPage(asSubject('WORKER', workerId), page);
  }

  async movementsForBusiness(ownerId: string, page: CurrencyMovementPage) {
    const company = await this.prisma.company.findUnique({ where: { ownerId }, select: { id: true } });
    if (!company) return { currency: this.currencyName, items: [], nextCursor: null };
    return this.movementPage(asSubject('COMPANY', company.id), page);
  }

  private sameRequest(existing: CurrencyMovement, accountId: string, input: CurrencyAdjustment) {
    return existing.accountId === accountId
      && existing.quantity === input.quantity
      && existing.action === 'ADMIN_ADJUSTMENT'
      && existing.reason === input.reason
      && existing.createdById === input.actorId;
  }

  private async existingIdempotentMovement(accountId: string, input: CurrencyAdjustment) {
    const existing = await this.prisma.currencyMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: movementInclude });
    if (!existing) return null;
    if (!this.sameRequest(existing, accountId, input)) throw new CurrencyError('IDEMPOTENCY_KEY_REUSED', 409);
    return existing as MovementWithActor;
  }

  async adjust(ownerType: CurrencyAccountOwnerType, subjectId: string, input: CurrencyAdjustment) {
    const subject = asSubject(ownerType, subjectId);
    await this.subjectExists(subject);
    const account = await this.accountFor(subject, true);
    // `create: true` usa `upsert`; esta guarda deja explícita esa invariante
    // también para TypeScript y evita continuar si el adaptador cambiara.
    if (!account) throw new Error('CURRENCY_ACCOUNT_CREATION_FAILED');
    const existing = await this.existingIdempotentMovement(account.id, input);
    if (existing) return { idempotent: true, currency: this.currencyName, movement: movementView(existing) };

    try {
      const result = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
        // Este bloqueo solo reduce conflictos: bajo Serializable la instantánea
        // se fija en esta primera sentencia, antes de esperar, así que quien
        // espera puede haber leído un saldo anterior. La garantía real es SSI
        // (40001 + reintento), el único (accountId, sequence) y el CHECK.
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CurrencyAccount" WHERE "id" = ${account.id} FOR UPDATE`);
        const repeated = await tx.currencyMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: movementInclude });
        if (repeated) {
          if (!this.sameRequest(repeated, account.id, input)) throw new CurrencyError('IDEMPOTENCY_KEY_REUSED', 409);
          return { movement: repeated as MovementWithActor, idempotent: true };
        }
        const latest = await tx.currencyMovement.findFirst({ where: { accountId: account.id }, orderBy: { sequence: 'desc' }, select: { sequence: true, balanceAfter: true } });
        const balanceAfter = (latest?.balanceAfter ?? 0) + input.quantity;
        if (balanceAfter < 0) throw new CurrencyError('INSUFFICIENT_CURRENCY_BALANCE', 409);
        if (balanceAfter > MAX_CURRENCY_BALANCE) throw new CurrencyError('CURRENCY_BALANCE_LIMIT_EXCEEDED', 409);
        const movement = await tx.currencyMovement.create({
          data: {
            accountId: account.id,
            sequence: (latest?.sequence ?? 0) + 1,
            quantity: input.quantity,
            balanceAfter,
            action: 'ADMIN_ADJUSTMENT',
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            createdById: input.actorId,
          },
          include: movementInclude,
        }) as MovementWithActor;
        return { movement, idempotent: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      return { idempotent: result.idempotent, currency: this.currencyName, movement: movementView(result.movement) };
    } catch (error) {
      // Dos cuentas distintas que reciben por error la misma clave pueden
      // chocar en el índice global. Releer permite devolver 409 explícito y
      // hace idempotente el reintento legítimo que acabó de ganar otra sesión.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const repeated = await this.existingIdempotentMovement(account.id, input);
        if (repeated) return { idempotent: true, currency: this.currencyName, movement: movementView(repeated) };
      }
      throw error;
    }
  }
}
