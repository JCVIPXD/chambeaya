import { ApiError, apiErrorFrom, apiOrigin, request } from '../../lib/business-api';

// Contrato de la API de puestos fijos, moneda virtual y talento (M3, M4 y M6) con tipos estrictos.
// Los valores de los enums van en inglés como en la API; los textos en español salen de `labels.ts`.
// Dinero siempre en céntimos de sol (`PEN`); la moneda virtual en unidades enteras. El NOMBRE de la
// moneda (`currency`) lo entrega siempre la API: nunca se fija en el panel.

export type PostingStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'CLOSED' | 'FILLED';
export type ApplicationStatus = 'APPLIED' | 'SHORTLISTED' | 'INTERVIEW' | 'OFFER' | 'ACCEPTED' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export type Modality = 'ONSITE' | 'REMOTE' | 'HYBRID';
export type Workload = 'FULL_TIME' | 'PART_TIME';
export type ContractType = 'INDEFINITE' | 'FIXED_TERM' | 'INTERNSHIP' | 'OTHER';
export type InterviewMode = 'ONSITE' | 'VIDEO' | 'PHONE';
export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'SUPERSEDED';

export type Page<T> = { items: T[]; nextCursor: string | null };

export type PostingRecord = {
  id: string;
  title: string;
  description: string;
  responsibilities: string | null;
  requirements: string | null;
  benefits: string | null;
  modality: Modality;
  workload: Workload;
  salary: { minCents: number; maxCents: number; currency: string };
  location: string;
  contractType: ContractType;
  expectedStartDate: string | null;
  vacancies: number;
  filledVacancies: number;
  screeningQuestions: string[];
  status: PostingStatus;
  publishedAt: string | null;
  closedAt: string | null;
  highlightedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  applicationsCount?: number;
  applicantCounts?: Partial<Record<ApplicationStatus, number>>;
};

export type PostingMutation = PostingRecord & { idempotent?: boolean; chargedAmount?: number };

export type PostingInput = {
  title: string;
  description: string;
  responsibilities?: string | null;
  requirements?: string | null;
  benefits?: string | null;
  modality: Modality;
  workload: Workload;
  salaryMinCents: number;
  salaryMaxCents: number;
  location: string;
  contractType: ContractType;
  expectedStartDate?: string | null;
  vacancies: number;
  screeningQuestions?: string[];
};

export type OfferDocument = { name: string; mediaType: string | null; sizeBytes: number | null; sha256: string | null };

export type AcceptanceSnapshot = {
  acceptedAt: string;
  offerVersion: number;
  company: { id: string; name: string; legalName: string | null; ruc: string };
  worker: { id: string; name: string; identifier: string };
  posting: { id: string; title: string; modality: Modality; workload: Workload; location: string; salaryRange: { minCents: number; maxCents: number; currency: string } };
  conditions: { salaryCents: number; currency: string; contractType: ContractType; startDate: string; note: string | null };
  document: OfferDocument | null;
};

export type OfferRecord = {
  id: string;
  version: number;
  status: OfferStatus;
  salaryCents: number;
  currency: string;
  contractType: ContractType;
  startDate: string;
  note: string | null;
  document: OfferDocument | null;
  createdAt: string;
  respondedAt: string | null;
  acceptanceSnapshot: AcceptanceSnapshot | null;
};

export type JobEventRecord = {
  id: string;
  type: string;
  actorRole: 'COMPANY' | 'WORKER' | 'SYSTEM' | string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus | null;
  detail: string | null;
  createdAt: string;
};

export type InterviewRecord = { scheduledAt: string; mode: InterviewMode | null; note: string | null } | null;

/** Lo que la API entrega de un postulante en la lista: sin correo, teléfono ni documento. */
export type ApplicantSummary = {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  isPriority: boolean;
  prioritizedAt: string | null;
  worker: { name: string; headline: string | null; district: string | null; hasCv: boolean };
  interview: InterviewRecord;
  currentOfferStatus: OfferStatus | null;
};

export type ApplicationDetail = ApplicantSummary & {
  posting: { id: string; title: string; status: PostingStatus };
  screeningAnswers: Array<{ question: string; answer: string }>;
  decisionReason: string | null;
  hiredAt: string | null;
  offers: OfferRecord[];
  events: JobEventRecord[];
};

export type OfferInput = { salaryCents: number; contractType: ContractType; startDate: string; note?: string | null; documentId?: string | null };
export type InterviewInput = { scheduledAt: string; mode?: InterviewMode | null; note?: string | null };
export type UploadedOfferDocument = { id: string; name: string; mediaType: string; sizeBytes: number; sha256: string };

