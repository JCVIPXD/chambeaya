import type { JobApplicationStatus } from './job-state.js';

export type JobApplicationEventKind =
  | 'APPLIED' | 'SHORTLISTED' | 'INTERVIEW_SCHEDULED' | 'OFFER_ISSUED' | 'OFFER_ACCEPTED'
  | 'OFFER_DECLINED' | 'HIRED' | 'REJECTED' | 'WITHDRAWN' | 'APPLICATION_REOPENED';

export type JobEventNotification = {
  type: JobApplicationEventKind;
  applicationId: string;
  postingId: string;
  status: JobApplicationStatus;
  /** Cuenta que debe enterarse (la contraparte de quien hizo el cambio). */
  recipientUserId: string;
  at: string;
};

export type JobEventListener = (event: JobEventNotification) => void;

/**
 * Bus en proceso para avisar en tiempo real de cambios de una postulación,
 * con el mismo patrón que `marketplaceShiftEvents` (el feed SSE de turnos):
 * suscripción por oyente, publicación síncrona. Aquí cada aviso lleva un
 * destinatario, y el endpoint SSE solo reenvía a su dueño.
 */
export class JobEvents {
  private readonly listeners = new Set<JobEventListener>();

  subscribe(listener: JobEventListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(event: JobEventNotification) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* un oyente roto no debe afectar a los demás ni a la operación */ }
    }
  }

  get subscriberCount() {
    return this.listeners.size;
  }
}

export const jobEvents = new JobEvents();
