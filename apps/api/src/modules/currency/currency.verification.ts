import { Prisma, PrismaClient, type WorkerDocumentKind } from '@prisma/client';

import { withSerializableRetry } from '../operations/serializable-retry.js';
import { CurrencyRewardService, type RewardOutcome } from './currency.rewards.js';
import { CurrencyError } from './currency.service.js';

/**
 * Verificaciones del administrador que disparan premios (M6).
 *
 * - Documento del trabajador (`CV` o `PROFILE_PHOTO`): el admin lo marca verificado con
 *   autor y fecha y el trabajador gana `DOCUMENT_VERIFIED`. Tope contra granjas: UN premio por
 *   TIPO de documento y trabajador (el hecho es `{trabajador}:{tipo}`); reemplazar el archivo
 *   quita la verificación pero re-verificarlo no vuelve a pagar.
 * - Empresa: el admin la marca verificada (autor y fecha) y gana `COMPANY_VERIFIED`, una vez.
 *
 * Verificar de nuevo algo ya verificado es idempotente (conserva autor y fecha originales) y
 * reintenta el premio si antes no cupo (tope) o falló: el hecho nunca se pierde por el premio.
 * Quitar la verificación no devuelve ni descuenta nada (el libro es solo de suma).
 */
export type VerificationResult = {
  verified: boolean;
  alreadyVerified: boolean;
  verifiedAt: Date | null;
  verifiedById: string | null;
  reward: { granted: boolean; amount: number; reason?: string };
};

function rewardView(outcome: RewardOutcome): VerificationResult['reward'] {
  return outcome.granted ? { granted: true, amount: outcome.amount } : { granted: false, amount: 0, reason: outcome.reason };
}

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 } as const;

export class CurrencyVerificationService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly rewards: CurrencyRewardService = new CurrencyRewardService(),
  ) {}

  verifyDocument(adminId: string, workerId: string, kind: WorkerDocumentKind): Promise<VerificationResult> {
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "WorkerDocument" WHERE "userId" = ${workerId} AND "kind"::text = ${kind} FOR UPDATE`);
      if (locked.length === 0) throw new CurrencyError('DOCUMENT_NOT_FOUND', 404);
      const document = await tx.workerDocument.findUniqueOrThrow({ where: { id: locked[0]!.id } });
      const alreadyVerified = document.verifiedAt !== null;
      const verified = alreadyVerified
        ? document
        : await tx.workerDocument.update({ where: { id: document.id }, data: { verifiedAt: this.rewards.now(), verifiedById: adminId } });
      const outcome = await this.rewards.tryGrant(tx, {
        actor: 'WORKER', userId: workerId, subjectId: workerId, actionKey: 'DOCUMENT_VERIFIED', fact: `${workerId}:${kind}`,
        related: { type: 'WorkerDocument', id: document.id },
        reason: kind === 'CV' ? 'CV verificado' : 'Foto de perfil verificada',
      });
      return { verified: true, alreadyVerified, verifiedAt: verified.verifiedAt, verifiedById: verified.verifiedById, reward: rewardView(outcome) };
    }, SERIALIZABLE));
  }

  async unverifyDocument(workerId: string, kind: WorkerDocumentKind) {
    const existing = await this.prisma.workerDocument.findUnique({ where: { userId_kind: { userId: workerId, kind } }, select: { id: true } });
    if (!existing) throw new CurrencyError('DOCUMENT_NOT_FOUND', 404);
    await this.prisma.workerDocument.updateMany({ where: { id: existing.id, verifiedAt: { not: null } }, data: { verifiedAt: null, verifiedById: null } });
    return { verified: false };
  }

  verifyCompany(adminId: string, companyId: string): Promise<VerificationResult> {
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`);
      if (locked.length === 0) throw new CurrencyError('COMPANY_NOT_FOUND', 404);
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const alreadyVerified = company.verifiedAt !== null;
      const verified = alreadyVerified
        ? company
        : await tx.company.update({ where: { id: companyId }, data: { verifiedAt: this.rewards.now(), verifiedById: adminId } });
      const outcome = await this.rewards.tryGrant(tx, {
        actor: 'COMPANY', userId: company.ownerId, subjectId: company.id, actionKey: 'COMPANY_VERIFIED', fact: company.id,
        related: { type: 'Company', id: company.id },
        reason: 'Empresa verificada',
      });
      return { verified: true, alreadyVerified, verifiedAt: verified.verifiedAt, verifiedById: verified.verifiedById, reward: rewardView(outcome) };
    }, SERIALIZABLE));
  }

  async unverifyCompany(companyId: string) {
    const result = await this.prisma.company.updateMany({ where: { id: companyId }, data: { verifiedAt: null, verifiedById: null } });
    if (result.count === 0) throw new CurrencyError('COMPANY_NOT_FOUND', 404);
    return { verified: false };
  }
}
