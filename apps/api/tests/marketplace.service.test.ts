import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseMarketplaceService, DemoMarketplaceService, splitPaymentCents, validateScreeningAnswers } from '../src/modules/marketplace/marketplace.service.js';
import {
  CHECK_IN_EARLY_TOLERANCE_MS,
  CHECK_IN_LATE_LIMIT_MS,
  CHECK_OUT_ABANDONED_GRACE_MS,
} from '../src/modules/operations/shift-state.js';

describe('DemoMarketplaceService', () => {
  it('assigns a published shift and generates a development check-in credential', () => {
    const service = new DemoMarketplaceService();

    const accepted = service.acceptShift('worker-demo', 'shift-la-mar');

    expect(accepted.status).toBe('ASSIGNED');
    expect(accepted.checkInCredential).toMatch(/^DEMO-CUMPLE-/);
  });

  it('rejects accepting an already assigned shift', () => {
    const service = new DemoMarketplaceService();
    service.acceptShift('worker-a', 'shift-la-mar');

    expect(() => service.acceptShift('worker-b', 'shift-la-mar')).toThrow('SHIFT_UNAVAILABLE');
  });

  it('stores one pending application per worker and shift', () => {
    const service = new DemoMarketplaceService();

    const first = service.applyToShift('worker-demo', 'shift-la-mar');
    const second = service.applyToShift('worker-demo', 'shift-la-mar');

    expect(first.id).toBe(second.id);
    expect(first.status).toBe('PENDING');
    expect(service.listApplications('worker-demo')).toHaveLength(1);
  });

  it('confirms an assigned shift and validates its check-in credential', () => {
    const service = new DemoMarketplaceService();
    service.acceptShift('worker-demo', 'shift-la-mar');

    expect(() => service.checkIn('worker-demo', 'shift-la-mar', 'DEMO-CUMPLE-SHIFT-LA-MAR')).toThrow('SHIFT_UNAVAILABLE');
    expect(service.confirmAssignment('worker-demo', 'shift-la-mar').status).toBe('ACCEPTED');
    expect(service.checkIn('worker-demo', 'shift-la-mar', 'DEMO-CUMPLE-SHIFT-LA-MAR').shiftId).toBe('shift-la-mar');
    expect(service.checkOut('worker-demo', 'shift-la-mar').shiftId).toBe('shift-la-mar');
    expect(service.activeShift('worker-demo')).toBeNull();
  });

  it('records a worker cancellation without deleting the application', () => {
    const service = new DemoMarketplaceService();
    service.applyToShift('worker-demo', 'shift-eventos-peru', [{
      question: '¿Tienes disponibilidad durante todo el horario indicado?',
      answer: 'Sí, tengo disponibilidad completa.',
    }]);

    const cancelled = service.cancelAssignment('worker-demo', 'shift-eventos-peru', 'Ya no tengo disponibilidad');

    expect(cancelled.status).toBe('CANCELLED');
    expect(service.listApplications('worker-demo')).toHaveLength(1);
  });

  it('requires one answer for every screening question and preserves its prompt', () => {
    const questions = ['¿Tienes disponibilidad durante todo el horario indicado?'];
    expect(() => validateScreeningAnswers(questions, [])).toThrow('INVALID_SCREENING_ANSWERS');
    expect(validateScreeningAnswers(questions, [{ question: questions[0], answer: '  Sí, todo el turno.  ' }])).toEqual([
      { question: questions[0], answer: 'Sí, todo el turno.' },
    ]);
  });

  it('computes a worker payment entirely in cents', () => {
    expect(splitPaymentCents(10000, 10)).toEqual({ feeCents: 1000, workerPayCents: 9000 });
  });

  it('disables the legacy direct-assignment path in persistent mode', async () => {
    const service = new DatabaseMarketplaceService({} as never);
    await expect(service.acceptShift('worker-live', 'shift-live')).rejects.toMatchObject({
      code: 'DIRECT_ASSIGNMENT_DISABLED',
      statusCode: 410,
    });
  });

  it('reads a worker-scoped persistent wallet ledger and computes balance excluding reversals', async () => {
    const prisma = {
      user: { findFirst: vi.fn(async ({ where }: any) => where.id === 'worker-a' ? { id: 'worker-a' } : null) },
      walletMovement: { findMany: vi.fn(async ({ where }: any) => where.workerId === 'worker-a' ? [
        { id: 'm2', description: 'Turno', amountCents: 9000, status: 'RELEASED', reference: 'shift-1', createdAt: new Date() },
        { id: 'm1', description: 'Ajuste', amountCents: -1000, status: 'REVERSED', reference: 'adjust-1', createdAt: new Date() },
      ] : []) },
    };
    const service = new DatabaseMarketplaceService(prisma as never);
    await expect(service.wallet('worker-a')).resolves.toMatchObject({ workerId: 'worker-a', balanceCents: 9000, movements: expect.any(Array) });
    expect(prisma.walletMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workerId: 'worker-a' } }));
    await expect(service.wallet('worker-b')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('records a validated movement for the authenticated worker only', async () => {
    const create = vi.fn(async ({ data }: any) => ({ id: 'm1', ...data }));
    const prisma = { user: { findFirst: vi.fn(async ({ where }: any) => where.id === 'worker-a' ? { id: 'worker-a', role: 'WORKER' } : null) }, walletMovement: { create } };
    const service = new DatabaseMarketplaceService(prisma as never);
    await expect(service.recordWalletMovement('worker-a', { amountCents: 1250, description: 'Pago turno', status: 'RELEASED' })).resolves.toMatchObject({ workerId: 'worker-a', amountCents: 1250 });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ workerId: 'worker-a', amountCents: 1250, status: 'RELEASED' }) });
    await expect(service.recordWalletMovement('worker-b', { amountCents: 1, description: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects BUSINESS identities, non-positive amounts and runtime-invalid statuses', async () => {
    const create = vi.fn();
    const prisma = {
      user: { findFirst: vi.fn(async ({ where }: any) => where.id === 'business-1' ? { id: 'business-1', role: 'BUSINESS' } : { id: where.id, role: 'WORKER' }) },
      walletMovement: { create },
    };
    const service = new DatabaseMarketplaceService(prisma as never);
    await expect(service.recordWalletMovement('business-1', { amountCents: 100, description: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.recordWalletMovement('worker-a', { amountCents: 0, description: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.recordWalletMovement('worker-a', { amountCents: -1, description: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.recordWalletMovement('worker-a', { amountCents: 1, description: 'x', status: 'FORGED' as any })).rejects.toMatchObject({ statusCode: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns the committed application when a concurrent submission wins the unique constraint', async () => {
    const existing = {
      id: 'application-live',
      shiftId: 'shift-live',
      status: 'PENDING' as const,
      screeningAnswers: [],
      createdAt: new Date('2026-08-26T12:00:00.000Z'),
      updatedAt: new Date('2026-08-26T12:00:00.000Z'),
      shift: {
        id: 'shift-live', title: 'Mozo', location: 'Lima', startsAt: new Date('2026-08-27T18:00:00.000Z'),
        endsAt: new Date('2026-08-27T23:00:00.000Z'), payCents: 10000, status: 'PUBLISHED' as const,
        rescueActive: false, description: null, responsibilities: null, requirements: null,
        screeningQuestions: [], modality: 'PRESENCIAL', company: { name: 'Restaurante Demo', industry: 'HOSPITALITY' },
      },
    };
    let lookupCount = 0;
    const create = vi.fn(async () => { throw { code: 'P2002' }; });
    const prisma = {
      user: { findFirst: async () => ({ id: 'worker-live', name: 'Ana', email: 'ana@example.com' }) },
      shift: { findFirst: async () => existing.shift },
      shiftApplication: {
        findUnique: async () => (++lookupCount === 1 ? null : existing),
      },
      $transaction: async (callback: (client: unknown) => Promise<unknown>) => callback({
        shiftApplication: { findUnique: async () => null, create },
        shiftEvent: { create: async () => { throw new Error('No event should be written for an existing application'); } },
      }),
    };
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.applyToShift('worker-live', 'shift-live')).resolves.toMatchObject({
      id: 'application-live',
      status: 'PENDING',
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('rolls back a new application when its auxiliary event cannot be recorded', async () => {
    const committedApplications: unknown[] = [];
    const stagedApplications: unknown[] = [];
    const shift = {
      id: 'shift-live', title: 'Mozo', location: 'Lima', startsAt: new Date('2026-08-27T18:00:00.000Z'),
      endsAt: new Date('2026-08-27T23:00:00.000Z'), payCents: 10000, status: 'PUBLISHED' as const,
      rescueActive: false, description: null, responsibilities: null, requirements: null,
      screeningQuestions: [], modality: 'PRESENCIAL', companyId: 'company-live', company: { name: 'Restaurante Demo', industry: 'HOSPITALITY' },
    };
    const tx = {
      shiftApplication: {
        findUnique: async () => null,
        create: async () => {
          const application = { id: 'application-live', shiftId: shift.id, status: 'PENDING' as const, screeningAnswers: [], createdAt: new Date(), updatedAt: new Date(), shift };
          stagedApplications.push(application);
          return application;
        },
      },
      shiftEvent: { create: async () => { throw new Error('event write failed'); } },
    };
    const prisma = {
      user: { findFirst: async () => ({ id: 'worker-live', name: 'Ana', email: 'ana@example.com' }) },
      shift: { findFirst: async () => shift },
      shiftApplication: { findUnique: async () => null },
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
        try {
          const result = await callback(tx);
          committedApplications.push(...stagedApplications);
          return result;
        } finally {
          stagedApplications.length = 0;
        }
      },
    };
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.applyToShift('worker-live', shift.id)).rejects.toThrow('event write failed');
    expect(committedApplications).toEqual([]);
  });

  it('persists availability on the authenticated worker profile', async () => {
    const updates: unknown[] = [];
    const prisma = {
      user: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; role: string } }) =>
          where.id === 'worker-a' && where.role === 'WORKER' ? { email: 'a@example.com' } : null),
      },
      companyWorkerContact: {
        updateMany: vi.fn(async (args: unknown) => { updates.push(args); return { count: 1 }; }),
      },
    };
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.updateAvailability('worker-a', false)).resolves.toEqual({ isAvailable: false });
    expect(updates).toEqual([{ where: { email: 'a@example.com' }, data: { status: 'UNAVAILABLE' } }]);
  });

  it('does not persist availability for another worker', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      user: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; role: string } }) =>
          where.id === 'worker-a' ? { email: 'a@example.com' } : { email: 'b@example.com' }),
      },
      companyWorkerContact: { updateMany },
    };
    const service = new DatabaseMarketplaceService(prisma as never);

    await service.updateAvailability('worker-a', true);
    await service.updateAvailability('worker-b', false);
    expect((updateMany.mock.calls as unknown as Array<[unknown]>).map(([args]) => args)).toEqual([
      { where: { email: 'a@example.com' }, data: { status: 'AVAILABLE' } },
      { where: { email: 'b@example.com' }, data: { status: 'UNAVAILABLE' } },
    ]);
  });
});

