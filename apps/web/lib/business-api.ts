const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000/api';

export const businessSessionKey = 'chambeaya_business_session';

export type BusinessSession = {
  token: string;
  userId: string;
  role: 'BUSINESS';
  name: string;
  email: string;
  identifier: string;
};

export type CompanyRecord = {
  id: string;
  name: string;
  legalName: string | null;
  ruc: string;
  industry: string | null;
  phone: string | null;
  address: string | null;
  district: string | null;
};

export type SubscriptionRecord = {
  // `id`/`startsAt` faltan cuando la empresa no activó ningún plan: el
  // backend ya no crea una fila real en el primer `GET`, así que devuelve un
  // objeto sintético en memoria con `status: 'INACTIVE'` en vez de fingir un
  // trial que nadie inició (ver `business.service.ts#getSubscription`).
  id?: string;
  plan: 'PILOT' | 'PRO' | 'CUSTOM';
  status: 'INACTIVE' | 'TRIAL' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';
  startsAt?: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
};

export type ShiftEventRecord = {
  id: string;
  shiftId: string;
  actorId: string | null;
  actorRole: 'WORKER' | 'BUSINESS' | 'SYSTEM';
  type: string;
  detail: string | null;
  createdAt: string;
};

export type ShiftRecord = {
  id: string;
  title: string;
  location: string;
  startsAt: string;
  endsAt: string;
  payCents: number;
  requiredWorkers: number;
  confirmedWorkers: number;
  description: string | null;
  responsibilities: string | null;
  requirements: string | null;
  screeningQuestions: string[] | null;
  modality: 'PRESENCIAL' | 'REMOTO' | 'HIBRIDO';
  notes: string | null;
  rescueActive: boolean;
  status: 'PUBLISHED' | 'ASSIGNED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
};

// Estado persistido de una asignación. `NO_SHOW` (confirmó y nunca hizo
// check-in dentro de la ventana) y `ABANDONED` (hizo check-in y nunca check-out
// tras el margen) los calcula la API "al leer" y quedan pendientes de una
// decisión humana de la empresa (`businessApi.assignments.resolve`).
export type AssignmentStatus = 'ASSIGNED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW' | 'ABANDONED';
export type AssignmentResolutionOutcome = 'COMPLETED' | 'CANCELLED';

export type AssignmentRecord = {
  id: string;
  status: AssignmentStatus;
  checkInCredential: string | null;
  workerConfirmedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

// Respuesta de `POST /business/shifts/:id/assignments/:assignmentId/resolve`:
// la fila `ShiftAssignment` ya actualizada (no incluye pago ni turno; para
// verlos hay que volver a consultarlos).
export type ResolvedAssignmentRecord = AssignmentRecord & {
  shiftId: string;
  workerId: string;
  applicationId: string;
  assignedAt: string;
  completedAt: string | null;
};

export type ShiftApplicationRecord = {
  id: string;
  shiftId: string;
  workerId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  screeningAnswers: { question: string; answer: string }[] | null;
  worker: { id: string; name: string; email: string | null; identifier: string };
  assignment?: AssignmentRecord | null;
  nextAction: {
    actor: 'BUSINESS' | 'WORKER' | 'NONE';
    code: 'REVIEW_APPLICATION' | 'CONFIRM_ASSIGNMENT' | 'CHECK_IN' | 'CHECK_OUT' | 'NONE';
    label: string;
  };
};

export type PendingApplicationsSummary = {
  count: number;
  shiftIds: string[];
};

export type WorkerRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  skills: string[];
  status: 'AVAILABLE' | 'ON_SHIFT' | 'UNAVAILABLE';
  availability: string | null;
};
export type SpecialtyRecord = { id: string; slug: string; name: string; category: string };
export type TalentCardRecord = { id: string; name: string; headline: string | null; district: string | null; availabilityText: string | null; isAvailable: boolean; specialties: SpecialtyRecord[]; completion: number; reputation: { averageRating: number | null; reviewCount: number } };
export type TalentSearchResult = { items: TalentCardRecord[]; nextCursor: string | null };

export type TalentInvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
export type TalentInvitationShiftSummary = { id: string; title: string; startsAt: string; endsAt: string };
export type BusinessTalentInvitationRecord = {
  id: string;
  status: TalentInvitationStatus;
  message: string | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
  shift: TalentInvitationShiftSummary | null;
  workerTalentProfileId: string;
  workerName: string;
};
export type TalentInvitationInput = { workerTalentProfileId: string; shiftId?: string | null; message?: string | null };

