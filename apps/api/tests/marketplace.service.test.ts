import { describe, expect, it, vi } from 'vitest';

import { DatabaseMarketplaceService, DemoMarketplaceService, splitPaymentCents, validateScreeningAnswers } from '../src/modules/marketplace/marketplace.service.js';

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
