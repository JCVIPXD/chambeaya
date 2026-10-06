import { describe, expect, it } from 'vitest';

import {
  JOB_APPLICATION_STATUSES,
  canIssueOffer,
  canScheduleInterview,
  canTransition,
  isTerminalApplication,
  postingAcceptsApplications,
  postingAllowsProgress,
  postingHasFreeVacancies,
  postingIsEditable,
  resolveApplicationTransition,
  resolvePostingTransition,
  type JobApplicationStatus,
} from '../src/modules/jobs/job-state.js';
import { JobEvents } from '../src/modules/jobs/jobs.events.js';
import { jobApplicantCvViewable, limaCalendarDate } from '../src/modules/jobs/jobs.service.js';

describe('job application funnel', () => {
  it('lets the company advance, skip to interview or offer, and reject', () => {
    expect(canTransition('APPLIED', 'SHORTLISTED', 'COMPANY')).toBe(true);
    expect(canTransition('APPLIED', 'INTERVIEW', 'COMPANY')).toBe(true);
    expect(canTransition('SHORTLISTED', 'OFFER', 'COMPANY')).toBe(true);
    expect(canTransition('INTERVIEW', 'OFFER', 'COMPANY')).toBe(true);
    expect(canTransition('ACCEPTED', 'HIRED', 'COMPANY')).toBe(true);
    for (const from of ['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'ACCEPTED'] as const) {
      expect(canTransition(from, 'REJECTED', 'COMPANY')).toBe(true);
    }
  });

  it('never moves backwards and never lets the company accept for the worker', () => {
    expect(canTransition('INTERVIEW', 'SHORTLISTED', 'COMPANY')).toBe(false);
    expect(canTransition('SHORTLISTED', 'APPLIED', 'COMPANY')).toBe(false);
    expect(canTransition('OFFER', 'ACCEPTED', 'COMPANY')).toBe(false);
    expect(canTransition('OFFER', 'HIRED', 'COMPANY')).toBe(false);
    expect(canTransition('APPLIED', 'HIRED', 'COMPANY')).toBe(false);
  });

  it('only lets the worker withdraw, or accept a pending offer; never hire or reject', () => {
    expect(canTransition('OFFER', 'ACCEPTED', 'WORKER')).toBe(true);
    for (const from of ['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'ACCEPTED'] as const) {
      expect(canTransition(from, 'WITHDRAWN', 'WORKER')).toBe(true);
      expect(canTransition(from, 'REJECTED', 'WORKER')).toBe(false);
      expect(canTransition(from, 'HIRED', 'WORKER')).toBe(false);
    }
    expect(canTransition('APPLIED', 'ACCEPTED', 'WORKER')).toBe(false);
    expect(canTransition('INTERVIEW', 'ACCEPTED', 'WORKER')).toBe(false);
  });

  it('has no way out of a terminal state for anyone', () => {
    for (const from of ['HIRED', 'REJECTED', 'WITHDRAWN'] as JobApplicationStatus[]) {
      expect(isTerminalApplication(from)).toBe(true);
      for (const to of JOB_APPLICATION_STATUSES) {
        if (to === from) continue;
        expect(canTransition(from, to, 'COMPANY')).toBe(false);
        expect(canTransition(from, to, 'WORKER')).toBe(false);
      }
    }
  });

  it('is idempotent only for a state the actor can legitimately reach', () => {
    expect(resolveApplicationTransition('REJECTED', 'REJECTED', 'COMPANY')).toEqual({ kind: 'IDEMPOTENT' });
    expect(resolveApplicationTransition('HIRED', 'HIRED', 'COMPANY')).toEqual({ kind: 'IDEMPOTENT' });
    expect(resolveApplicationTransition('WITHDRAWN', 'WITHDRAWN', 'WORKER')).toEqual({ kind: 'IDEMPOTENT' });
    expect(resolveApplicationTransition('ACCEPTED', 'ACCEPTED', 'WORKER')).toEqual({ kind: 'IDEMPOTENT' });
    // El trabajador no puede "contratar": repetirlo no es un no-op sino un error.
    expect(resolveApplicationTransition('HIRED', 'HIRED', 'WORKER')).toEqual({ kind: 'INVALID' });
    expect(resolveApplicationTransition('REJECTED', 'REJECTED', 'WORKER')).toEqual({ kind: 'INVALID' });
    // Conflicto entre actores: el trabajador se retira de algo ya rechazado.
    expect(resolveApplicationTransition('REJECTED', 'WITHDRAWN', 'WORKER')).toEqual({ kind: 'INVALID' });
    expect(resolveApplicationTransition('APPLIED', 'SHORTLISTED', 'COMPANY')).toEqual({ kind: 'MOVE' });
  });

  it('allows an offer and an interview only in the right stages', () => {
    expect(['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER'].every((status) => canIssueOffer(status as JobApplicationStatus))).toBe(true);
    expect(['ACCEPTED', 'HIRED', 'REJECTED', 'WITHDRAWN'].some((status) => canIssueOffer(status as JobApplicationStatus))).toBe(false);
    expect(canScheduleInterview('INTERVIEW')).toBe(true);
    expect(canScheduleInterview('OFFER')).toBe(false);
  });
});

describe('job posting lifecycle', () => {
  it('publishes from draft or pause, pauses only a published posting, and closes anything open', () => {
    expect(resolvePostingTransition('DRAFT', 'PUBLISH')).toEqual({ kind: 'MOVE', to: 'PUBLISHED' });
    expect(resolvePostingTransition('PAUSED', 'PUBLISH')).toEqual({ kind: 'MOVE', to: 'PUBLISHED' });
    expect(resolvePostingTransition('PUBLISHED', 'PUBLISH')).toEqual({ kind: 'IDEMPOTENT', to: 'PUBLISHED' });
    expect(resolvePostingTransition('PUBLISHED', 'PAUSE')).toEqual({ kind: 'MOVE', to: 'PAUSED' });
    expect(resolvePostingTransition('DRAFT', 'PAUSE').kind).toBe('INVALID');
    expect(resolvePostingTransition('CLOSED', 'CLOSE').kind).toBe('IDEMPOTENT');
    for (const status of ['DRAFT', 'PUBLISHED', 'PAUSED'] as const) expect(resolvePostingTransition(status, 'CLOSE').kind).toBe('MOVE');
  });

  it('never reopens a closed or filled posting', () => {
    for (const status of ['CLOSED', 'FILLED'] as const) {
      expect(resolvePostingTransition(status, 'PUBLISH').kind).toBe('INVALID');
      expect(resolvePostingTransition(status, 'PAUSE').kind).toBe('INVALID');
    }
    expect(resolvePostingTransition('FILLED', 'CLOSE').kind).toBe('INVALID');
  });

  it('fills only a published or paused posting and never idempotently', () => {
    expect(resolvePostingTransition('PUBLISHED', 'FILL')).toEqual({ kind: 'MOVE', to: 'FILLED' });
    expect(resolvePostingTransition('PAUSED', 'FILL')).toEqual({ kind: 'MOVE', to: 'FILLED' });
    expect(resolvePostingTransition('FILLED', 'FILL').kind).toBe('INVALID');
    expect(resolvePostingTransition('DRAFT', 'FILL').kind).toBe('INVALID');
  });

  it('accepts applications only when published, and edits only draft or paused', () => {
    expect(postingAcceptsApplications('PUBLISHED')).toBe(true);
    for (const status of ['DRAFT', 'PAUSED', 'CLOSED', 'FILLED'] as const) expect(postingAcceptsApplications(status)).toBe(false);
    expect(postingAllowsProgress('PAUSED')).toBe(true);
    expect(postingAllowsProgress('CLOSED')).toBe(false);
    expect(postingIsEditable('DRAFT') && postingIsEditable('PAUSED')).toBe(true);
    expect(postingIsEditable('PUBLISHED') || postingIsEditable('FILLED')).toBe(false);
  });

  it('requires at least one free vacancy to publish or receive applications', () => {
    expect(postingHasFreeVacancies({ vacancies: 2, filledVacancies: 1 })).toBe(true);
    expect(postingHasFreeVacancies({ vacancies: 1, filledVacancies: 0 })).toBe(true);
    expect(postingHasFreeVacancies({ vacancies: 1, filledVacancies: 1 })).toBe(false);
    expect(postingHasFreeVacancies({ vacancies: 2, filledVacancies: 3 })).toBe(false);
  });
});

describe('job helpers', () => {
  it('shows the CV only while the candidate is still in the process and the profile is visible', () => {
    expect(jobApplicantCvViewable('APPLIED', true)).toBe(true);
    expect(jobApplicantCvViewable('HIRED', true)).toBe(true);
    expect(jobApplicantCvViewable('REJECTED', true)).toBe(false);
    expect(jobApplicantCvViewable('WITHDRAWN', true)).toBe(false);
    expect(jobApplicantCvViewable('APPLIED', false)).toBe(false);
    expect(jobApplicantCvViewable('APPLIED', undefined)).toBe(false);
  });

  it('computes the calendar day in Lima, not UTC', () => {
    expect(limaCalendarDate(new Date('2026-10-07T03:00:00Z'))).toBe('2026-10-06');
    expect(limaCalendarDate(new Date('2026-10-07T05:00:00Z'))).toBe('2026-10-07');
  });

  it('publishes to every listener and survives a broken one', () => {
    const bus = new JobEvents();
    const received: string[] = [];
    bus.subscribe(() => { throw new Error('boom'); });
    const unsubscribe = bus.subscribe((event) => received.push(event.type));
    bus.publish({ type: 'APPLIED', applicationId: 'a', postingId: 'p', status: 'APPLIED', recipientUserId: 'u', at: 'now' });
    unsubscribe();
    bus.publish({ type: 'HIRED', applicationId: 'a', postingId: 'p', status: 'HIRED', recipientUserId: 'u', at: 'now' });
    expect(received).toEqual(['APPLIED']);
    expect(bus.subscriberCount).toBe(1);
  });
});
