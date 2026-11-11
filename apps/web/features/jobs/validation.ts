import { limaToday, parseSolesToCents } from './format';
import type { ContractType, InterviewMode, Modality, PostingInput, PostingRecord, Workload } from './jobs-api';

// Validación en el cliente, espejo de la de la API (`jobs.routes.ts`). La API sigue siendo la
// autoridad: esto solo evita viajes inútiles y da el mensaje junto al campo.

export const LIMITS = {
  title: { min: 5, max: 120 },
  description: { min: 20, max: 5000 },
  longText: { max: 3000 },
  location: { min: 2, max: 160 },
  salaryCents: { min: 1, max: 10_000_000 },
  vacancies: { min: 1, max: 500 },
  questions: { max: 5, min: 10, maxLength: 240 },
  offerNote: { max: 1000 },
  interviewNote: { max: 500 },
  rejectReason: { max: 500 },
  inviteMessage: { max: 500 },
  offerPdfBytes: 5 * 1024 * 1024,
} as const;

export type PostingFormValues = {
  title: string;
  description: string;
  responsibilities: string;
  requirements: string;
  benefits: string;
  modality: Modality;
  workload: Workload;
  salaryMin: string;
  salaryMax: string;
  location: string;
  contractType: ContractType;
  expectedStartDate: string;
  vacancies: string;
  screeningQuestions: string[];
};

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

export const EMPTY_POSTING_FORM: PostingFormValues = {
  title: '', description: '', responsibilities: '', requirements: '', benefits: '',
  modality: 'ONSITE', workload: 'FULL_TIME', salaryMin: '', salaryMax: '', location: '',
  contractType: 'INDEFINITE', expectedStartDate: '', vacancies: '1', screeningQuestions: [],
};

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Longitud contada como la cuenta la API: sin espacios al inicio ni al final. */
function size(text: string) {
  return text.trim().length;
}

export type PostingValidation = { errors: FieldErrors<keyof PostingFormValues | 'salary'>; input: PostingInput | null };

/**
 * Valida el formulario de puesto con las mismas reglas de la API y, si pasa, arma el cuerpo. `filled` es
 * lo ya cubierto del puesto que se edita (el total de vacantes debe superarlo).
 */
export function validatePosting(values: PostingFormValues, options: { filled?: number } = {}): PostingValidation {
  const errors: FieldErrors<keyof PostingFormValues | 'salary'> = {};
  const { title, description, location } = LIMITS;
  if (size(values.title) < title.min || size(values.title) > title.max) errors.title = `El título debe tener entre ${title.min} y ${title.max} caracteres.`;
  if (size(values.description) < description.min || size(values.description) > description.max) {
    errors.description = `La descripción debe tener entre ${description.min} y ${description.max} caracteres.`;
  }
  for (const field of ['responsibilities', 'requirements', 'benefits'] as const) {
    if (size(values[field]) > LIMITS.longText.max) errors[field] = `Máximo ${LIMITS.longText.max} caracteres.`;
  }
  if (size(values.location) < location.min || size(values.location) > location.max) errors.location = `La ubicación debe tener entre ${location.min} y ${location.max} caracteres.`;

  const min = parseSolesToCents(values.salaryMin);
  const max = parseSolesToCents(values.salaryMax);
  const { min: centsMin, max: centsMax } = LIMITS.salaryCents;
  if (min === null || min < centsMin || min > centsMax) errors.salaryMin = 'Ingresa el sueldo mensual mínimo en soles (hasta S/ 100 000).';
  if (max === null || max < centsMin || max > centsMax) errors.salaryMax = 'Ingresa el sueldo mensual máximo en soles (hasta S/ 100 000).';
  if (!errors.salaryMin && !errors.salaryMax && min !== null && max !== null && min > max) errors.salaryMax = 'El máximo no puede ser menor que el mínimo.';

  const vacancies = /^\d+$/.test(values.vacancies.trim()) ? Number(values.vacancies.trim()) : NaN;
  if (!Number.isInteger(vacancies) || vacancies < LIMITS.vacancies.min || vacancies > LIMITS.vacancies.max) {
    errors.vacancies = `Las vacantes deben ser un número entre ${LIMITS.vacancies.min} y ${LIMITS.vacancies.max}.`;
  } else if (options.filled !== undefined && vacancies <= options.filled) {
    errors.vacancies = `Ya hay ${options.filled} ${options.filled === 1 ? 'vacante cubierta' : 'vacantes cubiertas'}: el total debe ser mayor.`;
  }

  if (values.expectedStartDate) {
    if (!isValidCalendarDate(values.expectedStartDate)) errors.expectedStartDate = 'Ingresa una fecha válida.';
    else if (values.expectedStartDate < limaToday()) errors.expectedStartDate = 'La fecha de ingreso no puede estar en el pasado.';
  }

  const questions = values.screeningQuestions.map((question) => question.trim());
  if (questions.length > LIMITS.questions.max) errors.screeningQuestions = `Máximo ${LIMITS.questions.max} preguntas.`;
  else if (questions.some((question) => question.length < LIMITS.questions.min || question.length > LIMITS.questions.maxLength)) {
    errors.screeningQuestions = `Cada pregunta debe tener entre ${LIMITS.questions.min} y ${LIMITS.questions.maxLength} caracteres (quita las vacías).`;
  } else if (new Set(questions).size !== questions.length) errors.screeningQuestions = 'Hay preguntas repetidas.';

  if (Object.keys(errors).length > 0 || min === null || max === null) return { errors, input: null };
  return {
    errors,
    input: {
      title: values.title.trim(),
      description: values.description.trim(),
      responsibilities: values.responsibilities.trim() || null,
      requirements: values.requirements.trim() || null,
      benefits: values.benefits.trim() || null,
      modality: values.modality,
      workload: values.workload,
      salaryMinCents: min,
      salaryMaxCents: max,
      location: values.location.trim(),
      contractType: values.contractType,
      expectedStartDate: values.expectedStartDate || null,
      vacancies,
      screeningQuestions: questions,
    },
  };
}

