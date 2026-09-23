export type OperationalShiftStatus = 'PUBLISHED' | 'ASSIGNED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
export type OperationalApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED';
/**
 * `NO_SHOW` y `ABANDONED` no son transiciones que la aplicación dispare
 * directamente: las calcula `resolveAssignmentLifecycle` la próxima vez que
 * algo toca esa asignación puntual (check-in, check-out, o abrir el turno en
 * el panel de la empresa), nunca por un job en segundo plano.
 */
export type OperationalAssignmentStatus = 'ASSIGNED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW' | 'ABANDONED';

export interface AssignmentSnapshot {
  status: OperationalAssignmentStatus;
  workerConfirmedAt?: Date | string | null;
  checkedInAt?: Date | string | null;
  checkedOutAt?: Date | string | null;
}

export interface ShiftTimingSnapshot {
  startsAt: Date | string;
  endsAt: Date | string;
}

/** Cuánto antes de `startsAt` se permite hacer check-in. */
export const CHECK_IN_EARLY_TOLERANCE_MS = 30 * 60 * 1000;
/** Cuánto después de `startsAt` se sigue permitiendo el check-in antes de que
 * la asignación se considere `NO_SHOW` la próxima vez que se resuelva. */
export const CHECK_IN_LATE_LIMIT_MS = 60 * 60 * 1000;
/** Cuánto después de `endsAt` se tolera un check-in sin check-out antes de
 * que la asignación se considere `ABANDONED`. */
export const CHECK_OUT_ABANDONED_GRACE_MS = 60 * 60 * 1000;

export type CheckInWindowViolation = 'TOO_EARLY' | 'TOO_LATE';

/**
 * Ventana de tiempo válida para hacer check-in, relativa a `startsAt`. No
 * depende de `endsAt`: un turno corto puede tener su ventana de check-in más
 * angosta que su propia duración, lo cual es correcto (llegar muy tarde a un
 * turno corto también debe rechazarse).
 */
export function checkInWindowViolation(
  shift: Pick<ShiftTimingSnapshot, 'startsAt'>,
  now: Date = new Date(),
): CheckInWindowViolation | null {
  const startsAt = new Date(shift.startsAt);
  const opensAt = new Date(startsAt.getTime() - CHECK_IN_EARLY_TOLERANCE_MS);
  const closesAt = new Date(startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS);
  if (now < opensAt) return 'TOO_EARLY';
  if (now > closesAt) return 'TOO_LATE';
  return null;
}

export interface AssignmentLifecycleResult {
  status: OperationalAssignmentStatus;
  /** `true` cuando el estado calculado difiere del persistido y debe escribirse. */
  changed: boolean;
}

/**
 * Función pura que resuelve si una asignación quedó varada: `NO_SHOW`
 * (nunca hizo check-in y ya cerró su ventana) o `ABANDONED` (hizo check-in,
 * nunca hizo check-out y ya pasó el margen tras `endsAt`). Solo evalúa
 * asignaciones `ASSIGNED`; cualquier otro estado (`CANCELLED`, `COMPLETED`,
 * `NO_SHOW`, `ABANDONED`) es terminal para esta función y se devuelve sin
 * cambios (idempotente). No escribe nada: quien la invoque decide si y cómo
 * persistir el resultado.
 */
