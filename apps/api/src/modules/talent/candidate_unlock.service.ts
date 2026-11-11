import { Prisma, PrismaClient } from '@prisma/client';

import type { AuthSession } from '../auth/auth.service.js';
import { CurrencyActionService, instanceKeys } from '../currency/currency.actions.js';
import { withSerializableRetry } from '../operations/serializable-retry.js';
import { PrivateDocumentStorage } from './private_document_storage.js';

export type CandidateUnlockErrorCode = 'BUSINESS_ACCOUNT_REQUIRED' | 'TALENT_PROFILE_NOT_AVAILABLE' | 'CONTACT_NOT_UNLOCKED' | 'CV_NOT_AVAILABLE';

export class CandidateUnlockError extends Error {
  constructor(public readonly code: CandidateUnlockErrorCode) {
    super(code);
  }
}

export const CANDIDATE_UNLOCK_ERROR_STATUS: Record<CandidateUnlockErrorCode, number> = {
  BUSINESS_ACCOUNT_REQUIRED: 403,
  TALENT_PROFILE_NOT_AVAILABLE: 404,
  CONTACT_NOT_UNLOCKED: 403,
  CV_NOT_AVAILABLE: 404,
};

export type CvFile = { originalName: string; mediaType: string; bytes: Buffer };

export interface CandidateUnlockOperations {
  unlock(session: AuthSession, workerTalentProfileId: string): Promise<unknown>;
  contact(session: AuthSession, workerTalentProfileId: string): Promise<unknown>;
  downloadCv(session: AuthSession, workerTalentProfileId: string): Promise<CvFile>;
  list(session: AuthSession): Promise<unknown>;
}

/** Postulaciones que ya le dan a la empresa acceso al candidato: no hace falta pagar por ellas. */
const ENGAGED_STATUSES_EXCLUDED = ['REJECTED', 'WITHDRAWN'] as const;

/**
 * Desbloqueo de contacto y CV de un candidato que no postuló (`CANDIDATE_CONTACT_UNLOCK`, M4).
 *
 * - Idempotente por (empresa, candidato): se paga una sola vez; repetirlo (doble clic,
 *   reintento) no cobra y devuelve el mismo acceso. La unicidad `(companyId, workerUserId)` y la
 *   clave de instancia `contact-unlock:{empresa}:{candidato}` lo garantizan bajo concurrencia.
 * - Gratis si el candidato ya tiene una postulación vigente a un puesto de la empresa
 *   (nunca se cobra por lo que ya se tiene).
 * - El acceso sigue sujeto al consentimiento del candidato: si oculta su perfil, deja de poder
 *   leerse el contacto y el CV (lo pagado no se reembolsa).
 * - Datos entregados: nombre y correo de la cuenta, y el CV si existe. Nunca el DNI.
 */
export class DatabaseCandidateUnlockService implements CandidateUnlockOperations {
  constructor(
    private readonly prisma = new PrismaClient(),
    private readonly actions: CurrencyActionService = new CurrencyActionService(),
    private readonly documents = new PrivateDocumentStorage(),
  ) {}

  private requireBusiness(session: AuthSession) {
    if (session.role !== 'BUSINESS') throw new CandidateUnlockError('BUSINESS_ACCOUNT_REQUIRED');
  }

  private companyFor(session: AuthSession) {
    return this.prisma.company.upsert({
      where: { ownerId: session.userId },
      update: {},
      create: { ownerId: session.userId, name: session.name, legalName: session.name, ruc: session.identifier },
    });
  }

  /** No enumeración: "no existe" y "no es visible" responden igual. */
  private async visibleProfile(workerTalentProfileId: string) {
    const profile = await this.prisma.workerTalentProfile.findFirst({
      where: { id: workerTalentProfileId, isVisible: true },
      select: { id: true, userId: true, user: { select: { name: true, email: true, documents: { where: { kind: 'CV' }, select: { id: true } } } } },
    });
    if (!profile) throw new CandidateUnlockError('TALENT_PROFILE_NOT_AVAILABLE');
    return profile;
  }