/** Cuerpo del `PATCH`: solo lo que cambió respecto del puesto cargado. */
export function postingPatch(original: PostingRecord, input: PostingInput): Partial<PostingInput> {
  const patch: Partial<PostingInput> = {};
  if (input.title !== original.title) patch.title = input.title;
  if (input.description !== original.description) patch.description = input.description;
  for (const field of ['responsibilities', 'requirements', 'benefits'] as const) {
    if ((input[field] ?? null) !== (original[field] ?? null)) patch[field] = input[field] ?? null;
  }
  if (input.modality !== original.modality) patch.modality = input.modality;
  if (input.workload !== original.workload) patch.workload = input.workload;
  if (input.salaryMinCents !== original.salary.minCents) patch.salaryMinCents = input.salaryMinCents;
  if (input.salaryMaxCents !== original.salary.maxCents) patch.salaryMaxCents = input.salaryMaxCents;
  if (input.location !== original.location) patch.location = input.location;
  if (input.contractType !== original.contractType) patch.contractType = input.contractType;
  if ((input.expectedStartDate ?? null) !== (original.expectedStartDate?.slice(0, 10) ?? null)) patch.expectedStartDate = input.expectedStartDate ?? null;
  if (input.vacancies !== original.vacancies) patch.vacancies = input.vacancies;
  const before = original.screeningQuestions;
  const after = input.screeningQuestions ?? [];
  if (before.length !== after.length || before.some((question, index) => question !== after[index])) patch.screeningQuestions = after;
  return patch;
}

export function valuesFromPosting(posting: PostingRecord): PostingFormValues {
  return {
    title: posting.title,
    description: posting.description,
    responsibilities: posting.responsibilities ?? '',
    requirements: posting.requirements ?? '',
    benefits: posting.benefits ?? '',
    modality: posting.modality,
    workload: posting.workload,
    salaryMin: String(posting.salary.minCents / 100),
    salaryMax: String(posting.salary.maxCents / 100),
    location: posting.location,
    contractType: posting.contractType,
    expectedStartDate: posting.expectedStartDate?.slice(0, 10) ?? '',
    vacancies: String(posting.vacancies),
    screeningQuestions: [...posting.screeningQuestions],
  };
}

// ---- Oferta, entrevista y rechazo -------------------------------------------------------------------

export type OfferFormValues = { salary: string; contractType: ContractType; startDate: string; note: string };
export type OfferValidation = { errors: FieldErrors<keyof OfferFormValues>; input: { salaryCents: number; contractType: ContractType; startDate: string; note: string | null } | null };

export function validateOffer(values: OfferFormValues): OfferValidation {
  const errors: FieldErrors<keyof OfferFormValues> = {};
  const salary = parseSolesToCents(values.salary);
  if (salary === null || salary < LIMITS.salaryCents.min || salary > LIMITS.salaryCents.max) errors.salary = 'Ingresa el sueldo mensual en soles (hasta S/ 100 000).';
  if (!values.startDate) errors.startDate = 'Indica la fecha de ingreso.';
  else if (!isValidCalendarDate(values.startDate)) errors.startDate = 'Ingresa una fecha válida.';
  else if (values.startDate < limaToday()) errors.startDate = 'La fecha de ingreso no puede estar en el pasado.';
  if (size(values.note) > LIMITS.offerNote.max) errors.note = `Máximo ${LIMITS.offerNote.max} caracteres.`;
  if (Object.keys(errors).length > 0 || salary === null) return { errors, input: null };
  return { errors, input: { salaryCents: salary, contractType: values.contractType, startDate: values.startDate, note: values.note.trim() || null } };
}

const MAX_INTERVIEW_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

export type InterviewFormValues = { scheduledAt: string; mode: InterviewMode | ''; note: string };

export function validateInterview(values: InterviewFormValues, now: Date = new Date()): { errors: FieldErrors<keyof InterviewFormValues>; iso: string | null } {
  const errors: FieldErrors<keyof InterviewFormValues> = {};
  const parsed = values.scheduledAt ? new Date(values.scheduledAt) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) errors.scheduledAt = 'Elige la fecha y hora de la entrevista.';
  else if (parsed.getTime() <= now.getTime()) errors.scheduledAt = 'La entrevista debe ser en el futuro.';
  else if (parsed.getTime() > now.getTime() + MAX_INTERVIEW_HORIZON_MS) errors.scheduledAt = 'La entrevista debe ser dentro del próximo año.';
  if (size(values.note) > LIMITS.interviewNote.max) errors.note = `Máximo ${LIMITS.interviewNote.max} caracteres.`;
  return { errors, iso: Object.keys(errors).length === 0 && parsed ? parsed.toISOString() : null };
}

export function validateOfferPdf(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf')) return 'El documento debe ser un archivo PDF (.pdf).';
  if (file.name.length > 180) return 'El nombre del archivo es demasiado largo.';
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > LIMITS.offerPdfBytes) return 'El PDF supera los 5 MB permitidos.';
  return null;
}

/** La API verifica la firma `%PDF-`; se comprueba antes de subir para no gastar el intento. */
export async function looksLikePdf(file: File): Promise<boolean> {
  const head = await file.slice(0, 5).text();
  return head === '%PDF-';
}
