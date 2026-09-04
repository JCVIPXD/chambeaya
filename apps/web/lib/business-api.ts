const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000/api';

export const businessSessionKey = 'cumplenow_business_session';

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
  id: string;
  plan: 'PILOT' | 'PRO' | 'CUSTOM';
  status: 'TRIAL' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';
  startsAt: string;
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

export type ShiftApplicationRecord = {
  id: string;
  shiftId: string;
  workerId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  screeningAnswers: { question: string; answer: string }[] | null;
  worker: { id: string; name: string; email: string | null; identifier: string };
  assignment?: {
    id: string;
    status: 'ASSIGNED' | 'CANCELLED' | 'COMPLETED';
    checkInCredential: string | null;
    workerConfirmedAt: string | null;
    checkedInAt: string | null;
    checkedOutAt: string | null;
  } | null;
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
  cumpleScore: number;
  matchScore: number;
  completedJobs: number;
  verified: boolean;
};

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
  assignment?: { id: string; status: 'ASSIGNED' | 'CANCELLED' | 'COMPLETED'; worker: { id: string; name: string; email: string | null } } | null;
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
  workers: resource<WorkerRecord>('/business/workers'),
  conversations: {
    ...resource<ConversationRecord>('/business/conversations'),
    createMessage: (token: string, conversationId: string, body: string) => request<MessageRecord>(`/business/conversations/${conversationId}/messages`, { method: 'POST', token, body: JSON.stringify({ body }) }),
    updateMessage: (token: string, conversationId: string, messageId: string, input: unknown) => request<MessageRecord>(`/business/conversations/${conversationId}/messages/${messageId}`, { method: 'PATCH', token, body: JSON.stringify(input) }),
    removeMessage: (token: string, conversationId: string, messageId: string) => request<void>(`/business/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE', token }),
  },
  payments: resource<PaymentRecord>('/business/payments'),
};
