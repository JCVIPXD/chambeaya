import { describe, expect, it } from 'vitest';

import {
  CHECK_IN_EARLY_TOLERANCE_MS,
  CHECK_IN_LATE_LIMIT_MS,
  CHECK_OUT_ABANDONED_GRACE_MS,
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
