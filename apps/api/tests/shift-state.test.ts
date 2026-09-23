import { describe, expect, it } from 'vitest';

import {
  CHECK_IN_EARLY_TOLERANCE_MS,
  CHECK_IN_LATE_LIMIT_MS,
  CHECK_OUT_ABANDONED_GRACE_MS,
  LATE_ASSIGNMENT_CHECK_IN_GRACE_MS,
  checkInWindowViolation,
  deriveShiftStatus,
  nextOperationalAction,
  resolveAssignmentLifecycle,
} from '../src/modules/operations/shift-state.js';

describe('shared operational state machine', () => {
  it('keeps a multi-seat shift in progress until every assignment completes', () => {
    expect(deriveShiftStatus('CHECKED_IN', 2, [
      { status: 'COMPLETED', checkedInAt: new Date(), checkedOutAt: new Date() },
      { status: 'ASSIGNED' },
    ])).toBe('CHECKED_IN');

    expect(deriveShiftStatus('CHECKED_IN', 2, [
      { status: 'COMPLETED', checkedInAt: new Date(), checkedOutAt: new Date() },
      { status: 'COMPLETED', checkedInAt: new Date(), checkedOutAt: new Date() },
    ])).toBe('COMPLETED');
  });

  it('reopens coverage after a pre-check-in cancellation', () => {
    expect(deriveShiftStatus('ASSIGNED', 2, [
      { status: 'ASSIGNED' },
      { status: 'CANCELLED' },
    ])).toBe('PUBLISHED');
  });

  it('preserves terminal cancellation regardless of assignment snapshots', () => {
    expect(deriveShiftStatus('CANCELLED', 1, [{ status: 'ASSIGNED' }])).toBe('CANCELLED');
  });

  it('identifies the responsible actor and next action', () => {
    expect(nextOperationalAction({ shiftStatus: 'PUBLISHED', applicationStatus: 'PENDING' }).code).toBe('REVIEW_APPLICATION');
    expect(nextOperationalAction({
      shiftStatus: 'ASSIGNED', applicationStatus: 'ACCEPTED', assignment: { status: 'ASSIGNED' },
    }).code).toBe('CONFIRM_ASSIGNMENT');
    expect(nextOperationalAction({
      shiftStatus: 'ASSIGNED', applicationStatus: 'ACCEPTED', assignment: { status: 'ASSIGNED', workerConfirmedAt: new Date() },
    }).code).toBe('CHECK_IN');
    expect(nextOperationalAction({
      shiftStatus: 'CHECKED_IN', applicationStatus: 'ACCEPTED', assignment: { status: 'ASSIGNED', workerConfirmedAt: new Date(), checkedInAt: new Date() },
    }).code).toBe('CHECK_OUT');
  });

  it('excludes NO_SHOW and ABANDONED assignments from the aggregate, reopening coverage', () => {
    expect(deriveShiftStatus('ASSIGNED', 1, [{ status: 'NO_SHOW' }])).toBe('PUBLISHED');
    expect(deriveShiftStatus('CHECKED_IN', 1, [{ status: 'ABANDONED', checkedInAt: new Date() }])).toBe('PUBLISHED');
    // Un turno multi-cupo con un no-show sigue "en curso" mientras otra
    // asignación real siga activa: el cupo vacante no bloquea al resto.
    expect(deriveShiftStatus('CHECKED_IN', 2, [
      { status: 'NO_SHOW' },
      { status: 'ASSIGNED', checkedInAt: new Date() },
    ])).toBe('CHECKED_IN');
  });

  it('closes a shift as CANCELLED instead of reopening it to PUBLISHED once endsAt has passed and no active assignment remains (ALTO-2 of CN-20260918-002)', () => {
    const pastEndsAt = { endsAt: new Date('2026-09-18T00:00:00.000Z') };
    const now = new Date('2026-09-18T01:00:00.000Z');
    expect(deriveShiftStatus('ASSIGNED', 1, [{ status: 'CANCELLED' }], pastEndsAt, now)).toBe('CANCELLED');
    expect(deriveShiftStatus('CHECKED_IN', 1, [{ status: 'ABANDONED', checkedInAt: new Date('2026-09-17T20:00:00.000Z') }], pastEndsAt, now)).toBe('CANCELLED');
    expect(deriveShiftStatus('ASSIGNED', 1, [{ status: 'NO_SHOW' }], pastEndsAt, now)).toBe('CANCELLED');
  });

  it('still reopens to PUBLISHED while endsAt has not passed yet, so a replacement can still be assigned', () => {
    const futureEndsAt = { endsAt: new Date('2026-09-19T00:00:00.000Z') };
    const now = new Date('2026-09-18T01:00:00.000Z');
    expect(deriveShiftStatus('ASSIGNED', 1, [{ status: 'NO_SHOW' }], futureEndsAt, now)).toBe('PUBLISHED');
  });

  it('does not apply the endsAt-past rule without a shift argument, preserving existing callers', () => {
    // Mismo escenario que arriba (endsAt vencido) pero sin pasar `shift`: el
    // comportamiento previo a esta corrección se conserva para no romper
    // llamadores que todavía no lo necesiten.
    expect(deriveShiftStatus('ASSIGNED', 1, [{ status: 'NO_SHOW' }])).toBe('PUBLISHED');
  });

  // CN-20260922-013: bug raíz de "turnos multi-cupo parcialmente cubiertos"
  // (pendiente #1 de docs/product/project-master-plan.md, contexto en
  // CN-20260918-004 y CN-20260920-004/005/006). `effective` excluía
  // `CANCELLED`, `NO_SHOW` y `ABANDONED` por igual, sin distinguir una
  // asignación NO_SHOW/ABANDONED todavía sin resolver (debe seguir
  // bloqueando el cierre) de una que la empresa ya resolvió explícitamente
  // como CANCELLED (ya no hay decisión pendiente sobre ese cupo). Con un
  // cupo COMPLETED y el otro ya resuelto a CANCELLED, el turno debía cerrar
  // COMPLETED (parcialmente cubierto), no quedar CHECKED_IN para siempre.
  it('closes a multi-seat shift as COMPLETED once its only other seat was explicitly resolved to CANCELLED (no assignment left pending a human decision)', () => {
    expect(deriveShiftStatus('CHECKED_IN', 2, [
      { status: 'COMPLETED', checkedInAt: new Date(), checkedOutAt: new Date() },
      { status: 'CANCELLED' },
    ])).toBe('COMPLETED');
  });

  it('stays CHECKED_IN while a NO_SHOW/ABANDONED seat is still unresolved, even if another seat already completed', () => {
    expect(deriveShiftStatus('CHECKED_IN', 2, [
      { status: 'COMPLETED', checkedInAt: new Date(), checkedOutAt: new Date() },
      { status: 'NO_SHOW' },
    ])).toBe('CHECKED_IN');
    expect(deriveShiftStatus('CHECKED_IN', 2, [
      { status: 'COMPLETED', checkedInAt: new Date(), checkedOutAt: new Date() },
      { status: 'ABANDONED', checkedInAt: new Date() },
    ])).toBe('CHECKED_IN');
  });

  // BAJO-1 de CN-20260923-001: fija un cambio de comportamiento de 013 en un
  // turno de UN cupo. Un reemplazo completado mientras el NO_SHOW original
  // sigue sin resolver no cierra el turno: queda CHECKED_IN hasta que la
  // empresa resuelva el original (antes pasaba a COMPLETED). Una vez
  // resuelto, cierra.
  it('keeps a single-seat shift CHECKED_IN when a replacement completed while the original NO_SHOW is still unresolved, and closes it once resolved', () => {
    const completed = { status: 'COMPLETED' as const, checkedInAt: new Date(), checkedOutAt: new Date() };
    expect(deriveShiftStatus('CHECKED_IN', 1, [{ status: 'NO_SHOW' }, completed])).toBe('CHECKED_IN');
    expect(deriveShiftStatus('CHECKED_IN', 1, [{ status: 'CANCELLED' }, completed])).toBe('COMPLETED');
    expect(deriveShiftStatus('CHECKED_IN', 1, [{ status: 'NO_SHOW' }, completed], { endsAt: new Date('2026-09-18T00:00:00.000Z') }, new Date('2026-09-18T01:00:00.000Z'))).toBe('CHECKED_IN');
  });

  it('closes a multi-seat shift as CANCELLED once every seat is resolved, none completed, and endsAt already passed', () => {
    const pastEndsAt = { endsAt: new Date('2026-09-18T00:00:00.000Z') };
    const now = new Date('2026-09-18T01:00:00.000Z');
    expect(deriveShiftStatus('CHECKED_IN', 2, [
      { status: 'CANCELLED' },
      { status: 'CANCELLED' },
    ], pastEndsAt, now)).toBe('CANCELLED');
  });

  it('reopens a multi-seat shift to PUBLISHED (not CANCELLED) once every seat is resolved, none completed, but endsAt has not passed yet, so it can still be restaffed', () => {
    const futureEndsAt = { endsAt: new Date('2026-09-19T00:00:00.000Z') };
    const now = new Date('2026-09-18T01:00:00.000Z');
    expect(deriveShiftStatus('CHECKED_IN', 2, [
      { status: 'CANCELLED' },
      { status: 'CANCELLED' },
    ], futureEndsAt, now)).toBe('PUBLISHED');
  });

  it('reports a closed, non-actionable next action for NO_SHOW and ABANDONED assignments', () => {
    expect(nextOperationalAction({
      shiftStatus: 'PUBLISHED', applicationStatus: 'ACCEPTED', assignment: { status: 'NO_SHOW' },
    })).toMatchObject({ actor: 'NONE', code: 'NONE' });
    expect(nextOperationalAction({
      shiftStatus: 'CHECKED_IN', applicationStatus: 'ACCEPTED', assignment: { status: 'ABANDONED', checkedInAt: new Date() },
    })).toMatchObject({ actor: 'NONE', code: 'NONE' });
  });
});

