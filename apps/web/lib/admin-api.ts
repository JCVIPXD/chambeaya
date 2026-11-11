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
// `GET`/`PATCH /admin/settings`: ajuste global de comisión e IGV. `taxBps`
// es de solo lectura en este alcance (ningún endpoint lo modifica). Cambiar
// `commissionBps` no afecta ningún turno ya publicado (queda congelado en
// `Shift.commissionBps` al publicarse).
export type AdminPlatformSettings = {
  commissionBps: number;
  taxBps: number;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
};
// `GET /admin/commissions?from&to` (Alcance D): cuánto le corresponde
// facturar Chambeaya a cada empresa en modo manual ("por facturar": comisión
// e IGV de todo pago `provider: 'manual'` no `CANCELLED`, pagado o no) y
// cuánto ya cobró/tiene por cobrar vía pasarela (Alcance E; hoy siempre 0,
// sin proveedor contratado). `from`/`to` son fechas de calendario de Lima
// ("AAAA-MM-DD"), nunca UTC (corrección de ALTO-1 de CN-20260926-020).
// `closedWithoutPayment` cuenta asignaciones que la empresa cerró sin pagar
// (señal estructurada, nunca texto libre; corrección de MEDIO-1) y
// `pendingResolution` cuenta las `NO_SHOW`/`ABANDONED` que todavía no
// resolvió -sin filtro de período, para que no resolverlas no las oculte-.
export type AdminCommissionsTotals = {
  toInvoiceCents: number;
  toInvoiceTaxCents: number;
  collectedCents: number;
  pendingCollectionCents: number;
  payments: number;
  pendingResolution: number;
};
export type AdminCommissionsCompanyRow = AdminCommissionsTotals & {
  companyId: string;
  name: string;
  ruc: string;
  closedWithoutPayment: number;
};
export type AdminCommissionsReport = {
  // `from`/`to`: fechas de Lima recibidas ("AAAA-MM-DD"), o `null`. `fromUtc`/
  // `toUtcExclusive`: los instantes UTC efectivos de la consulta (el segundo
  // es un límite EXCLUSIVO), para que no haya ambigüedad.
  period: { from: string | null; to: string | null; fromUtc: string | null; toUtcExclusive: string | null };
  totals: AdminCommissionsTotals;
  companies: AdminCommissionsCompanyRow[];
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
export class AdminApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

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
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new AdminApiError(response.status, payload.error ?? "REQUEST_FAILED");
  }
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
  settings: (token: string) =>
    request<AdminPlatformSettings>("/admin/settings", token),
  // `from`/`to` en formato estricto `AAAA-MM-DD`, fechas de CALENDARIO DE
  // LIMA (nunca UTC; corrección de ALTO-1 de CN-20260926-020): la API cubre
  // desde las 00:00 de Lima de `from` hasta el final del día de `to`, hora
  // Lima. Sin ninguno de los dos, cubre todo el historial.
  commissions: (token: string, range: { from?: string; to?: string } = {}) => {
    const query = new URLSearchParams();
    if (range.from) query.set("from", range.from);
    if (range.to) query.set("to", range.to);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<AdminCommissionsReport>(`/admin/commissions${suffix}`, token);
  },
  updateSettings: (token: string, commissionBps: number) =>
    request<AdminPlatformSettings>("/admin/settings", token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionBps }),
    }),
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
  logout: (token: string) =>
    request<void>("/auth/session", token, { method: "DELETE" }),
  // Exige la contraseña actual; borra todas las demás sesiones y conserva la
  // que hizo la petición (`token`). Ver `docs/reference/api.md`.
  changePassword: (
    token: string,
    currentPassword: string,
    newPassword: string,
  ) =>
    request<AdminSession>("/auth/password/change", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
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
