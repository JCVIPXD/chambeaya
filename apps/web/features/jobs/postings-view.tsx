'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BriefcaseBusiness, CircleDot, MapPin, Pause, Pencil, Play, Plus, Sparkles, Users, XCircle } from 'lucide-react';

import { CostActionDialog, type CostActionSpec } from './cost-action';
import { formatCalendarDate, formatDateTime, formatSalaryRange } from './format';
import { useJobEvents } from './job-events';
import { useJobs } from './jobs-context';
import { jobsApi, type PostingRecord, type PostingStatus } from './jobs-api';
import { CONTRACT_LABEL, MODALITY_LABEL, POSTING_STATUS_LABEL, WORKLOAD_LABEL } from './labels';
import { describeError, type DescribedError } from './errors';
import { PostingFormModal } from './posting-form';
import { EmptyBlock, ErrorBlock, LoadingBlock, Modal, RetryButton, StatusPill, ViewHeading } from './ui';
import { usePagedList } from './use-paged';

const FILTERS: Array<{ value: PostingStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'DRAFT', label: 'Borradores' },
  { value: 'PUBLISHED', label: 'Publicados' },
  { value: 'PAUSED', label: 'En pausa' },
  { value: 'CLOSED', label: 'Cerrados' },
  { value: 'FILLED', label: 'Cubiertos' },
];

/** Debounce de los refrescos disparados por avisos en vivo (varios avisos seguidos = una lectura). */
function useDebouncedCallback(callback: () => void, delay: number) {
  const ref = useRef(callback);
  const timer = useRef<number | null>(null);
  useEffect(() => { ref.current = callback; });
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => ref.current(), delay);
  }, [delay]);
}