describe('DatabaseMarketplaceService rejects new applications for shifts that are no longer open', () => {
  // `applyToShift` busca el turno con `where: { id, status: 'PUBLISHED', endsAt: { gt: new Date() } }`
  // (`marketplace.service.ts`). Un turno `CANCELLED` y un turno vencido
  // producen exactamente la misma consulta vacía (Prisma no distingue el
  // motivo), así que ambos casos comparten esta prueba: lo relevante es que
  // el filtro se envía con la forma correcta y que la ausencia de resultado
  // se traduce en `409 SHIFT_UNAVAILABLE`, nunca en una postulación creada.
  it('sends the PUBLISHED + not-yet-ended filter and rejects with 409 when nothing matches', async () => {
    const findFirst = vi.fn(async () => null);
    const prisma = {
      user: { findFirst: vi.fn(async () => ({ id: 'worker-a', name: 'Ana', email: 'ana@example.com' })) },
      shift: { findFirst },
    };
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.applyToShift('worker-a', 'shift-cancelled')).rejects.toMatchObject({
      code: 'SHIFT_UNAVAILABLE',
      statusCode: 409,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'shift-cancelled', status: 'PUBLISHED', endsAt: { gt: expect.any(Date) } },
      include: { company: true },
    });
  });
});

// Modela el subconjunto de Prisma que `checkIn`/`checkOut` tocan, con estado
// mutable en memoria: cada `update` muta el fixture y el siguiente `findMany`
// dentro de la misma llamada ya ve el cambio, igual que en una transacción
// real de una sola conexión. `$transaction` simplemente invoca el callback
// con el mismo cliente: no hace falta aislamiento real para estas pruebas.
function fakeAssignmentPrisma(assignment: Record<string, unknown>, shift: Record<string, unknown>) {
  const state = { assignment: { ...assignment }, shift: { ...shift } };
  const shiftAssignment = {
    findFirst: vi.fn(async () => ({ ...state.assignment, shift: { ...state.shift } })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(state.assignment, data);
      return { ...state.assignment };
    }),
    findMany: vi.fn(async () => [{ ...state.assignment }]),
  };
  const shiftModel = {
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(state.shift, data);
      return { ...state.shift };
    }),
  };
  const shiftEvent = { create: vi.fn(async () => undefined) };
  const payment = { upsert: vi.fn(async () => undefined) };
  const prisma: Record<string, unknown> = { shiftAssignment, shift: shiftModel, shiftEvent, payment };
  prisma.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
  return { prisma, state, shiftAssignment, shiftModel, shiftEvent, payment };
}