export type MessageRecord = {
  id: string;
  sender: 'BUSINESS' | 'WORKER';
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type ConversationRecord = {
  id: string;
  workerId: string;
  shiftId: string | null;
  subject: string;
  status: 'OPEN' | 'ARCHIVED';
  updatedAt: string;
  worker: WorkerRecord;
  shift: ShiftRecord | null;
  messages: MessageRecord[];
};

export type PaymentRecord = {
  id: string;
  reference: string;
  description: string;
  amountCents: number;
  workerCount: number;
  status: 'PENDING' | 'SCHEDULED' | 'PROCESSED' | 'CANCELLED';
  dueAt: string | null;
  processedAt: string | null;
  createdAt: string;
  shift?: { id: string; title: string; startsAt: string; endsAt: string } | null;
  assignment?: { id: string; status: AssignmentStatus; worker: { id: string; name: string; email: string | null } } | null;
  workerConfirmedAt: string | null;
};

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

async function request<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...init } = options;
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(response.status, payload.error ?? 'REQUEST_FAILED');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const authApi = {
  login: (email: string, password: string) => request<BusinessSession>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  restore: (token: string) => request<BusinessSession>('/auth/session', { token }),
  logout: (token: string) => request<void>('/auth/session', { method: 'DELETE', token }),
};

function resource<T>(path: string) {
  return {
    list: (token: string) => request<T[]>(path, { token }),
    get: (token: string, id: string) => request<T>(`${path}/${id}`, { token }),
    create: (token: string, input: unknown) => request<T>(path, { method: 'POST', token, body: JSON.stringify(input) }),
    update: (token: string, id: string, input: unknown) => request<T>(`${path}/${id}`, { method: 'PATCH', token, body: JSON.stringify(input) }),
    remove: (token: string, id: string) => request<void>(`${path}/${id}`, { method: 'DELETE', token }),
  };
}

export const businessApi = {
  company: {
    get: (token: string) => request<CompanyRecord>('/business/company', { token }),
    update: (token: string, input: unknown) => request<CompanyRecord>('/business/company', { method: 'PATCH', token, body: JSON.stringify(input) }),
  },
  subscription: {
    get: (token: string) => request<SubscriptionRecord>('/business/subscription', { token }),
  },
  shifts: {
    ...resource<ShiftRecord>('/business/shifts'),
    cancel: (token: string, id: string, reason: string) => request<ShiftRecord>(`/business/shifts/${id}/cancel`, { method: 'POST', token, body: JSON.stringify({ reason }) }),
    events: (token: string, id: string) => request<ShiftEventRecord[]>(`/business/shifts/${id}/events`, { token }),
  },
  applications: {
    list: (token: string, shiftId: string) => request<ShiftApplicationRecord[]>(`/business/shifts/${shiftId}/applications`, { token }),
    pending: (token: string) => request<PendingApplicationsSummary>('/business/applications/pending', { token }),
    decide: (token: string, shiftId: string, applicationId: string, decision: 'ACCEPTED' | 'REJECTED', reason?: string) => request<ShiftApplicationRecord>(`/business/shifts/${shiftId}/applications/${applicationId}`, { method: 'PATCH', token, body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }) }),
  },
  assignments: {
    // `reason` es opcional pero, si se envía, la API exige al menos 3
    // caracteres (`400 INVALID_INPUT`). Solo acepta asignaciones `NO_SHOW` o
    // `ABANDONED` (`400 ASSIGNMENT_NOT_RESOLVABLE` en cualquier otro caso).
    resolve: (token: string, shiftId: string, assignmentId: string, outcome: AssignmentResolutionOutcome, reason?: string) => request<ResolvedAssignmentRecord>(`/business/shifts/${shiftId}/assignments/${assignmentId}/resolve`, { method: 'POST', token, body: JSON.stringify({ outcome, ...(reason ? { reason } : {}) }) }),
  },
  workers: resource<WorkerRecord>('/business/workers'),
  talent: {
    specialties: (token: string) => request<SpecialtyRecord[]>('/specialties', { token }),
    search: (token: string, input: { specialtyId?: string; district?: string; query?: string; availableOnly?: boolean; cursor?: string }) => {
      const query = new URLSearchParams({ limit: '20' });
      if (input.specialtyId) query.set('specialtyId', input.specialtyId);
      if (input.district) query.set('district', input.district);
      if (input.query) query.set('query', input.query);
      if (input.availableOnly) query.set('availableOnly', 'true');
      if (input.cursor) query.set('cursor', input.cursor);
      return request<TalentSearchResult>(`/business/talent?${query}`, { token });
    },
    invitations: {
      create: (token: string, input: TalentInvitationInput) => request<BusinessTalentInvitationRecord>('/business/talent-invitations', { method: 'POST', token, body: JSON.stringify(input) }),
      list: (token: string) => request<BusinessTalentInvitationRecord[]>('/business/talent-invitations', { token }),
    },
  },
  conversations: {
    ...resource<ConversationRecord>('/business/conversations'),
    createMessage: (token: string, conversationId: string, body: string) => request<MessageRecord>(`/business/conversations/${conversationId}/messages`, { method: 'POST', token, body: JSON.stringify({ body }) }),
    updateMessage: (token: string, conversationId: string, messageId: string, input: unknown) => request<MessageRecord>(`/business/conversations/${conversationId}/messages/${messageId}`, { method: 'PATCH', token, body: JSON.stringify(input) }),
    removeMessage: (token: string, conversationId: string, messageId: string) => request<void>(`/business/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE', token }),
  },
  payments: resource<PaymentRecord>('/business/payments'),
};
