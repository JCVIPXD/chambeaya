import { createHash } from 'node:crypto';

import { Prisma, PrismaClient, type WorkerDocumentKind } from '@prisma/client';

import { withSerializableRetry } from '../operations/serializable-retry.js';
import { CurrencyRewardService, type RewardOutcome } from './currency.rewards.js';
import { PrivateDocumentStorage } from '../talent/private_document_storage.js';
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
 * CN-20261012-049 (BAJO-3): la verificación queda LIGADA al archivo concreto revisado. El admin lista
 * los documentos (`listDocuments`, con una `version` opaca por archivo), descarga el archivo
 * (`downloadDocument`) y verifica enviando esa `version`; si el trabajador lo reemplazó mientras
 * tanto, responde `409 DOCUMENT_CHANGED` y no verifica nada. La versión es un hash de la clave de
 * almacenamiento (no la expone y cambia con cada archivo nuevo). Cada verificación y cada retiro
 * (con su motivo) quedan en un historial con autor y fecha; retirar no devuelve ni descuenta
 * nada y volver a verificar no vuelve a pagar (el premio sigue siendo uno por tipo).
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
const HISTORY_PAGE = 20;

/** Identificador opaco del archivo vigente: cambia con cada archivo nuevo y no revela la clave de almacenamiento. */
export function documentVersion(document: { id: string; storageKey: string }): string {
  return createHash('sha256').update(`${document.id}:${document.storageKey}`).digest('hex').slice(0, 32);
}

