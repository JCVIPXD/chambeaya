export type OperationalShiftStatus = 'PUBLISHED' | 'ASSIGNED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
export type OperationalApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED';
export type OperationalAssignmentStatus = 'ASSIGNED' | 'CANCELLED' | 'COMPLETED';

export interface AssignmentSnapshot {
  status: OperationalAssignmentStatus;
  workerConfirmedAt?: Date | string | null;
  checkedInAt?: Date | string | null;
  checkedOutAt?: Date | string | null;
}

export type OperationalActionCode =
  | 'REVIEW_APPLICATION'
  | 'CONFIRM_ASSIGNMENT'
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'NONE';

export interface OperationalAction {
  actor: 'BUSINESS' | 'WORKER' | 'NONE';
  code: OperationalActionCode;
  label: string;
}

export function isTerminalShift(status: OperationalShiftStatus) {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

/**
 * Derives the aggregate shift state from persisted assignments. A multi-seat
 * shift stays in progress after the first check-in until every non-cancelled
 * assignment has completed.
 */
export function deriveShiftStatus(
  current: OperationalShiftStatus,
  requiredWorkers: number,
  assignments: AssignmentSnapshot[],
): OperationalShiftStatus {
  if (current === 'CANCELLED') return 'CANCELLED';

  const effective = assignments.filter((assignment) => assignment.status !== 'CANCELLED');
  if (effective.length >= requiredWorkers && effective.every((assignment) => assignment.status === 'COMPLETED')) {
    return 'COMPLETED';
  }
  if (effective.some((assignment) => assignment.checkedInAt != null || assignment.status === 'COMPLETED')) {
    return 'CHECKED_IN';
  }

  const assigned = effective.filter((assignment) => assignment.status === 'ASSIGNED').length;
  return assigned >= requiredWorkers ? 'ASSIGNED' : 'PUBLISHED';
}

export function nextOperationalAction(input: {
  shiftStatus: OperationalShiftStatus;
  applicationStatus: OperationalApplicationStatus;
  assignment?: AssignmentSnapshot | null;
}): OperationalAction {
  const { shiftStatus, applicationStatus, assignment } = input;
  if (isTerminalShift(shiftStatus) || ['REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(applicationStatus)) {
    return { actor: 'NONE', code: 'NONE', label: 'Proceso cerrado' };
  }
  if (applicationStatus === 'PENDING') {
    return { actor: 'BUSINESS', code: 'REVIEW_APPLICATION', label: 'Revisa la postulación y decide si continúa' };
  }
  if (!assignment || assignment.status !== 'ASSIGNED') {
    return { actor: 'NONE', code: 'NONE', label: 'Proceso cerrado' };
  }
  if (assignment.workerConfirmedAt == null) {
    return { actor: 'WORKER', code: 'CONFIRM_ASSIGNMENT', label: 'Confirma tu asistencia al turno' };
  }
  if (assignment.checkedInAt == null) {
    return { actor: 'WORKER', code: 'CHECK_IN', label: 'Registra tu llegada en la sede' };
  }
  if (assignment.checkedOutAt == null) {
    return { actor: 'WORKER', code: 'CHECK_OUT', label: 'Registra tu salida al terminar' };
  }
  return { actor: 'NONE', code: 'NONE', label: 'Turno finalizado; revisa el pago reportado' };
}