export function resolveAssignmentLifecycle(
  assignment: AssignmentSnapshot,
  shift: ShiftTimingSnapshot,
  now: Date = new Date(),
): AssignmentLifecycleResult {
  if (assignment.status !== 'ASSIGNED') {
    return { status: assignment.status, changed: false };
  }
  if (!assignment.checkedInAt) {
    if (checkInWindowViolation(shift, now) === 'TOO_LATE') {
      return { status: 'NO_SHOW', changed: true };
    }
    return { status: 'ASSIGNED', changed: false };
  }
  if (!assignment.checkedOutAt) {
    const abandonedAt = new Date(new Date(shift.endsAt).getTime() + CHECK_OUT_ABANDONED_GRACE_MS);
    if (now > abandonedAt) {
      return { status: 'ABANDONED', changed: true };
    }
  }
  return { status: 'ASSIGNED', changed: false };
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
 * Derives the aggregate shift state from persisted assignments. A shift stays
 * in progress after the first check-in until no assignment is left pending a
 * decision (none `ASSIGNED`, none `NO_SHOW`/`ABANDONED` still unresolved) and
 * at least one completed; seats resolved to `CANCELLED` no longer block the
 * close (CN-20260922-013). If none completed, it reopens (`PUBLISHED`) or,
 * past `endsAt`, closes as `CANCELLED`.
 */
export function deriveShiftStatus(
  current: OperationalShiftStatus,
  requiredWorkers: number,
  assignments: AssignmentSnapshot[],
  /**
   * Opcional para no romper llamadores existentes que no necesitan la regla
   * de abajo. Cuando se provee y `endsAt` ya pasó, un turno que de otro modo
   * "reabriría" a `PUBLISHED` (porque sus únicas asignaciones activas quedaron
   * `CANCELLED`/`NO_SHOW`/`ABANDONED`) se cierra como `CANCELLED` en su lugar.
   * Sin esto, un turno vencido podía quedar "fantasma": visible como
   * PUBLISHED/activo para siempre, pero inalcanzable desde cualquier endpoint
   * (`cancelShift`/`deleteShift`/`updateShift` lo rechazan, y nadie puede
   * postular ni hacer check-in sobre un `endsAt` ya pasado). Ver ALTO-2 de
   * CN-20260918-002.
   */
  shift?: Pick<ShiftTimingSnapshot, 'endsAt'>,
  now: Date = new Date(),
): OperationalShiftStatus {
  if (current === 'CANCELLED') return 'CANCELLED';

  // `ASSIGNED`, `NO_SHOW` y `ABANDONED` sin resolver representan una
  // decisión todavía pendiente sobre ese cupo: `ASSIGNED` es trabajo en
  // curso (camino normal a `COMPLETED` vía check-out); `NO_SHOW`/`ABANDONED`
  // exigen que la empresa decida `COMPLETED`/`CANCELLED` vía
  // `resolveAssignment` (nunca se resuelven solas). Mientras exista una
  // asignación así, el turno no puede darse por `COMPLETED`: podría todavía
  // sumar otro cupo completado, o la empresa podría revertir su decisión.
  // Una vez que ya no queda ninguna (todo cupo terminó `COMPLETED` o
  // `CANCELLED` -este último con o sin haber pasado antes por
  // `NO_SHOW`/`ABANDONED`-), si al menos uno completó, el turno se da por
  // `COMPLETED` aunque otros hayan terminado `CANCELLED`: un turno
  // multi-cupo parcialmente cubierto refleja que sí se prestó el servicio,
  // aunque parcial, en vez de quedar `CHECKED_IN` para siempre (el bug
  // original, CN-20260922-013, pendiente #1 de "turnos multi-cupo
  // parcialmente cubiertos" del plan maestro; contexto en CN-20260918-004 y
  // CN-20260920-004/005/006) o `CANCELLED` (que sugeriría que no pasó nada).
  // Esto cubre también, sin caso especial, el turno de un solo cupo
  // totalmente completado. Un cambio de comportamiento alcanzable en un
  // turno de un cupo: si el reemplazo se completa mientras el `NO_SHOW`
  // original sigue sin resolver, el turno se mantiene `CHECKED_IN` hasta que
  // la empresa resuelva el original (antes pasaba a `COMPLETED`); es
  // coherente con la regla "ninguna decisión pendiente" y lo fija una prueba
  // (BAJO-1 de CN-20260923-001).
  const pending = assignments.some((assignment) => ['ASSIGNED', 'NO_SHOW', 'ABANDONED'].includes(assignment.status));
  const completedCount = assignments.filter((assignment) => assignment.status === 'COMPLETED').length;
  if (!pending && completedCount > 0) return 'COMPLETED';

  // `NO_SHOW`/`ABANDONED` (resueltas o no) se excluyen de aquí en adelante
  // igual que `CANCELLED`: son asignaciones que no van a completarse por sí
  // solas, y dejarlas contar bloquearía para siempre la reasignación de ese
  // cupo (sin cambios respecto al comportamiento previo).
  const effective = assignments.filter((assignment) => !['CANCELLED', 'NO_SHOW', 'ABANDONED'].includes(assignment.status));
  if (effective.some((assignment) => assignment.checkedInAt != null || assignment.status === 'COMPLETED')) {
    return 'CHECKED_IN';
  }

  const assigned = effective.filter((assignment) => assignment.status === 'ASSIGNED').length;
  if (assigned >= requiredWorkers) return 'ASSIGNED';

  if (shift && assignments.length > 0 && new Date(shift.endsAt) <= now) {
    return 'CANCELLED';
  }

  return 'PUBLISHED';
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
  if (assignment?.status === 'NO_SHOW') {
    return { actor: 'NONE', code: 'NONE', label: 'No se registró el check-in a tiempo' };
  }
  if (assignment?.status === 'ABANDONED') {
    return { actor: 'NONE', code: 'NONE', label: 'Pendiente de cierre por la empresa' };
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
