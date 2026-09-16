const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000/api";
export type AdminSession = {
  token: string;
  userId: string;
  role: "ADMIN";
  name: string;
  email: string;
  identifier: string;
};
export type AdminOverview = {
  companies: number;
  workers: number;
  activeShifts: number;
  openIncidents: number;
  pendingApplications: number;
};
export type AdminCompany = {
  id: string;
  name: string;
  legalName: string | null;
  ruc: string;
  industry: string | null;
  district: string | null;
  owner: { id: string; name: string; email: string };
  subscription: { plan: string; status: string } | null;
  createdAt: string;
};
export type AdminWorker = {
  id: string;
  name: string;
  email: string | null;
  identifier: string;
  companyWorkerContacts: {
    status: string;
    company: { id: string; name: string };
  }[];
};
export type AdminIncident = {
  id: string;
  type: string;
  priority: string;
  status: string;
  subject: string;
  company: string;
  shiftId: string;
  updatedAt: string;
};
async function request<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(8_000),
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error("REQUEST_FAILED");
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const adminApi = {
  restore: (token: string) => request<AdminSession>("/auth/session", token),
  overview: (token: string) => request<AdminOverview>("/admin/overview", token),
  companies: (token: string) =>
    request<AdminCompany[]>("/admin/companies", token),
  workers: (token: string) => request<AdminWorker[]>("/admin/workers", token),
  incidents: (token: string) =>
    request<AdminIncident[]>("/admin/incidents", token),
  createCompany: (token: string, input: unknown) =>
    request<AdminCompany>("/admin/companies", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  updateCompany: (token: string, id: string, input: unknown) =>
    request<AdminCompany>(`/admin/companies/${id}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  deleteCompany: (token: string, id: string) =>
    request<void>(`/admin/companies/${id}`, token, { method: "DELETE" }),
  deleteWorker: (token: string, id: string) =>
    request<void>(`/admin/workers/${id}`, token, { method: "DELETE" }),
};
export async function adminLogin(email: string, password: string) {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error("INVALID_CREDENTIALS");
  const session = (await response.json()) as AdminSession;
  if (session.role !== "ADMIN") throw new Error("ADMIN_ACCOUNT_REQUIRED");
  return session;
}
