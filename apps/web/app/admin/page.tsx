"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  LogOut,
  Search,
  RefreshCw,
  Shield,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  adminApi,
  adminLogin,
  type AdminCompany,
  type AdminIncident,
  type AdminOverview,
  type AdminSession,
  type AdminWorker,
} from "../../lib/admin-api";

const key = "cumplenow_admin_session";
export default function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const saved = localStorage.getItem(key);
    if (saved) setSession(JSON.parse(saved));
  }, []);
  if (!session)
    return (
      <main className="admin-auth">
        <div className="admin-auth-card">
          <div className="admin-mark">
            <Shield size={22} />
          </div>
          <p className="eyebrow">CUMPLE NOW · CONTROL CENTRAL</p>
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
        localStorage.removeItem(key);
        setSession(null);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [section, setSection] = useState<
    "overview" | "companies" | "workers" | "incidents"
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
  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const [summary, companyData, workerData, incidentData] =
        await Promise.all([
          adminApi.overview(session.token),
          adminApi.companies(session.token),
          adminApi.workers(session.token),
          adminApi.incidents(session.token),
        ]);
      setOverview(summary);
      setCompanies(companyData);
      setWorkers(workerData);
      setIncidents(incidentData);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
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
        `${worker.name} ${worker.email ?? ""} ${worker.identifier} ${worker.workerProfiles.map((profile) => profile.company.name).join(" ")}`
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
      setError(true);
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
          <p className="eyebrow">CUMPLE NOW · SUPERADMIN</p>
          <h1>Centro de control</h1>
        </div>
        <div className="admin-actions">
          <button className="secondary-button" onClick={() => void load()}>
            <RefreshCw size={16} /> Actualizar
          </button>
          <button className="secondary-button" onClick={onLogout}>
            <LogOut size={16} /> Salir
          </button>
        </div>
      </header>
      {error && (
        <div className="admin-error-banner">
          <AlertTriangle size={18} /> No se pudo actualizar toda la información.{" "}
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
      {section !== "overview" && (
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
                      {worker.workerProfiles[0]?.company.name ?? "Sin empresa"}{" "}
                      · Índice {worker.workerProfiles[0]?.cumpleScore ?? "—"}
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
                      {worker.workerProfiles[0]?.company.name ?? "Sin empresa"}{" "}
                      · Índice {worker.workerProfiles[0]?.cumpleScore ?? "—"}
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
                          await adminApi.deleteCompany(
                            session.token,
                            selectedCompany.id,
                          );
                          setCompanies((current) =>
                            current.filter(
                              (item) => item.id !== selectedCompany.id,
                            ),
                          );
                          setSelected(null);
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
                        {selectedWorker.workerProfiles[0]?.company.name ??
                          "Sin empresa"}
                      </dd>
                      <dt>Estado</dt>
                      <dd>
                        {selectedWorker.workerProfiles[0]?.status ??
                          "Sin perfil"}
                      </dd>
                    </dl>
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
    </main>
  );
}
