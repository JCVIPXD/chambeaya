import type { ApplicationStatus, ContractType, InterviewMode, Modality, OfferStatus, PostingStatus, Workload } from './jobs-api';

// Textos en español de los enums de la API. Los valores técnicos nunca se muestran tal cual.

export const POSTING_STATUS_LABEL: Record<PostingStatus, string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicado',
  PAUSED: 'En pausa',
  CLOSED: 'Cerrado',
  FILLED: 'Cubierto',
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  APPLIED: 'Postulado',
  SHORTLISTED: 'Preseleccionado',
  INTERVIEW: 'Entrevista',
  OFFER: 'Oferta',
  ACCEPTED: 'Aceptada',
  HIRED: 'Contratado',
  REJECTED: 'Rechazado',
  WITHDRAWN: 'Retirado',
};

/** Etapas del embudo en orden, y las dos salidas. */
export const FUNNEL_STAGES: ApplicationStatus[] = ['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'HIRED'];
export const EXIT_STAGES: ApplicationStatus[] = ['REJECTED', 'WITHDRAWN'];

export const MODALITY_LABEL: Record<Modality, string> = { ONSITE: 'Presencial', REMOTE: 'Remoto', HYBRID: 'Híbrido' };
export const WORKLOAD_LABEL: Record<Workload, string> = { FULL_TIME: 'Tiempo completo', PART_TIME: 'Tiempo parcial' };
export const CONTRACT_LABEL: Record<ContractType, string> = {
  INDEFINITE: 'Plazo indefinido',
  FIXED_TERM: 'Plazo fijo',
  INTERNSHIP: 'Prácticas',
  OTHER: 'Otro',
};
export const INTERVIEW_MODE_LABEL: Record<InterviewMode, string> = { ONSITE: 'Presencial', VIDEO: 'Videollamada', PHONE: 'Llamada' };
export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  PENDING: 'Pendiente de respuesta',
  ACCEPTED: 'Aceptada',
  DECLINED: 'Rechazada por el candidato',
  WITHDRAWN: 'Retirada',
  SUPERSEDED: 'Reemplazada por otra versión',
};

export const EVENT_LABEL: Record<string, string> = {
  APPLIED: 'Postuló al puesto',
  SHORTLISTED: 'Preseleccionado',
  INTERVIEW_SCHEDULED: 'Entrevista programada',
  OFFER_ISSUED: 'Oferta emitida',
  OFFER_ACCEPTED: 'Oferta aceptada por el candidato',
  OFFER_DECLINED: 'Oferta rechazada por el candidato',
  HIRED: 'Contratación confirmada',
  REJECTED: 'Rechazado por la empresa',
  WITHDRAWN: 'El candidato se retiró',
  APPLICATION_REOPENED: 'Volvió a postular',
};

/** Acciones de la moneda virtual (claves estables del catálogo) en lenguaje de producto. */
export const ACTION_LABEL: Record<string, string> = {
  JOB_PUBLISH_EXTRA: 'Publicar puesto fuera de la cuota gratuita',
  JOB_HIGHLIGHT: 'Destacar un puesto',
  TALENT_INVITE: 'Invitar a un candidato',
  CANDIDATE_CONTACT_UNLOCK: 'Desbloquear contacto y CV',
  COMPANY_VERIFIED: 'Empresa verificada',
  APPLICANTS_RESPONDED_ON_TIME: 'Responder postulantes a tiempo',
  HIRE_CONFIRMED: 'Confirmar una contratación',
  WELCOME_BONUS: 'Bono de bienvenida',
  APPLICATION_EXTRA: 'Postulación adicional',
  APPLICATION_PRIORITY: 'Postulación con prioridad',
  PROFILE_HIGHLIGHT: 'Destacar el perfil',
  PROFILE_COMPLETE: 'Perfil completo',
  DOCUMENT_VERIFIED: 'Documento verificado',
  INVITATION_RESPONDED: 'Invitación respondida',
  REFERRAL: 'Referido',
};

/** Cómo se gana cada premio de la empresa (condición visible en la Billetera). */
export const REWARD_CONDITION: Record<string, string> = {
  COMPANY_VERIFIED: 'Cuando el equipo de Chambeaya verifica tu empresa.',
  APPLICANTS_RESPONDED_ON_TIME: 'Cada vez que respondes a un postulante (preseleccionas, entrevistas, ofreces o rechazas) dentro del plazo.',
  HIRE_CONFIRMED: 'Cada vez que confirmas una contratación.',
  WELCOME_BONUS: 'Al crear la cuenta de la empresa.',
};

export function actionLabel(actionKey: string | null | undefined): string {
  if (!actionKey) return 'Movimiento';
  return ACTION_LABEL[actionKey] ?? actionKey;
}

export function movementTypeLabel(action: string): string {
  switch (action) {
    case 'ACTION_CHARGE': return 'Gasto';
    case 'ACTION_REFUND': return 'Devolución';
    case 'REWARD': return 'Premio';
    case 'ADMIN_ADJUSTMENT': return 'Ajuste de Chambeaya';
    default: return action;
  }
}
