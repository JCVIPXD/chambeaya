import { createHash } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import type { AuthSession } from '../auth/auth.service.js';
import { validateScreeningAnswers, MarketplaceError } from '../marketplace/marketplace.service.js';
import { withSerializableRetry } from '../operations/serializable-retry.js';
import { PrivateDocumentStorage } from '../talent/private_document_storage.js';
import {
  canIssueOffer,
  canScheduleInterview,
  isTerminalApplication,
  postingAcceptsApplications,
  postingAllowsProgress,
  postingHasFreeVacancies,
  postingIsEditable,
  resolveApplicationTransition,
  resolvePostingTransition,
  type JobActor,
  type JobApplicationStatus,
  type JobPostingAction,
  type JobPostingStatus,
} from './job-state.js';
import { JobError } from './jobs.errors.js';
import { jobEvents, type JobApplicationEventKind, type JobEvents } from './jobs.events.js';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type JobModality = 'ONSITE' | 'REMOTE' | 'HYBRID';
export type JobWorkload = 'FULL_TIME' | 'PART_TIME';
export type JobContractType = 'INDEFINITE' | 'FIXED_TERM' | 'INTERNSHIP' | 'OTHER';
export type JobInterviewMode = 'ONSITE' | 'VIDEO' | 'PHONE';

export type JobPostingInput = {
  title: string;
  description: string;
  responsibilities?: string | null;
  requirements?: string | null;
  benefits?: string | null;
  modality: JobModality;
  workload: JobWorkload;
  salaryMinCents: number;
  salaryMaxCents: number;
  location: string;
  contractType: JobContractType;
  /** `YYYY-MM-DD`. */
  expectedStartDate?: string | null;
  vacancies: number;
  screeningQuestions?: string[];
};
export type JobPostingPatch = Partial<JobPostingInput>;

export type Page = { limit: number; cursor?: string };
export type OfferInput = {
  salaryCents: number;
  contractType: JobContractType;
  /** `YYYY-MM-DD`. */
  startDate: string;
  note?: string | null;
  /** Documento PDF subido antes con `uploadOfferDocument`. */
  documentId?: string | null;
};
export type InterviewInput = { scheduledAt: Date; mode?: JobInterviewMode | null; note?: string | null };
export type PostingSearch = Page & {
  query?: string;
  modality?: JobModality;
  workload?: JobWorkload;
  contractType?: JobContractType;
  minSalaryCents?: number;
  location?: string;
};

export type DocumentDownload = { originalName: string; mediaType: string; bytes: Buffer };

/**
 * Puntos de extensión para M4 (cobro y premios en moneda virtual). Se invocan
 * DENTRO de la transacción de la operación, con el cliente transaccional: si
 * M4 cobra y el hook lanza, toda la operación se revierte. M3 no cobra ni
 * devuelve nada; el valor por defecto no hace nada.
 */
export interface JobHooks {
  beforePublish?(context: { tx: Prisma.TransactionClient; userId: string; companyId: string; postingId: string; firstPublication: boolean }): Promise<void>;
  beforeApply?(context: { tx: Prisma.TransactionClient; userId: string; postingId: string; companyId: string }): Promise<void>;
  afterHire?(context: { tx: Prisma.TransactionClient; applicationId: string; postingId: string; companyId: string; workerId: string }): Promise<void>;
}

const MAX_PENDING_UPLOADS = 5;
const MAX_INTERVIEW_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function encodeCursor(date: Date, id: string) {
  return Buffer.from(JSON.stringify([date.toISOString(), id])).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { date: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      const date = new Date(parsed[0]);
      if (!Number.isNaN(date.getTime()) && parsed[1].length > 0 && parsed[1].length <= 128) return { date, id: parsed[1] };
    }
  } catch { /* se informa abajo */ }
  throw new JobError('INVALID_CURSOR', 400);
}

/** Fecha calendario de Lima (`YYYY-MM-DD`) de un instante. */
export function limaCalendarDate(instant: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function parseCalendarDate(value: string, code: 'INVALID_START_DATE') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new JobError(code, 400);
  return date;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readAnswers(value: unknown): Array<{ question: string; answer: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return typeof record.question === 'string' && typeof record.answer === 'string' ? [{ question: record.question, answer: record.answer }] : [];
  });
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** El CV solo lo ve la empresa mientras el candidato siga en proceso (o contratado) y su perfil sea visible. */
export function jobApplicantCvViewable(status: JobApplicationStatus, profileIsVisible: boolean | null | undefined) {
  return status !== 'REJECTED' && status !== 'WITHDRAWN' && profileIsVisible === true;
}

// ---------------------------------------------------------------------------
// Lecturas con relaciones
// ---------------------------------------------------------------------------