// ---- Moneda virtual -------------------------------------------------------

export type QuoteReason = 'CHARGE' | 'FREE_QUOTA' | 'ALREADY_REGISTERED' | 'FREE_ACTION';
export type QuotableAction = 'JOB_PUBLISH_EXTRA' | 'JOB_HIGHLIGHT' | 'TALENT_INVITE' | 'CANDIDATE_CONTACT_UNLOCK';

export type Quote = {
  currency: string;
  actionKey: string;
  actor: string;
  active: boolean;
  cost: number;
  catalogAmount: number;
  reason: QuoteReason;
  freeQuota: { monthlyLimit: number; used: number; remaining: number; periodStart: string; periodEnd: string } | null;
  balance: number;
  sufficientBalance: boolean;
  dailyCap: { limit: number; spentToday: number; remaining: number };
  withinDailyCap: boolean;
  canExecute: boolean;
  refundWindowHours: number | null;
};

export type Balance = { currency: string; balance: number };

export type MovementRecord = {
  id: string;
  sequence: number;
  quantity: number;
  balanceAfter: number;
  action: 'ADMIN_ADJUSTMENT' | 'ACTION_CHARGE' | 'ACTION_REFUND' | 'REWARD';
  actionKey: string | null;
  reason: string | null;
  relatedEntity: { type: string; id: string } | null;
  refundOfId: string | null;
  actor: { id: string; name: string } | null;
  createdAt: string;
};
export type MovementPage = Page<MovementRecord> & { currency: string };

export type CatalogItem = {
  actionKey: string;
  kind: 'COST' | 'REWARD';
  amount: number;
  freeMonthlyQuota?: number;
  freeRemaining?: number;
  refundWindowHours?: number | null;
};
export type Catalog = { currency: string; items: CatalogItem[] };

export type RewardItem = {
  actionKey: string;
  amount: number;
  repeatable: boolean;
  earnedCount: number;
  earnedAmount: number;
  status: 'EARNED' | 'AVAILABLE';
  verified?: boolean;
  monthly?: { limit: number; used: number; remaining: number };
  windowHours?: number;
};
export type Rewards = {
  currency: string;
  items: RewardItem[];
  caps: { daily: { limit: number; earned: number; remaining: number }; monthly: { limit: number; earned: number; remaining: number } };
};

// ---- Talento ---------------------------------------------------------------

export type UnlockResult = {
  unlocked: true;
  idempotent: boolean;
  chargedAmount: number;
  viaApplication: boolean;
  contact: { name: string; email: string };
  hasCv: boolean;
};
export type ContactRecord = { unlocked: true; contact: { name: string; email: string }; hasCv: boolean };
export type UnlockList = { items: Array<{ workerTalentProfileId: string; unlockedAt: string }> };

// ---- Eventos en tiempo real -------------------------------------------------

export type JobEventType =
  | 'APPLIED' | 'SHORTLISTED' | 'INTERVIEW_SCHEDULED' | 'OFFER_ISSUED' | 'OFFER_ACCEPTED'
  | 'OFFER_DECLINED' | 'HIRED' | 'REJECTED' | 'WITHDRAWN' | 'APPLICATION_REOPENED';
export type JobEventNotification = { type: JobEventType; applicationId: string; postingId: string; status: ApplicationStatus; at: string };

// ---- Peticiones -------------------------------------------------------------

function pageQuery(params: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : '';
}

function json(body: unknown) {
  return JSON.stringify(body);
}

