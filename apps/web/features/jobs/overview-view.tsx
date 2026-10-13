'use client';

import { useCallback } from 'react';
import { BriefcaseBusiness, Plus, Search, Users, WalletCards } from 'lucide-react';

import { formatCoins } from './format';
import { useJobEvents } from './job-events';
import { useJobs } from './jobs-context';
import { jobsApi, type PostingRecord } from './jobs-api';
import { POSTING_STATUS_LABEL } from './labels';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusPill, ViewHeading } from './ui';
import { useResource } from './use-resource';

/** Resumen de la empresa cuando los turnos temporales están apagados: puestos, postulantes y saldo. */
export function OverviewView({ companyName, requestCreate }: { companyName: string; requestCreate: () => void }) {
  const { token, currency, balance, balanceError, onUnauthorized, goTo, setSelectedPostingId } = useJobs();
  const postings = useResource(() => jobsApi.postings.list(token, { limit: 100 }), 'overview', { onUnauthorized, currency });
  const { reload } = postings;
  const onEvent = useCallback(() => void reload({ silent: true }), [reload]);
  useJobEvents(token, true, onEvent, onUnauthorized);

  const items = postings.data?.items ?? [];
  const count = (status: PostingRecord['status']) => items.filter((item) => item.status === status).length;
  const applications = items.reduce((sum, item) => sum + (item.applicationsCount ?? 0), 0);
  const recent = items.filter((item) => item.status !== 'DRAFT').slice(0, 5);

  return (
    <div className="workspace fx-view">
      <ViewHeading eyebrow="Panel de empresa" title={`Hola, ${companyName}`} description="Tus puestos fijos, tus postulantes y tu saldo, en un solo lugar." />

      <div className="fx-stat-grid fx-stat-grid-4">
        <div className="fx-stat">
          <span className="fx-stat-icon"><BriefcaseBusiness size={20} aria-hidden="true" /></span>
          <div><small>Puestos publicados</small><strong>{postings.data ? count('PUBLISHED') : '—'}</strong><small>{postings.data ? `${count('DRAFT')} en borrador · ${count('PAUSED')} en pausa` : ' '}</small></div>
        </div>
        <div className="fx-stat">
          <span className="fx-stat-icon"><Users size={20} aria-hidden="true" /></span>
          <div><small>Postulaciones recibidas</small><strong>{postings.data ? applications : '—'}</strong><small>En todos tus puestos</small></div>
        </div>
        <div className="fx-stat">
          <span className="fx-stat-icon"><WalletCards size={20} aria-hidden="true" /></span>
          <div><small>Saldo</small><strong>{balance !== null ? formatCoins(balance, currency) : balanceError ? '—' : 'Cargando…'}</strong><small>Moneda virtual de Chambeaya</small></div>
        </div>
        <div className="fx-stat">
          <span className="fx-stat-icon"><BriefcaseBusiness size={20} aria-hidden="true" /></span>
          <div><small>Puestos cubiertos o cerrados</small><strong>{postings.data ? count('FILLED') + count('CLOSED') : '—'}</strong><small>Historial de tu empresa</small></div>
        </div>
      </div>

      <div className="fx-quick" role="group" aria-label="Accesos rápidos">
        <button className="primary-button" type="button" onClick={requestCreate}><Plus size={16} aria-hidden="true" /> Crear un puesto</button>
        <button className="secondary-button" type="button" onClick={() => goTo('Talento')}><Search size={16} aria-hidden="true" /> Buscar talento</button>
        <button className="secondary-button" type="button" onClick={() => goTo('Billetera')}><WalletCards size={16} aria-hidden="true" /> Ver mi billetera</button>
      </div>

      <section className="panel fx-panel" aria-label="Puestos recientes" aria-busy={postings.loading}>
        <h2 className="fx-h2">Tus puestos</h2>
        {postings.loading && <LoadingBlock label="Cargando tus puestos…" />}
        {!postings.loading && postings.error && <ErrorBlock error={postings.error} onRetry={() => void postings.reload()} title="No pudimos cargar tus puestos" />}
        {postings.data && items.length === 0 && (
          <EmptyBlock icon={<BriefcaseBusiness size={26} aria-hidden="true" />} title="Todavía no tienes puestos">
            Crea tu primer puesto y publícalo para empezar a recibir postulaciones.
          </EmptyBlock>
        )}
        {postings.data && items.length > 0 && recent.length === 0 && <EmptyBlock title="Tienes borradores sin publicar">Entra a Puestos para revisarlos y publicarlos.</EmptyBlock>}
        {recent.length > 0 && (
          <ul className="fx-list fx-list-compact">
            {recent.map((item) => (
              <li className="fx-row fx-row-slim" key={item.id}>
                <div className="fx-row-main">
                  <div className="fx-row-title"><h3>{item.title}</h3><StatusPill status={item.status} label={POSTING_STATUS_LABEL[item.status]} /></div>
                  <p className="fx-meta"><span>{item.applicationsCount ?? 0} postulaciones</span><span>Vacantes cubiertas {item.filledVacancies}/{item.vacancies}</span></p>
                </div>
                <div className="fx-row-actions">
                  <button className="secondary-button fx-small-button" type="button" aria-label={`Ver postulantes de ${item.title}`} onClick={() => { setSelectedPostingId(item.id); goTo('Postulantes'); }}>Ver postulantes</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