describe('checkInWindowViolation', () => {
  it('accepts check-in inside the tolerance window around startsAt', () => {
    const startsAt = new Date('2026-09-18T18:00:00.000Z');
    expect(checkInWindowViolation({ startsAt }, new Date(startsAt.getTime() - CHECK_IN_EARLY_TOLERANCE_MS))).toBeNull();
    expect(checkInWindowViolation({ startsAt }, startsAt)).toBeNull();
    expect(checkInWindowViolation({ startsAt }, new Date(startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS))).toBeNull();
  });

  it('rejects check-in attempted too early or too late', () => {
    const startsAt = new Date('2026-09-18T18:00:00.000Z');
    expect(checkInWindowViolation({ startsAt }, new Date(startsAt.getTime() - CHECK_IN_EARLY_TOLERANCE_MS - 1))).toBe('TOO_EARLY');
    expect(checkInWindowViolation({ startsAt }, new Date(startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS + 1))).toBe('TOO_LATE');
  });

  describe('assignment created after startsAt (replacement, CN-20260923-006)', () => {
    const startsAt = new Date('2026-09-18T18:00:00.000Z');
    // Reemplazo aceptado 3 horas después de `startsAt`: la ventana original
    // (startsAt + 60 min) hace rato que venció.
    const assignedAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);

    it('measures the closing of the window from assignedAt when the assignment was created after startsAt', () => {
      expect(checkInWindowViolation({ startsAt }, assignedAt, assignedAt)).toBeNull();
      expect(checkInWindowViolation({ startsAt }, new Date(assignedAt.getTime() + LATE_ASSIGNMENT_CHECK_IN_GRACE_MS), assignedAt)).toBeNull();
    });

    it('still closes the window once the grace counted from assignedAt is over', () => {
      expect(checkInWindowViolation({ startsAt }, new Date(assignedAt.getTime() + LATE_ASSIGNMENT_CHECK_IN_GRACE_MS + 1), assignedAt)).toBe('TOO_LATE');
    });

    it('keeps rejecting the same instant when no assignedAt is provided (window counted only from startsAt)', () => {
      expect(checkInWindowViolation({ startsAt }, assignedAt)).toBe('TOO_LATE');
    });

    it('caps the extended window at endsAt when it is known, so a late assignment cannot stay open past the end of the shift', () => {
      const endsAt = new Date(assignedAt.getTime() + 10 * 60 * 1000);
      expect(checkInWindowViolation({ startsAt, endsAt }, endsAt, assignedAt)).toBeNull();
      expect(checkInWindowViolation({ startsAt, endsAt }, new Date(endsAt.getTime() + 1), assignedAt)).toBe('TOO_LATE');
    });

    // BAJO-2 de CN-20260923-007: la rama `max(startsAt + 60 min, ...)`. En un
    // turno de menos de 60 minutos con una asignación tardía, el tope de
    // `endsAt` deja el margen extendido por debajo de la ventana original
    // (`startsAt + 60 min`); el `max` impide que la asignación tardía tenga una
    // ventana MÁS angosta que la de una creada a tiempo. Sin él, la ventana
    // se cerraría en `endsAt` en vez de en `startsAt + 60 min`.
    it('never closes a late assignment window before the original startsAt + 60 min, even in a shift shorter than that', () => {
      const shortShift = { startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000) };
      const lateAssignedAt = new Date(startsAt.getTime() + 10 * 60 * 1000);
      // Entre `endsAt` (startsAt + 30) y `startsAt + 60`: sigue abierta por el `max`.
      const afterEnd = new Date(startsAt.getTime() + 45 * 60 * 1000);
      expect(checkInWindowViolation(shortShift, afterEnd, lateAssignedAt)).toBeNull();
      expect(checkInWindowViolation(shortShift, new Date(startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS), lateAssignedAt)).toBeNull();
      expect(checkInWindowViolation(shortShift, new Date(startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS + 1), lateAssignedAt)).toBe('TOO_LATE');
      // Igual que la ventana de una asignación creada a tiempo en el mismo turno.
      const onTime = new Date(startsAt.getTime() - 60 * 60 * 1000);
      expect(checkInWindowViolation(shortShift, afterEnd, onTime)).toBeNull();
    });

    it('does not weaken the window of an assignment created before startsAt, whatever its assignedAt', () => {
      const early = new Date(startsAt.getTime() - 5 * 60 * 60 * 1000);
      const justBefore = new Date(startsAt.getTime() - 1);
      for (const created of [early, justBefore, startsAt]) {
        expect(checkInWindowViolation({ startsAt }, new Date(startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS), created)).toBeNull();
        expect(checkInWindowViolation({ startsAt }, new Date(startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS + 1), created)).toBe('TOO_LATE');
        expect(checkInWindowViolation({ startsAt }, new Date(startsAt.getTime() - CHECK_IN_EARLY_TOLERANCE_MS - 1), created)).toBe('TOO_EARLY');
      }
    });
  });
});