export class CurrencyVerificationService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly rewards: CurrencyRewardService = new CurrencyRewardService(),
    private readonly storage: PrivateDocumentStorage = new PrivateDocumentStorage(),
  ) {}

  /** Documentos del trabajador con su versión, tamaño, fecha, estado de verificación y últimos cambios. Sin la clave de almacenamiento. */
  async listDocuments(workerId: string) {
    const worker = await this.prisma.user.findFirst({ where: { id: workerId, role: 'WORKER' }, select: { id: true } });
    if (!worker) throw new CurrencyError('WORKER_NOT_FOUND', 404);
    const documents = await this.prisma.workerDocument.findMany({ where: { userId: workerId }, orderBy: { kind: 'asc' } });
    const history = await this.prisma.workerDocumentVerificationChange.findMany({
      where: { userId: workerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_PAGE * 2,
    });
    return {
      documents: documents.map((document) => ({
        kind: document.kind,
        id: document.id,
        version: documentVersion(document),
        originalName: document.originalName,
        mediaType: document.mediaType,
        sizeBytes: document.sizeBytes,
        uploadedAt: document.uploadedAt ?? document.createdAt,
        verified: document.verifiedAt !== null,
        verifiedAt: document.verifiedAt,
        verifiedById: document.verifiedById,
        history: history.filter((change) => change.kind === document.kind).slice(0, HISTORY_PAGE).map((change) => ({
          action: change.action, reason: change.reason, changedById: change.changedById, documentVersion: change.documentVersion, createdAt: change.createdAt,
        })),
      })),
    };
  }

  /** Archivo del trabajador para que el admin lo revise. Solo se llama desde una ruta `ADMIN`; la clave de almacenamiento no sale de aquí. */
  async downloadDocument(workerId: string, kind: WorkerDocumentKind) {
    const document = await this.prisma.workerDocument.findUnique({ where: { userId_kind: { userId: workerId, kind } } });
    if (!document) throw new CurrencyError('DOCUMENT_NOT_FOUND', 404);
    try {
      return { originalName: document.originalName, mediaType: document.mediaType, version: documentVersion(document), bytes: await this.storage.read(document.storageKey) };
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') {
        // Reemplazado entre la lectura de la fila y la del archivo: el admin debe volver a listar.
        const current = await this.prisma.workerDocument.findUnique({ where: { userId_kind: { userId: workerId, kind } }, select: { storageKey: true } });
        throw current && current.storageKey !== document.storageKey ? new CurrencyError('DOCUMENT_CHANGED', 409) : new CurrencyError('DOCUMENT_FILE_NOT_FOUND', 404);
      }
      throw error;
    }
  }

  verifyDocument(adminId: string, workerId: string, kind: WorkerDocumentKind, expectedVersion: string): Promise<VerificationResult & { documentVersion: string }> {
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "WorkerDocument" WHERE "userId" = ${workerId} AND "kind"::text = ${kind} FOR UPDATE`);
      if (locked.length === 0) throw new CurrencyError('DOCUMENT_NOT_FOUND', 404);
      const document = await tx.workerDocument.findUniqueOrThrow({ where: { id: locked[0]!.id } });
      const version = documentVersion(document);
      // El archivo que el admin revisó ya no es el vigente: no se verifica uno que no vio.
      if (version !== expectedVersion) throw new CurrencyError('DOCUMENT_CHANGED', 409);
      const alreadyVerified = document.verifiedAt !== null;
      const verified = alreadyVerified
        ? document
        : await tx.workerDocument.update({ where: { id: document.id }, data: { verifiedAt: this.rewards.now(), verifiedById: adminId } });
      if (!alreadyVerified) {
        await tx.workerDocumentVerificationChange.create({ data: { userId: workerId, kind, documentVersion: version, action: 'VERIFIED', changedById: adminId } });
      }
      const outcome = await this.rewards.tryGrant(tx, {
        actor: 'WORKER', userId: workerId, subjectId: workerId, actionKey: 'DOCUMENT_VERIFIED', fact: `${workerId}:${kind}`,
        related: { type: 'WorkerDocument', id: document.id },
        reason: kind === 'CV' ? 'CV verificado' : 'Foto de perfil verificada',
      });
      return { verified: true, alreadyVerified, verifiedAt: verified.verifiedAt, verifiedById: verified.verifiedById, documentVersion: version, reward: rewardView(outcome) };
    }, SERIALIZABLE));
  }

  /** Quita la verificación con motivo y la registra en el historial. Idempotente: si no estaba verificada no escribe nada. */
  unverifyDocument(adminId: string, workerId: string, kind: WorkerDocumentKind, reason: string) {
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "WorkerDocument" WHERE "userId" = ${workerId} AND "kind"::text = ${kind} FOR UPDATE`);
      if (locked.length === 0) throw new CurrencyError('DOCUMENT_NOT_FOUND', 404);
      const document = await tx.workerDocument.findUniqueOrThrow({ where: { id: locked[0]!.id } });
      if (document.verifiedAt === null) return { verified: false, alreadyUnverified: true };
      await tx.workerDocument.update({ where: { id: document.id }, data: { verifiedAt: null, verifiedById: null } });
      await tx.workerDocumentVerificationChange.create({
        data: { userId: workerId, kind, documentVersion: documentVersion(document), action: 'UNVERIFIED', reason, changedById: adminId },
      });
      return { verified: false, alreadyUnverified: false };
    }, SERIALIZABLE));
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
      if (!alreadyVerified) await tx.companyVerificationChange.create({ data: { companyId, action: 'VERIFIED', changedById: adminId } });
      const outcome = await this.rewards.tryGrant(tx, {
        actor: 'COMPANY', userId: company.ownerId, subjectId: company.id, actionKey: 'COMPANY_VERIFIED', fact: company.id,
        related: { type: 'Company', id: company.id },
        reason: 'Empresa verificada',
      });
      return { verified: true, alreadyVerified, verifiedAt: verified.verifiedAt, verifiedById: verified.verifiedById, reward: rewardView(outcome) };
    }, SERIALIZABLE));
  }

  unverifyCompany(adminId: string, companyId: string, reason: string) {
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`);
      if (locked.length === 0) throw new CurrencyError('COMPANY_NOT_FOUND', 404);
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      if (company.verifiedAt === null) return { verified: false, alreadyUnverified: true };
      await tx.company.update({ where: { id: companyId }, data: { verifiedAt: null, verifiedById: null } });
      await tx.companyVerificationChange.create({ data: { companyId, action: 'UNVERIFIED', reason, changedById: adminId } });
      return { verified: false, alreadyUnverified: false };
    }, SERIALIZABLE));
  }
}
