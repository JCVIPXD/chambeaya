"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  KeyRound,
  LogOut,
  Search,
  RefreshCw,
  Settings,
  Shield,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  adminApi,
  adminLogin,
  type AdminCommissionsReport,
  type AdminCommissionsTotals,
  type AdminCompany,
  type AdminIncident,
  type AdminOverview,
  type AdminPlatformSettings,
  type AdminSession,
  type AdminWorker,
} from "../../lib/admin-api";
import { ChangePasswordModal } from "../../components/change-password-modal";

const key = "chambeaya_admin_session";

// Corrección de ALTO-1 de CN-20260926-020: la fecha "de hoy" para el filtro
// de Comisiones debe ser la fecha de calendario de LIMA, nunca la del
// navegador/servidor donde corre este componente (que puede tener otro
// huso horario, o ninguno configurado). `Intl.DateTimeFormat` con
// `timeZone: 'America/Lima'` hace la conversión explícita una sola vez, en
// vez de sumar/restar horas a mano en cada sitio que necesite "hoy".
const limaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** La fecha de hoy en Lima, en formato `AAAA-MM-DD`. */
function limaTodayIso(): string {
  return limaDateFormatter.format(new Date());
}

export default function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const saved = localStorage.getItem(key);
    if (!saved) {
      setRestoringSession(false);
      return;
    }
    try {
      const candidate = JSON.parse(saved) as AdminSession;
      void adminApi
        .restore(candidate.token)
        .then((restored) => {
          if (restored.role !== "ADMIN") throw new Error("ADMIN_ACCOUNT_REQUIRED");
          localStorage.setItem(key, JSON.stringify(restored));
          setSession(restored);
        })
        .catch(() => localStorage.removeItem(key))
        .finally(() => setRestoringSession(false));
    } catch {
      localStorage.removeItem(key);
      setRestoringSession(false);
    }
  }, []);
  if (restoringSession)
    return <main className="admin-auth"><div className="admin-auth-card">Validando sesión…</div></main>;
  if (!session)
    return (
      <main className="admin-auth">
        <div className="admin-auth-card">
          <div className="admin-mark">
            <Shield size={22} />
          </div>
          <p className="eyebrow">CHAMBEAYA · CONTROL CENTRAL</p>
          <h1>Acceso superadmin</h1>
          <p>
            Administra empresas, trabajadores e incidencias desde una sola
            vista.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              try {
                const next = await adminLogin(email, password);
                localStorage.setItem(key, JSON.stringify(next));
                // Corrección de CN-20260926-008 (MEDIO-2): sin esto, la
                // contraseña quedaba en el estado de `AdminPage` (que nunca
                // se desmonta) después de entrar, y volvía a aparecer en el
                // campo si más tarde se pulsaba "Salir".
                setPassword("");
                setSession(next);
              } catch {
                setError(
                  "Credenciales inválidas o cuenta sin permisos de superadmin.",
                );
              }
            }}
          >
            <label className="field">
              <span>Correo</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Contraseña</span>
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="admin-error">{error}</p>}
            <button className="primary-button full-action" type="submit">
              Ingresar
            </button>
          </form>
        </div>
      </main>
    );
  return (
    <AdminWorkspace
      session={session}
      onLogout={() => {
        // El estado local se limpia de inmediato, sin esperar a la API
        // (corrección de CN-20260926-008, BAJO-2: antes esta llamada
        // bloqueaba la salida hasta 8 s por `AbortSignal.timeout`, sin
        // ninguna señal para quien esperaba). La contraseña se limpia aquí
        // también, por si el login no llegó a hacerlo (MEDIO-2); el correo
        // se conserva a propósito, por conveniencia para volver a entrar.
        localStorage.removeItem(key);
        setSession(null);
        setPassword("");
        // Best effort: revoca el token en el servidor sin bloquear ni
        // condicionar la salida a su resultado (mismo criterio que
        // `logout()` del panel de empresa en `apps/web/app/page.tsx`, que
        // también limpia primero y llama después).
        void adminApi.logout(session.token).catch(() => undefined);
      }}
    />
  );
}

