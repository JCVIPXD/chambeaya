'use client';

import { BadgeCheck, Building2, KeyRound, Pencil } from 'lucide-react';

import type { CompanyRecord } from '../../lib/business-api';
import { useJobs } from './jobs-context';
import { jobsApi } from './jobs-api';
import { StatusPill, ViewHeading } from './ui';
import { useResource } from './use-resource';

/** Perfil de empresa: datos de la cuenta, verificación y plan. La edición reutiliza el formulario existente. */
export function CompanyProfileView({ company, planLabel, onEdit, onChangePassword }: {
  company: CompanyRecord | null;
  planLabel: string;
  onEdit: () => void;
  onChangePassword: () => void;
}) {
  const { token, currency, onUnauthorized } = useJobs();
  const rewards = useResource(() => jobsApi.currency.rewards(token), 'profile-rewards', { onUnauthorized, currency });
  const verification = rewards.data?.items.find((item) => item.actionKey === 'COMPANY_VERIFIED');
  const rows: Array<[string, string | null | undefined]> = [
    ['Nombre comercial', company?.name],
    ['Razón social', company?.legalName],
    ['RUC', company?.ruc],
    ['Industria', company?.industry],
    ['Teléfono', company?.phone],
    ['Dirección', company?.address],
    ['Distrito', company?.district],
  ];
  return (
    <div className="workspace view-workspace fx-view">
      <ViewHeading
        eyebrow="Cuenta"
        title="Perfil de empresa"
        description="Los datos con los que los candidatos te conocen."
        actions={<button className="primary-button" type="button" onClick={onEdit} disabled={!company}><Pencil size={16} aria-hidden="true" /> Editar perfil</button>}
      />
      <section className="panel fx-panel" aria-label="Datos de la empresa">
        <h2 className="fx-h2"><Building2 size={18} aria-hidden="true" /> Datos de la empresa</h2>
        {!company ? <p className="fx-muted" role="status">Cargando los datos de tu empresa…</p> : (
          <dl className="fx-facts">
            {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || <span className="fx-muted">Sin completar</span>}</dd></div>)}
            <div><dt>Plan</dt><dd>{planLabel}</dd></div>
            {verification && (
              <div>
                <dt>Verificación</dt>
                <dd>
                  {verification.verified ? <StatusPill status="ACCEPTED" label="Empresa verificada" /> : <StatusPill status="APPLIED" label="Pendiente de verificación" />}
                  {!verification.verified && <small className="fx-muted"> Cuando Chambeaya verifique tu empresa ganas {verification.amount} {currency}.</small>}
                  {verification.verified && <small className="fx-muted"> <BadgeCheck size={13} aria-hidden="true" /> Los candidatos ven que tu empresa es de confianza.</small>}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>
      <section className="panel fx-panel" aria-label="Seguridad">
        <h2 className="fx-h2"><KeyRound size={18} aria-hidden="true" /> Seguridad</h2>
        <p className="fx-muted">Cambia tu contraseña cuando lo necesites; cerraremos tus otras sesiones.</p>
        <button className="secondary-button" type="button" onClick={onChangePassword}><KeyRound size={16} aria-hidden="true" /> Cambiar contraseña</button>
      </section>
    </div>
  );
}
