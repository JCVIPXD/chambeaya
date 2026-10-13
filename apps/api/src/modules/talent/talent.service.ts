import { Prisma, PrismaClient } from '@prisma/client';

import type { AuthSession } from '../auth/auth.service.js';
import { instanceKeys, type CurrencyActionService } from '../currency/currency.actions.js';
import type { ProfileRewardService } from '../currency/currency.profile-rewards.js';
import { readCurrencySetting } from '../currency/currency.settings.js';
import { documentVersion } from '../currency/currency.verification.js';
import { withSerializableRetry } from '../operations/serializable-retry.js';
import { companyCanViewApplicantCv } from './cv_access.js';
import { PrivateDocumentStorage } from './private_document_storage.js';

export type TalentProfileInput = {
  headline?: string | null;
  bio?: string | null;
  district?: string | null;
  availabilityText?: string | null;
  availabilityDays?: string[];
  availabilityPeriods?: string[];
  isAvailable?: boolean;
  isVisible?: boolean;
  specialtyIds?: string[];
  specialties?: TalentSpecialtyInput[];
  workRadiusKm?: number | null;
  workDistricts?: string[];
  isExperienceVisible?: boolean;
  isCertificationsVisible?: boolean;
  isLanguagesVisible?: boolean;
  isWorkAreaVisible?: boolean;
  experiences?: TalentExperienceInput[];
  certifications?: TalentCertificationInput[];
  languages?: TalentLanguageInput[];
};

export type TalentSpecialtyInput = {
  specialtyId: string;
  proficiency: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  yearsExperience?: number | null;
};

export type TalentExperienceInput = {
  role: string;
  employer: string;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
};

/// Metadato declarado por el trabajador. A propósito no tiene ningún campo
/// de verificación (ver `WorkerCertification` en schema.prisma).
export type TalentCertificationInput = {
  name: string;
  issuer?: string | null;
  issueDate?: string | null;
  expirationDate?: string | null;
  credentialId?: string | null;
};

export type TalentLanguageInput = {
  language: string;
  proficiency: 'BASIC' | 'CONVERSATIONAL' | 'FLUENT' | 'NATIVE';
};

export type CvUploadInput = {
  originalName: string;
  mediaType: string;
  bytes: Buffer;
};

export type CvDownload = {
  originalName: string;
  mediaType: string;
  bytes: Buffer;
};

export type ProfilePhotoUploadInput = {
  originalName: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  bytes: Buffer;
};

export type ProfilePhotoDownload = {
  originalName: string;
  mediaType: string;
  bytes: Buffer;
};

export type TalentSearchInput = {
  specialtyId?: string;
  district?: string;
  query?: string;
  availableOnly?: boolean;
  cursor?: string;
  limit?: number;
};
export type AssignmentReviewInput = { rating: number; comment?: string };

export interface TalentOperations {
  ownProfile(session: AuthSession): Promise<unknown>;
  updateOwnProfile(session: AuthSession, input: TalentProfileInput): Promise<unknown>;
  listSpecialties(): Promise<unknown>;
  searchTalent(session: AuthSession, input: TalentSearchInput): Promise<unknown>;
  /** M6: destaca el perfil propio en la búsqueda de talento (`PROFILE_HIGHLIGHT`, con costo). */
  highlightOwnProfile(session: AuthSession): Promise<unknown>;
  createAssignmentReview(session: AuthSession, assignmentId: string, input: AssignmentReviewInput): Promise<unknown>;
  uploadCv(session: AuthSession, input: CvUploadInput): Promise<unknown>;
  downloadCv(session: AuthSession): Promise<CvDownload | null>;
  downloadApplicantCv(session: AuthSession, shiftId: string, applicationId: string): Promise<CvDownload>;
  uploadProfilePhoto(session: AuthSession, input: ProfilePhotoUploadInput): Promise<unknown>;
  downloadProfilePhoto(session: AuthSession): Promise<ProfilePhotoDownload | null>;
}