describe('DatabaseMarketplaceService.checkIn time window and lifecycle', () => {
  const baseShift = {
    id: 'shift-1', companyId: 'company-1', title: 'Mozo', payCents: 10000,
    requiredWorkers: 1, status: 'ASSIGNED',
    startsAt: new Date('2026-09-18T18:00:00.000Z'),
    endsAt: new Date('2026-09-19T00:00:00.000Z'),
    company: { name: 'Restaurante Demo' },
  };
  const baseAssignment = {
    id: 'assignment-1', shiftId: 'shift-1', workerId: 'worker-1', status: 'ASSIGNED',
    checkInCredential: 'CUMPLE-ABC123', workerConfirmedAt: new Date('2026-09-18T10:00:00.000Z'),
    checkedInAt: null, checkedOutAt: null,
  };

  afterEach(() => { vi.useRealTimers(); });

  it('rejects a check-in attempted before the tolerance window opens', async () => {
    const { prisma } = fakeAssignmentPrisma(baseAssignment, baseShift);
    vi.useFakeTimers().setSystemTime(new Date(baseShift.startsAt.getTime() - CHECK_IN_EARLY_TOLERANCE_MS - 1000));
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.checkIn('worker-1', 'shift-1', 'CUMPLE-ABC123')).rejects.toMatchObject({ code: 'CHECK_IN_TOO_EARLY', statusCode: 409 });
  });

  it('accepts a check-in inside the tolerance window', async () => {
    const { prisma, state } = fakeAssignmentPrisma(baseAssignment, baseShift);
    vi.useFakeTimers().setSystemTime(baseShift.startsAt);
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.checkIn('worker-1', 'shift-1', 'CUMPLE-ABC123')).resolves.toMatchObject({ shiftId: 'shift-1' });
    expect(state.assignment.checkedInAt).toBeInstanceOf(Date);
  });

  it('flags a never-checked-in assignment as NO_SHOW once the window closes, reopens the shift for reassignment, and rejects the check-in', async () => {
    const { prisma, state } = fakeAssignmentPrisma(baseAssignment, baseShift);
    vi.useFakeTimers().setSystemTime(new Date(baseShift.startsAt.getTime() + CHECK_IN_LATE_LIMIT_MS + 1000));
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.checkIn('worker-1', 'shift-1', 'CUMPLE-ABC123')).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_ACTIONABLE', statusCode: 409 });
    expect(state.assignment.status).toBe('NO_SHOW');
    expect(state.shift.status).toBe('PUBLISHED');
    expect(state.shift.confirmedWorkers).toBe(0);
  });

  it('rejects a check-in on an assignment already resolved as NO_SHOW, without touching it again', async () => {
    const { prisma, state, shiftAssignment } = fakeAssignmentPrisma({ ...baseAssignment, status: 'NO_SHOW' }, baseShift);
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.checkIn('worker-1', 'shift-1', 'CUMPLE-ABC123')).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_ACTIONABLE', statusCode: 409 });
    expect(shiftAssignment.update).not.toHaveBeenCalled();
    expect(state.assignment.status).toBe('NO_SHOW');
  });

  it('rejects a check-in once endsAt has passed even inside the startsAt-relative late window, on a shift shorter than CHECK_IN_LATE_LIMIT_MS (MEDIO-3 of CN-20260918-002)', async () => {
    // Turno de 30 minutos: su ventana de check-in (hasta startsAt + 60 min)
    // sigue "abierta" según `checkInWindowViolation`, pero `endsAt` (a los 30
    // min) ya pasó. Sin el guard restaurado, esto aceptaría un check-in
    // después de que el turno terminara.
    const shortShift = { ...baseShift, endsAt: new Date(baseShift.startsAt.getTime() + 30 * 60 * 1000) };
    const { prisma, shiftAssignment } = fakeAssignmentPrisma(baseAssignment, shortShift);
    vi.useFakeTimers().setSystemTime(new Date(baseShift.startsAt.getTime() + 45 * 60 * 1000));
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.checkIn('worker-1', 'shift-1', 'CUMPLE-ABC123')).rejects.toMatchObject({ code: 'SHIFT_UNAVAILABLE', statusCode: 409 });
    expect(shiftAssignment.update).not.toHaveBeenCalled();
  });
});