const applicationInclude = {
  posting: { include: { company: { select: { id: true, name: true, legalName: true, ruc: true, ownerId: true } } } },
  worker: {
    select: {
      id: true,
      name: true,
      identifier: true,
      talentProfile: { select: { headline: true, district: true, isVisible: true } },
      documents: { where: { kind: 'CV' as const }, select: { id: true } },
    },
  },
  offers: { orderBy: { version: 'asc' as const } },
  events: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.JobApplicationInclude;

type ApplicationRecord = Prisma.JobApplicationGetPayload<{ include: typeof applicationInclude }>;
type OfferRecord = ApplicationRecord['offers'][number];
type EventRecord = ApplicationRecord['events'][number];
type PostingRecord = Prisma.JobPostingGetPayload<{ include: { company: { select: { id: true; name: true } } } }>;

function offerView(offer: OfferRecord) {
  return {
    id: offer.id,
    version: offer.version,
    status: offer.status,
    salaryCents: offer.salaryCents,
    currency: offer.currency,
    contractType: offer.contractType,
    startDate: offer.startDate,
    note: offer.note,
    document: offer.documentName
      ? { name: offer.documentName, mediaType: offer.documentMediaType, sizeBytes: offer.documentSizeBytes, sha256: offer.documentSha256 }
      : null,
    createdAt: offer.createdAt,
    respondedAt: offer.respondedAt,
    acceptanceSnapshot: offer.acceptanceSnapshot,
  };
}

function eventView(event: EventRecord, audience: JobActor) {
  return {
    id: event.id,
    type: event.type,
    actorRole: event.actorRole,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    // El motivo de un rechazo es una nota interna de la empresa.
    detail: audience === 'WORKER' && event.type === 'REJECTED' ? null : event.detail,
    createdAt: event.createdAt,
  };
}

function interviewView(application: Pick<ApplicationRecord, 'interviewAt' | 'interviewMode' | 'interviewNote'>) {
  return application.interviewAt
    ? { scheduledAt: application.interviewAt, mode: application.interviewMode, note: application.interviewNote }
    : null;
}

function companyApplicantSummary(application: ApplicationRecord) {
  return {
    id: application.id,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    worker: {
      name: application.worker.name,
      headline: application.worker.talentProfile?.headline ?? null,
      district: application.worker.talentProfile?.district ?? null,
      hasCv: application.worker.documents.length > 0
        && jobApplicantCvViewable(application.status, application.worker.talentProfile?.isVisible),
    },
    interview: interviewView(application),
    currentOfferStatus: application.offers.at(-1)?.status ?? null,
  };
}

function companyApplicationDetail(application: ApplicationRecord) {
  return {
    ...companyApplicantSummary(application),
    posting: { id: application.posting.id, title: application.posting.title, status: application.posting.status },
    screeningAnswers: readAnswers(application.screeningAnswers),
    decisionReason: application.decisionReason,
    hiredAt: application.hiredAt,
    offers: application.offers.map(offerView),
    events: application.events.map((event) => eventView(event, 'COMPANY')),
  };
}

function postingSalaryView(posting: { salaryMinCents: number; salaryMaxCents: number; currency: string }) {
  return { minCents: posting.salaryMinCents, maxCents: posting.salaryMaxCents, currency: posting.currency };
}

function workerApplicationView(application: ApplicationRecord) {
  const open = application.offers.filter((offer) => offer.status === 'PENDING' || offer.status === 'ACCEPTED').at(-1);
  return {
    id: application.id,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    posting: {
      id: application.posting.id,
      title: application.posting.title,
      companyName: application.posting.company.name,
      modality: application.posting.modality,
      workload: application.posting.workload,
      location: application.posting.location,
      status: application.posting.status,
      salary: postingSalaryView(application.posting),
    },
    screeningAnswers: readAnswers(application.screeningAnswers),
    interview: interviewView(application),
    currentOfferId: open?.id ?? null,
    offers: application.offers.map(offerView),
    events: application.events.map((event) => eventView(event, 'WORKER')),
  };
}

function companyPostingView(posting: Prisma.JobPostingGetPayload<object>, extras: { applicantCounts?: Record<string, number>; applicationsCount?: number } = {}) {
  return {
    id: posting.id,
    title: posting.title,
    description: posting.description,
    responsibilities: posting.responsibilities,
    requirements: posting.requirements,
    benefits: posting.benefits,
    modality: posting.modality,
    workload: posting.workload,
    salary: postingSalaryView(posting),
    location: posting.location,
    contractType: posting.contractType,
    expectedStartDate: posting.expectedStartDate,
    vacancies: posting.vacancies,
    filledVacancies: posting.filledVacancies,
    screeningQuestions: readStringList(posting.screeningQuestions),
    status: posting.status,
    publishedAt: posting.publishedAt,
    closedAt: posting.closedAt,
    createdAt: posting.createdAt,
    updatedAt: posting.updatedAt,
    ...extras,
  };
}

function publicPostingView(posting: PostingRecord, mine: { id: string; status: JobApplicationStatus } | null) {
  return {
    id: posting.id,
    title: posting.title,
    description: posting.description,
    responsibilities: posting.responsibilities,
    requirements: posting.requirements,
    benefits: posting.benefits,
    modality: posting.modality,
    workload: posting.workload,
    salary: postingSalaryView(posting),
    location: posting.location,
    contractType: posting.contractType,
    expectedStartDate: posting.expectedStartDate,
    vacanciesRemaining: posting.vacancies - posting.filledVacancies,
    screeningQuestions: readStringList(posting.screeningQuestions),
    publishedAt: posting.publishedAt,
    company: { name: posting.company.name },
    myApplication: mine,
  };
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

type PendingNotification = { type: JobApplicationEventKind; applicationId: string; postingId: string; status: JobApplicationStatus; recipientUserId: string };
type Emit = (notification: PendingNotification) => void;
type Actor = { userId: string; kind: JobActor };

export class JobService {
  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly options: {
      storage?: PrivateDocumentStorage;
      hooks?: JobHooks;
      events?: JobEvents;
      now?: () => Date;
    } = {},
  ) {}

  private get storage() { return this.options.storage ??= new PrivateDocumentStorage(); }
  private get hooks(): JobHooks { return this.options.hooks ?? {}; }
  private get bus() { return this.options.events ?? jobEvents; }
  private now() { return this.options.now?.() ?? new Date(); }

  /**
   * Toda escritura corre en `Serializable` con reintento: `operation` abre la
   * transacción y relee dentro de ella el estado del que depende. Los avisos
   * en tiempo real se publican solo después de confirmar (y se descartan si
   * un intento se reintenta).
   */
  private async run<T>(work: (tx: Prisma.TransactionClient, emit: Emit) => Promise<T>): Promise<T> {
    const { value, notifications } = await withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const notifications: PendingNotification[] = [];
      const value = await work(tx, (notification) => notifications.push(notification));
      return { value, notifications };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 }));
    const at = this.now().toISOString();
    for (const notification of notifications) this.bus.publish({ ...notification, at });
    return value;
  }

  // ---- Empresa: puestos ---------------------------------------------------

  private async companyFor(session: AuthSession) {
    return this.prisma.company.upsert({
      where: { ownerId: session.userId },
      update: {},
      create: { ownerId: session.userId, name: session.name, legalName: session.name, ruc: session.identifier },
    });
  }

  async createPosting(session: AuthSession, input: JobPostingInput) {
    const company = await this.companyFor(session);
    const data = this.postingData(input);
    const posting = await this.prisma.jobPosting.create({ data: { ...data, companyId: company.id, status: 'DRAFT' } });
    return companyPostingView(posting);
  }

  async listPostings(session: AuthSession, filter: Page & { status?: JobPostingStatus }) {
    const company = await this.companyFor(session);
    const cursor = decodeCursor(filter.cursor);
    const rows = await this.prisma.jobPosting.findMany({
      where: {
        companyId: company.id,
        ...(filter.status ? { status: filter.status } : {}),
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.date } }, { createdAt: cursor.date, id: { lt: cursor.id } }] } : {}),
      },
      include: { _count: { select: { applications: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });
    const items = rows.slice(0, filter.limit);
    return {
      items: items.map(({ _count, ...posting }) => companyPostingView(posting, { applicationsCount: _count.applications })),
      nextCursor: rows.length > filter.limit ? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id) : null,
    };
  }

  async getPosting(session: AuthSession, postingId: string) {
    const company = await this.companyFor(session);
    const posting = await this.prisma.jobPosting.findFirst({ where: { id: postingId, companyId: company.id } });
    if (!posting) throw new JobError('JOB_POSTING_NOT_FOUND', 404);
    const groups = await this.prisma.jobApplication.groupBy({ by: ['status'], where: { postingId }, _count: { _all: true } });
    const applicantCounts = Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
    return companyPostingView(posting, { applicantCounts, applicationsCount: groups.reduce((total, group) => total + group._count._all, 0) });
  }

  async updatePosting(session: AuthSession, postingId: string, patch: JobPostingPatch) {
    const company = await this.companyFor(session);
    return this.run(async (tx) => {
      const posting = await this.lockPosting(tx, postingId, company.id);
      if (!postingIsEditable(posting.status)) throw new JobError('POSTING_NOT_EDITABLE', 409, { status: posting.status });
      const data = this.postingData(patch);
      const salaryMin = data.salaryMinCents ?? posting.salaryMinCents;
      const salaryMax = data.salaryMaxCents ?? posting.salaryMaxCents;
      if (salaryMin > salaryMax) throw new JobError('INVALID_SALARY_RANGE', 400);
      if (data.vacancies !== undefined && data.vacancies <= posting.filledVacancies) {
        throw new JobError('VACANCIES_BELOW_FILLED', 400, { filledVacancies: posting.filledVacancies });
      }
      if (patch.screeningQuestions !== undefined && !sameStringList(patch.screeningQuestions, readStringList(posting.screeningQuestions))) {
        // Las respuestas ya recibidas dejarían de corresponder a las preguntas.
        if (await tx.jobApplication.count({ where: { postingId: posting.id } }) > 0) throw new JobError('POSTING_HAS_APPLICATIONS', 409);
      }
      const updated = await tx.jobPosting.update({ where: { id: posting.id }, data });
      return companyPostingView(updated);
    });
  }

  publishPosting(session: AuthSession, postingId: string) { return this.changePostingStatus(session, postingId, 'PUBLISH'); }
  pausePosting(session: AuthSession, postingId: string) { return this.changePostingStatus(session, postingId, 'PAUSE'); }
  closePosting(session: AuthSession, postingId: string) { return this.changePostingStatus(session, postingId, 'CLOSE'); }

  private async changePostingStatus(session: AuthSession, postingId: string, action: JobPostingAction) {
    const company = await this.companyFor(session);
    return this.run(async (tx, emit) => {
      const posting = await this.lockPosting(tx, postingId, company.id);
      const decision = resolvePostingTransition(posting.status, action);
      if (decision.kind === 'INVALID') throw new JobError('INVALID_STATE_TRANSITION', 409, { status: posting.status, requested: decision.to });
      if (decision.kind === 'IDEMPOTENT') return { ...companyPostingView(posting), idempotent: true };
      const now = this.now();
      if (action === 'PUBLISH') {
        if (!postingHasFreeVacancies(posting)) throw new JobError('POSTING_FILLED', 409);
        // Punto de extensión de M4: cobrar publicaciones extra más allá de la cuota gratuita.
        await this.hooks.beforePublish?.({ tx, userId: session.userId, companyId: company.id, postingId: posting.id, firstPublication: posting.publishedAt === null });
      }
      const updated = await tx.jobPosting.update({
        where: { id: posting.id },
        data: {
          status: decision.to,
          ...(action === 'PUBLISH' && posting.publishedAt === null ? { publishedAt: now } : {}),
          ...(action === 'CLOSE' ? { closedAt: now } : {}),
        },
      });
      if (action === 'CLOSE') await this.releasePendingOffers(tx, emit, posting.id, session.userId, 'POSTING_CLOSED');
      return { ...companyPostingView(updated), idempotent: false };
    });
  }

  // ---- Empresa: postulantes ------------------------------------------------

  async listApplicants(session: AuthSession, postingId: string, filter: Page & { statuses?: JobApplicationStatus[] }) {
    const company = await this.companyFor(session);
    const posting = await this.prisma.jobPosting.findFirst({ where: { id: postingId, companyId: company.id }, select: { id: true } });
    if (!posting) throw new JobError('JOB_POSTING_NOT_FOUND', 404);
    const cursor = decodeCursor(filter.cursor);
    const rows = await this.prisma.jobApplication.findMany({
      where: {
        postingId,
        ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.date } }, { createdAt: cursor.date, id: { lt: cursor.id } }] } : {}),
      },
      include: applicationInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });
    const items = rows.slice(0, filter.limit);
    return {
      items: items.map(companyApplicantSummary),
      nextCursor: rows.length > filter.limit ? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id) : null,
    };
  }

  async getApplicationForCompany(session: AuthSession, applicationId: string) {
    const company = await this.companyFor(session);
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, posting: { companyId: company.id } },
      include: applicationInclude,
    });
    if (!application) throw new JobError('JOB_APPLICATION_NOT_FOUND', 404);
    return companyApplicationDetail(application);
  }

  /** Empresa: preselecciona o pasa a entrevista (sin fecha; para la fecha, `scheduleInterview`). */
  async moveStage(session: AuthSession, applicationId: string, to: 'SHORTLISTED' | 'INTERVIEW') {
    const company = await this.companyFor(session);
    return this.run(async (tx, emit) => {
      const application = await this.lockCompanyApplication(tx, applicationId, company.id);
      const result = await this.transition(tx, emit, application, { userId: session.userId, kind: 'COMPANY' }, to, to === 'SHORTLISTED' ? 'SHORTLISTED' : 'INTERVIEW_SCHEDULED', { requireOpenPosting: true });
      return { ...companyApplicationDetail(await this.reload(tx, applicationId)), idempotent: result.idempotent };
    });
  }

  async scheduleInterview(session: AuthSession, applicationId: string, input: InterviewInput) {
    const now = this.now();
    if (input.scheduledAt.getTime() <= now.getTime() || input.scheduledAt.getTime() > now.getTime() + MAX_INTERVIEW_HORIZON_MS) {
      throw new JobError('INVALID_INTERVIEW_DATE', 400);
    }
    const company = await this.companyFor(session);
    return this.run(async (tx, emit) => {
      const application = await this.lockCompanyApplication(tx, applicationId, company.id);
      if (!canScheduleInterview(application.status)) throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: 'INTERVIEW' });
      if (!postingAllowsProgress(application.posting.status)) throw new JobError('POSTING_NOT_OPEN', 409, { status: application.posting.status });
      const mode = input.mode ?? null;
      const note = input.note?.trim() || null;
      if (
        application.status === 'INTERVIEW'
        && application.interviewAt?.getTime() === input.scheduledAt.getTime()
        && application.interviewMode === mode
        && application.interviewNote === note
      ) {
        return { ...companyApplicationDetail(application), idempotent: true };
      }
      const detail = `${input.scheduledAt.toISOString()}${mode ? ` · ${mode}` : ''}`;
      await tx.jobApplication.update({
        where: { id: application.id },
        data: { status: 'INTERVIEW', interviewAt: input.scheduledAt, interviewMode: mode, interviewNote: note },
      });
      await this.record(tx, emit, application, { userId: session.userId, kind: 'COMPANY' }, 'INTERVIEW_SCHEDULED', application.status, 'INTERVIEW', detail, 'INTERVIEW');
      return { ...companyApplicationDetail(await this.reload(tx, applicationId)), idempotent: false };
    });
  }

  async rejectApplication(session: AuthSession, applicationId: string, reason?: string | null) {
    const company = await this.companyFor(session);
    return this.run(async (tx, emit) => {
      const application = await this.lockCompanyApplication(tx, applicationId, company.id);
      const normalized = reason?.trim() || null;
      const result = await this.transition(tx, emit, application, { userId: session.userId, kind: 'COMPANY' }, 'REJECTED', 'REJECTED', {
        data: { decisionReason: normalized },
        detail: normalized,
        withdrawPendingOffer: true,
      });
      return { ...companyApplicationDetail(await this.reload(tx, applicationId)), idempotent: result.idempotent };
    });
  }

  async uploadOfferDocument(session: AuthSession, applicationId: string, input: { originalName: string; bytes: Buffer }) {
    const company = await this.companyFor(session);
    const stored = await this.storage.put({
      originalName: input.originalName,
      mediaType: 'application/pdf',
      sizeBytes: input.bytes.byteLength,
      bytes: input.bytes,
      extension: 'pdf',
    });
    try {
      return await this.run(async (tx) => {
        const application = await this.lockCompanyApplication(tx, applicationId, company.id);
        if (!canIssueOffer(application.status)) throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: 'OFFER' });
        if (!postingAllowsProgress(application.posting.status)) throw new JobError('POSTING_NOT_OPEN', 409, { status: application.posting.status });
        const pending = await tx.jobOfferUpload.count({ where: { applicationId, consumedAt: null } });
        if (pending >= MAX_PENDING_UPLOADS) throw new JobError('TOO_MANY_PENDING_UPLOADS', 409);
        const upload = await tx.jobOfferUpload.create({
          data: {
            applicationId,
            storageKey: stored.storageKey,
            originalName: stored.originalName,
            mediaType: stored.mediaType,
            sizeBytes: stored.sizeBytes,
            sha256: createHash('sha256').update(input.bytes).digest('hex'),
          },
        });
        return { id: upload.id, name: upload.originalName, mediaType: upload.mediaType, sizeBytes: upload.sizeBytes, sha256: upload.sha256 };
      });
    } catch (error) {
      await this.storage.remove(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** Emite una oferta nueva (versión siguiente); la anterior pendiente queda `SUPERSEDED`. */
  async issueOffer(session: AuthSession, applicationId: string, input: OfferInput) {
    const startDate = parseCalendarDate(input.startDate, 'INVALID_START_DATE');
    if (input.startDate < limaCalendarDate(this.now())) throw new JobError('INVALID_START_DATE', 400);
    const company = await this.companyFor(session);
    return this.run(async (tx, emit) => {
      const application = await this.lockCompanyApplication(tx, applicationId, company.id);
      if (!canIssueOffer(application.status)) throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: 'OFFER' });
      if (!postingAllowsProgress(application.posting.status)) throw new JobError('POSTING_NOT_OPEN', 409, { status: application.posting.status });
      const note = input.note?.trim() || null;
      const latest = application.offers.at(-1);
      // Reenvío idéntico (doble clic, reintento del cliente): no crea otra versión.
      if (
        latest?.status === 'PENDING' && !input.documentId
        && latest.salaryCents === input.salaryCents && latest.contractType === input.contractType
        && latest.startDate.getTime() === startDate.getTime() && latest.note === note
      ) {
        return { ...companyApplicationDetail(application), idempotent: true };
      }
      let document: { storageKey: string; originalName: string; mediaType: string; sizeBytes: number; sha256: string } | null = null;
      if (input.documentId) {
        // `updateMany` condicional: dos ofertas simultáneas no pueden consumir el mismo documento.
        const upload = await tx.jobOfferUpload.findFirst({ where: { id: input.documentId, applicationId, consumedAt: null } });
        if (!upload) throw new JobError('OFFER_DOCUMENT_NOT_AVAILABLE', 400);
        const consumed = await tx.jobOfferUpload.updateMany({ where: { id: upload.id, consumedAt: null }, data: { consumedAt: this.now() } });
        if (consumed.count !== 1) throw new JobError('OFFER_DOCUMENT_NOT_AVAILABLE', 400);
        document = upload;
      }
      if (latest?.status === 'PENDING') {
        await tx.jobOffer.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED', respondedAt: this.now() } });
      }
      const version = (latest?.version ?? 0) + 1;
      await tx.jobOffer.create({
        data: {
          applicationId,
          version,
          salaryCents: input.salaryCents,
          currency: application.posting.currency,
          contractType: input.contractType,
          startDate,
          note,
          ...(document ? {
            documentStorageKey: document.storageKey,
            documentName: document.originalName,
            documentMediaType: document.mediaType,
            documentSizeBytes: document.sizeBytes,
            documentSha256: document.sha256,
          } : {}),
        },
      });
      if (application.status !== 'OFFER') await tx.jobApplication.update({ where: { id: applicationId }, data: { status: 'OFFER' } });
      await this.record(tx, emit, application, { userId: session.userId, kind: 'COMPANY' }, 'OFFER_ISSUED', application.status, 'OFFER', `v${version}`, 'OFFER');
      return { ...companyApplicationDetail(await this.reload(tx, applicationId)), idempotent: false };
    });
  }

  /**
   * Confirma la contratación tras la aceptación del trabajador. Incrementa lo
   * cubierto con un `UPDATE` condicional sobre la fila del puesto bloqueada
   * (`filledVacancies < vacancies`) más el `CHECK` de la base: contratar por
   * encima de las vacantes es imposible aunque lleguen dos confirmaciones a
   * la vez.
   */
  async confirmHire(session: AuthSession, applicationId: string) {
    const company = await this.companyFor(session);
    return this.run(async (tx, emit) => {
      // Orden de bloqueo fijo: postulación y luego puesto.
      const application = await this.lockCompanyApplication(tx, applicationId, company.id);
      const decision = resolveApplicationTransition(application.status, 'HIRED', 'COMPANY');
      if (decision.kind === 'INVALID') throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: 'HIRED' });
      if (decision.kind === 'IDEMPOTENT') return { ...companyApplicationDetail(application), idempotent: true };
      const posting = await this.lockPosting(tx, application.postingId, company.id);
      if (posting.status === 'FILLED') throw new JobError('POSTING_FILLED', 409);
      if (!postingAllowsProgress(posting.status)) throw new JobError('POSTING_NOT_OPEN', 409, { status: posting.status });
      const bumped = await tx.$queryRaw<Array<{ filledVacancies: number; vacancies: number }>>`
        UPDATE "JobPosting" SET "filledVacancies" = "filledVacancies" + 1, "updatedAt" = NOW()
        WHERE "id" = ${posting.id} AND "filledVacancies" < "vacancies"
        RETURNING "filledVacancies", "vacancies"`;
      if (bumped.length !== 1) throw new JobError('POSTING_FILLED', 409);
      if (bumped[0]!.filledVacancies >= bumped[0]!.vacancies) {
        const fill = resolvePostingTransition(posting.status, 'FILL');
        if (fill.kind === 'MOVE') await tx.jobPosting.update({ where: { id: posting.id }, data: { status: fill.to, closedAt: this.now() } });
      }
      await tx.jobApplication.update({ where: { id: applicationId }, data: { status: 'HIRED', hiredAt: this.now() } });
      await this.record(tx, emit, application, { userId: session.userId, kind: 'COMPANY' }, 'HIRED', application.status, 'HIRED', null, 'HIRED');
      if (bumped[0]!.filledVacancies >= bumped[0]!.vacancies) await this.releasePendingOffers(tx, emit, posting.id, session.userId, 'POSTING_FILLED');
      // Punto de extensión de M4: premio de empresa por contratación confirmada.
      await this.hooks.afterHire?.({ tx, applicationId, postingId: posting.id, companyId: company.id, workerId: application.workerId });
      return { ...companyApplicationDetail(await this.reload(tx, applicationId)), idempotent: false };
    });
  }

  async downloadApplicantCv(session: AuthSession, applicationId: string): Promise<DocumentDownload> {
    const company = await this.companyFor(session);
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, posting: { companyId: company.id } },
      select: {
        status: true,
        worker: { select: { talentProfile: { select: { isVisible: true } }, documents: { where: { kind: 'CV' }, select: { storageKey: true, originalName: true, mediaType: true } } } },
      },
    });
    if (!application) throw new JobError('JOB_APPLICATION_NOT_FOUND', 404);
    const cv = application.worker.documents[0];
    if (!cv || !jobApplicantCvViewable(application.status, application.worker.talentProfile?.isVisible)) throw new JobError('JOB_DOCUMENT_NOT_FOUND', 404);
    return { originalName: cv.originalName, mediaType: 'application/pdf', bytes: await this.storage.read(cv.storageKey) };
  }

  async downloadOfferDocument(session: AuthSession, actor: JobActor, applicationId: string, offerId: string): Promise<DocumentDownload> {
    const where: Prisma.JobApplicationWhereInput = actor === 'COMPANY'
      ? { id: applicationId, posting: { companyId: (await this.companyFor(session)).id } }
      : { id: applicationId, workerId: session.userId };
    const application = await this.prisma.jobApplication.findFirst({ where, select: { id: true } });
    if (!application) throw new JobError('JOB_APPLICATION_NOT_FOUND', 404);
    const offer = await this.prisma.jobOffer.findFirst({ where: { id: offerId, applicationId } });
    if (!offer) throw new JobError('JOB_OFFER_NOT_FOUND', 404);
    if (!offer.documentStorageKey || !offer.documentName) throw new JobError('JOB_DOCUMENT_NOT_FOUND', 404);
    return { originalName: offer.documentName, mediaType: 'application/pdf', bytes: await this.storage.read(offer.documentStorageKey) };
  }

  // ---- Trabajador ----------------------------------------------------------

  async searchPostings(session: AuthSession, search: PostingSearch) {
    const cursor = decodeCursor(search.cursor);
    const text = search.query?.trim();
    const where: Prisma.JobPostingWhereInput = {
      status: 'PUBLISHED',
      ...(search.modality ? { modality: search.modality } : {}),
      ...(search.workload ? { workload: search.workload } : {}),
      ...(search.contractType ? { contractType: search.contractType } : {}),
      // El rango del puesto alcanza al menos el mínimo que busca el trabajador.
      ...(search.minSalaryCents ? { salaryMaxCents: { gte: search.minSalaryCents } } : {}),
      ...(search.location ? { location: { contains: search.location.trim(), mode: 'insensitive' as const } } : {}),
      AND: [
        ...(text ? [{ OR: [
          { title: { contains: text, mode: 'insensitive' as const } },
          { description: { contains: text, mode: 'insensitive' as const } },
          { company: { name: { contains: text, mode: 'insensitive' as const } } },
        ] }] : []),
        ...(cursor ? [{ OR: [{ publishedAt: { lt: cursor.date } }, { publishedAt: cursor.date, id: { lt: cursor.id } }] }] : []),
      ],
    };
    const rows = await this.prisma.jobPosting.findMany({
      where,
      include: { company: { select: { id: true, name: true } } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: search.limit + 1,
    });
    const items = rows.slice(0, search.limit);
    const mine = await this.myApplicationsFor(session.userId, items.map((posting) => posting.id));
    const last = items[items.length - 1];
    return {
      items: items.map((posting) => publicPostingView(posting, mine.get(posting.id) ?? null)),
      nextCursor: rows.length > search.limit && last?.publishedAt ? encodeCursor(last.publishedAt, last.id) : null,
    };
  }

  async getPublicPosting(session: AuthSession, postingId: string) {
    const posting = await this.prisma.jobPosting.findFirst({
      where: { id: postingId, status: 'PUBLISHED' },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!posting) throw new JobError('JOB_POSTING_NOT_FOUND', 404);
    const mine = await this.myApplicationsFor(session.userId, [posting.id]);
    return publicPostingView(posting, mine.get(posting.id) ?? null);
  }

  private async myApplicationsFor(userId: string, postingIds: string[]) {
    if (postingIds.length === 0) return new Map<string, { id: string; status: JobApplicationStatus }>();
    const rows = await this.prisma.jobApplication.findMany({
      where: { workerId: userId, postingId: { in: postingIds } },
      select: { id: true, postingId: true, status: true },
    });
    return new Map(rows.map((row) => [row.postingId, { id: row.id, status: row.status }]));
  }

  async apply(session: AuthSession, postingId: string, answers: Array<{ question: string; answer: string }> = []) {
    const attempt = () => this.run(async (tx, emit) => {
      const posting = await tx.jobPosting.findUnique({ where: { id: postingId }, include: { company: { select: { id: true, name: true, ownerId: true } } } });
      // Un borrador no es visible para nadie más que su empresa.
      if (!posting || posting.status === 'DRAFT') throw new JobError('JOB_POSTING_NOT_FOUND', 404);
      const existing = await tx.jobApplication.findUnique({ where: { postingId_workerId: { postingId, workerId: session.userId } }, include: applicationInclude });
      if (existing) {
        if (existing.status === 'APPLIED') return { ...workerApplicationView(existing), idempotent: true, created: false };
        throw new JobError('ALREADY_APPLIED', 409, { status: existing.status });
      }
      if (!postingAcceptsApplications(posting.status)) {
        throw new JobError(posting.status === 'FILLED' ? 'POSTING_FILLED' : 'POSTING_NOT_PUBLISHED', 409, { status: posting.status });
      }
      let screeningAnswers: Array<{ question: string; answer: string }>;
      try {
        screeningAnswers = validateScreeningAnswers(readStringList(posting.screeningQuestions), answers);
      } catch (error) {
        if (error instanceof MarketplaceError) throw new JobError('INVALID_SCREENING_ANSWERS', 400);
        throw error;
      }
      if (!postingHasFreeVacancies(posting)) throw new JobError('POSTING_FILLED', 409);
      // Punto de extensión de M4: cobrar postulaciones extra más allá de la cuota gratuita.
      await this.hooks.beforeApply?.({ tx, userId: session.userId, postingId, companyId: posting.companyId });
      const created = await tx.jobApplication.create({ data: { postingId, workerId: session.userId, screeningAnswers } });
      const application = await tx.jobApplication.findUniqueOrThrow({ where: { id: created.id }, include: applicationInclude });
      await this.record(tx, emit, application, { userId: session.userId, kind: 'WORKER' }, 'APPLIED', null, 'APPLIED', null, 'APPLIED');
      return { ...workerApplicationView(await this.reload(tx, created.id)), idempotent: false, created: true };
    });
    try {
      return await attempt();
    } catch (error) {
      // Postulación doble simultánea: la restricción única sobre `(puesto, trabajador)`
      // hace perder a la segunda; al reintentar ve la primera y responde de forma idempotente.
      if (isUniqueViolation(error)) return attempt();
      throw error;
    }
  }

  async listMyApplications(session: AuthSession, filter: Page & { statuses?: JobApplicationStatus[] }) {
    const cursor = decodeCursor(filter.cursor);
    const rows = await this.prisma.jobApplication.findMany({
      where: {
        workerId: session.userId,
        ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.date } }, { createdAt: cursor.date, id: { lt: cursor.id } }] } : {}),
      },
      include: applicationInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });
    const items = rows.slice(0, filter.limit);
    return {
      items: items.map(workerApplicationView),
      nextCursor: rows.length > filter.limit ? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id) : null,
    };
  }

  async getMyApplication(session: AuthSession, applicationId: string) {
    const application = await this.prisma.jobApplication.findFirst({ where: { id: applicationId, workerId: session.userId }, include: applicationInclude });
    if (!application) throw new JobError('JOB_APPLICATION_NOT_FOUND', 404);
    return workerApplicationView(application);
  }

  async withdraw(session: AuthSession, applicationId: string) {
    return this.run(async (tx, emit) => {
      const application = await this.lockWorkerApplication(tx, applicationId, session.userId);
      const result = await this.transition(tx, emit, application, { userId: session.userId, kind: 'WORKER' }, 'WITHDRAWN', 'WITHDRAWN', { withdrawPendingOffer: true });
      return { ...workerApplicationView(await this.reload(tx, applicationId)), idempotent: result.idempotent };
    });
  }

  async acceptOffer(session: AuthSession, applicationId: string, offerId: string) {
    return this.run(async (tx, emit) => {
      const application = await this.lockWorkerApplication(tx, applicationId, session.userId);
      const offer = application.offers.find((candidate) => candidate.id === offerId);
      if (!offer) throw new JobError('JOB_OFFER_NOT_FOUND', 404);
      if (application.status === 'ACCEPTED' && offer.status === 'ACCEPTED') return { ...workerApplicationView(application), idempotent: true };
      // Solo la oferta vigente (la última, pendiente) se acepta; una versión anterior ya no.
      if (application.status !== 'OFFER') throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: 'ACCEPTED' });
      if (offer.status !== 'PENDING') throw new JobError('OFFER_NOT_PENDING', 409, { offerStatus: offer.status });
      if (!postingAllowsProgress(application.posting.status)) throw new JobError('POSTING_NOT_OPEN', 409, { status: application.posting.status });
      const acceptedAt = this.now();
      // Constancia inmutable: copia de las condiciones tal como se aceptaron. Después
      // de este UPDATE un trigger impide cualquier otro cambio sobre la fila.
      const acceptanceSnapshot = {
        acceptedAt: acceptedAt.toISOString(),
        offerVersion: offer.version,
        company: { id: application.posting.company.id, name: application.posting.company.name, legalName: application.posting.company.legalName, ruc: application.posting.company.ruc },
        worker: { id: application.worker.id, name: application.worker.name, identifier: application.worker.identifier },
        posting: {
          id: application.posting.id,
          title: application.posting.title,
          modality: application.posting.modality,
          workload: application.posting.workload,
          location: application.posting.location,
          salaryRange: postingSalaryView(application.posting),
        },
        conditions: {
          salaryCents: offer.salaryCents,
          currency: offer.currency,
          contractType: offer.contractType,
          startDate: offer.startDate.toISOString().slice(0, 10),
          note: offer.note,
        },
        document: offer.documentName ? { name: offer.documentName, mediaType: offer.documentMediaType, sizeBytes: offer.documentSizeBytes, sha256: offer.documentSha256 } : null,
      };
      const resolved = resolveApplicationTransition(application.status, 'ACCEPTED', 'WORKER');
      if (resolved.kind !== 'MOVE') throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: 'ACCEPTED' });
      await tx.jobOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', respondedAt: acceptedAt, acceptanceSnapshot } });
      await tx.jobApplication.update({ where: { id: applicationId }, data: { status: 'ACCEPTED' } });
      await this.record(tx, emit, application, { userId: session.userId, kind: 'WORKER' }, 'OFFER_ACCEPTED', application.status, 'ACCEPTED', `v${offer.version}`, 'ACCEPTED');
      return { ...workerApplicationView(await this.reload(tx, applicationId)), idempotent: false };
    });
  }

  /** Rechazar una oferta es una retirada del trabajador (`WITHDRAWN`), con evento propio. */
  async declineOffer(session: AuthSession, applicationId: string, offerId: string) {
    return this.run(async (tx, emit) => {
      const application = await this.lockWorkerApplication(tx, applicationId, session.userId);
      const offer = application.offers.find((candidate) => candidate.id === offerId);
      if (!offer) throw new JobError('JOB_OFFER_NOT_FOUND', 404);
      if (offer.status === 'DECLINED') return { ...workerApplicationView(application), idempotent: true };
      if (application.status !== 'OFFER') throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: 'WITHDRAWN' });
      if (offer.status !== 'PENDING') throw new JobError('OFFER_NOT_PENDING', 409, { offerStatus: offer.status });
      await tx.jobOffer.update({ where: { id: offer.id }, data: { status: 'DECLINED', respondedAt: this.now() } });
      await tx.jobApplication.update({ where: { id: applicationId }, data: { status: 'WITHDRAWN' } });
      await this.record(tx, emit, application, { userId: session.userId, kind: 'WORKER' }, 'OFFER_DECLINED', application.status, 'WITHDRAWN', `v${offer.version}`, 'WITHDRAWN');
      return { ...workerApplicationView(await this.reload(tx, applicationId)), idempotent: false };
    });
  }

  // ---- Internos ----------------------------------------------------------

  private postingData(input: JobPostingPatch) {
    const data: Prisma.JobPostingUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.responsibilities !== undefined) data.responsibilities = input.responsibilities;
    if (input.requirements !== undefined) data.requirements = input.requirements;
    if (input.benefits !== undefined) data.benefits = input.benefits;
    if (input.modality !== undefined) data.modality = input.modality;
    if (input.workload !== undefined) data.workload = input.workload;
    if (input.salaryMinCents !== undefined) data.salaryMinCents = input.salaryMinCents;
    if (input.salaryMaxCents !== undefined) data.salaryMaxCents = input.salaryMaxCents;
    if (input.location !== undefined) data.location = input.location;
    if (input.contractType !== undefined) data.contractType = input.contractType;
    if (input.vacancies !== undefined) data.vacancies = input.vacancies;
    if (input.screeningQuestions !== undefined) data.screeningQuestions = input.screeningQuestions;
    if (input.expectedStartDate !== undefined) {
      data.expectedStartDate = input.expectedStartDate === null ? null : parseCalendarDate(input.expectedStartDate, 'INVALID_START_DATE');
      if (input.expectedStartDate !== null && input.expectedStartDate < limaCalendarDate(this.now())) throw new JobError('INVALID_START_DATE', 400);
    }
    if (
      data.salaryMinCents !== undefined && data.salaryMaxCents !== undefined
      && (data.salaryMinCents as number) > (data.salaryMaxCents as number)
    ) throw new JobError('INVALID_SALARY_RANGE', 400);
    return data as Prisma.JobPostingUncheckedCreateInput;
  }

  /** Bloquea la fila del puesto de la empresa; 404 si no existe o es de otra empresa. */
  private async lockPosting(tx: Prisma.TransactionClient, postingId: string, companyId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "JobPosting" WHERE "id" = ${postingId} AND "companyId" = ${companyId} FOR UPDATE`;
    if (locked.length === 0) throw new JobError('JOB_POSTING_NOT_FOUND', 404);
    return tx.jobPosting.findUniqueOrThrow({ where: { id: postingId } });
  }

  private async lockCompanyApplication(tx: Prisma.TransactionClient, applicationId: string, companyId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT a."id" FROM "JobApplication" a JOIN "JobPosting" p ON p."id" = a."postingId"
      WHERE a."id" = ${applicationId} AND p."companyId" = ${companyId} FOR UPDATE OF a`;
    if (locked.length === 0) throw new JobError('JOB_APPLICATION_NOT_FOUND', 404);
    return this.reload(tx, applicationId);
  }

  private async lockWorkerApplication(tx: Prisma.TransactionClient, applicationId: string, workerId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "JobApplication" WHERE "id" = ${applicationId} AND "workerId" = ${workerId} FOR UPDATE`;
    if (locked.length === 0) throw new JobError('JOB_APPLICATION_NOT_FOUND', 404);
    return this.reload(tx, applicationId);
  }

  private reload(tx: Prisma.TransactionClient, applicationId: string) {
    return tx.jobApplication.findUniqueOrThrow({ where: { id: applicationId }, include: applicationInclude });
  }

  /**
   * Al cerrar o cubrir un puesto, las ofertas aún sin responder ya no pueden
   * aceptarse: se retiran (`WITHDRAWN`), la postulación pasa a `REJECTED` con el
   * motivo `POSTING_CLOSED`/`POSTING_FILLED` en la línea de tiempo y el
   * trabajador recibe el aviso. Las demás postulaciones abiertas no se tocan.
   */
  private async releasePendingOffers(tx: Prisma.TransactionClient, emit: Emit, postingId: string, companyUserId: string, reason: 'POSTING_CLOSED' | 'POSTING_FILLED') {
    const open = await tx.jobApplication.findMany({ where: { postingId, status: 'OFFER' }, include: applicationInclude, orderBy: { id: 'asc' } });
    for (const application of open) {
      const pending = application.offers.find((offer) => offer.status === 'PENDING');
      if (pending) await tx.jobOffer.update({ where: { id: pending.id }, data: { status: 'WITHDRAWN', respondedAt: this.now() } });
      await tx.jobApplication.update({ where: { id: application.id }, data: { status: 'REJECTED' } });
      await this.record(tx, emit, application, { userId: companyUserId, kind: 'COMPANY' }, 'REJECTED', application.status, 'REJECTED', reason, 'REJECTED');
    }
  }

  /** Escribe el evento de línea de tiempo y encola el aviso para la contraparte. */
  private async record(
    tx: Prisma.TransactionClient,
    emit: Emit,
    application: ApplicationRecord,
    actor: Actor,
    type: JobApplicationEventKind,
    from: JobApplicationStatus | null,
    to: JobApplicationStatus,
    detail: string | null,
    statusAfter: JobApplicationStatus,
  ) {
    await tx.jobApplicationEvent.create({
      data: {
        applicationId: application.id,
        actorId: actor.userId,
        actorRole: actor.kind === 'COMPANY' ? 'BUSINESS' : 'WORKER',
        type,
        fromStatus: from,
        toStatus: to,
        detail,
      },
    });
    emit({
      type,
      applicationId: application.id,
      postingId: application.postingId,
      status: statusAfter,
      recipientUserId: actor.kind === 'COMPANY' ? application.workerId : application.posting.company.ownerId,
    });
  }

  /**
   * Aplica una transición de la máquina de estados con idempotencia: pedir el
   * estado en el que ya está devuelve el actual sin escribir nada. Una oferta
   * pendiente se retira si la postulación sale del proceso.
   */
  private async transition(
    tx: Prisma.TransactionClient,
    emit: Emit,
    application: ApplicationRecord,
    actor: Actor,
    to: JobApplicationStatus,
    type: JobApplicationEventKind,
    options: { data?: Prisma.JobApplicationUncheckedUpdateInput; detail?: string | null; requireOpenPosting?: boolean; withdrawPendingOffer?: boolean } = {},
  ): Promise<{ idempotent: boolean }> {
    const decision = resolveApplicationTransition(application.status, to, actor.kind);
    if (decision.kind === 'INVALID') throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: to });
    if (decision.kind === 'IDEMPOTENT') return { idempotent: true };
    if (isTerminalApplication(application.status)) throw new JobError('INVALID_STATE_TRANSITION', 409, { status: application.status, requested: to });
    if (options.requireOpenPosting && !postingAllowsProgress(application.posting.status)) {
      throw new JobError('POSTING_NOT_OPEN', 409, { status: application.posting.status });
    }
    if (options.withdrawPendingOffer) {
      const pending = application.offers.find((offer) => offer.status === 'PENDING');
      if (pending) await tx.jobOffer.update({ where: { id: pending.id }, data: { status: 'WITHDRAWN', respondedAt: this.now() } });
    }
    await tx.jobApplication.update({ where: { id: application.id }, data: { ...options.data, status: to } });
    await this.record(tx, emit, application, actor, type, application.status, to, options.detail ?? null, to);
    return { idempotent: false };
  }
}