  async unlock(session: AuthSession, workerTalentProfileId: string) {
    this.requireBusiness(session);
    const company = await this.companyFor(session);
    const profile = await this.visibleProfile(workerTalentProfileId);
    const attempt = () => withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const existing = await tx.candidateContactUnlock.findUnique({ where: { companyId_workerUserId: { companyId: company.id, workerUserId: profile.userId } } });
      if (existing) return { idempotent: true, charged: 0, viaApplication: false };
      const viaApplication = await tx.jobApplication.count({
        where: { workerId: profile.userId, posting: { companyId: company.id }, status: { notIn: [...ENGAGED_STATUSES_EXCLUDED] } },
      }) > 0;
      let movementId: string | null = null;
      let charged = 0;
      if (!viaApplication) {
        const charge = await this.actions.charge(tx, {
          actor: 'COMPANY', userId: session.userId, subjectId: company.id, actionKey: 'CANDIDATE_CONTACT_UNLOCK',
          instanceKey: instanceKeys.contactUnlock(company.id, profile.userId),
          related: { type: 'WorkerTalentProfile', id: profile.id },
          reason: 'Desbloqueo de contacto y CV de un candidato',
        });
        movementId = charge.movementId;
        charged = charge.amount;
      }
      await tx.candidateContactUnlock.create({ data: { companyId: company.id, workerUserId: profile.userId, movementId } });
      return { idempotent: false, charged, viaApplication };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    let result: Awaited<ReturnType<typeof attempt>>;
    try {
      result = await attempt();
    } catch (error) {
      // Dos clics simultáneos: el único (empresa, candidato) hace perder al segundo; al repetir ve el desbloqueo.
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002') result = await attempt();
      else throw error;
    }
    return {
      unlocked: true,
      idempotent: result.idempotent,
      chargedAmount: result.charged,
      viaApplication: result.viaApplication,
      contact: { name: profile.user.name, email: profile.user.email },
      hasCv: profile.user.documents.length > 0,
    };
  }

  /** Lectura gratuita del contacto ya desbloqueado. */
  async contact(session: AuthSession, workerTalentProfileId: string) {
    this.requireBusiness(session);
    const company = await this.companyFor(session);
    const profile = await this.visibleProfile(workerTalentProfileId);
    const unlock = await this.prisma.candidateContactUnlock.findUnique({ where: { companyId_workerUserId: { companyId: company.id, workerUserId: profile.userId } } });
    if (!unlock) throw new CandidateUnlockError('CONTACT_NOT_UNLOCKED');
    return { unlocked: true, contact: { name: profile.user.name, email: profile.user.email }, hasCv: profile.user.documents.length > 0 };
  }

  /** Candidatos ya desbloqueados por la empresa (solo los de perfil visible). */
  async list(session: AuthSession) {
    this.requireBusiness(session);
    const company = await this.companyFor(session);
    const rows = await this.prisma.candidateContactUnlock.findMany({
      where: { companyId: company.id, worker: { talentProfile: { isVisible: true } } },
      select: { createdAt: true, worker: { select: { talentProfile: { select: { id: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.flatMap((row) => (row.worker.talentProfile ? [{ workerTalentProfileId: row.worker.talentProfile.id, unlockedAt: row.createdAt }] : [])) };
  }

  async downloadCv(session: AuthSession, workerTalentProfileId: string): Promise<CvFile> {
    this.requireBusiness(session);
    const company = await this.companyFor(session);
    const profile = await this.visibleProfile(workerTalentProfileId);
    const unlock = await this.prisma.candidateContactUnlock.findUnique({ where: { companyId_workerUserId: { companyId: company.id, workerUserId: profile.userId } } });
    if (!unlock) throw new CandidateUnlockError('CONTACT_NOT_UNLOCKED');
    const document = await this.prisma.workerDocument.findUnique({ where: { userId_kind: { userId: profile.userId, kind: 'CV' } } });
    if (!document) throw new CandidateUnlockError('CV_NOT_AVAILABLE');
    try {
      return { originalName: document.originalName, mediaType: 'application/pdf', bytes: await this.documents.read(document.storageKey) };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') throw new CandidateUnlockError('CV_NOT_AVAILABLE');
      throw error;
    }
  }
}