describe('DatabaseMarketplaceService.checkOut time window and lifecycle', () => {
  const baseShift = {
    id: 'shift-1', companyId: 'company-1', title: 'Mozo', payCents: 10000,
    requiredWorkers: 1, status: 'CHECKED_IN',
    startsAt: new Date('2026-09-18T18:00:00.000Z'),
    endsAt: new Date('2026-09-19T00:00:00.000Z'),
    company: { name: 'Restaurante Demo' },
  };
  const checkedInAssignment = {
    id: 'assignment-1', shiftId: 'shift-1', workerId: 'worker-1', status: 'ASSIGNED',
    checkInCredential: 'CUMPLE-ABC123', workerConfirmedAt: new Date('2026-09-18T10:00:00.000Z'),
    checkedInAt: new Date('2026-09-18T18:05:00.000Z'), checkedOutAt: null,
  };

  afterEach(() => { vi.useRealTimers(); });

  it('completes the check-out and creates a payment before the abandonment grace period elapses', async () => {
    const { prisma, state, payment } = fakeAssignmentPrisma(checkedInAssignment, baseShift);
    vi.useFakeTimers().setSystemTime(baseShift.endsAt);
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.checkOut('worker-1', 'shift-1')).resolves.toMatchObject({ shiftId: 'shift-1' });
    expect(state.assignment.status).toBe('COMPLETED');
    expect(payment.upsert).toHaveBeenCalledOnce();
  });

  it('flags a checked-in, never-checked-out assignment as ABANDONED past the grace period and closes the shift as CANCELLED (its endsAt already passed, so it cannot reopen to PUBLISHED), rejecting the check-out without creating a payment', async () => {
    const { prisma, state, payment, shiftEvent } = fakeAssignmentPrisma(checkedInAssignment, baseShift);
    vi.useFakeTimers().setSystemTime(new Date(baseShift.endsAt.getTime() + CHECK_OUT_ABANDONED_GRACE_MS + 1000));
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.checkOut('worker-1', 'shift-1')).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_ACTIONABLE', statusCode: 409 });
    expect(state.assignment.status).toBe('ABANDONED');
    // Ver ALTO-2 de CN-20260918-002: antes de esta corrección, `deriveShiftStatus`
    // reabría este turno a `PUBLISHED` aunque `endsAt` ya hubiera pasado, dejándolo
    // "fantasma" (visible como activo, pero inalcanzable desde cualquier endpoint,
    // porque nadie puede postular ni hacer check-in sobre un turno vencido). El
    // turno todavía puede resolverse manualmente vía `resolveAssignment` (no
    // requiere que el turno siga PUBLISHED/ASSIGNED), así que cerrarlo aquí no
    // bloquea el pago si la empresa confirma que el trabajador sí trabajó.
    expect(state.shift.status).toBe('CANCELLED');
    expect(payment.upsert).not.toHaveBeenCalled();
    expect(shiftEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorRole: 'SYSTEM', type: 'CANCELLED', shiftId: 'shift-1' }),
    }));
  });

  it('rejects a check-out on an assignment already resolved as ABANDONED, without touching it again', async () => {
    const { prisma, state, shiftAssignment, payment } = fakeAssignmentPrisma({ ...checkedInAssignment, status: 'ABANDONED' }, baseShift);
    const service = new DatabaseMarketplaceService(prisma as never);

    await expect(service.checkOut('worker-1', 'shift-1')).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_ACTIONABLE', statusCode: 409 });
    expect(shiftAssignment.update).not.toHaveBeenCalled();
    expect(payment.upsert).not.toHaveBeenCalled();
    expect(state.assignment.status).toBe('ABANDONED');
  });
});