export class TalentError extends Error {
  constructor(public readonly code: 'WORKER_ACCOUNT_REQUIRED' | 'BUSINESS_ACCOUNT_REQUIRED' | 'SPECIALTY_NOT_FOUND' | 'REVIEW_NOT_ELIGIBLE' | 'REVIEW_ALREADY_EXISTS' | 'APPLICATION_NOT_FOUND' | 'CV_NOT_AVAILABLE' | 'PROFILE_NOT_VISIBLE') {
    super(code);
  }
}

const profileInclude = {
  user: {
    select: {
      id: true,
      name: true,
      reviewsReceived: { select: { rating: true } },
      documents: {
        select: { kind: true, originalName: true, mediaType: true, sizeBytes: true, updatedAt: true },
      },
    },
  },
  specialties: { include: { specialty: true }, orderBy: { specialty: { name: 'asc' as const } } },
  experiences: { orderBy: { startDate: 'desc' as const } },
  certifications: { orderBy: { createdAt: 'desc' as const } },
  languages: { orderBy: { language: 'asc' as const } },
};

/** Motivo del historial cuando reemplazar el archivo retira una verificación (autor nulo: lo hace el sistema). */
export const REPLACEMENT_UNVERIFY_REASON = 'verificación retirada por reemplazo';

export class DatabaseTalentService implements TalentOperations {
  constructor(
    private readonly prisma = new PrismaClient(),
    private readonly documents = new PrivateDocumentStorage(),
    /** M6: premios de perfil. Sin él nada se otorga (pruebas con un cliente simulado); `createApp` lo inyecta. */
    private readonly rewards?: ProfileRewardService,
    /** M6: cobro de `PROFILE_HIGHLIGHT`. Sin él destacar el perfil no cobra (pruebas); `createApp` lo inyecta. */
    private readonly charging?: CurrencyActionService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Ejecuta `work` y, si hay premios, evalúa el perfil en la MISMA transacción
   * `Serializable` (con reintento): el cambio y su premio son todo-o-nada y dos
   * guardados simultáneos nunca pagan dos veces (único del hecho + reintento).
   */
  private async withProfileRewards<T>(userId: string, work: (client: Prisma.TransactionClient | PrismaClient) => Promise<T>): Promise<T> {
    const rewards = this.rewards;
    if (!rewards) return work(this.prisma);
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const result = await work(tx);
      await rewards.evaluate(tx, userId);
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 }));
  }


  /**
   * Guarda (crea o reemplaza) un documento del trabajador. Si el archivo reemplazado estaba verificado,
   * la verificación se retira y queda una fila de historial (`UNVERIFIED`, sin autor: lo hizo el sistema al
   * reemplazar, no un admin) con la versión del archivo que se verificó y el motivo. Corre en el mismo
   * cliente (transacción) que el resto del guardado.
   */
  private async replaceDocument(client: Prisma.TransactionClient | PrismaClient, userId: string, kind: 'CV' | 'PROFILE_PHOTO', stored: { originalName: string; mediaType: string; sizeBytes: number; storageKey: string }) {
    const previous = await client.workerDocument.findUnique({ where: { userId_kind: { userId, kind } } });
    const document = await client.workerDocument.upsert({
      where: { userId_kind: { userId, kind } },
      create: { userId, kind, ...stored, uploadedAt: this.clock() },
      update: { ...stored, uploadedAt: this.clock(), verifiedAt: null, verifiedById: null },
    });
    if (previous?.verifiedAt && previous.storageKey !== stored.storageKey) {
      await client.workerDocumentVerificationChange.create({
        data: { userId, kind, documentVersion: documentVersion(previous), action: 'UNVERIFIED', reason: REPLACEMENT_UNVERIFY_REASON, changedById: null },
      });
    }
    return document;
  }

  async ownProfile(session: AuthSession) {
    this.requireWorker(session);
    const profile = await this.prisma.workerTalentProfile.upsert({
      where: { userId: session.userId },
      create: { userId: session.userId },
      update: {},
      include: profileInclude,
    });
    return toOwnProfile(profile);
  }

  async updateOwnProfile(session: AuthSession, input: TalentProfileInput) {
    this.requireWorker(session);
    const specialties = selectionsFrom(input);
    if (specialties) await this.requireSpecialties(specialties.map((item) => item.specialtyId));
    const experiences = input.experiences?.map(toExperienceRecord);
    const certifications = input.certifications?.map(toCertificationRecord);
    const languages = input.languages?.map(toLanguageRecord);
    const profile = await this.withProfileRewards(session.userId, (client) => client.workerTalentProfile.upsert({
      where: { userId: session.userId },
      create: {
        userId: session.userId,
        ...withoutRelational(input),
        specialties: specialties ? { create: specialties.map(toSpecialtyRecord) } : undefined,
        experiences: experiences ? { create: experiences } : undefined,
        certifications: certifications ? { create: certifications } : undefined,
        languages: languages ? { create: languages } : undefined,
      },
      update: {
        ...withoutRelational(input),
        specialties: specialties
          ? { deleteMany: {}, create: specialties.map(toSpecialtyRecord) }
          : undefined,
        experiences: experiences ? { deleteMany: {}, create: experiences } : undefined,
        certifications: certifications ? { deleteMany: {}, create: certifications } : undefined,
        languages: languages ? { deleteMany: {}, create: languages } : undefined,
      },
      include: profileInclude,
    }));
    return toOwnProfile(profile);
  }

  async listSpecialties() {
    return this.prisma.specialty.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, category: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Búsqueda de talento con orden preferente (M6, `PROFILE_HIGHLIGHT`): primero los perfiles
   * destacados vigentes y luego el resto; en cada segmento por `id` ascendente. El cursor es
   * opaco y recuerda el segmento (`H`/`N`), el último `id` y el INSTANTE de la primera página:
   * la partición destacados/resto se evalúa siempre con ese instante, de modo que un destacado
   * que vence o se compra a mitad de la paginación no hace que una fila se repita ni se salte
   * (`highlightedAt <= instante < highlightedUntil` es destacado; lo demás, resto). Un cursor
   * antiguo (un `id` simple) se interpreta como continuación del segmento resto.
   */
  async searchTalent(session: AuthSession, input: TalentSearchInput) {
    this.requireBusiness(session);
    const limit = input.limit ?? 20;
    const query = input.query?.trim();
    const now = this.clock();
    const cursor = decodeTalentCursor(input.cursor, now);
    const at = cursor?.at ?? now;
    const filters: Prisma.WorkerTalentProfileWhereInput = {
      isVisible: true,
      ...(input.availableOnly ? { isAvailable: true } : {}),
      ...(input.district ? { district: { equals: input.district, mode: 'insensitive' } } : {}),
      ...(input.specialtyId ? { specialties: { some: { specialtyId: input.specialtyId } } } : {}),
      ...(query
        ? {
            OR: [
              { headline: { contains: query, mode: 'insensitive' } },
              { district: { contains: query, mode: 'insensitive' } },
              { user: { name: { contains: query, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const highlighted: Prisma.WorkerTalentProfileWhereInput = { highlightedAt: { lte: at }, highlightedUntil: { gt: at } };
    const regular: Prisma.WorkerTalentProfileWhereInput = { OR: [{ highlightedUntil: null }, { highlightedUntil: { lte: at } }, { highlightedAt: { gt: at } }] };
    const take = limit + 1;
    type Row = Awaited<ReturnType<DatabaseTalentService['fetchProfiles']>>[number];
    const rows: Array<{ profile: Row; segment: 'H' | 'N' }> = [];
    if (!cursor || cursor.segment === 'H') {
      const found = await this.fetchProfiles({ AND: [filters, highlighted, ...(cursor ? [{ id: { gt: cursor.id } }] : [])] }, take);
      rows.push(...found.map((profile) => ({ profile, segment: 'H' as const })));
    }
    if (rows.length < take) {
      const found = await this.fetchProfiles({ AND: [filters, regular, ...(cursor?.segment === 'N' ? [{ id: { gt: cursor.id } }] : [])] }, take - rows.length);
      rows.push(...found.map((profile) => ({ profile, segment: 'N' as const })));
    }
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(({ profile }) => toTalentCard(profile, at)),
      nextCursor: rows.length > limit && last ? encodeTalentCursor(last.segment, last.profile.id, at) : null,
    };
  }

  private fetchProfiles(where: Prisma.WorkerTalentProfileWhereInput, take: number) {
    return this.prisma.workerTalentProfile.findMany({ where, take, orderBy: { id: 'asc' }, include: profileInclude });
  }

  /**
   * Destaca el perfil propio (M6, `PROFILE_HIGHLIGHT`): cobra el costo del catálogo (con su cuota
   * gratuita y el tope diario de gasto) y fija `highlightedAt/Until` en la misma transacción.
   * Con un destacado vigente repetirlo no cobra ni extiende (doble clic seguro). Un perfil oculto
   * (`isVisible = false`) no se puede destacar: pagaría por algo que nadie vería.
   */
  async highlightOwnProfile(session: AuthSession) {
    this.requireWorker(session);
    const charging = this.charging;
    return withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const ensured = await tx.workerTalentProfile.upsert({ where: { userId: session.userId }, create: { userId: session.userId }, update: {}, select: { id: true } });
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "WorkerTalentProfile" WHERE "id" = ${ensured.id} FOR UPDATE`);
      const profile = await tx.workerTalentProfile.findUniqueOrThrow({ where: { id: ensured.id }, select: { id: true, isVisible: true, highlightedUntil: true } });
      if (!profile.isVisible) throw new TalentError('PROFILE_NOT_VISIBLE');
      const now = this.clock();
      if (profile.highlightedUntil && profile.highlightedUntil.getTime() > now.getTime()) {
        return { highlightedUntil: profile.highlightedUntil.toISOString(), idempotent: true, chargedAmount: 0 };
      }
      let chargedAmount = 0;
      if (charging) {
        const sequence = (await tx.currencyActionUse.count({ where: { actionKey: 'PROFILE_HIGHLIGHT', relatedEntityType: 'WorkerTalentProfile', relatedEntityId: profile.id } })) + 1;
        const charge = await charging.charge(tx, {
          actor: 'WORKER', userId: session.userId, subjectId: session.userId, actionKey: 'PROFILE_HIGHLIGHT',
          instanceKey: instanceKeys.profileHighlight(profile.id, sequence),
          related: { type: 'WorkerTalentProfile', id: profile.id },
          reason: 'Perfil destacado',
        });
        chargedAmount = charge.amount;
      }
      const hours = await readCurrencySetting(tx, 'PROFILE_HIGHLIGHT_DURATION_HOURS');
      const highlightedUntil = new Date(now.getTime() + hours * 3_600_000);
      await tx.workerTalentProfile.update({ where: { id: profile.id }, data: { highlightedAt: now, highlightedUntil } });
      return { highlightedUntil: highlightedUntil.toISOString(), idempotent: false, chargedAmount };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 }));
  }

  async createAssignmentReview(session: AuthSession, assignmentId: string, input: AssignmentReviewInput) {
    const assignment = await this.prisma.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: { shift: { include: { company: true } } },
    });
    if (!assignment || assignment.status !== 'COMPLETED' || !assignment.completedAt) {
      throw new TalentError('REVIEW_NOT_ELIGIBLE');
    }
    const isWorker = session.role === 'WORKER' && assignment.workerId === session.userId;
    const isBusiness = session.role === 'BUSINESS' && assignment.shift.company.ownerId === session.userId;
    if (!isWorker && !isBusiness) throw new TalentError('REVIEW_NOT_ELIGIBLE');
    const recipientId = isWorker ? assignment.shift.company.ownerId : assignment.workerId;
    try {
      return await this.prisma.assignmentReview.create({
        data: { assignmentId, authorId: session.userId, recipientId, authorRole: isWorker ? 'WORKER' : 'BUSINESS', rating: input.rating, comment: input.comment?.trim() || null },
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new TalentError('REVIEW_ALREADY_EXISTS');
      throw error;
    }
  }

  async uploadCv(session: AuthSession, input: CvUploadInput) {
    this.requireWorker(session);
    const stored = await this.documents.put({
      originalName: input.originalName,
      mediaType: input.mediaType,
      sizeBytes: input.bytes.byteLength,
      bytes: input.bytes,
      extension: 'pdf',
    });
    try {
      const previous = await this.prisma.workerDocument.findUnique({
        where: { userId_kind: { userId: session.userId, kind: 'CV' } },
        select: { storageKey: true },
      });
      // Reemplazar el archivo borra la verificación del administrador (el premio ya pagado no se repite).
      await this.withProfileRewards(session.userId, (client) => this.replaceDocument(client, session.userId, 'CV', stored));
      if (previous && previous.storageKey !== stored.storageKey) {
        await this.documents.remove(previous.storageKey);
      }
      return this.ownProfile(session);
    } catch (error) {
      await this.documents.remove(stored.storageKey);
      throw error;
    }
  }

  async downloadCv(session: AuthSession): Promise<CvDownload | null> {
    this.requireWorker(session);
    const document = await this.prisma.workerDocument.findUnique({
      where: { userId_kind: { userId: session.userId, kind: 'CV' } },
    });
    if (!document) return null;
    return {
      originalName: document.originalName,
      mediaType: document.mediaType,
      bytes: await this.documents.read(document.storageKey),
    };
  }

  /**
   * CV de un postulante, para la empresa dueña del turno. Una sola consulta
   * resuelve propiedad (turno de la empresa de la sesión), estado de la
   * postulación, visibilidad del perfil y existencia del CV; la regla de
   * acceso vive en `cv_access.ts` y es la misma que alimenta `hasCv` en la
   * lista de postulantes.
   *
   * - `APPLICATION_NOT_FOUND`: la postulación no existe o no es de un turno de
   *   esta empresa (misma respuesta para ambos casos, sin enumeración).
   * - `CV_NOT_AVAILABLE`: la postulación es suya pero el CV no se puede
   *   entregar (no hay CV, el perfil está oculto o la postulación ya no está
   *   vigente). Es deliberadamente uniforme: no revela si un perfil oculto
   *   tiene CV.
   */
  async downloadApplicantCv(session: AuthSession, shiftId: string, applicationId: string): Promise<CvDownload> {
    this.requireBusiness(session);
    const application = await this.prisma.shiftApplication.findFirst({
      where: { id: applicationId, shiftId, shift: { company: { ownerId: session.userId } } },
      select: {
        status: true,
        worker: {
          select: {
            talentProfile: { select: { isVisible: true } },
            documents: { where: { kind: 'CV' } },
          },
        },
      },
    });
    if (!application) throw new TalentError('APPLICATION_NOT_FOUND');
    const document = application.worker.documents[0];
    if (
      !document ||
      !companyCanViewApplicantCv({
        applicationStatus: application.status,
        profileIsVisible: application.worker.talentProfile?.isVisible,
      })
    ) {
      throw new TalentError('CV_NOT_AVAILABLE');
    }
    let bytes: Buffer;
    try {
      bytes = await this.documents.read(document.storageKey);
    } catch (error) {
      // Archivo ausente en el almacenamiento privado: para la empresa es lo
      // mismo que no tener CV.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        throw new TalentError('CV_NOT_AVAILABLE');
      }
      throw error;
    }
    return { originalName: document.originalName, mediaType: document.mediaType, bytes };
  }

  async uploadProfilePhoto(session: AuthSession, input: ProfilePhotoUploadInput) {
    this.requireWorker(session);
    const stored = await this.documents.put({
      originalName: input.originalName,
      mediaType: input.mediaType,
      sizeBytes: input.bytes.byteLength,
      bytes: input.bytes,
      extension: input.extension,
    });
    try {
      const previous = await this.prisma.workerDocument.findUnique({
        where: { userId_kind: { userId: session.userId, kind: 'PROFILE_PHOTO' } },
        select: { storageKey: true },
      });
      await this.withProfileRewards(session.userId, (client) => this.replaceDocument(client, session.userId, 'PROFILE_PHOTO', stored));
      if (previous && previous.storageKey !== stored.storageKey) {
        await this.documents.remove(previous.storageKey);
      }
      return this.ownProfile(session);
    } catch (error) {
      await this.documents.remove(stored.storageKey);
      throw error;
    }
  }

  async downloadProfilePhoto(session: AuthSession): Promise<ProfilePhotoDownload | null> {
    this.requireWorker(session);
    const document = await this.prisma.workerDocument.findUnique({
      where: { userId_kind: { userId: session.userId, kind: 'PROFILE_PHOTO' } },
    });
    if (!document) return null;
    return {
      originalName: document.originalName,
      mediaType: document.mediaType,
      bytes: await this.documents.read(document.storageKey),
    };
  }

  private requireWorker(session: AuthSession) {
    if (session.role !== 'WORKER') throw new TalentError('WORKER_ACCOUNT_REQUIRED');
  }

  private requireBusiness(session: AuthSession) {
    if (session.role !== 'BUSINESS') throw new TalentError('BUSINESS_ACCOUNT_REQUIRED');
  }

  private async requireSpecialties(specialtyIds: string[]) {
    const distinct = [...new Set(specialtyIds)];
    const found = await this.prisma.specialty.count({ where: { id: { in: distinct }, isActive: true } });
    if (found !== distinct.length) throw new TalentError('SPECIALTY_NOT_FOUND');
  }
}

function withoutRelational(input: TalentProfileInput) {
  const {
    specialtyIds: _specialtyIds,
    specialties: _specialties,
    experiences: _experiences,
    certifications: _certifications,
    languages: _languages,
    ...profile
  } = input;
  return profile;
}

function selectionsFrom(input: TalentProfileInput): TalentSpecialtyInput[] | undefined {
  if (input.specialties) return input.specialties;
  return input.specialtyIds?.map((specialtyId) => ({ specialtyId, proficiency: 'INTERMEDIATE' }));
}

function toSpecialtyRecord(item: TalentSpecialtyInput) {
  return {
    specialtyId: item.specialtyId,
    proficiency: item.proficiency,
    yearsExperience: item.yearsExperience ?? null,
  };
}

function toExperienceRecord(item: TalentExperienceInput) {
  return {
    role: item.role,
    employer: item.employer,
    description: item.description ?? null,
    startDate: new Date(item.startDate),
    endDate: item.endDate ? new Date(item.endDate) : null,
  };
}

/// A propósito no copia ningún campo de verificación: `TalentCertificationInput`
/// no lo tiene y `WorkerCertification` no lo admite.
function toCertificationRecord(item: TalentCertificationInput) {
  return {
    name: item.name,
    issuer: item.issuer ?? null,
    issueDate: item.issueDate ? new Date(item.issueDate) : null,
    expirationDate: item.expirationDate ? new Date(item.expirationDate) : null,
    credentialId: item.credentialId ?? null,
  };
}

function toLanguageRecord(item: TalentLanguageInput) {
  return { language: item.language, proficiency: item.proficiency };
}

/// 13 señales de contenido real, cada una vale lo mismo. A diferencia de la
/// fórmula anterior (fija sobre 9 pese a que el máximo real alcanzable era
/// 8, por lo que nunca llegaba a 100%), el divisor es siempre `items.length`:
/// un perfil con todo lo declarado llega a 100%.
function completion(profile: {
  headline: string | null; bio: string | null; district: string | null;
  availabilityText: string | null; availabilityDays: string[]; availabilityPeriods: string[];
  specialties: unknown[]; cv: unknown; photo: unknown;
  workRadiusKm: number | null; workDistricts: string[];
  experiences: unknown[]; certifications: unknown[]; languages: unknown[];
}) {
  const items = [
    Boolean(profile.headline),
    Boolean(profile.bio),
    Boolean(profile.district),
    Boolean(profile.availabilityText),
    profile.availabilityDays.length > 0,
    profile.availabilityPeriods.length > 0,
    profile.specialties.length > 0,
    Boolean(profile.cv),
    Boolean(profile.photo),
    Boolean(profile.workRadiusKm) || profile.workDistricts.length > 0,
    profile.experiences.length > 0,
    profile.certifications.length > 0,
    profile.languages.length > 0,
  ];
  const completed = items.filter(Boolean).length;
  return Math.round((completed / items.length) * 100);
}

function toSpecialties(profile: {
  specialties: Array<{
    proficiency: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'; yearsExperience: number | null;
    specialty: { id: string; slug: string; name: string; category: string };
  }>;
}) {
  return profile.specialties.map(({ specialty, proficiency, yearsExperience }) => ({
    ...specialty,
    proficiency,
    yearsExperience,
  }));
}

function toExperiences(profile: {
  experiences: Array<{ id: string; role: string; employer: string; description: string | null; startDate: Date; endDate: Date | null }>;
}) {
  return profile.experiences.map((item) => ({
    id: item.id,
    role: item.role,
    employer: item.employer,
    description: item.description,
    startDate: item.startDate.toISOString(),
    endDate: item.endDate?.toISOString() ?? null,
  }));
}

/// Mapea únicamente metadatos declarados. A propósito no incluye (ni debe
/// ganar sin decisión de producto explícita) ningún campo de verificación.
function toCertifications(profile: {
  certifications: Array<{ id: string; name: string; issuer: string | null; issueDate: Date | null; expirationDate: Date | null; credentialId: string | null }>;
}) {
  return profile.certifications.map((item) => ({
    id: item.id,
    name: item.name,
    issuer: item.issuer,
    issueDate: item.issueDate?.toISOString() ?? null,
    expirationDate: item.expirationDate?.toISOString() ?? null,
    credentialId: item.credentialId,
  }));
}

function toLanguages(profile: {
  languages: Array<{ id: string; language: string; proficiency: 'BASIC' | 'CONVERSATIONAL' | 'FLUENT' | 'NATIVE' }>;
}) {
  return profile.languages.map((item) => ({ id: item.id, language: item.language, proficiency: item.proficiency }));
}

function toOwnProfile(profile: {
  highlightedUntil?: Date | null;
  id: string; isAvailable: boolean; isVisible: boolean; headline: string | null; bio: string | null; district: string | null; availabilityText: string | null;
  availabilityDays: string[]; availabilityPeriods: string[];
  workRadiusKm: number | null; workDistricts: string[];
  isExperienceVisible: boolean; isCertificationsVisible: boolean; isLanguagesVisible: boolean; isWorkAreaVisible: boolean;
  user: {
    id: string;
    name: string;
    reviewsReceived: Array<{ rating: number }>;
    documents: Array<{
      kind: 'CV' | 'PROFILE_PHOTO';
      originalName: string;
      mediaType: string;
      sizeBytes: number;
      updatedAt: Date;
    }>;
  };
  specialties: Array<{ proficiency: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'; yearsExperience: number | null; specialty: { id: string; slug: string; name: string; category: string } }>;
  experiences: Array<{ id: string; role: string; employer: string; description: string | null; startDate: Date; endDate: Date | null }>;
  certifications: Array<{ id: string; name: string; issuer: string | null; issueDate: Date | null; expirationDate: Date | null; credentialId: string | null }>;
  languages: Array<{ id: string; language: string; proficiency: 'BASIC' | 'CONVERSATIONAL' | 'FLUENT' | 'NATIVE' }>;
}) {
  const cv = documentMetadata(profile.user.documents.find((document) => document.kind === 'CV'));
  const photo = documentMetadata(profile.user.documents.find((document) => document.kind === 'PROFILE_PHOTO'));
  return {
    id: profile.id,
    name: profile.user.name,
    headline: profile.headline,
    bio: profile.bio,
    district: profile.district,
    availabilityText: profile.availabilityText,
    availabilityDays: profile.availabilityDays,
    availabilityPeriods: profile.availabilityPeriods,
    isAvailable: profile.isAvailable,
    isVisible: profile.isVisible,
    workRadiusKm: profile.workRadiusKm,
    workDistricts: profile.workDistricts,
    isExperienceVisible: profile.isExperienceVisible,
    isCertificationsVisible: profile.isCertificationsVisible,
    isLanguagesVisible: profile.isLanguagesVisible,
    isWorkAreaVisible: profile.isWorkAreaVisible,
    highlightedUntil: profile.highlightedUntil?.toISOString() ?? null,
    specialties: toSpecialties(profile),
    experiences: toExperiences(profile),
    certifications: toCertifications(profile),
    languages: toLanguages(profile),
    cv,
    photo,
    completion: completion({ ...profile, cv, photo }),
    reputation: reputation(profile.user.reviewsReceived),
  };
}

function documentMetadata(document: { originalName: string; mediaType: string; sizeBytes: number; updatedAt?: Date } | undefined) {
  if (!document) return null;
  return {
    originalName: document.originalName,
    mediaType: document.mediaType,
    sizeBytes: document.sizeBytes,
    updatedAt: document.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

function reputation(reviews: Array<{ rating: number }>) {
  if (!reviews.length) return { averageRating: null, reviewCount: 0 };
  return { averageRating: Math.round((reviews.reduce((total, review) => total + review.rating, 0) / reviews.length) * 10) / 10, reviewCount: reviews.length };
}

/// El directorio empresarial nunca ve una sección que el trabajador ocultó
/// (`isXVisible === false`): la sección se devuelve vacía/`null`, no
/// omitida, para que el contrato de campos sea estable. Ocultar nunca borra
/// datos: `toOwnProfile` los sigue mostrando siempre al propio trabajador.
function toTalentCard(profile: Parameters<typeof toOwnProfile>[0] & { highlightedAt?: Date | null }, at: Date) {
  const own = toOwnProfile(profile);
  return {
    id: own.id,
    isHighlighted: Boolean(profile.highlightedAt && profile.highlightedUntil && profile.highlightedAt.getTime() <= at.getTime() && profile.highlightedUntil.getTime() > at.getTime()),
    name: own.name,
    headline: own.headline,
    district: own.district,
    availabilityText: own.availabilityText,
    availabilityDays: own.availabilityDays,
    availabilityPeriods: own.availabilityPeriods,
    isAvailable: own.isAvailable,
    specialties: own.specialties,
    completion: own.completion,
    reputation: own.reputation,
    workArea: own.isWorkAreaVisible ? { workRadiusKm: own.workRadiusKm, workDistricts: own.workDistricts } : null,
    experiences: own.isExperienceVisible ? own.experiences : [],
    certifications: own.isCertificationsVisible ? own.certifications : [],
    languages: own.isLanguagesVisible ? own.languages : [],
  };
}

type TalentCursor = { segment: 'H' | 'N'; id: string; at: Date };

function encodeTalentCursor(segment: 'H' | 'N', id: string, at: Date) {
  return Buffer.from(JSON.stringify([segment, id, at.toISOString()])).toString('base64url');
}

/** Un cursor que no se puede leer se trata como un `id` simple del segmento resto (formato anterior a M6). */
function decodeTalentCursor(cursor: string | undefined, now: Date): TalentCursor | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && (parsed[0] === 'H' || parsed[0] === 'N') && typeof parsed[1] === 'string' && typeof parsed[2] === 'string') {
      const at = new Date(parsed[2]);
      if (!Number.isNaN(at.getTime())) return { segment: parsed[0], id: parsed[1], at };
    }
  } catch {
    // formato anterior
  }
  return { segment: 'N', id: cursor, at: now };
}
