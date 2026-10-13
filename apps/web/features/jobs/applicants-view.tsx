'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, FileText, Radio, Star, Users } from 'lucide-react';

import { formatDateTime } from './format';
import { useJobEvents } from './job-events';
import { useJobs } from './jobs-context';
import { jobsApi, type ApplicantSummary, type ApplicationStatus, type JobEventNotification, type PostingRecord } from './jobs-api';
import { APPLICATION_STATUS_LABEL, EXIT_STAGES, FUNNEL_STAGES, INTERVIEW_MODE_LABEL, OFFER_STATUS_LABEL, POSTING_STATUS_LABEL } from './labels';
import { ApplicantDetailModal } from './applicant-detail';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusPill, ViewHeading } from './ui';
import { useResource } from './use-resource';
import { usePagedList } from './use-paged';

type StageFilter = ApplicationStatus | 'ALL';

export function ApplicantsView() {
  const { token, currency, onUnauthorized, goTo, selectedPostingId, setSelectedPostingId } = useJobs();
  const postings = useResource(() => jobsApi.postings.list(token, { limit: 100 }), 'postings', { onUnauthorized, currency });
  const publishedOrPast = useMemo(() => (postings.data?.items ?? []).filter((posting) => posting.status !== 'DRAFT'), [postings.data]);
  const postingId = publishedOrPast.some((posting) => posting.id === selectedPostingId) ? selectedPostingId : (publishedOrPast[0]?.id ?? '');

  const [stage, setStage] = useState<StageFilter>('ALL');
  const [openApplication, setOpenApplication] = useState<{ id: string; name: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const openRef = useRef<string | null>(null);
  const postingRef = useRef(postingId);
  useEffect(() => {
    openRef.current = openApplication?.id ?? null;
    postingRef.current = postingId;
  });

  const posting = useResource(() => jobsApi.postings.get(token, postingId), postingId, { onUnauthorized, currency, enabled: postingId !== '' });
  const list = usePagedList<ApplicantSummary>(
    (cursor, limit) => jobsApi.applications.list(token, postingId, { statuses: stage === 'ALL' ? undefined : [stage], cursor, limit }),
    `${postingId}|${stage}`,
    { onUnauthorized, currency, enabled: postingId !== '' },
  );
  const { reload: reloadList } = list;
  const { reload: reloadPosting } = posting;
  const { reload: reloadPostings } = postings;

  // Avisos en vivo: una lectura por ráfaga de avisos.
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const onEvent = useCallback((event: JobEventNotification) => {
    if (event.postingId !== postingRef.current) return;
    if (event.applicationId === openRef.current) setRefreshKey((key) => key + 1);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void reloadList({ silent: true });
      void reloadPosting({ silent: true });
      void reloadPostings({ silent: true });
    }, 350);
  }, [reloadList, reloadPosting, reloadPostings]);
  const live = useJobEvents(token, true, onEvent, onUnauthorized);

  const refreshAll = useCallback(() => {
    void reloadList({ silent: true });
    void reloadPosting({ silent: true });
    void reloadPostings({ silent: true });
  }, [reloadList, reloadPosting, reloadPostings]);

  const current: PostingRecord | null = posting.data ?? publishedOrPast.find((item) => item.id === postingId) ?? null;
  const counts = posting.data?.applicantCounts ?? {};
  const total = posting.data?.applicationsCount ?? 0;
  const acceptedOnClosed = current && (current.status === 'CLOSED' || current.status === 'FILLED') ? counts.ACCEPTED ?? 0 : 0;

  return (
    <div className="workspace view-workspace fx-view">
      <ViewHeading
        eyebrow="Selección"
        title="Postulantes"
        description="Mueve a cada candidato por el embudo: postulado, preseleccionado, entrevista, oferta, aceptada y contratado."
        actions={
          <span className={`fx-live fx-live-${live}`} role="status" aria-live="polite">
            <Radio size={13} aria-hidden="true" />
            {live === 'live' ? 'Actualización en vivo activa' : live === 'reconnecting' ? 'Reconectando…' : 'Conectando…'}
          </span>
        }
      />

      {postings.loading && <LoadingBlock label="Cargando tus puestos…" />}
      {!postings.loading && postings.error && <ErrorBlock error={postings.error} onRetry={() => void postings.reload()} title="No pudimos cargar tus puestos" />}
      {!postings.loading && !postings.error && publishedOrPast.length === 0 && (
        <section className="panel fx-panel">
          <EmptyBlock icon={<Users size={26} aria-hidden="true" />} title="Aún no hay postulantes que revisar">
            Publica un puesto para empezar a recibir postulaciones.
            <button className="primary-button" type="button" onClick={() => goTo('Puestos')}>Ir a Puestos</button>
          </EmptyBlock>
        </section>
      )}

      {publishedOrPast.length > 0 && (
        <>
          <div className="fx-toolbar">
            <div className="fx-select-label">
              <label htmlFor="fx-posting-select">Puesto</label>
              <select id="fx-posting-select" value={postingId} onChange={(event) => { setSelectedPostingId(event.target.value); setStage('ALL'); }}>
                {publishedOrPast.map((item) => <option key={item.id} value={item.id}>{item.title} · {POSTING_STATUS_LABEL[item.status]}</option>)}
              </select>
            </div>
            {current && <p className="fx-muted">Vacantes cubiertas: <strong>{current.filledVacancies}/{current.vacancies}</strong> · {POSTING_STATUS_LABEL[current.status]}</p>}
          </div>

          {acceptedOnClosed > 0 && (
            <div className="fx-callout fx-callout-warn" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <p>
                <strong>{acceptedOnClosed === 1 ? 'Hay 1 postulación con oferta aceptada' : `Hay ${acceptedOnClosed} postulaciones con oferta aceptada`} en un puesto {current?.status === 'FILLED' ? 'cubierto' : 'cerrado'}.</strong>{' '}
                Ya no se puede confirmar su contratación. Revísalas y recházalas para cerrar el proceso; la constancia de aceptación se conserva.
              </p>
            </div>
          )}

          <div className="fx-filters" role="group" aria-label="Filtrar postulantes por etapa">
            <StageChip active={stage === 'ALL'} label="Todos" count={posting.data ? total : null} onClick={() => setStage('ALL')} />
            {FUNNEL_STAGES.map((value) => (
              <StageChip key={value} active={stage === value} label={APPLICATION_STATUS_LABEL[value]} count={posting.data ? counts[value] ?? 0 : null} onClick={() => setStage(value)} />
            ))}
            <span className="fx-chip-sep" aria-hidden="true" />
            {EXIT_STAGES.map((value) => (
              <StageChip key={value} active={stage === value} label={APPLICATION_STATUS_LABEL[value]} count={posting.data ? counts[value] ?? 0 : null} onClick={() => setStage(value)} />
            ))}
          </div>

          <section className="panel fx-panel" aria-busy={list.loading} aria-label="Postulantes del puesto">
            {list.loading && <LoadingBlock label="Cargando postulantes…" />}
            {!list.loading && list.error && <ErrorBlock error={list.error} onRetry={() => void list.reload()} title="No pudimos cargar los postulantes" />}
            {!list.loading && !list.error && list.items.length === 0 && (
              <EmptyBlock icon={<Users size={26} aria-hidden="true" />} title={stage === 'ALL' ? 'Todavía no hay postulantes' : `No hay postulantes en «${APPLICATION_STATUS_LABEL[stage]}»`}>
                {stage === 'ALL' ? 'Cuando alguien postule a este puesto aparecerá aquí al instante.' : 'Cambia de etapa para ver a los demás candidatos.'}
              </EmptyBlock>
            )}
            {list.refreshFailed && <p className="fx-callout fx-callout-warn" role="status">No pudimos actualizar la lista; mostramos lo último que cargó. Reintentaremos con el siguiente aviso.</p>}
            {!list.loading && !list.error && list.items.length > 0 && (
              <ul className="fx-list">
                {list.items.map((item) => <ApplicantCard key={item.id} item={item} onOpen={() => setOpenApplication({ id: item.id, name: item.worker.name })} />)}
              </ul>
            )}
            {list.hasMore && !list.loading && (
              <div className="fx-more">
                <button className="secondary-button" type="button" disabled={list.loadingMore} onClick={() => void list.loadMore()}>{list.loadingMore ? 'Cargando…' : 'Ver más postulantes'}</button>
                {list.loadMoreError && <small className="fx-field-error" role="alert">{list.loadMoreError.message}</small>}
              </div>
            )}
          </section>
        </>
      )}

      {openApplication && (
        <ApplicantDetailModal
          applicationId={openApplication.id}
          name={openApplication.name}
          posting={current}
          refreshKey={refreshKey}
          onClose={() => setOpenApplication(null)}
          onChanged={refreshAll}
        />
      )}
    </div>
  );
}

