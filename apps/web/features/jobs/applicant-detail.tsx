'use client';

import type { FormEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, FileCheck2, FileText, Handshake, Star, UserCheck, XCircle } from 'lucide-react';

import { ApiError } from '../../lib/business-api';
import { describeError, fieldIssues, type DescribedError } from './errors';
import { centsToSolesInput, formatCalendarDate, formatCents, formatDateTime, formatFileSize, localDateTimeToIso } from './format';
import { useJobs } from './jobs-context';
import {
  jobsApi,
  type ApplicantSummary,
  type ApplicationDetail,
  type ContractType,
  type InterviewMode,
  type OfferRecord,
  type PostingRecord,
  type UploadedOfferDocument,
} from './jobs-api';
import {
  APPLICATION_STATUS_LABEL,
  CONTRACT_LABEL,
  EVENT_LABEL,
  INTERVIEW_MODE_LABEL,
  MODALITY_LABEL,
  OFFER_STATUS_LABEL,
  WORKLOAD_LABEL,
} from './labels';
import { PdfButton } from './pdf-button';
import { ErrorBlock, Field, LoadingBlock, Modal, RetryButton, StatusPill } from './ui';
import { useResource } from './use-resource';
import {
  LIMITS,
  looksLikePdf,
  validateInterview,
  validateOffer,
  validateOfferPdf,
  type FieldErrors,
  type InterviewFormValues,
  type OfferFormValues,
} from './validation';

// Qué puede hacer la empresa en cada etapa. Espejo de `job-state.ts` de la API (que sigue siendo la
// autoridad): preseleccionar solo desde «Postulado»; entrevistar y ofertar desde las etapas previas;
// contratar solo desde «Aceptada»; rechazar desde cualquier etapa abierta.
export function allowedActions(status: ApplicantSummary['status'], postingOpen: boolean) {
  const open = status === 'APPLIED' || status === 'SHORTLISTED' || status === 'INTERVIEW' || status === 'OFFER' || status === 'ACCEPTED';
  return {
    shortlist: postingOpen && status === 'APPLIED',
    interview: postingOpen && (status === 'APPLIED' || status === 'SHORTLISTED' || status === 'INTERVIEW'),
    offer: postingOpen && (status === 'APPLIED' || status === 'SHORTLISTED' || status === 'INTERVIEW' || status === 'OFFER'),
    hire: postingOpen && status === 'ACCEPTED',
    reject: open,
  };
}

type Mode = null | 'interview' | 'offer' | 'reject' | 'hire';

