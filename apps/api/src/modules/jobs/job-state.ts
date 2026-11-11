/**
 * Máquinas de estado de M3 (puestos fijos), centralizadas como
 * `operations/shift-state.ts`: funciones puras, sin acceso a base de datos.
 * El servicio las consulta SIEMPRE dentro de la transacción, sobre el estado
 * releído con la fila bloqueada, de modo que la decisión no se tome con una
 * lectura obsoleta.
 */

export type JobApplicationStatus =
  | 'APPLIED' | 'SHORTLISTED' | 'INTERVIEW' | 'OFFER' | 'ACCEPTED' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export type JobPostingStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'CLOSED' | 'FILLED';
export type JobActor = 'COMPANY' | 'WORKER';

export const JOB_APPLICATION_STATUSES: readonly JobApplicationStatus[] = [
  'APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'HIRED', 'REJECTED', 'WITHDRAWN',
];

/**
 * Transiciones válidas por actor. La empresa avanza (puede saltarse etapas
 * intermedias hacia la entrevista o la oferta) o rechaza; el trabajador se
 * retira, o acepta la oferta. Rechazar una oferta es una retirada del
 * trabajador (`WITHDRAWN`): `REJECTED` es siempre una decisión de la empresa.
 * `ACCEPTED -> HIRED` solo la confirma la empresa, nunca el trabajador.
 */
const TRANSITIONS: Readonly<Record<JobApplicationStatus, Readonly<Record<JobActor, readonly JobApplicationStatus[]>>>> = {
  APPLIED: { COMPANY: ['SHORTLISTED', 'INTERVIEW', 'OFFER', 'REJECTED'], WORKER: ['WITHDRAWN'] },
  SHORTLISTED: { COMPANY: ['INTERVIEW', 'OFFER', 'REJECTED'], WORKER: ['WITHDRAWN'] },
  INTERVIEW: { COMPANY: ['OFFER', 'REJECTED'], WORKER: ['WITHDRAWN'] },
  OFFER: { COMPANY: ['REJECTED'], WORKER: ['ACCEPTED', 'WITHDRAWN'] },
  ACCEPTED: { COMPANY: ['HIRED', 'REJECTED'], WORKER: ['WITHDRAWN'] },
  HIRED: { COMPANY: [], WORKER: [] },
  REJECTED: { COMPANY: [], WORKER: [] },
  WITHDRAWN: { COMPANY: [], WORKER: [] },
};

export const TERMINAL_APPLICATION_STATUSES: readonly JobApplicationStatus[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];
/** Etapas en las que se puede emitir (o reemitir) una oferta. */
export const OFFERABLE_STATUSES: readonly JobApplicationStatus[] = ['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER'];
/** Etapas en las que se puede programar o reprogramar una entrevista. */
export const INTERVIEWABLE_STATUSES: readonly JobApplicationStatus[] = ['APPLIED', 'SHORTLISTED', 'INTERVIEW'];

export function isTerminalApplication(status: JobApplicationStatus) {
  return TERMINAL_APPLICATION_STATUSES.includes(status);
}

export type TransitionDecision =
  | { kind: 'MOVE' }
  /** Ya está en el estado pedido por un actor que puede llegar a él: repetir la petición no cambia nada. */
  | { kind: 'IDEMPOTENT' }
  | { kind: 'INVALID' };

export function canTransition(from: JobApplicationStatus, to: JobApplicationStatus, actor: JobActor) {
  return TRANSITIONS[from][actor].includes(to);
}

/** `true` si `actor` puede alcanzar `status` desde algún estado (base de la idempotencia). */
function isTargetFor(status: JobApplicationStatus, actor: JobActor) {
  return JOB_APPLICATION_STATUSES.some((from) => TRANSITIONS[from][actor].includes(status));
}

export function resolveApplicationTransition(from: JobApplicationStatus, to: JobApplicationStatus, actor: JobActor): TransitionDecision {
  if (from === to) return isTargetFor(to, actor) ? { kind: 'IDEMPOTENT' } : { kind: 'INVALID' };
  return canTransition(from, to, actor) ? { kind: 'MOVE' } : { kind: 'INVALID' };
}

export function canIssueOffer(status: JobApplicationStatus) {
  return OFFERABLE_STATUSES.includes(status);
}

export function canScheduleInterview(status: JobApplicationStatus) {
  return INTERVIEWABLE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Puesto
// ---------------------------------------------------------------------------

export type JobPostingAction = 'PUBLISH' | 'PAUSE' | 'CLOSE' | 'FILL';

const POSTING_TRANSITIONS: Readonly<Record<JobPostingAction, { to: JobPostingStatus; from: readonly JobPostingStatus[] }>> = {
  PUBLISH: { to: 'PUBLISHED', from: ['DRAFT', 'PAUSED'] },
  PAUSE: { to: 'PAUSED', from: ['PUBLISHED'] },
  CLOSE: { to: 'CLOSED', from: ['DRAFT', 'PUBLISHED', 'PAUSED'] },
  /** Solo la dispara la última contratación confirmada; no hay ruta pública. */
  FILL: { to: 'FILLED', from: ['PUBLISHED', 'PAUSED'] },
};

export function resolvePostingTransition(from: JobPostingStatus, action: JobPostingAction): TransitionDecision & { to: JobPostingStatus } {
  const rule = POSTING_TRANSITIONS[action];
  if (from === rule.to && action !== 'FILL') return { kind: 'IDEMPOTENT', to: rule.to };
  return rule.from.includes(from) ? { kind: 'MOVE', to: rule.to } : { kind: 'INVALID', to: rule.to };
}

/** Un trabajador solo puede postular a un puesto publicado. */
export function postingAcceptsApplications(status: JobPostingStatus) {
  return status === 'PUBLISHED';
}

/** Un puesto solo se publica o recibe postulaciones mientras le queden vacantes libres. */
export function postingHasFreeVacancies(posting: { vacancies: number; filledVacancies: number }) {
  return posting.vacancies > posting.filledVacancies;
}

/** La empresa y el trabajador solo avanzan el proceso mientras el puesto esté vigente (publicado o en pausa). */
export function postingAllowsProgress(status: JobPostingStatus) {
  return status === 'PUBLISHED' || status === 'PAUSED';
}

/** Solo un borrador o un puesto en pausa se edita; uno publicado debe pausarse antes. */
export function postingIsEditable(status: JobPostingStatus) {
  return status === 'DRAFT' || status === 'PAUSED';
}

/**
 * Re-postulación flexible (decisión del dueño del producto): solo quien se
 * retiró (`WITHDRAWN`, incluido el rechazo de una oferta) vuelve a postular al
 * mismo puesto, y se reactiva la MISMA postulación. Quien fue rechazado por la
 * empresa (`REJECTED`) o ya fue contratado no puede.
 */
export function canReopenApplication(status: JobApplicationStatus) {
  return status === 'WITHDRAWN';
}

/** Una postulación con prioridad solo se marca mientras la empresa no la haya movido. */
export function canPrioritizeApplication(status: JobApplicationStatus) {
  return status === 'APPLIED';
}