function CompanyModal({
  mode,
  company,
  saving,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  company?: AdminCompany;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div
      className="admin-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Cuenta empresarial</p>
            <h2>{mode === "create" ? "Crear empresa" : "Editar empresa"}</h2>
          </div>
          <button
            type="button"
            className="admin-detail-close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Nombre comercial</span>
            <input name="name" required defaultValue={company?.name ?? ""} />
          </label>
          <label className="field">
            <span>Razón social</span>
            <input name="legalName" defaultValue={company?.legalName ?? ""} />
          </label>
          <div className="admin-form-row">
            <label className="field">
              <span>RUC</span>
              <input
                name="ruc"
                required
                pattern="[0-9]{11}"
                disabled={mode === "edit"}
                defaultValue={company?.ruc ?? ""}
              />
            </label>
            <label className="field">
              <span>Correo de acceso</span>
              <input
                name="email"
                required
                type="email"
                disabled={mode === "edit"}
                defaultValue={company?.owner.email ?? ""}
              />
            </label>
          </div>
          {mode === "create" && (
            <label className="field">
              <span>Contraseña inicial</span>
              <input
                name="password"
                required
                minLength={8}
                placeholder="Mayúscula, número y 8 caracteres"
              />
            </label>
          )}
          <div className="admin-form-row">
            <label className="field">
              <span>Industria</span>
              <input name="industry" defaultValue={company?.industry ?? ""} />
            </label>
            <label className="field">
              <span>Distrito</span>
              <input name="district" defaultValue={company?.district ?? ""} />
            </label>
          </div>
          <label className="field">
            <span>Teléfono</span>
            <input name="phone" />
          </label>
          <label className="field">
            <span>Dirección</span>
            <input name="address" />
          </label>
          <div className="admin-modal-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving
                ? "Guardando…"
                : mode === "create"
                  ? "Crear cuenta"
                  : "Guardar cambios"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function AdminWorkspace({
  session,
  onLogout,
}: {
  session: AdminSession;
  onLogout: () => void;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [workers, setWorkers] = useState<AdminWorker[]>([]);
  const [incidents, setIncidents] = useState<AdminIncident[]>([]);
  const [settings, setSettings] = useState<AdminPlatformSettings | null>(null);
  // Métrica del resumen: "por facturar" del mes en curso (con el IGV
  // aparte), siempre ese rango fijo, independiente del filtro de la sección
  // "Comisiones".
  const [monthCommissions, setMonthCommissions] =
    useState<AdminCommissionsTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [failedSections, setFailedSections] = useState<string[]>([]);
  const [section, setSection] = useState<
    "overview" | "companies" | "workers" | "incidents" | "settings" | "commissions"
  >("overview");
  const [query, setQuery] = useState("");
  const [incidentFilter, setIncidentFilter] = useState<
    "ALL" | "OPEN" | "CLOSED"
  >("ALL");
  const [selected, setSelected] = useState<{
    kind: "company" | "worker" | "incident";
    id: string;
  } | null>(null);
  const [companyModal, setCompanyModal] = useState<"create" | "edit" | null>(
    null,
  );
  const [savingCompany, setSavingCompany] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  // Rango del mes en curso, en fecha de calendario de LIMA (`limaTodayIso`,
  // nunca la hora local del navegador): usado como valor inicial del filtro
  // de "Comisiones" y como rango fijo de la métrica del resumen.
  const monthRange = useMemo(() => {
    const today = limaTodayIso();
    const from = `${today.slice(0, 7)}-01`;
    return { from, to: today };
  }, []);
  const [commissionsReport, setCommissionsReport] =
    useState<AdminCommissionsReport | null>(null);
  const [commissionsFrom, setCommissionsFrom] = useState(monthRange.from);
  const [commissionsTo, setCommissionsTo] = useState(monthRange.to);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [commissionsError, setCommissionsError] = useState("");
  const loadCommissionsReport = async (from: string, to: string) => {
    setLoadingCommissions(true);
    setCommissionsError("");
    try {
      const report = await adminApi.commissions(session.token, { from, to });
      setCommissionsReport(report);
    } catch {
      setCommissionsError("No se pudo cargar el reporte de comisiones.");
    } finally {
      setLoadingCommissions(false);
    }
  };
  const load = async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      adminApi.overview(session.token),
      adminApi.companies(session.token),
      adminApi.workers(session.token),
      adminApi.incidents(session.token),
      adminApi.settings(session.token),
      adminApi.commissions(session.token, monthRange),
    ]);
    const labels = ["resumen", "empresas", "trabajadores", "incidencias", "configuración", "comisiones"];
    const failures = results.flatMap((result, index) =>
      result.status === "rejected" ? [labels[index]] : [],
    );
    const [summary, companyData, workerData, incidentData, settingsData, commissionsData] = results;
    if (summary.status === "fulfilled") setOverview(summary.value);
    if (companyData.status === "fulfilled") setCompanies(companyData.value);
    if (workerData.status === "fulfilled") setWorkers(workerData.value);
    if (incidentData.status === "fulfilled") setIncidents(incidentData.value);
    if (settingsData.status === "fulfilled") setSettings(settingsData.value);
    if (commissionsData.status === "fulfilled") setMonthCommissions(commissionsData.value.totals);
    setFailedSections(failures);
    setLoading(false);
  };
  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSettingsError("");
    const data = new FormData(event.currentTarget);
    const commissionPercent = Number(data.get("commissionPercent"));
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 50) {
      setSettingsError("El porcentaje debe estar entre 0% y 50%.");
      return;
    }
    // Puntos básicos enteros (1000 = 10,00%): redondea el porcentaje con dos
    // decimales que admite el campo a la unidad entera que espera la API.
    const commissionBps = Math.round(commissionPercent * 100);
    setSavingSettings(true);
    try {
      const saved = await adminApi.updateSettings(session.token, commissionBps);
      setSettings(saved);
    } catch {
      setSettingsError("No se pudo guardar el cambio. Intenta nuevamente.");
    } finally {
      setSavingSettings(false);
    }
  };
  useEffect(() => {
    void load();
    void loadCommissionsReport(commissionsFrom, commissionsTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCompanies = useMemo(
    () =>
      companies.filter((company) =>
        `${company.name} ${company.ruc} ${company.industry ?? ""} ${company.district ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [companies, normalizedQuery],
  );
  const filteredWorkers = useMemo(
    () =>
      workers.filter((worker) =>
        `${worker.name} ${worker.email ?? ""} ${worker.identifier} ${worker.companyWorkerContacts.map((contact) => contact.company?.name ?? "").join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [workers, normalizedQuery],
  );
  const filteredIncidents = useMemo(
    () =>
      incidents.filter(
        (incident) =>
          (incidentFilter === "ALL" || incident.status === incidentFilter) &&
          `${incident.subject} ${incident.company} ${incident.type}`
            .toLowerCase()
            .includes(normalizedQuery),
      ),
    [incidents, incidentFilter, normalizedQuery],
  );
  const selectedCompany =
    selected?.kind === "company"
      ? companies.find((item) => item.id === selected.id)
      : undefined;
  const selectedWorker =
    selected?.kind === "worker"
      ? workers.find((item) => item.id === selected.id)
      : undefined;
  const selectedIncident =
    selected?.kind === "incident"
      ? incidents.find((item) => item.id === selected.id)
      : undefined;
  const saveCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSavingCompany(true);
    const input = {
      name: String(data.get("name")),
      legalName: String(data.get("legalName") || "") || null,
      ruc: String(data.get("ruc")),
      email: String(data.get("email")),
      password: String(data.get("password")),
      industry: String(data.get("industry") || "") || null,
      phone: String(data.get("phone") || "") || null,
      address: String(data.get("address") || "") || null,
      district: String(data.get("district") || "") || null,
    };
    try {
      if (companyModal === "edit" && selectedCompany) {
        const saved = await adminApi.updateCompany(
          session.token,
          selectedCompany.id,
          input,
        );
        setCompanies((current) =>
          current.map((item) =>
            item.id === saved.id ? { ...item, ...saved } : item,
          ),
        );
      } else {
        const saved = await adminApi.createCompany(session.token, input);
        setCompanies((current) => [saved, ...current]);
      }
      setCompanyModal(null);
      setSelected(null);
    } catch {
      setFailedSections(["empresa"]);
    } finally {
      setSavingCompany(false);
    }
  };
  const metricItems: {
    icon: LucideIcon;
    label: string;
    value: number | undefined;
  }[] = [
    { icon: Building2, label: "Empresas", value: overview?.companies },
    { icon: Users, label: "Trabajadores", value: overview?.workers },
    {
      icon: ClipboardList,
      label: "Turnos activos",
      value: overview?.activeShifts,
    },
    {
      icon: AlertTriangle,
      label: "Incidencias abiertas",
      value: overview?.openIncidents,
    },
    {
      icon: CheckCircle2,
      label: "Postulaciones pendientes",
      value: overview?.pendingApplications,
    },
  ];
  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">CHAMBEAYA · SUPERADMIN</p>
          <h1>Centro de control</h1>
        </div>
        <div className="admin-actions">
          <button className="secondary-button" onClick={() => void load()}>
            <RefreshCw size={16} /> Actualizar
          </button>
          <button
            className="secondary-button"
            onClick={() => setPasswordModalOpen(true)}
          >
            <KeyRound size={16} /> Cambiar contraseña
          </button>
          <button className="secondary-button" onClick={onLogout}>
            <LogOut size={16} /> Salir
          </button>
        </div>
      </header>
      {failedSections.length > 0 && (
        <div className="admin-error-banner">
          <AlertTriangle size={18} /> No se pudo actualizar: {failedSections.join(", ")}. Los demás datos siguen disponibles.{" "}
          <button onClick={() => void load()}>Reintentar</button>
        </div>
      )}
      <nav className="admin-nav" aria-label="Módulos de administración">
        {(
          [
            ["overview", "Resumen"],
            ["companies", "Empresas"],
            ["workers", "Trabajadores"],
            ["incidents", "Incidencias"],
            ["commissions", "Comisiones"],
            ["settings", "Configuración"],
          ] as const
        ).map(([value, label]) => (
          <button
            className={section === value ? "active" : ""}
            key={value}
            type="button"
            onClick={() => {
              setSection(value);
              setSelected(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {section !== "overview" && section !== "settings" && section !== "commissions" && (
        <div className="admin-toolbar">
          <label className="admin-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Buscar en ${section === "companies" ? "empresas" : section === "workers" ? "trabajadores" : "incidencias"}`}
              aria-label="Buscar"
            />
          </label>
          {section === "incidents" && (
            <select
              value={incidentFilter}
              onChange={(event) =>
                setIncidentFilter(event.target.value as typeof incidentFilter)
              }
              aria-label="Filtrar incidencias"
            >
              <option value="ALL">Todas</option>
              <option value="OPEN">Abiertas</option>
              <option value="CLOSED">Cerradas</option>
            </select>
          )}
          <span className="admin-result-count">
            {section === "companies"
              ? filteredCompanies.length
              : section === "workers"
                ? filteredWorkers.length
                : filteredIncidents.length}{" "}
            resultados
          </span>
        </div>
      )}
      {loading ? (
        <div className="admin-loading">Cargando operación…</div>
      ) : (
        <div className="admin-view" key={section}>
          <section className="admin-metrics">
            {metricItems.map(({ icon: Icon, label, value }) => (
              <article className="admin-metric" key={label}>
                <Icon size={18} />
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          {section === "overview" && (
            <section className="admin-grid">
              <article className="admin-panel">
                <div className="admin-panel-head">
                  <div>
                    <p className="eyebrow">Atención prioritaria</p>
                    <h2>Incidencias</h2>
                  </div>
                  <span className="admin-count">{incidents.length}</span>
                </div>
                <div className="admin-list">
                  {incidents.map((incident) => (
                    <button
                      className="admin-list-row"
                      key={incident.id}
                      onClick={() => {
                        setSection("incidents");
                        setSelected({ kind: "incident", id: incident.id });
                      }}
                    >
                      <span
                        className={`priority-dot ${incident.priority.toLowerCase()}`}
                      />
                      <div>
                        <strong>{incident.subject}</strong>
                        <small>
                          {incident.company} · {incident.type}
                        </small>
                      </div>
                      <span className="admin-status">
                        {incident.status === "OPEN" ? "Abierta" : "Cerrada"}
                      </span>
                    </button>
                  ))}
                </div>
              </article>
              <article className="admin-panel">
                <div className="admin-panel-head">
                  <div>
                    <p className="eyebrow">Directorio</p>
                    <h2>Empresas</h2>
                  </div>
                  <span className="admin-count">{companies.length}</span>
                </div>
                <div className="admin-list">
                  {companies.slice(0, 8).map((company) => (
                    <button
                      className="admin-list-row"
                      key={company.id}
                      onClick={() => {
                        setSection("companies");
                        setSelected({ kind: "company", id: company.id });
                      }}
                    >
                      <span className="admin-avatar">{company.name[0]}</span>
                      <div>
                        <strong>{company.name}</strong>
                        <small>
                          {company.industry ?? "Industria no definida"} ·{" "}
                          {company.district ?? "Sin distrito"}
                        </small>
                      </div>
                      <span className="admin-status">
                        {company.subscription?.status ?? "Sin plan"}
                      </span>
                    </button>
                  ))}
                </div>
              </article>
              <article className="admin-panel">
                <div className="admin-panel-head">
                  <div>
                    <p className="eyebrow">Modo manual · sin pasarela</p>
                    <h2>Comisión por facturar (mes en curso)</h2>
                  </div>
                  <CircleDollarSign size={18} />
                </div>
                <div className="admin-list">
                  <div className="admin-list-row">
                    <div>
                      <strong>
                        S/{" "}
                        {monthCommissions
                          ? (monthCommissions.toInvoiceCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })
                          : "0.00"}
                      </strong>
                      <small>
                        + IGV S/{" "}
                        {monthCommissions
                          ? (monthCommissions.toInvoiceTaxCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })
                          : "0.00"}
                      </small>
                    </div>
                  </div>
                  <button
                    className="admin-list-row"
                    type="button"
                    onClick={() => setSection("commissions")}
                  >
                    <div>
                      <strong>Ver desglose por empresa</strong>
                      <small>Incluye cerrados sin pago, para detectar evasión</small>
                    </div>
                    <ChevronRight size={15} />
                  </button>
                </div>
              </article>
            </section>
          )}
          {section === "overview" && (
            <section className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <p className="eyebrow">Red de talento</p>
                  <h2>Trabajadores</h2>
                </div>
                <span className="admin-count">{workers.length}</span>
              </div>
              <div className="admin-worker-grid">
                {workers.slice(0, 12).map((worker) => (
                  <button
                    className="admin-worker"
                    key={worker.id}
                    onClick={() => {
                      setSection("workers");
                      setSelected({ kind: "worker", id: worker.id });
                    }}
                  >
                    <strong>{worker.name}</strong>
                    <small>{worker.email}</small>
                    <span>
                      {worker.companyWorkerContacts[0]?.company?.name ?? "Sin empresa"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {section === "companies" && (
            <section className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <p className="eyebrow">Directorio completo</p>
                  <h2>Empresas</h2>
                </div>
                <div className="admin-head-actions">
                  <span className="admin-count">
                    {filteredCompanies.length}
                  </span>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setCompanyModal("create")}
                  >
                    Nueva empresa
                  </button>
                </div>
              </div>
              <div className="admin-list">
                {filteredCompanies.map((company) => (
                  <button
                    className="admin-list-row"
                    key={company.id}
                    onClick={() =>
                      setSelected({ kind: "company", id: company.id })
                    }
                  >
                    <span className="admin-avatar">{company.name[0]}</span>
                    <div>
                      <strong>{company.name}</strong>
                      <small>
                        {company.ruc} ·{" "}
                        {company.industry ?? "Industria no definida"}
                      </small>
                    </div>
                    <span className="admin-status">
                      {company.subscription?.status ?? "Sin plan"}
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {section === "workers" && (
            <section className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <p className="eyebrow">Red de talento completa</p>
                  <h2>Trabajadores</h2>
                </div>
                <span className="admin-count">{filteredWorkers.length}</span>
              </div>
              <div className="admin-worker-grid">
                {filteredWorkers.map((worker) => (
                  <button
                    className="admin-worker"
                    key={worker.id}
                    onClick={() =>
                      setSelected({ kind: "worker", id: worker.id })
                    }
                  >
                    <strong>{worker.name}</strong>
                    <small>{worker.email ?? "Sin correo"}</small>
                    <span>
                      {worker.companyWorkerContacts[0]?.company?.name ?? "Sin empresa"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {section === "incidents" && (
            <section className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <p className="eyebrow">Seguimiento operativo</p>
                  <h2>Incidencias</h2>
                </div>
                <span className="admin-count">{filteredIncidents.length}</span>
              </div>
              <div className="admin-list">
                {filteredIncidents.map((incident) => (
                  <button
                    className="admin-list-row"
                    key={incident.id}
                    onClick={() =>
                      setSelected({ kind: "incident", id: incident.id })
                    }
                  >
                    <span
                      className={`priority-dot ${incident.priority.toLowerCase()}`}
                    />
                    <div>
                      <strong>{incident.subject}</strong>
                      <small>
                        {incident.company} · {incident.type}
                      </small>
                    </div>
                    <span className="admin-status">
                      {incident.status === "OPEN" ? "Abierta" : "Cerrada"}
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {section === "settings" && (
            <section className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <p className="eyebrow">Ajuste global</p>
                  <h2>Configuración</h2>
                </div>
                <Settings size={18} />
              </div>
              <form className="admin-settings-form" onSubmit={saveSettings}>
                <div className="field">
                  <label htmlFor="admin-commission-percent">Comisión de Chambeaya</label>
                  <div className="admin-settings-percent">
                    <input
                      id="admin-commission-percent"
                      name="commissionPercent"
                      type="number"
                      required
                      step="0.01"
                      defaultValue={settings ? settings.commissionBps / 100 : ""}
                      key={settings?.commissionBps ?? "loading"}
                    />
                    <span>%</span>
                  </div>
                  <small>
                    Se cobra a la empresa, encima del pago al trabajador. Este
                    cambio solo aplica a los turnos que se publiquen desde
                    ahora: los turnos ya publicados conservan la comisión con
                    la que se publicaron, aunque cambies este valor.
                  </small>
                </div>
                <div className="field">
                  <label htmlFor="admin-tax-percent">IGV sobre la comisión</label>
                  <div className="admin-settings-percent readonly">
                    <input
                      id="admin-tax-percent"
                      type="number"
                      value={settings ? settings.taxBps / 100 : ""}
                      disabled
                      readOnly
                    />
                    <span>%</span>
                  </div>
                  <small>Solo lectura en este alcance.</small>
                </div>
                {settingsError && <p className="admin-error">{settingsError}</p>}
                <p className="admin-settings-meta">
                  {settings?.updatedBy
                    ? `Último cambio por ${settings.updatedBy.name}${settings.updatedAt ? ` · ${new Date(settings.updatedAt).toLocaleString("es-PE")}` : ""}`
                    : "Todavía no se registró ningún cambio manual."}
                </p>
                <div className="admin-modal-actions">
                  <button className="primary-button" type="submit" disabled={savingSettings || !settings}>
                    {savingSettings ? "Guardando…" : "Guardar cambio"}
                  </button>
                </div>
              </form>
            </section>
          )}
          {section === "commissions" && (
            <section className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <p className="eyebrow">Facturación de comisión por empresa</p>
                  <h2>Comisiones</h2>
                </div>
                <CircleDollarSign size={18} />
              </div>
              <form
                className="admin-settings-form admin-commissions-filter"
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadCommissionsReport(commissionsFrom, commissionsTo);
                }}
              >
                <div className="field">
                  <label htmlFor="commissions-from">Desde</label>
                  <input
                    id="commissions-from"
                    type="date"
                    value={commissionsFrom}
                    onChange={(event) => setCommissionsFrom(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="commissions-to">Hasta</label>
                  <input
                    id="commissions-to"
                    type="date"
                    value={commissionsTo}
                    onChange={(event) => setCommissionsTo(event.target.value)}
                  />
                </div>
                <div className="admin-modal-actions">
                  <button className="primary-button" type="submit" disabled={loadingCommissions}>
                    {loadingCommissions ? "Cargando…" : "Aplicar filtro"}
                  </button>
                </div>
              </form>
              {commissionsError && <p className="admin-error">{commissionsError}</p>}
              {commissionsReport && (
                <>
                  <div className="admin-list">
                    <div className="admin-list-row">
                      <div>
                        <strong>
                          Por facturar (modo manual): S/{" "}
                          {(commissionsReport.totals.toInvoiceCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                        </strong>
                        <small>
                          + IGV S/ {(commissionsReport.totals.toInvoiceTaxCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                        </small>
                      </div>
                    </div>
                    <div className="admin-list-row">
                      <div>
                        <strong>
                          Cobrada (pasarela): S/{" "}
                          {(commissionsReport.totals.collectedCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                        </strong>
                        <small>Sin proveedor contratado todavía: siempre 0.</small>
                      </div>
                    </div>
                    <div className="admin-list-row">
                      <div>
                        <strong>
                          Por cobrar (pasarela): S/{" "}
                          {(commissionsReport.totals.pendingCollectionCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                        </strong>
                        <small>{commissionsReport.totals.payments} pagos en el período</small>
                      </div>
                    </div>
                    <div className="admin-list-row">
                      <div>
                        <strong>{commissionsReport.totals.pendingResolution} pendientes de decisión</strong>
                        <small>
                          Asignaciones NO_SHOW o abandonadas que ninguna empresa resolvió todavía (no depende del período consultado)
                        </small>
                      </div>
                    </div>
                  </div>
                  <div className="admin-panel-head">
                    <div>
                      <p className="eyebrow">Desglose</p>
                      <h2>Por empresa</h2>
                    </div>
                    <span className="admin-count">{commissionsReport.companies.length}</span>
                  </div>
                  <div className="admin-list">
                    {commissionsReport.companies.map((row) => (
                      // Todo el detalle numérico va DENTRO del único `div`
                      // flexible (`flex:1; min-width:0`), como líneas
                      // apiladas, en vez de repartirlo en varios `span`
                      // hermanos con `white-space:nowrap`
                      // (`.admin-status`): con textos largos, esos hermanos
                      // no encogen y el `div` flexible termina en 0px de
                      // ancho en una pantalla angosta, lo que deja el
                      // nombre de la empresa técnicamente invisible (sin
                      // caja) pese a seguir en el árbol de accesibilidad.
                      <div className="admin-list-row" key={row.companyId}>
                        <span className="admin-avatar">{row.name[0]}</span>
                        <div>
                          <strong>{row.name}</strong>
                          <small>
                            {row.ruc} · {row.payments} pagos
                          </small>
                          <small>
                            Por facturar S/{" "}
                            {(row.toInvoiceCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                            {" "}+ IGV S/{" "}
                            {(row.toInvoiceTaxCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                          </small>
                          <small>
                            Cobrada S/ {(row.collectedCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })} · Por cobrar S/{" "}
                            {(row.pendingCollectionCents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                          </small>
                        </div>
                        <span className={row.closedWithoutPayment > 0 ? "admin-status admin-error" : "admin-status"}>
                          {row.closedWithoutPayment} cerrados sin pago
                        </span>
                        <span className={row.pendingResolution > 0 ? "admin-status admin-error" : "admin-status"}>
                          {row.pendingResolution} pendientes de decisión
                        </span>
                      </div>
                    ))}
                    {commissionsReport.companies.length === 0 && (
                      <div className="empty-state compact-empty-state">
                        <CheckCircle2 size={22} />
                        <strong>Sin actividad en el período</strong>
                        <span>Ninguna empresa tuvo pagos ni cierres sin pago en el rango seleccionado.</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
          {selected &&
            (selectedCompany || selectedWorker || selectedIncident) && (
              <aside className="admin-detail">
                <button
                  className="admin-detail-close"
                  aria-label="Cerrar detalle"
                  onClick={() => setSelected(null)}
                >
                  <X size={18} />
                </button>
                {selectedCompany && (
                  <>
                    <p className="eyebrow">Empresa</p>
                    <h2>{selectedCompany.name}</h2>
                    <dl>
                      <dt>RUC</dt>
                      <dd>{selectedCompany.ruc}</dd>
                      <dt>Responsable</dt>
                      <dd>
                        {selectedCompany.owner.name} ·{" "}
                        {selectedCompany.owner.email}
                      </dd>
                      <dt>Industria</dt>
                      <dd>{selectedCompany.industry ?? "No definida"}</dd>
                      <dt>Plan</dt>
                      <dd>
                        {selectedCompany.subscription?.plan ??
                          "Sin suscripción"}
                      </dd>
                    </dl>
                    <div className="admin-detail-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setCompanyModal("edit")}
                      >
                        Editar datos
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "¿Eliminar esta cuenta empresarial?",
                            )
                          )
                            return;
                          try {
                            await adminApi.deleteCompany(
                              session.token,
                              selectedCompany.id,
                            );
                            setCompanies((current) =>
                              current.filter(
                                (item) => item.id !== selectedCompany.id,
                              ),
                            );
                            setOverview((current) =>
                              current
                                ? {
                                    ...current,
                                    companies: Math.max(
                                      0,
                                      (current.companies ?? 0) - 1,
                                    ),
                                  }
                                : current,
                            );
                            setSelected(null);
                          } catch {
                            setFailedSections(["eliminar empresa"]);
                          }
                        }}
                      >
                        Eliminar cuenta
                      </button>
                    </div>
                  </>
                )}
                {selectedWorker && (
                  <>
                    <p className="eyebrow">Trabajador</p>
                    <h2>{selectedWorker.name}</h2>
                    <dl>
                      <dt>Correo</dt>
                      <dd>{selectedWorker.email ?? "Sin correo"}</dd>
                      <dt>Identificador</dt>
                      <dd>{selectedWorker.identifier}</dd>
                      <dt>Empresa</dt>
                      <dd>
                        {selectedWorker.companyWorkerContacts[0]?.company?.name ??
                          "Sin empresa"}
                      </dd>
                      <dt>Estado</dt>
                      <dd>
                        {selectedWorker.companyWorkerContacts[0]?.status ??
                          "Sin perfil"}
                      </dd>
                    </dl>
                    <div className="admin-detail-actions">
                      <button
                        className="danger-button"
                        type="button"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "¿Eliminar esta cuenta de trabajador?",
                            )
                          )
                            return;
                          try {
                            await adminApi.deleteWorker(
                              session.token,
                              selectedWorker.id,
                            );
                            setWorkers((current) =>
                              current.filter(
                                (item) => item.id !== selectedWorker.id,
                              ),
                            );
                            setOverview((current) =>
                              current
                                ? {
                                    ...current,
                                    workers: Math.max(
                                      0,
                                      (current.workers ?? 0) - 1,
                                    ),
                                  }
                                : current,
                            );
                            setSelected(null);
                          } catch {
                            setFailedSections(["eliminar trabajador"]);
                          }
                        }}
                      >
                        Eliminar trabajador
                      </button>
                    </div>
                  </>
                )}
                {selectedIncident && (
                  <>
                    <p className="eyebrow">Incidencia</p>
                    <h2>{selectedIncident.subject}</h2>
                    <dl>
                      <dt>Tipo</dt>
                      <dd>{selectedIncident.type}</dd>
                      <dt>Prioridad</dt>
                      <dd>
                        {selectedIncident.priority === "HIGH"
                          ? "Alta"
                          : "Media"}
                      </dd>
                      <dt>Empresa</dt>
                      <dd>{selectedIncident.company}</dd>
                      <dt>Estado</dt>
                      <dd>
                        {selectedIncident.status === "OPEN"
                          ? "Abierta"
                          : "Cerrada"}
                      </dd>
                    </dl>
                    <p className="admin-detail-note">
                      La gestión manual de incidencias se habilitará cuando
                      exista el registro persistente de casos.
                    </p>
                  </>
                )}
              </aside>
            )}
          {companyModal && (
            <CompanyModal
              mode={companyModal}
              company={selectedCompany}
              saving={savingCompany}
              onClose={() => setCompanyModal(null)}
              onSubmit={saveCompany}
            />
          )}
        </div>
      )}
      {passwordModalOpen && (
        <ChangePasswordModal
          variant="admin"
          onClose={() => setPasswordModalOpen(false)}
          onSubmit={async ({ currentPassword, newPassword }) => {
            await adminApi.changePassword(
              session.token,
              currentPassword,
              newPassword,
            );
          }}
        />
      )}
    </main>
  );
}
