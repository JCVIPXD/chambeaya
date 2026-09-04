import { describe, expect, it } from 'vitest';

import { deriveShiftStatus, nextOperationalAction } from '../src/modules/operations/shift-state.js';

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
});
