'use client';

import type { FormEvent } from 'react';
import { useRef, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';

import { ApiError } from '../../lib/business-api';
import { describeError, fieldIssues, type DescribedError } from './errors';
import { limaToday } from './format';
import { useJobs } from './jobs-context';
import { jobsApi, type PostingRecord } from './jobs-api';
import { CONTRACT_LABEL, MODALITY_LABEL, WORKLOAD_LABEL } from './labels';
import { Modal, Field, RetryButton } from './ui';
import {
  EMPTY_POSTING_FORM,
  LIMITS,
  postingPatch,
  validatePosting,
  valuesFromPosting,
  type FieldErrors,
  type PostingFormValues,
} from './validation';

type FormErrors = FieldErrors<keyof PostingFormValues | 'salary'>;

// Campos del API (zod) -> campos del formulario, para mostrar el error del servidor junto al campo.
const API_FIELD: Record<string, keyof PostingFormValues> = {
  title: 'title', description: 'description', responsibilities: 'responsibilities', requirements: 'requirements',
  benefits: 'benefits', modality: 'modality', workload: 'workload', salaryMinCents: 'salaryMin', salaryMaxCents: 'salaryMax',
  location: 'location', contractType: 'contractType', expectedStartDate: 'expectedStartDate', vacancies: 'vacancies',
  screeningQuestions: 'screeningQuestions',
};

const FIELD_ORDER: Array<keyof PostingFormValues> = [
  'title', 'description', 'responsibilities', 'requirements', 'benefits', 'modality', 'workload', 'contractType',
  'salaryMin', 'salaryMax', 'location', 'expectedStartDate', 'vacancies', 'screeningQuestions',
];

/** Crear o editar un puesto (borrador o en pausa) con todos sus campos y validación espejo de la API. */
export function PostingFormModal({ posting, onClose, onSaved }: {
  posting: PostingRecord | null;
  onClose: () => void;
  onSaved: (posting: PostingRecord, created: boolean) => void;
}) {
  const { token, toast, onUnauthorized } = useJobs();
  const [values, setValues] = useState<PostingFormValues>(() => (posting ? valuesFromPosting(posting) : EMPTY_POSTING_FORM));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<DescribedError | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const editing = posting !== null;
  const hasApplications = (posting?.applicationsCount ?? 0) > 0;

  function set<K extends keyof PostingFormValues>(key: K, value: PostingFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function focusFirst(next: FormErrors) {
    const first = FIELD_ORDER.find((field) => next[field]);
    if (!first) return;
    window.requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus());
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (saving) return;
    const result = validatePosting(values, { filled: posting?.filledVacancies });
    if (!result.input) {
      setErrors(result.errors);
      focusFirst(result.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      if (posting) {
        const patch = postingPatch(posting, result.input);
        if (Object.keys(patch).length === 0) {
          toast('No hay cambios para guardar.');
          onClose();
          return;
        }
        const saved = await jobsApi.postings.update(token, posting.id, patch);
        toast('Puesto actualizado.');
        onSaved({ ...posting, ...saved }, false);
      } else {
        const saved = await jobsApi.postings.create(token, result.input);
        toast('Borrador guardado. Publícalo cuando esté listo.');
        onSaved(saved, true);
      }
    } catch (error) {
      const described = describeError(error);
      if (described.kind === 'session') {
        onUnauthorized();
        return;
      }
      const issues = fieldIssues(error);
      if (issues.length > 0) {
        const next: FormErrors = {};
        for (const issue of issues) {
          const field = API_FIELD[issue.path];
          if (field && !next[field]) next[field] = issue.message && !/^[A-Z_]+$/.test(issue.message) ? issue.message : 'El servidor no aceptó este valor.';
        }
        setErrors(next);
        focusFirst(next);
        setFailure(Object.keys(next).length > 0 ? null : described);
      } else if (error instanceof ApiError && (error.code === 'INVALID_SALARY_RANGE' || error.code === 'VACANCIES_BELOW_FILLED')) {
        const field = error.code === 'INVALID_SALARY_RANGE' ? 'salaryMax' : 'vacancies';
        setErrors({ [field]: described.message });
        focusFirst({ [field]: described.message });
      } else {
        setFailure(described);
      }
    } finally {
      setSaving(false);
    }
  }

  const questions = values.screeningQuestions;
  return (
    <Modal
      title={editing ? 'Editar puesto' : 'Nuevo puesto'}
      description={editing ? 'Los cambios se aplican a tu borrador o puesto en pausa.' : 'Se guarda como borrador. Podrás revisarlo y publicarlo después.'}
      onClose={onClose}
      busy={saving}
      size="lg"
    >
      <form ref={form} className="fx-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="fx-grid">
          <Field label="Título del puesto" error={errors.title} full>
            {(props) => <input {...props} name="title" value={values.title} maxLength={LIMITS.title.max + 40} onChange={(event) => set('title', event.target.value)} placeholder="Cajera de tienda de ropa" autoComplete="off" />}
          </Field>
          <Field label="Descripción" error={errors.description} hint={`${values.description.trim().length} / ${LIMITS.description.max}`} full>
            {(props) => <textarea {...props} name="description" rows={5} value={values.description} onChange={(event) => set('description', event.target.value)} placeholder="Qué hará la persona, en qué equipo y con qué herramientas." />}
          </Field>
          <Field label="Responsabilidades (opcional)" error={errors.responsibilities} full>
            {(props) => <textarea {...props} name="responsibilities" rows={3} value={values.responsibilities} onChange={(event) => set('responsibilities', event.target.value)} />}
          </Field>
          <Field label="Requisitos (opcional)" error={errors.requirements} full>
            {(props) => <textarea {...props} name="requirements" rows={3} value={values.requirements} onChange={(event) => set('requirements', event.target.value)} />}
          </Field>
          <Field label="Beneficios (opcional)" error={errors.benefits} full>
            {(props) => <textarea {...props} name="benefits" rows={3} value={values.benefits} onChange={(event) => set('benefits', event.target.value)} />}
          </Field>
          <Field label="Modalidad" error={errors.modality}>
            {(props) => (
              <select {...props} name="modality" value={values.modality} onChange={(event) => set('modality', event.target.value as PostingFormValues['modality'])}>
                {Object.entries(MODALITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Jornada" error={errors.workload}>
            {(props) => (
              <select {...props} name="workload" value={values.workload} onChange={(event) => set('workload', event.target.value as PostingFormValues['workload'])}>
                {Object.entries(WORKLOAD_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Tipo de contrato" error={errors.contractType}>
            {(props) => (
              <select {...props} name="contractType" value={values.contractType} onChange={(event) => set('contractType', event.target.value as PostingFormValues['contractType'])}>
                {Object.entries(CONTRACT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Ubicación" error={errors.location}>
            {(props) => <input {...props} name="location" value={values.location} onChange={(event) => set('location', event.target.value)} placeholder="Miraflores, Lima" autoComplete="off" />}
          </Field>
          <Field label="Sueldo mensual mínimo (S/)" error={errors.salaryMin}>
            {(props) => <input {...props} name="salaryMin" inputMode="decimal" value={values.salaryMin} onChange={(event) => set('salaryMin', event.target.value)} placeholder="1500" autoComplete="off" />}
          </Field>
          <Field label="Sueldo mensual máximo (S/)" error={errors.salaryMax}>
            {(props) => <input {...props} name="salaryMax" inputMode="decimal" value={values.salaryMax} onChange={(event) => set('salaryMax', event.target.value)} placeholder="2000" autoComplete="off" />}
          </Field>
          <Field label="Fecha de ingreso prevista (opcional)" error={errors.expectedStartDate}>
            {(props) => <input {...props} name="expectedStartDate" type="date" min={limaToday()} value={values.expectedStartDate} onChange={(event) => set('expectedStartDate', event.target.value)} />}
          </Field>
          <Field
            label="Vacantes"
            error={errors.vacancies}
            hint={editing && posting.filledVacancies > 0 ? `Ya cubiertas: ${posting.filledVacancies}. El total debe ser mayor.` : undefined}
          >
            {(props) => <input {...props} name="vacancies" inputMode="numeric" value={values.vacancies} onChange={(event) => set('vacancies', event.target.value)} />}
          </Field>
        </div>

        <fieldset className="fx-fieldset" disabled={hasApplications} aria-describedby="fx-questions-note">
          <legend>Preguntas de filtro (opcional, hasta {LIMITS.questions.max})</legend>
          <p id="fx-questions-note" className="fx-muted">
            {hasApplications
              ? 'Este puesto ya tiene postulaciones: las preguntas de filtro no se pueden cambiar.'
              : `Cada candidato las responde al postular. Entre ${LIMITS.questions.min} y ${LIMITS.questions.maxLength} caracteres, sin repetir.`}
          </p>
          {questions.map((question, index) => (
            <div className="fx-question-row" key={index}>
              <input
                name={index === 0 ? 'screeningQuestions' : undefined}
                aria-label={`Pregunta de filtro ${index + 1}`}
                aria-invalid={Boolean(errors.screeningQuestions)}
                value={question}
                maxLength={LIMITS.questions.maxLength + 40}
                onChange={(event) => set('screeningQuestions', questions.map((current, at) => (at === index ? event.target.value : current)))}
              />
              <button className="icon-button" type="button" aria-label={`Quitar la pregunta ${index + 1}`} onClick={() => set('screeningQuestions', questions.filter((_, at) => at !== index))}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          {errors.screeningQuestions && <small className="fx-field-error" role="alert">{errors.screeningQuestions}</small>}
          {questions.length < LIMITS.questions.max && (
            <button className="secondary-button fx-small-button" type="button" onClick={() => set('screeningQuestions', [...questions, ''])}>
              <Plus size={15} aria-hidden="true" /> Agregar pregunta
            </button>
          )}
        </fieldset>

        {failure && (
          <div className={`fx-callout ${failure.kind === 'retry' ? 'fx-callout-warn' : 'fx-callout-bad'}`} role="alert">
            <p>{failure.message}</p>
            {failure.kind === 'retry' && <RetryButton onRetry={() => void submit()} seconds={failure.retryAfterSeconds} label="Reintentar guardado" busy={saving} />}
          </div>
        )}
        {Object.values(errors).some(Boolean) && <p className="fx-muted" role="status">Revisa los campos marcados antes de guardar.</p>}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={saving}>
            <Save size={16} aria-hidden="true" /> {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar borrador'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