/** Descarga un archivo con la sesión de la empresa; solo se acepta `application/pdf`. */
async function pdfBlob(path: string, token: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`${apiOrigin()}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok) throw await apiErrorFrom(response);
  const blob = await response.blob();
  if (blob.type !== 'application/pdf') throw new ApiError(502, 'INVALID_PDF_RESPONSE');
  return blob;
}

export const jobsApi = {
  postings: {
    list: (token: string, input: { status?: PostingStatus; cursor?: string | null; limit?: number } = {}) =>
      request<Page<PostingRecord>>(`/business/job-postings${pageQuery({ status: input.status, cursor: input.cursor, limit: input.limit ?? 25 })}`, { token }),
    get: (token: string, id: string) => request<PostingRecord>(`/business/job-postings/${encodeURIComponent(id)}`, { token }),
    create: (token: string, input: PostingInput) => request<PostingRecord>('/business/job-postings', { method: 'POST', token, body: json(input) }),
    update: (token: string, id: string, patch: Partial<PostingInput>) =>
      request<PostingRecord>(`/business/job-postings/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: json(patch) }),
    publish: (token: string, id: string) => request<PostingMutation>(`/business/job-postings/${encodeURIComponent(id)}/publish`, { method: 'POST', token }),
    pause: (token: string, id: string) => request<PostingMutation>(`/business/job-postings/${encodeURIComponent(id)}/pause`, { method: 'POST', token }),
    close: (token: string, id: string) => request<PostingMutation>(`/business/job-postings/${encodeURIComponent(id)}/close`, { method: 'POST', token }),
    highlight: (token: string, id: string) => request<PostingMutation>(`/business/job-postings/${encodeURIComponent(id)}/highlight`, { method: 'POST', token }),
  },
  applications: {
    list: (token: string, postingId: string, input: { statuses?: ApplicationStatus[]; cursor?: string | null; limit?: number } = {}) =>
      request<Page<ApplicantSummary>>(
        `/business/job-postings/${encodeURIComponent(postingId)}/applications${pageQuery({ status: input.statuses?.join(','), cursor: input.cursor, limit: input.limit ?? 25 })}`,
        { token },
      ),
    get: (token: string, id: string) => request<ApplicationDetail>(`/business/job-applications/${encodeURIComponent(id)}`, { token }),
    stage: (token: string, id: string, status: 'SHORTLISTED' | 'INTERVIEW') =>
      request<ApplicationDetail>(`/business/job-applications/${encodeURIComponent(id)}/stage`, { method: 'POST', token, body: json({ status }) }),
    interview: (token: string, id: string, input: InterviewInput) =>
      request<ApplicationDetail>(`/business/job-applications/${encodeURIComponent(id)}/interview`, { method: 'POST', token, body: json(input) }),
    reject: (token: string, id: string, reason?: string | null) =>
      request<ApplicationDetail>(`/business/job-applications/${encodeURIComponent(id)}/reject`, { method: 'POST', token, body: json(reason ? { reason } : {}) }),
    hire: (token: string, id: string) => request<ApplicationDetail>(`/business/job-applications/${encodeURIComponent(id)}/hire`, { method: 'POST', token }),
    uploadOfferDocument: async (token: string, id: string, file: File): Promise<UploadedOfferDocument> => {
      const response = await fetch(`${apiOrigin()}/business/job-applications/${encodeURIComponent(id)}/offer-documents`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
      if (!response.ok) throw await apiErrorFrom(response);
      return (await response.json()) as UploadedOfferDocument;
    },
    issueOffer: (token: string, id: string, input: OfferInput) =>
      request<ApplicationDetail & { idempotent?: boolean }>(`/business/job-applications/${encodeURIComponent(id)}/offers`, { method: 'POST', token, body: json(input) }),
    cv: (token: string, id: string, signal?: AbortSignal) => pdfBlob(`/business/job-applications/${encodeURIComponent(id)}/cv`, token, signal),
    offerDocument: (token: string, id: string, offerId: string, signal?: AbortSignal) =>
      pdfBlob(`/business/job-applications/${encodeURIComponent(id)}/offers/${encodeURIComponent(offerId)}/document`, token, signal),
  },
  currency: {
    balance: (token: string) => request<Balance>('/business/currency/balance', { token }),
    movements: (token: string, input: { cursor?: string | null; limit?: number } = {}) =>
      request<MovementPage>(`/business/currency/movements${pageQuery({ cursor: input.cursor, limit: input.limit ?? 20 })}`, { token }),
    catalog: (token: string) => request<Catalog>('/business/currency/catalog', { token }),
    rewards: (token: string) => request<Rewards>('/business/currency/rewards', { token }),
    quote: (token: string, actionKey: QuotableAction, targetId?: string) =>
      request<Quote>(`/business/currency/quote${pageQuery({ actionKey, targetId })}`, { token }),
  },
  talent: {
    unlocks: (token: string) => request<UnlockList>('/business/talent-unlocks', { token }),
    unlock: (token: string, profileId: string) => request<UnlockResult>(`/business/talent/${encodeURIComponent(profileId)}/unlock-contact`, { method: 'POST', token }),
    contact: (token: string, profileId: string) => request<ContactRecord>(`/business/talent/${encodeURIComponent(profileId)}/contact`, { token }),
    cv: (token: string, profileId: string, signal?: AbortSignal) => pdfBlob(`/business/talent/${encodeURIComponent(profileId)}/cv`, token, signal),
  },
};