export function PostingsView() {
  const { token, currency, onUnauthorized, toast, goTo, setSelectedPostingId, refreshBalance, createPending, consumeCreate } = useJobs();
  const [filter, setFilter] = useState<PostingStatus | 'ALL'>('ALL');
  const [editor, setEditor] = useState<PostingRecord | 'new' | null>(null);
  const [costSpec, setCostSpec] = useState<CostActionSpec | null>(null);
  const [closing, setClosing] = useState<PostingRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ title: string; error: DescribedError; retry?: () => void } | null>(null);

  const list = usePagedList<PostingRecord>(
    (cursor, limit) => jobsApi.postings.list(token, { status: filter === 'ALL' ? undefined : filter, cursor, limit }),
    filter,
    { onUnauthorized, currency },
  );
  const refresh = useDebouncedCallback(() => void list.reload({ silent: true }), 400);
  useJobEvents(token, true, refresh, onUnauthorized);

  useEffect(() => {
    if (createPending) {
      consumeCreate();
      setEditor('new');
    }
  }, [createPending, consumeCreate]);

  function openApplicants(posting: PostingRecord) {
    setSelectedPostingId(posting.id);
    goTo('Postulantes');
  }

  function publishSpec(posting: PostingRecord): CostActionSpec {
    return {
      title: `Publicar «${posting.title}»`,
      summary: posting.status === 'PAUSED' ? 'Vuelve a recibir postulaciones.' : 'Los candidatos podrán verlo y postular.',
      actionKey: 'JOB_PUBLISH_EXTRA',
      targetId: posting.id,
      confirmLabel: 'Publicar',
      execute: async () => {
        const result = await jobsApi.postings.publish(token, posting.id);
        return result.chargedAmount && result.chargedAmount > 0
          ? `«${posting.title}» publicado. Se cobraron ${result.chargedAmount} ${currency}.`
          : `«${posting.title}» publicado.`;
      },
    };
  }

  function highlightSpec(posting: PostingRecord): CostActionSpec {
    return {
      title: `Destacar «${posting.title}»`,
      summary: 'Aparece primero en la búsqueda de puestos durante la duración del destacado.',
      actionKey: 'JOB_HIGHLIGHT',
      targetId: posting.id,
      confirmLabel: 'Destacar',
      execute: async () => {
        const result = await jobsApi.postings.highlight(token, posting.id);
        return result.idempotent ? `«${posting.title}» ya estaba destacado.` : `«${posting.title}» destacado hasta el ${formatDateTime(result.highlightedUntil)}.`;
      },
    };
  }

  async function pause(posting: PostingRecord) {
    setBusyId(posting.id);
    setActionError(null);
    try {
      await jobsApi.postings.pause(token, posting.id);
      toast(`«${posting.title}» en pausa: ya no recibe postulaciones.`);
      void list.reload({ silent: true });
    } catch (error) {
      const described = describeError(error, currency);
      if (described.kind === 'session') onUnauthorized();
      else {
        setActionError({ title: `No pudimos pausar «${posting.title}»`, error: described, retry: () => void pause(posting) });
        void list.reload({ silent: true });
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="workspace view-workspace fx-view">
      <ViewHeading
        eyebrow="Puestos fijos"
        title="Puestos"
        description="Crea, publica y administra tus puestos de trabajo fijos."
        actions={<button className="primary-button" type="button" onClick={() => setEditor('new')}><Plus size={17} aria-hidden="true" /> Nuevo puesto</button>}
      />

      <div className="fx-filters" role="group" aria-label="Filtrar puestos por estado">
        {FILTERS.map((item) => (
          <button key={item.value} type="button" className={`fx-chip${filter === item.value ? ' active' : ''}`} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
            {item.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="fx-callout fx-callout-bad" role="alert">
          <strong>{actionError.title}</strong>
          <p>{actionError.error.message}</p>
          <div className="fx-inline-actions">
            {actionError.retry && actionError.error.kind === 'retry' && <RetryButton onRetry={() => actionError.retry?.()} seconds={actionError.error.retryAfterSeconds} />}
            <button className="secondary-button fx-small-button" type="button" onClick={() => setActionError(null)}>Cerrar aviso</button>
          </div>
        </div>
      )}

      <section className="panel fx-panel" aria-busy={list.loading} aria-label="Mis puestos">
        {list.loading && <LoadingBlock label="Cargando tus puestos…" />}
        {!list.loading && list.error && <ErrorBlock error={list.error} onRetry={() => void list.reload()} title="No pudimos cargar tus puestos" />}
        {!list.loading && !list.error && list.items.length === 0 && (
          filter === 'ALL' ? (
            <EmptyBlock icon={<BriefcaseBusiness size={26} aria-hidden="true" />} title="Todavía no tienes puestos">
              Crea tu primer puesto: lo guardamos como borrador y lo publicas cuando quieras.
              <button className="primary-button" type="button" onClick={() => setEditor('new')}><Plus size={16} aria-hidden="true" /> Crear mi primer puesto</button>
            </EmptyBlock>
          ) : (
            <EmptyBlock title={`No tienes puestos ${FILTERS.find((item) => item.value === filter)?.label.toLowerCase()}`}>Cambia el filtro para ver otros puestos.</EmptyBlock>
          )
        )}
        {list.refreshFailed && <p className="fx-callout fx-callout-warn" role="status">No pudimos actualizar la lista; mostramos lo último que cargó.</p>}
        {!list.loading && !list.error && list.items.length > 0 && (
          <ul className="fx-list">
            {list.items.map((posting) => (
              <PostingRow
                key={posting.id}
                posting={posting}
                busy={busyId === posting.id}
                onApplicants={() => openApplicants(posting)}
                onEdit={() => setEditor(posting)}
                onPublish={() => setCostSpec(publishSpec(posting))}
                onPause={() => void pause(posting)}
                onClose={() => setClosing(posting)}
                onHighlight={() => setCostSpec(highlightSpec(posting))}
              />
            ))}
          </ul>
        )}
        {list.hasMore && !list.loading && (
          <div className="fx-more">
            <button className="secondary-button" type="button" disabled={list.loadingMore} onClick={() => void list.loadMore()}>{list.loadingMore ? 'Cargando…' : 'Ver más puestos'}</button>
            {list.loadMoreError && <small className="fx-field-error" role="alert">{list.loadMoreError.message}</small>}
          </div>
        )}
      </section>

      {editor && (
        <PostingFormModal
          posting={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void list.reload({ silent: true });
          }}
        />
      )}
      {costSpec && (
        <CostActionDialog
          spec={costSpec}
          token={token}
          currency={currency}
          onClose={() => setCostSpec(null)}
          onFailed={() => void list.reload({ silent: true })}
          onUnauthorized={onUnauthorized}
          onOpenWallet={() => { setCostSpec(null); goTo('Billetera'); }}
          onDone={(message) => {
            setCostSpec(null);
            if (message) toast(message);
            void list.reload({ silent: true });
            void refreshBalance();
          }}
        />
      )}
      {closing && (
        <ClosePostingDialog
          posting={closing}
          onClose={() => setClosing(null)}
          onClosed={(message) => {
            setClosing(null);
            toast(message);
            void list.reload({ silent: true });
          }}
        />
      )}
    </div>
  );
}

function PostingRow({ posting, busy, onApplicants, onEdit, onPublish, onPause, onClose, onHighlight }: {
  posting: PostingRecord;
  busy: boolean;
  onApplicants: () => void;
  onEdit: () => void;
  onPublish: () => void;
  onPause: () => void;
  onClose: () => void;
  onHighlight: () => void;
}) {
  const highlighted = Boolean(posting.highlightedUntil) && new Date(posting.highlightedUntil as string).getTime() > Date.now();
  const editable = posting.status === 'DRAFT' || posting.status === 'PAUSED';
  const open = posting.status === 'DRAFT' || posting.status === 'PUBLISHED' || posting.status === 'PAUSED';
  const applications = posting.applicationsCount ?? 0;
  return (
    <li className="fx-row">
      <div className="fx-row-main">
        <div className="fx-row-title">
          <h3>{posting.title}</h3>
          <StatusPill status={posting.status} label={POSTING_STATUS_LABEL[posting.status]} />
          {highlighted && <span className="fx-pill fx-pill-gold"><Sparkles size={12} aria-hidden="true" /> Destacado hasta el {formatCalendarDate(posting.highlightedUntil)}</span>}
        </div>
        <p className="fx-meta">
          <span><MapPin size={13} aria-hidden="true" /> {posting.location}</span>
          <span>{MODALITY_LABEL[posting.modality]} · {WORKLOAD_LABEL[posting.workload]} · {CONTRACT_LABEL[posting.contractType]}</span>
          <span>{formatSalaryRange(posting.salary.minCents, posting.salary.maxCents, posting.salary.currency)} al mes</span>
        </p>
        <p className="fx-meta">
          <span><CircleDot size={13} aria-hidden="true" /> Vacantes cubiertas: <strong>{posting.filledVacancies}/{posting.vacancies}</strong></span>
          <span><Users size={13} aria-hidden="true" /> {applications} {applications === 1 ? 'postulación' : 'postulaciones'}</span>
          {posting.publishedAt && <span>Publicado el {formatCalendarDate(posting.publishedAt)}</span>}
        </p>
      </div>
      <div className="fx-row-actions">
        {posting.status !== 'DRAFT' && (
          <button className="secondary-button fx-small-button" type="button" aria-label={`Ver postulantes de ${posting.title}`} onClick={onApplicants}>
            <Users size={15} aria-hidden="true" /> Postulantes
          </button>
        )}
        {editable && (
          <button className="secondary-button fx-small-button" type="button" aria-label={`Editar ${posting.title}`} onClick={onEdit}>
            <Pencil size={15} aria-hidden="true" /> Editar
          </button>
        )}
        {(posting.status === 'DRAFT' || posting.status === 'PAUSED') && (
          <button className="primary-button fx-small-button" type="button" aria-label={`${posting.status === 'DRAFT' ? 'Publicar' : 'Reanudar'} ${posting.title}`} onClick={onPublish}>
            <Play size={15} aria-hidden="true" /> {posting.status === 'DRAFT' ? 'Publicar' : 'Reanudar'}
          </button>
        )}
        {posting.status === 'PUBLISHED' && (
          <>
            <button className="secondary-button fx-small-button" type="button" aria-label={`Pausar ${posting.title}`} disabled={busy} onClick={onPause}>
              <Pause size={15} aria-hidden="true" /> {busy ? 'Pausando…' : 'Pausar'}
            </button>
            <button className="secondary-button fx-small-button" type="button" aria-label={`Destacar ${posting.title}`} onClick={onHighlight}>
              <Sparkles size={15} aria-hidden="true" /> {highlighted ? 'Destacado' : 'Destacar'}
            </button>
          </>
        )}
        {open && (
          <button className="secondary-button fx-small-button fx-danger" type="button" aria-label={`Cerrar ${posting.title}`} onClick={onClose}>
            <XCircle size={15} aria-hidden="true" /> Cerrar
          </button>
        )}
      </div>
    </li>
  );
}

function ClosePostingDialog({ posting, onClose, onClosed }: { posting: PostingRecord; onClose: () => void; onClosed: (message: string) => void }) {
  const { token, currency, toast, onUnauthorized } = useJobs();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DescribedError | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await jobsApi.postings.close(token, posting.id);
      onClosed(`«${posting.title}» cerrado.`);
    } catch (error) {
      const described = describeError(error, currency);
      if (described.kind === 'session') onUnauthorized();
      else {
        setFailure(described);
        if (described.kind === 'conflict' || described.kind === 'not-found') toast('Actualizamos la lista de puestos.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`¿Cerrar «${posting.title}»?`} description="Un puesto cerrado no vuelve a abrirse." onClose={onClose} busy={busy} size="sm" initialFocus="[data-autofocus]">
      <div className="fx-cost">
        <p>Al cerrarlo:</p>
        <ul className="fx-bullets">
          <li>deja de recibir postulaciones y desaparece de la búsqueda de los candidatos;</li>
          <li>las ofertas pendientes se retiran y esas postulaciones pasan a «Rechazado», con aviso al candidato;</li>
          <li>las postulaciones con oferta aceptada que aún no confirmaste también pasan a «Rechazado»;</li>
          <li>las contrataciones ya confirmadas y las constancias de aceptación se conservan.</li>
        </ul>
        {failure && (
          <div className="fx-callout fx-callout-bad" role="alert">
            <p>{failure.message}</p>
            {failure.kind === 'retry' && <RetryButton onRetry={() => void confirm()} seconds={failure.retryAfterSeconds} label="Reintentar" busy={busy} />}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button className="secondary-button" type="button" data-autofocus onClick={onClose} disabled={busy}>No cerrar</button>
        <button className="primary-button fx-danger-solid" type="button" onClick={() => void confirm()} disabled={busy}>{busy ? 'Cerrando…' : 'Sí, cerrar el puesto'}</button>
      </div>
    </Modal>
  );
}