function StageChip({ active, label, count, onClick }: { active: boolean; label: string; count: number | null; onClick: () => void }) {
  return (
    <button type="button" className={`fx-chip${active ? ' active' : ''}`} aria-pressed={active} onClick={onClick}>
      {label}{count !== null && <span className="fx-chip-count"> {count}</span>}
    </button>
  );
}

function ApplicantCard({ item, onOpen }: { item: ApplicantSummary; onOpen: () => void }) {
  const subtitle = [item.worker.headline, item.worker.district].filter(Boolean).join(' · ');
  return (
    <li className="fx-row">
      <div className="fx-row-main">
        <div className="fx-row-title">
          <h3>{item.worker.name}</h3>
          <StatusPill status={item.status} label={APPLICATION_STATUS_LABEL[item.status]} />
          {item.isPriority && <span className="fx-pill fx-pill-gold"><Star size={12} aria-hidden="true" /> Prioridad</span>}
        </div>
        {subtitle && <p className="fx-meta"><span>{subtitle}</span></p>}
        <p className="fx-meta">
          <span>Postuló el {formatDateTime(item.createdAt)}</span>
          {item.interview && <span><CalendarClock size={13} aria-hidden="true" /> Entrevista {formatDateTime(item.interview.scheduledAt)}{item.interview.mode ? ` · ${INTERVIEW_MODE_LABEL[item.interview.mode]}` : ''}</span>}
          {item.currentOfferStatus && <span>Oferta: {OFFER_STATUS_LABEL[item.currentOfferStatus]}</span>}
          {item.worker.hasCv && <span><FileText size={13} aria-hidden="true" /> CV disponible</span>}
        </p>
      </div>
      <div className="fx-row-actions">
        <button className="secondary-button fx-small-button" type="button" aria-label={`Revisar a ${item.worker.name}`} onClick={onOpen}>Revisar</button>
      </div>
    </li>
  );
}