export function ApplicantDetailModal({ applicationId, posting, name, refreshKey, onClose, onChanged }: {
  applicationId: string;
  /** Sube con cada aviso en vivo que toca esta postulación. */
  refreshKey: number;
  posting: PostingRecord | null;
  name: string;
  onClose: () => void;
  /** Algo cambió (etapa, oferta, contratación): quien llama refresca la lista, los conteos y el puesto. */
  onChanged: () => void;
}) {
  const { token, currency, onUnauthorized, toast, refreshBalance } = useJobs();
  const detail = useResource(() => jobsApi.applications.get(token, applicationId), applicationId, { onUnauthorized, currency });
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<DescribedError | null>(null);
  const retryRef = useRef<(() => void) | null>(null);

  // Un aviso en vivo de esta postulación (la vista sube `refreshKey`) recarga el detalle abierto sin vaciarlo.
  const { reload } = detail;
  useEffect(() => {
    if (refreshKey > 0) void reload({ silent: true });
  }, [refreshKey, reload]);

  const data = detail.data;
  const postingOpen = posting ? posting.status === 'PUBLISHED' || posting.status === 'PAUSED' : data ? data.posting.status === 'PUBLISHED' || data.posting.status === 'PAUSED' : true;
  const actions = data ? allowedActions(data.status, postingOpen) : null;

  /** Ejecuta una acción de la empresa con manejo común de errores y reintento seguro. */
  async function perform(label: string, action: () => Promise<ApplicationDetail>, success: string, afterOk?: () => void) {
    if (busy) return;
    setBusy(label);
    setFailure(null);
    retryRef.current = () => void perform(label, action, success, afterOk);
    try {
      const result = await action();
      detail.replace(result);
      setMode(null);
      toast(success);
      onChanged();
      afterOk?.();
    } catch (error) {
      const described = describeError(error, currency);
      if (described.kind === 'session') {
        onUnauthorized();
        return;
      }
      setFailure(described);
      // Si el servidor dice que el estado cambió, se vuelve a leer lo vigente.
      if (described.kind === 'conflict' || described.kind === 'not-found') {
        void detail.reload({ silent: true });
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={name} description="Revisa la postulación y decide el siguiente paso." onClose={onClose} busy={busy !== null} size="lg">
      {detail.loading && <LoadingBlock label="Cargando la postulación…" />}
      {!detail.loading && detail.error && <ErrorBlock error={detail.error} onRetry={() => void detail.reload()} title="No pudimos cargar la postulación" />}
      {data && actions && (
        <div className="fx-detail">
          <div className="fx-detail-head">
            <StatusPill status={data.status} label={APPLICATION_STATUS_LABEL[data.status]} />
            {data.isPriority && <span className="fx-pill fx-pill-gold"><Star size={12} aria-hidden="true" /> Postulación con prioridad</span>}
            <span className="fx-muted">Postuló el {formatDateTime(data.createdAt)}</span>
          </div>
          <p className="fx-muted">{[data.worker.headline, data.worker.district].filter(Boolean).join(' · ') || 'Sin titular ni distrito en el perfil'}</p>

          {data.status === 'ACCEPTED' && !postingOpen && (
            <div className="fx-callout fx-callout-warn" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <p><strong>El puesto ya no está abierto.</strong> Esta persona aceptó la oferta, pero ya no se puede confirmar su contratación. Puedes rechazar la postulación para cerrar el proceso; la constancia de aceptación se conserva.</p>
            </div>
          )}
          {data.status === 'REJECTED' && data.events.some((event) => event.detail === 'POSTING_CLOSED' || event.detail === 'POSTING_FILLED') && (
            <div className="fx-callout" role="note">
              <p>El sistema rechazó esta postulación porque el puesto se {data.events.some((event) => event.detail === 'POSTING_FILLED') ? 'cubrió' : 'cerró'}. El candidato fue avisado.</p>
            </div>
          )}
          {data.decisionReason && <p className="fx-muted"><strong>Motivo interno del rechazo:</strong> {data.decisionReason} (el candidato no lo ve)</p>}

          {data.worker.hasCv && (
            <PdfButton
              label="Ver CV"
              downloadName={`CV de ${name}.pdf`}
              fetchBlob={(signal) => jobsApi.applications.cv(token, applicationId, signal)}
              onUnauthorized={onUnauthorized}
              note="PDF subido por el candidato, solo lectura. Chambeaya no verifica su contenido."
            />
          )}

          {data.interview && (
            <section className="fx-block" aria-label="Entrevista">
              <h3><CalendarClock size={16} aria-hidden="true" /> Entrevista</h3>
              <p>{formatDateTime(data.interview.scheduledAt)}{data.interview.mode ? ` · ${INTERVIEW_MODE_LABEL[data.interview.mode]}` : ''}</p>
              {data.interview.note && <p className="fx-muted">{data.interview.note}</p>}
            </section>
          )}

          {data.screeningAnswers.length > 0 && (
            <section className="fx-block" aria-label="Respuestas a las preguntas de filtro">
              <h3>Preguntas de filtro</h3>
              <dl className="fx-qa">
                {data.screeningAnswers.map((item, index) => (
                  <div key={index}><dt>{item.question}</dt><dd>{item.answer}</dd></div>
                ))}
              </dl>
            </section>
          )}

          <OffersBlock offers={data.offers} applicationId={applicationId} workerName={name} />

          <section className="fx-block" aria-label="Línea de tiempo">
            <h3>Línea de tiempo</h3>
            {data.events.length === 0 ? <p className="fx-muted">Sin movimientos.</p> : (
              <ol className="fx-timeline">
                {data.events.map((event) => (
                  <li key={event.id}>
                    <strong>{EVENT_LABEL[event.type] ?? event.type}</strong>
                    <span>{formatDateTime(event.createdAt)}{event.actorRole === 'COMPANY' ? ' · Tu empresa' : event.actorRole === 'WORKER' ? ' · El candidato' : ' · Sistema'}</span>
                    {event.type === 'REJECTED' && event.detail && event.detail !== 'POSTING_CLOSED' && event.detail !== 'POSTING_FILLED' && <em>Motivo interno: {event.detail}</em>}
                    {event.type === 'REJECTED' && (event.detail === 'POSTING_CLOSED' || event.detail === 'POSTING_FILLED') && <em>{event.detail === 'POSTING_FILLED' ? 'El puesto se cubrió.' : 'El puesto se cerró.'}</em>}
                    {event.type === 'OFFER_ISSUED' && event.detail && <em>Versión {event.detail.replace(/^v/, '')}</em>}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {failure && (
            <div className={`fx-callout ${failure.kind === 'retry' ? 'fx-callout-warn' : 'fx-callout-bad'}`} role="alert">
              <p>{failure.message}</p>
              {failure.kind === 'retry' && <RetryButton onRetry={() => retryRef.current?.()} seconds={failure.retryAfterSeconds} label="Reintentar ahora" busy={busy !== null} />}
            </div>
          )}

          {mode === null && (
            <div className="fx-action-bar" role="group" aria-label="Acciones de la postulación">
              {actions.shortlist && (
                <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void perform('shortlist', () => jobsApi.applications.stage(token, applicationId, 'SHORTLISTED'), `${name} quedó preseleccionado.`)}>
                  <UserCheck size={16} aria-hidden="true" /> {busy === 'shortlist' ? 'Preseleccionando…' : 'Preseleccionar'}
                </button>
              )}
              {actions.interview && (
                <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => { setFailure(null); setMode('interview'); }}>
                  <CalendarClock size={16} aria-hidden="true" /> {data.status === 'INTERVIEW' ? 'Reprogramar entrevista' : 'Programar entrevista'}
                </button>
              )}
              {actions.offer && (
                <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => { setFailure(null); setMode('offer'); }}>
                  <FileCheck2 size={16} aria-hidden="true" /> {data.status === 'OFFER' ? 'Emitir nueva versión de la oferta' : 'Emitir oferta'}
                </button>
              )}
              {actions.hire && (
                <button className="primary-button" type="button" disabled={busy !== null} onClick={() => { setFailure(null); setMode('hire'); }}>
                  <Handshake size={16} aria-hidden="true" /> Confirmar contratación
                </button>
              )}
              {actions.reject && (
                <button className="secondary-button fx-danger" type="button" disabled={busy !== null} onClick={() => { setFailure(null); setMode('reject'); }}>
                  <XCircle size={16} aria-hidden="true" /> Rechazar
                </button>
              )}
              {!actions.shortlist && !actions.interview && !actions.offer && !actions.hire && !actions.reject && (
                <p className="fx-muted">Esta postulación ya terminó: no hay acciones disponibles.</p>
              )}
            </div>
          )}

          {mode === 'interview' && (
            <InterviewForm
              current={data.interview}
              disabled={busy !== null}
              onCancel={() => setMode(null)}
              onSubmit={(input) => void perform('interview', () => jobsApi.applications.interview(token, applicationId, input), data.status === 'INTERVIEW' ? 'Entrevista reprogramada.' : 'Entrevista programada.')}
              busy={busy === 'interview'}
            />
          )}
          {mode === 'offer' && (
            <OfferForm
              applicationId={applicationId}
              last={data.offers.at(-1) ?? null}
              posting={posting}
              disabled={busy !== null}
              onCancel={() => setMode(null)}
              onIssued={(result, idempotent) => {
                detail.replace(result);
                setMode(null);
                toast(idempotent ? 'La oferta ya estaba emitida con esas condiciones.' : `Oferta emitida a ${name}.`);
                onChanged();
              }}
              onFailure={setFailure}
            />
          )}
          {mode === 'reject' && (
            <RejectForm
              name={name}
              hasPendingOffer={data.offers.some((offer) => offer.status === 'PENDING')}
              accepted={data.status === 'ACCEPTED'}
              busy={busy === 'reject'}
              disabled={busy !== null}
              onCancel={() => setMode(null)}
              onSubmit={(reason) => void perform('reject', () => jobsApi.applications.reject(token, applicationId, reason), `${name} fue rechazado.`)}
            />
          )}
          {mode === 'hire' && (
            <HireConfirm
              name={name}
              posting={posting}
              busy={busy === 'hire'}
              disabled={busy !== null}
              onCancel={() => setMode(null)}
              onConfirm={() => void perform('hire', () => jobsApi.applications.hire(token, applicationId), `Contratación de ${name} confirmada.`, () => void refreshBalance())}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function Section({ title, children, tone }: { title: string; children: ReactNode; tone?: 'warn' }) {
  return (
    <section className={`fx-subform${tone ? ` fx-subform-${tone}` : ''}`} aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function InterviewForm({ current, onSubmit, onCancel, disabled, busy }: {
  current: ApplicationDetail['interview'];
  onSubmit: (input: { scheduledAt: string; mode?: InterviewMode | null; note?: string | null }) => void;
  onCancel: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  const [values, setValues] = useState<InterviewFormValues>({ scheduledAt: '', mode: current?.mode ?? '', note: current?.note ?? '' });
  const [errors, setErrors] = useState<FieldErrors<keyof InterviewFormValues>>({});
  const minValue = useRef(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16));

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateInterview(values);
    if (!result.iso) {
      setErrors(result.errors);
      return;
    }
    onSubmit({ scheduledAt: localDateTimeToIso(values.scheduledAt) ?? result.iso, mode: values.mode || null, note: values.note.trim() || null });
  }

  return (
    <Section title={current ? 'Reprogramar entrevista' : 'Programar entrevista'}>
      <form className="fx-form" onSubmit={submit} noValidate>
        <div className="fx-grid">
          <Field label="Fecha y hora" error={errors.scheduledAt}>
            {(props) => <input {...props} name="scheduledAt" type="datetime-local" min={minValue.current} value={values.scheduledAt} autoFocus onChange={(event) => { setValues({ ...values, scheduledAt: event.target.value }); setErrors({ ...errors, scheduledAt: undefined }); }} />}
          </Field>
          <Field label="Modalidad (opcional)">
            {(props) => (
              <select {...props} value={values.mode} onChange={(event) => setValues({ ...values, mode: event.target.value as InterviewFormValues['mode'] })}>
                <option value="">Sin indicar</option>
                {Object.entries(INTERVIEW_MODE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Nota para el candidato (opcional)" error={errors.note} full>
            {(props) => <textarea {...props} rows={2} value={values.note} onChange={(event) => setValues({ ...values, note: event.target.value })} placeholder="Dirección, enlace de la videollamada, a quién preguntar…" />}
          </Field>
        </div>
        <div className="fx-inline-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>Volver</button>
          <button className="primary-button" type="submit" disabled={disabled}>{busy ? 'Guardando…' : 'Guardar entrevista'}</button>
        </div>
      </form>
    </Section>
  );
}

function RejectForm({ name, hasPendingOffer, accepted, onSubmit, onCancel, disabled, busy }: {
  name: string;
  hasPendingOffer: boolean;
  accepted: boolean;
  onSubmit: (reason: string | null) => void;
  onCancel: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  const [reason, setReason] = useState('');
  const tooLong = reason.trim().length > LIMITS.rejectReason.max;
  return (
    <Section title={`Rechazar a ${name}`} tone="warn">
      <form className="fx-form" onSubmit={(event) => { event.preventDefault(); if (!tooLong) onSubmit(reason.trim() || null); }} noValidate>
        <p className="fx-muted">
          El candidato recibirá el aviso de que ya no sigue en el proceso. El motivo es una nota interna: <strong>el candidato no lo ve</strong>.
          {hasPendingOffer && ' La oferta pendiente se retirará.'}
          {accepted && ' La oferta aceptada se conserva como constancia.'}
        </p>
        <Field label="Motivo interno (opcional)" error={tooLong ? `Máximo ${LIMITS.rejectReason.max} caracteres.` : undefined}>
          {(props) => <textarea {...props} rows={2} value={reason} autoFocus onChange={(event) => setReason(event.target.value)} />}
        </Field>
        <div className="fx-inline-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>No rechazar</button>
          <button className="primary-button fx-danger-solid" type="submit" disabled={disabled || tooLong}>{busy ? 'Rechazando…' : 'Sí, rechazar'}</button>
        </div>
      </form>
    </Section>
  );
}

function HireConfirm({ name, posting, onConfirm, onCancel, disabled, busy }: { name: string; posting: PostingRecord | null; onConfirm: () => void; onCancel: () => void; disabled: boolean; busy: boolean }) {
  const free = posting ? posting.vacancies - posting.filledVacancies : null;
  return (
    <Section title={`Confirmar la contratación de ${name}`}>
      <p className="fx-muted">
        Confirmas que {name} ingresa a la empresa con las condiciones aceptadas. Esto ocupa una vacante
        {posting && free !== null ? ` (${posting.filledVacancies} de ${posting.vacancies} cubiertas; quedan ${free})` : ''} y no se puede deshacer.
        {posting && free === 1 ? ' Es la última vacante: el puesto pasará a «Cubierto» y las demás ofertas sin responder se retirarán.' : ''}
      </p>
      <div className="fx-inline-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>Volver</button>
        <button className="primary-button" type="button" data-autofocus autoFocus onClick={onConfirm} disabled={disabled}>{busy ? 'Confirmando…' : 'Sí, confirmar contratación'}</button>
      </div>
    </Section>
  );
}

function OfferForm({ applicationId, last, posting, onIssued, onFailure, onCancel, disabled }: {
  applicationId: string;
  last: OfferRecord | null;
  posting: PostingRecord | null;
  onIssued: (result: ApplicationDetail, idempotent: boolean) => void;
  onFailure: (error: DescribedError | null) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const { token, currency, onUnauthorized } = useJobs();
  const [values, setValues] = useState<OfferFormValues>(() => ({
    salary: last ? centsToSolesInput(last.salaryCents) : posting ? centsToSolesInput(posting.salary.maxCents) : '',
    contractType: last?.contractType ?? posting?.contractType ?? ('INDEFINITE' as ContractType),
    startDate: '',
    note: '',
  }));
  const [errors, setErrors] = useState<FieldErrors<keyof OfferFormValues | 'file'>>({});
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<UploadedOfferDocument | null>(null);
  const [step, setStep] = useState<'idle' | 'uploading' | 'sending'>('idle');
  const fileInput = useRef<HTMLInputElement>(null);
  const working = step !== 'idle';

  function pickFile(next: File | null) {
    setUploaded(null);
    if (!next) {
      setFile(null);
      setErrors((current) => ({ ...current, file: undefined }));
      return;
    }
    const problem = validateOfferPdf(next);
    setFile(problem ? null : next);
    setErrors((current) => ({ ...current, file: problem ?? undefined }));
    if (problem && fileInput.current) fileInput.current.value = '';
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    const result = validateOffer(values);
    if (!result.input) {
      setErrors(result.errors);
      return;
    }
    onFailure(null);
    try {
      let document = uploaded;
      if (file && !document) {
        if (!(await looksLikePdf(file))) {
          setErrors((current) => ({ ...current, file: 'El archivo no parece un PDF válido.' }));
          return;
        }
        setStep('uploading');
        document = await jobsApi.applications.uploadOfferDocument(token, applicationId, file);
        setUploaded(document);
      }
      setStep('sending');
      const issued = await jobsApi.applications.issueOffer(token, applicationId, { ...result.input, ...(document ? { documentId: document.id } : {}) });
      onIssued(issued, Boolean(issued.idempotent));
    } catch (error) {
      const described = describeError(error, currency);
      if (described.kind === 'session') {
        onUnauthorized();
        return;
      }
      if (error instanceof ApiError && error.code === 'OFFER_DOCUMENT_NOT_AVAILABLE') {
        setUploaded(null);
        setErrors((current) => ({ ...current, file: 'Hay que adjuntar el PDF de nuevo.' }));
      }
      const issues = fieldIssues(error);
      if (issues.length > 0) {
        const next: FieldErrors<keyof OfferFormValues | 'file'> = {};
        for (const issue of issues) {
          if (issue.path === 'salaryCents') next.salary = 'El servidor no aceptó este sueldo.';
          if (issue.path === 'startDate') next.startDate = 'El servidor no aceptó esta fecha.';
          if (issue.path === 'note') next.note = 'El servidor no aceptó esta nota.';
        }
        setErrors(next);
      }
      onFailure(described);
    } finally {
      setStep('idle');
    }
  }

  return (
    <Section title={last?.status === 'PENDING' ? `Emitir la versión ${last.version + 1} de la oferta` : 'Emitir oferta'}>
      <form className="fx-form" onSubmit={(event) => void submit(event)} noValidate>
        {last?.status === 'PENDING' && <p className="fx-muted">La versión {last.version} quedará reemplazada y el candidato verá solo la nueva.</p>}
        <div className="fx-grid">
          <Field label="Sueldo mensual (S/)" error={errors.salary}>
            {(props) => <input {...props} name="salary" inputMode="decimal" value={values.salary} autoFocus onChange={(event) => { setValues({ ...values, salary: event.target.value }); setErrors({ ...errors, salary: undefined }); }} />}
          </Field>
          <Field label="Tipo de contrato">
            {(props) => (
              <select {...props} value={values.contractType} onChange={(event) => setValues({ ...values, contractType: event.target.value as ContractType })}>
                {Object.entries(CONTRACT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Fecha de ingreso" error={errors.startDate}>
            {(props) => <input {...props} name="startDate" type="date" value={values.startDate} onChange={(event) => { setValues({ ...values, startDate: event.target.value }); setErrors({ ...errors, startDate: undefined }); }} />}
          </Field>
          <Field label="Documento de la oferta (PDF, opcional)" error={errors.file} hint={file ? `${file.name} (${formatFileSize(file.size)})` : 'Hasta 5 MB. Se guarda en la constancia con su huella.'}>
            {(props) => <input {...props} ref={fileInput} type="file" accept="application/pdf,.pdf" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />}
          </Field>
          <Field label="Nota para el candidato (opcional)" error={errors.note} full>
            {(props) => <textarea {...props} rows={2} value={values.note} onChange={(event) => setValues({ ...values, note: event.target.value })} />}
          </Field>
        </div>
        {step === 'uploading' && <p className="fx-muted" role="status">Subiendo el PDF…</p>}
        {step === 'sending' && <p className="fx-muted" role="status">Emitiendo la oferta…</p>}
        {uploaded && step === 'idle' && <p className="fx-muted" role="status"><CheckCircle2 size={14} aria-hidden="true" /> PDF «{uploaded.name}» subido; se usará al reintentar.</p>}
        <div className="fx-inline-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled || working}>Volver</button>
          <button className="primary-button" type="submit" disabled={disabled || working}>{working ? 'Enviando…' : 'Emitir oferta'}</button>
        </div>
      </form>
    </Section>
  );
}

function OffersBlock({ offers, applicationId, workerName }: { offers: OfferRecord[]; applicationId: string; workerName: string }) {
  const { token, onUnauthorized } = useJobs();
  if (offers.length === 0) return null;
  return (
    <section className="fx-block" aria-label="Ofertas">
      <h3><FileText size={16} aria-hidden="true" /> Ofertas</h3>
      <ul className="fx-offers">
        {[...offers].reverse().map((offer) => (
          <li key={offer.id} className={`fx-offer fx-offer-${offer.status.toLowerCase()}`}>
            <div className="fx-offer-head">
              <strong>Versión {offer.version}</strong>
              <StatusPill status={offer.status === 'ACCEPTED' ? 'ACCEPTED' : offer.status === 'DECLINED' ? 'WITHDRAWN' : offer.status === 'PENDING' ? 'OFFER' : 'CLOSED'} label={OFFER_STATUS_LABEL[offer.status]} />
            </div>
            <p>{formatCents(offer.salaryCents, offer.currency)} al mes · {CONTRACT_LABEL[offer.contractType]} · ingreso el {formatCalendarDate(offer.startDate)}</p>
            {offer.note && <p className="fx-muted">Nota: {offer.note}</p>}
            <p className="fx-muted">Emitida el {formatDateTime(offer.createdAt)}{offer.respondedAt ? ` · respuesta ${formatDateTime(offer.respondedAt)}` : ''}</p>
            {offer.document && (
              <PdfButton
                label={`Ver PDF de la versión ${offer.version}`}
                downloadName={offer.document.name}
                fetchBlob={(signal) => jobsApi.applications.offerDocument(token, applicationId, offer.id, signal)}
                onUnauthorized={onUnauthorized}
                note={`${offer.document.name}${offer.document.sizeBytes ? ` · ${formatFileSize(offer.document.sizeBytes)}` : ''}`}
              />
            )}
            {offer.acceptanceSnapshot && <AcceptanceRecord snapshot={offer.acceptanceSnapshot} workerName={workerName} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Constancia de aceptación: la única parte donde aparece el documento de identidad (decisión del dueño). */
function AcceptanceRecord({ snapshot, workerName }: { snapshot: NonNullable<OfferRecord['acceptanceSnapshot']>; workerName: string }) {
  return (
    <div className="fx-acceptance" role="group" aria-label={`Constancia de aceptación de ${workerName}`}>
      <strong><FileCheck2 size={15} aria-hidden="true" /> Constancia de aceptación</strong>
      <dl>
        <div><dt>Aceptada el</dt><dd>{formatDateTime(snapshot.acceptedAt)}</dd></div>
        <div><dt>Empresa</dt><dd>{snapshot.company.legalName ?? snapshot.company.name} · RUC {snapshot.company.ruc}</dd></div>
        <div><dt>Candidato</dt><dd>{snapshot.worker.name} · Documento de identidad {snapshot.worker.identifier}</dd></div>
        <div><dt>Puesto</dt><dd>{snapshot.posting.title} · {MODALITY_LABEL[snapshot.posting.modality]} · {WORKLOAD_LABEL[snapshot.posting.workload]} · {snapshot.posting.location}</dd></div>
        <div><dt>Condiciones</dt><dd>{formatCents(snapshot.conditions.salaryCents, snapshot.conditions.currency)} al mes · {CONTRACT_LABEL[snapshot.conditions.contractType]} · ingreso el {formatCalendarDate(snapshot.conditions.startDate)}{snapshot.conditions.note ? ` · ${snapshot.conditions.note}` : ''}</dd></div>
        {snapshot.document && <div><dt>Documento</dt><dd>{snapshot.document.name} · huella {snapshot.document.sha256 ? `${snapshot.document.sha256.slice(0, 12)}…` : 'no disponible'}</dd></div>}
      </dl>
      <small className="fx-muted">Las condiciones aceptadas quedan congeladas y no se pueden modificar.</small>
    </div>
  );
}