describe('resolveAssignmentLifecycle', () => {
  const shift = { startsAt: new Date('2026-09-18T18:00:00.000Z'), endsAt: new Date('2026-09-19T00:00:00.000Z') };

  it('leaves an ASSIGNED assignment untouched while its check-in window is still open', () => {
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED' }, shift, shift.startsAt)).toEqual({ status: 'ASSIGNED', changed: false });
  });

  it('flags a never-checked-in assignment as NO_SHOW once its window closes', () => {
    const now = new Date(shift.startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS + 1);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED' }, shift, now)).toEqual({ status: 'NO_SHOW', changed: true });
  });

  it('does not flag as NO_SHOW a replacement created after startsAt while its own grace from assignedAt is open, and flags it once that grace is over (CN-20260923-006)', () => {
    const assignedAt = new Date(shift.startsAt.getTime() + 2 * 60 * 60 * 1000);
    const insideGrace = new Date(assignedAt.getTime() + 10 * 60 * 1000);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', assignedAt }, shift, insideGrace)).toEqual({ status: 'ASSIGNED', changed: false });
    const afterGrace = new Date(assignedAt.getTime() + LATE_ASSIGNMENT_CHECK_IN_GRACE_MS + 1);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', assignedAt }, shift, afterGrace)).toEqual({ status: 'NO_SHOW', changed: true });
  });

  it('flags NO_SHOW a late assignment once endsAt passes even if its own grace from assignedAt is still open (nobody can check in after endsAt)', () => {
    const assignedAt = new Date(shift.endsAt.getTime() - 10 * 60 * 1000);
    const now = new Date(shift.endsAt.getTime() + 1);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', assignedAt }, shift, now)).toEqual({ status: 'NO_SHOW', changed: true });
  });

  it('keeps a late assignment in a shift shorter than 60 minutes ASSIGNED until startsAt + 60 min, not only until endsAt (BAJO-2 de CN-20260923-007)', () => {
    const shortShift = { startsAt: shift.startsAt, endsAt: new Date(shift.startsAt.getTime() + 30 * 60 * 1000) };
    const assignedAt = new Date(shift.startsAt.getTime() + 10 * 60 * 1000);
    const betweenEndAndOriginalDeadline = new Date(shift.startsAt.getTime() + 45 * 60 * 1000);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', assignedAt }, shortShift, betweenEndAndOriginalDeadline)).toEqual({ status: 'ASSIGNED', changed: false });
    const afterOriginalDeadline = new Date(shift.startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS + 1);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', assignedAt }, shortShift, afterOriginalDeadline)).toEqual({ status: 'NO_SHOW', changed: true });
  });

  it('still flags NO_SHOW an assignment created before startsAt at the original deadline', () => {
    const assignedAt = new Date(shift.startsAt.getTime() - 60 * 60 * 1000);
    const now = new Date(shift.startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS + 1);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', assignedAt }, shift, now)).toEqual({ status: 'NO_SHOW', changed: true });
  });

  it('leaves a checked-in assignment untouched before the post-endsAt grace period elapses', () => {
    const checkedInAt = shift.startsAt;
    const now = new Date(shift.endsAt.getTime() + CHECK_OUT_ABANDONED_GRACE_MS);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', checkedInAt }, shift, now)).toEqual({ status: 'ASSIGNED', changed: false });
  });

  it('flags a checked-in, never-checked-out assignment as ABANDONED past the grace period', () => {
    const checkedInAt = shift.startsAt;
    const now = new Date(shift.endsAt.getTime() + CHECK_OUT_ABANDONED_GRACE_MS + 1);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', checkedInAt }, shift, now)).toEqual({ status: 'ABANDONED', changed: true });
  });

  it('never re-derives a terminal or already-resolved status', () => {
    const now = new Date(shift.endsAt.getTime() + 10 * CHECK_OUT_ABANDONED_GRACE_MS);
    for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'ABANDONED'] as const) {
      expect(resolveAssignmentLifecycle({ status }, shift, now)).toEqual({ status, changed: false });
    }
  });

  it('does not flag a checked-in-and-checked-out assignment as ABANDONED', () => {
    const now = new Date(shift.endsAt.getTime() + 10 * CHECK_OUT_ABANDONED_GRACE_MS);
    expect(resolveAssignmentLifecycle({ status: 'ASSIGNED', checkedInAt: shift.startsAt, checkedOutAt: shift.endsAt }, shift, now))
      .toEqual({ status: 'ASSIGNED', changed: false });
  });
});
