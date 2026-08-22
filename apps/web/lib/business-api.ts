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

export type ShiftRecord = {
  id: string;
  title: string;
  location: string;
  startsAt: string;
  endsAt: string;
  payCents: number;
  requiredWorkers: number;
  confirmedWorkers: number;
  notes: string | null;
  rescueActive: boolean;
  status: 'PUBLISHED' | 'ASSIGNED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
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
  register: (input: { name: string; email: string; password: string; dniOrRuc: string }) => request<BusinessSession>('/auth/register', { method: 'POST', body: JSON.stringify({ ...input, role: 'BUSINESS' }) }),
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
  shifts: resource<ShiftRecord>('/business/shifts'),
  workers: resource<WorkerRecord>('/business/workers'),
  conversations: {
    ...resource<ConversationRecord>('/business/conversations'),
    createMessage: (token: string, conversationId: string, body: string) => request<MessageRecord>(`/business/conversations/${conversationId}/messages`, { method: 'POST', token, body: JSON.stringify({ body }) }),
    updateMessage: (token: string, conversationId: string, messageId: string, input: unknown) => request<MessageRecord>(`/business/conversations/${conversationId}/messages/${messageId}`, { method: 'PATCH', token, body: JSON.stringify(input) }),
    removeMessage: (token: string, conversationId: string, messageId: string) => request<void>(`/business/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE', token }),
  },
  payments: resource<PaymentRecord>('/business/payments'),
};
