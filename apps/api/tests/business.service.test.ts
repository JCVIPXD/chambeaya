import { describe, expect, it, vi } from 'vitest';

import {
  BusinessValidationError,
  DatabaseBusinessService,
} from '../src/modules/business/business.service.js';
import type { AuthSession } from '../src/modules/auth/auth.service.js';

// Este archivo cubre las reglas de negocio de `DatabaseBusinessService` que
// hasta ahora solo se ejercían indirectamente (o nunca) por otras suites:
// `business.routes.test.ts` reemplaza el servicio completo por mocks, por lo
// que la lógica real de `decideShiftApplication`/`updateShift` -incluida la
// prevención de sobrecupo y la de editar/aceptar turnos ya vencidos- no
// tenía ninguna prueba directa antes de este cierre.

const session: AuthSession = {
  token: 'token-business',
  userId: 'business-1',
  role: 'BUSINESS',
  name: 'Restaurante Demo',
  email: 'empresa@example.com',
  identifier: '20123456789',
  requiresPasswordSetup: false,
};

function companyUpsert() {
  return vi.fn(async () => ({ id: 'company-1', ownerId: session.userId, name: session.name }));
}

describe('DatabaseBusinessService.updateShift', () => {
  it('rejects editing a shift whose endsAt already passed, even without touching dates', async () => {
    const expiredShift = {
      id: 'shift-expired',
      companyId: 'company-1',
      status: 'PUBLISHED' as const,
      requiredWorkers: 2,
      confirmedWorkers: 0,
      startsAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: {
        findFirst: vi.fn(async () => expiredShift),
        update: vi.fn(),
      },
      shiftEvent: { create: vi.fn() },
    };
    const service = new DatabaseBusinessService(prisma as never);

    await expect(service.updateShift(session, 'shift-expired', { rescueActive: true }))
      .rejects.toBeInstanceOf(BusinessValidationError);
    await expect(service.updateShift(session, 'shift-expired', { rescueActive: true }))
      .rejects.toMatchObject({ message: 'SHIFT_NOT_EDITABLE' });
    expect(prisma.shift.update).not.toHaveBeenCalled();
  });

  it('allows editing a shift that is still PUBLISHED and has not ended', async () => {
    const activeShift = {
      id: 'shift-active',
      companyId: 'company-1',
      status: 'PUBLISHED' as const,
      requiredWorkers: 2,
      confirmedWorkers: 0,
      startsAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 54 * 60 * 60 * 1000),
    };
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: {
        findFirst: vi.fn(async () => activeShift),
        update: vi.fn(async (args: { data: unknown }) => ({ ...activeShift, ...(args.data as object) })),
      },
      shiftEvent: { create: vi.fn(async () => undefined) },
    };
    const service = new DatabaseBusinessService(prisma as never);

    const updated = await service.updateShift(session, 'shift-active', { rescueActive: true });

    expect(updated).toMatchObject({ rescueActive: true });
    expect(prisma.shift.update).toHaveBeenCalledOnce();
  });
});

describe('DatabaseBusinessService.decideShiftApplication', () => {
  const baseShift = {
    id: 'shift-full',
    companyId: 'company-1',
    status: 'PUBLISHED' as const,
    requiredWorkers: 1,
    confirmedWorkers: 0,
  };

  it('rejects accepting or rejecting an application once the shift has already ended', async () => {
    const expiredShift = { ...baseShift, endsAt: new Date(Date.now() - 60 * 1000) };
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => expiredShift) },
      $transaction: vi.fn(),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await expect(service.decideShiftApplication(session, 'shift-full', 'application-1', 'ACCEPTED'))
      .rejects.toMatchObject({ message: 'SHIFT_NOT_ASSIGNABLE' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects accepting a second application once every required slot is already assigned', async () => {
    const shift = { ...baseShift, endsAt: new Date(Date.now() + 60 * 60 * 1000) };
    const application = { id: 'application-2', workerId: 'worker-2', status: 'PENDING' as const };
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftApplication: { findFirst: vi.fn(async () => application) },
        // Simula que otra postulación ya ocupó el único cupo disponible entre
        // la lectura del turno y la decisión de esta solicitud.
        shiftAssignment: { count: vi.fn(async () => 1), create: vi.fn() },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await expect(service.decideShiftApplication(session, 'shift-full', 'application-2', 'ACCEPTED'))
      .rejects.toMatchObject({ message: 'SHIFT_FULL' });
  });

  it('accepts an application when a slot is still free and persists a single assignment', async () => {
    const shift = { ...baseShift, endsAt: new Date(Date.now() + 60 * 60 * 1000) };
    const application = { id: 'application-1', workerId: 'worker-1', status: 'PENDING' as const };
    const createAssignment = vi.fn(async () => undefined);
    const updateShift = vi.fn(async () => undefined);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift), update: updateShift },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftApplication: {
          findFirst: vi.fn(async () => application),
          update: vi.fn(async () => ({ ...application, status: 'ACCEPTED' })),
        },
        shiftAssignment: { count: vi.fn(async () => 0), create: createAssignment },
        shiftEvent: { create: vi.fn(async () => undefined) },
        shift: { update: updateShift },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.decideShiftApplication(session, 'shift-full', 'application-1', 'ACCEPTED');

    expect(result).toMatchObject({ status: 'ACCEPTED' });
    expect(createAssignment).toHaveBeenCalledOnce();
    expect(updateShift).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ confirmedWorkers: 1, status: 'ASSIGNED' }),
    }));
  });
});

describe('DatabaseBusinessService credential generation', () => {
  it('generates a different check-in credential for each accepted application of the same multi-seat shift', async () => {
    const shift = { id: 'shift-multi', companyId: 'company-1', status: 'PUBLISHED' as const, requiredWorkers: 2, endsAt: new Date(Date.now() + 60 * 60 * 1000) };
    const applications: Record<string, { id: string; workerId: string; status: string }> = {
      'application-1': { id: 'application-1', workerId: 'worker-1', status: 'PENDING' },
      'application-2': { id: 'application-2', workerId: 'worker-2', status: 'PENDING' },
    };
    const createdAssignments: { data: { checkInCredential: string } }[] = [];
    let assignedCount = 0;
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift), update: vi.fn(async () => undefined) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftApplication: {
          findFirst: vi.fn(async ({ where }: { where: { id: string } }) => applications[where.id]),
          update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
            ({ ...applications[where.id], ...data })),
        },
        shiftAssignment: {
          count: vi.fn(async () => assignedCount),
          create: vi.fn(async (args: { data: { checkInCredential: string } }) => {
            createdAssignments.push(args);
            assignedCount += 1;
          }),
        },
        shiftEvent: { create: vi.fn(async () => undefined) },
        shift: { update: vi.fn(async () => undefined) },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await service.decideShiftApplication(session, 'shift-multi', 'application-1', 'ACCEPTED');
    await service.decideShiftApplication(session, 'shift-multi', 'application-2', 'ACCEPTED');

    expect(createdAssignments).toHaveLength(2);
    const credentials = createdAssignments.map((call) => call.data.checkInCredential);
    expect(credentials[0]).toMatch(/^CUMPLE-[0-9A-F]{8}$/);
    expect(credentials[1]).toMatch(/^CUMPLE-[0-9A-F]{8}$/);
    expect(credentials[0]).not.toBe(credentials[1]);
    // La credencial ya no se deriva de `shiftId`: dos asignaciones del mismo
    // turno no deben compartir el sufijo fijo `CUMPLE-${shiftId.slice(-8)}`.
    expect(credentials[0]).not.toBe(`CUMPLE-${shift.id.slice(-8).toUpperCase()}`);
  });
});

describe('DatabaseBusinessService.getShift', () => {
  it('resolves a stale NO_SHOW assignment on read, reopening the shift for reassignment', async () => {
    const shift = {
      id: 'shift-1', companyId: 'company-1', status: 'ASSIGNED' as const, requiredWorkers: 1,
      startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const staleAssignment = { id: 'assignment-1', shiftId: 'shift-1', status: 'ASSIGNED', checkedInAt: null, checkedOutAt: null };
    const assignmentUpdate = vi.fn(async () => undefined);
    const shiftUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...shift, ...data }));
    const shiftEventCreate = vi.fn(async () => undefined);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]) },
      // La escritura relee el turno y las asignaciones DENTRO de la transacción
      // (BAJO-3 de CN-20260918-002); aquí siguen siendo las mismas.
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]), update: assignmentUpdate },
        shiftEvent: { create: shiftEventCreate },
        shift: { findUnique: vi.fn(async () => shift), update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.getShift(session, 'shift-1');

    expect(assignmentUpdate).toHaveBeenCalledWith({ where: { id: 'assignment-1' }, data: { status: 'NO_SHOW' } });
    expect(shiftUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PUBLISHED', confirmedWorkers: 0 } }));
    expect(result).toMatchObject({ status: 'PUBLISHED', confirmedWorkers: 0 });
    // MEDIO-1 de CN-20260918-002: la transición automática deja un rastro de
    // auditoría (`ShiftEvent` con actor `SYSTEM`).
    expect(shiftEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ shiftId: 'shift-1', actorId: null, actorRole: 'SYSTEM', type: 'CANCELLED' }),
    }));
  });

  it('leaves an assignment untouched while it is still within its check-in window', async () => {
    const shift = {
      id: 'shift-2', companyId: 'company-1', status: 'ASSIGNED' as const, requiredWorkers: 1,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
    };
    const freshAssignment = { id: 'assignment-2', shiftId: 'shift-2', status: 'ASSIGNED', checkedInAt: null, checkedOutAt: null };
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => [freshAssignment]) },
      $transaction: vi.fn(),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.getShift(session, 'shift-2');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toBe(shift);
  });

  // BAJO-3 de CN-20260918-002: la lectura previa (fuera de la transacción) solo
  // decide si hay algo que escribir; la decisión y la escritura salen de la
  // relectura hecha dentro de la transacción.
  it('does not write anything when the transaction re-read shows the assignment is no longer ASSIGNED', async () => {
    const shift = {
      id: 'shift-3', companyId: 'company-1', status: 'ASSIGNED' as const, requiredWorkers: 1,
      startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const staleAssignment = { id: 'assignment-3', shiftId: 'shift-3', status: 'ASSIGNED', checkedInAt: null, checkedOutAt: null };
    const currentShift = { ...shift, status: 'PUBLISHED' as const };
    const assignmentUpdate = vi.fn(async () => undefined);
    const shiftUpdate = vi.fn(async () => undefined);
    const shiftEventCreate = vi.fn(async () => undefined);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findMany: vi.fn(async () => [{ ...staleAssignment, status: 'CANCELLED' }]), update: assignmentUpdate },
        shiftEvent: { create: shiftEventCreate },
        shift: { findUnique: vi.fn(async () => currentShift), update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.getShift(session, 'shift-3');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(assignmentUpdate).not.toHaveBeenCalled();
    expect(shiftEventCreate).not.toHaveBeenCalled();
    expect(shiftUpdate).not.toHaveBeenCalled();
    expect(result).toBe(currentShift);
  });

  it('re-reads inside every retry of the lifecycle transaction instead of reusing the stale read', async () => {
    const shift = {
      id: 'shift-4', companyId: 'company-1', status: 'ASSIGNED' as const, requiredWorkers: 1,
      startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const assigned = { id: 'assignment-4', shiftId: 'shift-4', status: 'ASSIGNED', checkedInAt: null, checkedOutAt: null };
    const assignmentUpdate = vi.fn(async () => undefined);
    const txFindMany = vi.fn(async () => [assigned]);
    let attempts = 0;
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => [assigned]) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        attempts += 1;
        const outcome = await callback({
          shiftAssignment: { findMany: txFindMany, update: assignmentUpdate },
          shiftEvent: { create: vi.fn(async () => undefined) },
          shift: { findUnique: vi.fn(async () => shift), update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...shift, ...data })) },
        });
        // El primer intento se aborta por fallo de serialización tras escribir.
        if (attempts === 1) throw Object.assign(new Error('serialization failure'), { code: 'P2034' });
        return outcome;
      }),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await service.getShift(session, 'shift-4');

    expect(attempts).toBe(2);
    expect(txFindMany).toHaveBeenCalledTimes(2);
  });
});

describe('DatabaseBusinessService.listShiftApplications', () => {
  it('resolves a stale ABANDONED assignment before listing, and reports a closed next action for it', async () => {
    const shift = {
      id: 'shift-1', companyId: 'company-1', status: 'CHECKED_IN' as const, requiredWorkers: 1,
      startsAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    };
    const staleAssignment = {
      id: 'assignment-1', shiftId: 'shift-1', status: 'ASSIGNED',
      checkedInAt: new Date(Date.now() - 4 * 60 * 60 * 1000), checkedOutAt: null,
    };
    const assignmentUpdate = vi.fn(async () => undefined);
    const shiftUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...shift, ...data }));
    const shiftEventCreate = vi.fn(async () => undefined);
    const applicationsAfterResolution = [{
      id: 'application-1', status: 'ACCEPTED',
      worker: { id: 'worker-1', name: 'Ana', email: null, identifier: '12345678', talentProfile: null, documents: [] },
      assignment: { ...staleAssignment, status: 'ABANDONED' },
    }];
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]) },
      shiftApplication: { findMany: vi.fn(async () => applicationsAfterResolution) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]), update: assignmentUpdate },
        shiftEvent: { create: shiftEventCreate },
        shift: { findUnique: vi.fn(async () => shift), update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.listShiftApplications(session, 'shift-1');

    expect(assignmentUpdate).toHaveBeenCalledWith({ where: { id: 'assignment-1' }, data: { status: 'ABANDONED' } });
    // Este turno de un cupo ya tiene `endsAt` vencido (ver setup arriba) y su
    // única asignación quedó ABANDONED: por ALTO-2 de CN-20260918-002, el
    // turno se cierra como CANCELLED en vez de reabrir a PUBLISHED, así que
    // el `nextAction` llega a `NONE`/`NONE` por el turno ya terminal (no
    // solo por la asignación ABANDONED).
    expect(shiftUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED', confirmedWorkers: 0 } }));
    expect(result).toEqual([expect.objectContaining({
      id: 'application-1',
      nextAction: expect.objectContaining({ actor: 'NONE', code: 'NONE' }),
    })]);
    expect(shiftEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ shiftId: 'shift-1', actorId: null, actorRole: 'SYSTEM', type: 'CANCELLED' }),
    }));
  });
});

describe('DatabaseBusinessService.resolveAssignment', () => {
  const shift = {
    id: 'shift-1', companyId: 'company-1', status: 'CHECKED_IN' as const, requiredWorkers: 1,
    payCents: 10000, title: 'Mozo',
    startsAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
  };

  function abandonedAssignment(overrides: Partial<{ status: string }> = {}) {
    return {
      id: 'assignment-1', shiftId: 'shift-1', status: 'ABANDONED', completedAt: null,
      shift: { ...shift, company: { id: 'company-1', name: 'Restaurante Demo' } },
      ...overrides,
    };
  }

  it('rejects resolving an assignment that is not ABANDONED', async () => {
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => []) },
      // La asignación se lee dentro de la transacción reintentable.
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findFirst: vi.fn(async () => abandonedAssignment({ status: 'ASSIGNED' })) },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await expect(service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED'))
      .rejects.toMatchObject({ message: 'ASSIGNMENT_NOT_RESOLVABLE' });
  });

  it('rejects resolving an assignment that does not exist on this shift', async () => {
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findFirst: vi.fn(async () => null) },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await expect(service.resolveAssignment(session, 'shift-1', 'assignment-missing', 'COMPLETED'))
      .rejects.toMatchObject({ message: 'ASSIGNMENT_NOT_FOUND' });
  });

  it('creates a Payment when the outcome is COMPLETED, reusing the checkOut payment shape', async () => {
    const paymentUpsert = vi.fn(async (_args: { where: unknown; create: unknown; update: unknown }) => undefined);
    const assignmentUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...abandonedAssignment(), ...data }));
    const shiftUpdate = vi.fn(async () => undefined);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => abandonedAssignment()) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findFirst: vi.fn(async () => abandonedAssignment()), update: assignmentUpdate, findMany: vi.fn(async () => [{ status: 'COMPLETED' }]) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        payment: { upsert: paymentUpsert },
        shift: { update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED', 'Confirmado con el cliente');

    expect(result).toMatchObject({ status: 'COMPLETED' });
    expect(paymentUpsert).toHaveBeenCalledOnce();
    expect(paymentUpsert.mock.calls[0]?.[0]).toMatchObject({
      where: { assignmentId: 'assignment-1' },
      create: expect.objectContaining({ amountCents: 10000, workerCount: 1, status: 'PENDING' }),
    });
  });

  it('does not create a Payment when the outcome is CANCELLED', async () => {
    const paymentUpsert = vi.fn(async () => undefined);
    const assignmentUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...abandonedAssignment(), ...data }));
    const shiftUpdate = vi.fn(async () => undefined);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => abandonedAssignment()) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findFirst: vi.fn(async () => abandonedAssignment()), update: assignmentUpdate, findMany: vi.fn(async () => [{ status: 'CANCELLED' }]) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        payment: { upsert: paymentUpsert },
        shift: { update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'CANCELLED');

    expect(result).toMatchObject({ status: 'CANCELLED' });
    expect(paymentUpsert).not.toHaveBeenCalled();
  });

  // ALTO-1 de CN-20260918-002: antes de esta corrección, un `NO_SHOW` era un
  // callejón sin salida sin ninguna ruta de API para cobrar, aunque el
  // trabajador hubiera llegado tarde y trabajado el turno completo. Ahora
  // `resolveAssignment` acepta también `NO_SHOW`, igual que `ABANDONED`.
  function noShowAssignment(overrides: Partial<{ status: string }> = {}) {
    return {
      id: 'assignment-1', shiftId: 'shift-1', status: 'NO_SHOW', completedAt: null,
      shift: { ...shift, company: { id: 'company-1', name: 'Restaurante Demo' } },
      ...overrides,
    };
  }

  it('accepts resolving a NO_SHOW assignment as CANCELLED (no payment)', async () => {
    const paymentUpsert = vi.fn(async () => undefined);
    const assignmentUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...noShowAssignment(), ...data }));
    const shiftUpdate = vi.fn(async () => undefined);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => noShowAssignment()) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findFirst: vi.fn(async () => noShowAssignment()), update: assignmentUpdate, findMany: vi.fn(async () => [{ status: 'CANCELLED' }]) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        payment: { upsert: paymentUpsert },
        shift: { update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'CANCELLED');

    expect(result).toMatchObject({ status: 'CANCELLED' });
    expect(paymentUpsert).not.toHaveBeenCalled();
  });

  it('accepts resolving a NO_SHOW assignment as COMPLETED, creating a Payment when the company confirms the worker did show up and work', async () => {
    const paymentUpsert = vi.fn(async (_args: { where: unknown; create: unknown; update: unknown }) => undefined);
    const assignmentUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...noShowAssignment(), ...data }));
    const shiftUpdate = vi.fn(async () => undefined);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => noShowAssignment()) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findFirst: vi.fn(async () => noShowAssignment()), update: assignmentUpdate, findMany: vi.fn(async () => [{ status: 'COMPLETED' }]) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        payment: { upsert: paymentUpsert },
        shift: { update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED', 'Llegó tarde a registrar pero trabajó el turno completo');

    expect(result).toMatchObject({ status: 'COMPLETED' });
    expect(paymentUpsert).toHaveBeenCalledOnce();
    expect(paymentUpsert.mock.calls[0]?.[0]).toMatchObject({
      where: { assignmentId: 'assignment-1' },
      create: expect.objectContaining({ amountCents: 10000, workerCount: 1, status: 'PENDING' }),
    });
  });

  // ALTO-2 de CN-20260918-002: un turno de un solo cupo cuya única asignación
  // se resuelve como CANCELLED (desde ABANDONED o NO_SHOW) y cuyo endsAt ya
  // pasó no debe "reabrir" a PUBLISHED -quedaría inalcanzable desde cualquier
  // endpoint (cancelShift/deleteShift/updateShift lo rechazan, y nadie puede
  // postular ni hacer check-in sobre un endsAt vencido)-, sino cerrarse como
  // CANCELLED.
  it('closes a single-seat shift as CANCELLED instead of reopening it to PUBLISHED when its only assignment is resolved as CANCELLED past endsAt', async () => {
    const shiftUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...shift, ...data }));
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => abandonedAssignment()),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { findFirst: vi.fn(async () => abandonedAssignment()), update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...abandonedAssignment(), ...data })), findMany: vi.fn(async () => [{ status: 'CANCELLED' }]) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        payment: { upsert: vi.fn(async () => undefined) },
        shift: { update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'CANCELLED');

    expect(shiftUpdate).toHaveBeenCalledWith({ where: { id: 'shift-1' }, data: { status: 'CANCELLED', confirmedWorkers: 0 } });
  });

  // BAJO-5 de CN-20260918-004: `resolveAssignment` calculaba el estado del
  // turno con la lectura previa (`owned.status`) y descartaba el turno que
  // devuelve el ciclo de vida. Un turno que el propio ciclo de vencimiento
  // cerró como `CANCELLED` ("sin asignaciones viables") quedaba `CANCELLED`
  // aunque la empresa confirmara que el trabajo sí ocurrió y ya existiera el
  // pago. Estas pruebas fijan la regla: se reabre solo ese cierre automático y
  // solo si el turno queda `COMPLETED` (MEDIO-2 de CN-20260920-004: un
  // multi-cupo con cupos sin cerrar se mantiene `CANCELLED`).
  describe('estado del turno al resolver sobre un turno ya cerrado como CANCELLED', () => {
    const closedShift = { ...shift, status: 'CANCELLED' as const };

    type CancellationRow = { id: string; shiftId: string; assignmentId: string | null; actorRole: 'WORKER' | 'BUSINESS' };
    // Filas de `ShiftCancellation` tal como las escriben las dos únicas rutas
    // reales: `cancelShift` (empresa, sin `assignmentId`) y
    // `marketplace.cancelAssignment` (trabajador; `assignmentId` nulo si la
    // postulación aún estaba `PENDING`, o si la asignación se borró después).
    const companyCancellation: CancellationRow = { id: 'cancellation-company', shiftId: 'shift-1', assignmentId: null, actorRole: 'BUSINESS' };
    const workerCancellationOnPendingApplication: CancellationRow = { id: 'cancellation-worker-pending', shiftId: 'shift-1', assignmentId: null, actorRole: 'WORKER' };
    const workerCancellationOnAssignment: CancellationRow = { id: 'cancellation-worker-assigned', shiftId: 'shift-1', assignmentId: 'assignment-9', actorRole: 'WORKER' };
    const companyCancellationOfAnotherShift: CancellationRow = { id: 'cancellation-other-shift', shiftId: 'shift-otro', assignmentId: null, actorRole: 'BUSINESS' };

    // Evalúa el `where` recibido contra las filas de prueba (igualdad simple por
    // columna) en vez de devolver un valor fijo: así las pruebas verifican el
    // comportamiento de la consulta y no su forma literal.
    function cancellationFindFirstOver(rows: CancellationRow[]) {
      return vi.fn(async ({ where }: { where: Record<string, unknown>; select?: unknown }) => {
        const match = rows.find((row) => Object.entries(where).every(([column, expected]) => (row as Record<string, unknown>)[column] === expected));
        return match ? { id: match.id } : null;
      });
    }

    const reopenedStatus = { where: { id: 'shift-1' }, data: { status: 'COMPLETED', confirmedWorkers: 0 } };
    const stillCancelled = { where: { id: 'shift-1' }, data: { status: 'CANCELLED', confirmedWorkers: 0 } };

    function scenario(options: {
      shiftRow?: Record<string, unknown>;
      source?: string;
      assignmentsAfterUpdate?: { status: string }[];
      cancellations?: CancellationRow[];
    } = {}) {
      const shiftRow = options.shiftRow ?? closedShift;
      const source = options.source ?? 'NO_SHOW';
      const assignmentRow = { ...noShowAssignment({ status: source }), shift: { ...shiftRow, company: { id: 'company-1', name: 'Restaurante Demo' } } };
      const paymentUpsert = vi.fn(async (_args: { where: unknown; create: unknown; update: unknown }) => undefined);
      const shiftUpdate = vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => undefined);
      const shiftEventCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => undefined);
      const cancellationFindFirst = cancellationFindFirstOver(options.cancellations ?? []);
      const prisma = {
        company: { upsert: companyUpsert() },
        shift: { findFirst: vi.fn(async () => shiftRow) },
        shiftAssignment: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => assignmentRow) },
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
          shiftAssignment: { findFirst: vi.fn(async () => assignmentRow),
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...assignmentRow, ...data })),
            findMany: vi.fn(async () => options.assignmentsAfterUpdate ?? [{ status: 'COMPLETED' }]),
          },
          shiftEvent: { create: shiftEventCreate },
          payment: { upsert: paymentUpsert },
          shift: { update: shiftUpdate },
          shiftCancellation: { findFirst: cancellationFindFirst },
        })),
      };
      return { service: new DatabaseBusinessService(prisma as never), paymentUpsert, shiftUpdate, shiftEventCreate, cancellationFindFirst };
    }

    it.each(['NO_SHOW', 'ABANDONED'] as const)('deja de figurar CANCELLED al confirmar COMPLETED una asignación %s cuando el cierre lo puso el vencimiento, con un solo pago', async (source) => {
      const { service, paymentUpsert, shiftUpdate, shiftEventCreate, cancellationFindFirst } = scenario({ source });

      const result = await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

      expect(result).toMatchObject({ status: 'COMPLETED' });
      expect(shiftUpdate).toHaveBeenCalledOnce();
      expect(shiftUpdate).toHaveBeenCalledWith(reopenedStatus);
      expect(paymentUpsert).toHaveBeenCalledOnce();
      expect(paymentUpsert.mock.calls[0]?.[0]).toMatchObject({ where: { assignmentId: 'assignment-1' }, create: expect.objectContaining({ status: 'PENDING', amountCents: 10000 }) });
      // La distinción se hace por el rastro de la cancelación de la empresa.
      expect(cancellationFindFirst).toHaveBeenCalledOnce();
      // Rastro de la transición: el cierre del turno y el del pago quedan en
      // `ShiftEvent`, y el de la transición conserva quién la ejecutó.
      expect(shiftEventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'COMPLETED', actorRole: 'BUSINESS' }) });
      expect(shiftEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'UPDATED', actorRole: 'BUSINESS', actorId: session.userId, detail: expect.stringContaining('pasó de CANCELLED a COMPLETED') }),
      });
    });

    it('no reabre un turno que la propia empresa canceló (cancelShift): sigue CANCELLED aunque el pago quede registrado', async () => {
      const { service, paymentUpsert, shiftUpdate, shiftEventCreate } = scenario({ cancellations: [companyCancellation] });

      await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

      expect(shiftUpdate).toHaveBeenCalledWith(stillCancelled);
      expect(paymentUpsert).toHaveBeenCalledOnce();
      expect(shiftEventCreate).not.toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'UPDATED' }) });
    });

    it('no reabre si la empresa canceló el turno aunque también existan cancelaciones de trabajadores', async () => {
      const { service, shiftUpdate } = scenario({ cancellations: [workerCancellationOnPendingApplication, workerCancellationOnAssignment, companyCancellation] });

      await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

      expect(shiftUpdate).toHaveBeenCalledWith(stillCancelled);
    });

    // MEDIO-1 de CN-20260920-004: un trabajador que cancela su postulación
    // todavía `PENDING` deja un `ShiftCancellation` con `assignmentId` nulo
    // (`marketplace.cancelAssignment` no tiene asignación que enlazar). Eso no es
    // una cancelación de la empresa y no debe impedir reabrir el cierre por
    // vencimiento; tampoco la de un trabajador con asignación ni la de otro turno.
    it.each([
      ['una cancelación de un trabajador sobre una postulación pendiente (assignmentId nulo)', [workerCancellationOnPendingApplication]],
      ['una cancelación de un trabajador sobre una asignación (assignmentId presente)', [workerCancellationOnAssignment]],
      ['ambas cancelaciones de trabajadores a la vez', [workerCancellationOnPendingApplication, workerCancellationOnAssignment]],
      ['una cancelación de la empresa pero de OTRO turno', [companyCancellationOfAnotherShift]],
    ])('sí reabre el cierre por vencimiento pese a %s', async (_label, cancellations) => {
      const { service, paymentUpsert, shiftUpdate, shiftEventCreate } = scenario({ cancellations });

      await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

      expect(shiftUpdate).toHaveBeenCalledWith(reopenedStatus);
      expect(paymentUpsert).toHaveBeenCalledOnce();
      expect(shiftEventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'UPDATED', actorId: session.userId }) });
    });

    it('no reabre un turno CANCELLED cuyo endsAt aún no vence (no puede ser un cierre por vencimiento) y ni siquiera consulta cancelaciones', async () => {
      const futureShift = { ...closedShift, endsAt: new Date(Date.now() + 60 * 60 * 1000) };
      const { service, shiftUpdate, cancellationFindFirst } = scenario({ shiftRow: futureShift });

      await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

      expect(shiftUpdate).toHaveBeenCalledWith(stillCancelled);
      expect(cancellationFindFirst).not.toHaveBeenCalled();
    });

    // Frontera de `current.endsAt <= ahora` con el reloj congelado: un `endsAt`
    // exactamente igual al instante de la confirmación ya cuenta como vencido
    // (BAJO-3 de CN-20260920-004); un milisegundo en el futuro, no.
    it('endsAt exactamente igual a "ahora" cuenta como vencido y reabre; un milisegundo después no', async () => {
      const frozen = new Date('2026-09-20T15:00:00.000Z');
      vi.useFakeTimers({ now: frozen, toFake: ['Date'] });
      try {
        const atBoundary = scenario({ shiftRow: { ...closedShift, endsAt: new Date(frozen.getTime()) } });
        await atBoundary.service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');
        expect(atBoundary.shiftUpdate).toHaveBeenCalledWith(reopenedStatus);

        const justAfter = scenario({ shiftRow: { ...closedShift, endsAt: new Date(frozen.getTime() + 1) } });
        await justAfter.service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');
        expect(justAfter.shiftUpdate).toHaveBeenCalledWith(stillCancelled);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cerrar sin pago (CANCELLED) no toca el estado del turno, no crea pago ni consulta cancelaciones', async () => {
      const { service, paymentUpsert, shiftUpdate, shiftEventCreate, cancellationFindFirst } = scenario({ assignmentsAfterUpdate: [{ status: 'CANCELLED' }] });

      const result = await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'CANCELLED');

      expect(result).toMatchObject({ status: 'CANCELLED' });
      expect(shiftUpdate).toHaveBeenCalledWith(stillCancelled);
      expect(paymentUpsert).not.toHaveBeenCalled();
      expect(cancellationFindFirst).not.toHaveBeenCalled();
      expect(shiftEventCreate).not.toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'UPDATED' }) });
    });

    // MEDIO-2 de CN-20260920-004: reabrir a `CHECKED_IN` dejaba el turno
    // multi-cupo vencido inalcanzable (ningún endpoint lo mueve). Solo se
    // reabre si el recálculo da `COMPLETED`; el pago se registra en ambos casos.
    it('en un turno multi-cupo cerrado por vencimiento, confirmar un cupo deja el turno CANCELLED (con su pago) y confirmar el último lo completa', async () => {
      const multiSeat = { ...closedShift, requiredWorkers: 2 };
      const partial = scenario({ shiftRow: multiSeat, assignmentsAfterUpdate: [{ status: 'COMPLETED' }, { status: 'NO_SHOW' }] });
      await partial.service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');
      expect(partial.shiftUpdate).toHaveBeenCalledWith(stillCancelled);
      expect(partial.paymentUpsert).toHaveBeenCalledOnce();
      expect(partial.cancellationFindFirst).not.toHaveBeenCalled();
      expect(partial.shiftEventCreate).not.toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'UPDATED' }) });

      const full = scenario({ shiftRow: multiSeat, assignmentsAfterUpdate: [{ status: 'COMPLETED' }, { status: 'COMPLETED' }] });
      await full.service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');
      expect(full.shiftUpdate).toHaveBeenCalledWith(reopenedStatus);
      expect(full.paymentUpsert).toHaveBeenCalledOnce();
    });

    it('un turno multi-cupo vencido nunca queda en CHECKED_IN: con un cupo COMPLETED y los demás ABANDONED/NO_SHOW se mantiene CANCELLED', async () => {
      const multiSeat = { ...closedShift, requiredWorkers: 3 };
      const { service, shiftUpdate } = scenario({
        shiftRow: multiSeat,
        source: 'ABANDONED',
        assignmentsAfterUpdate: [{ status: 'COMPLETED' }, { status: 'ABANDONED' }, { status: 'NO_SHOW' }],
      });

      await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

      expect(shiftUpdate.mock.calls.map(([args]) => args.data.status)).toEqual(['CANCELLED']);
    });

    it('primer contacto: si la propia resolución automática cierra el turno como CANCELLED, se reabre igual que si ya estuviera persistido', async () => {
      // La lectura inicial (`owned`) aún dice ASSIGNED; el ciclo de vida marca
      // NO_SHOW y devuelve el turno CANCELLED. Ese turno actualizado es la base.
      const freshShift = { ...shift, status: 'ASSIGNED' as const };
      const staleAssignment = { id: 'assignment-1', shiftId: 'shift-1', status: 'ASSIGNED', checkedInAt: null, checkedOutAt: null };
      const noShow = { ...noShowAssignment(), shift: { ...freshShift, company: { id: 'company-1', name: 'Restaurante Demo' } } };
      // Dentro de la transacción el turno ya se relee con lo que persistió el ciclo de vida.
      const noShowInTx = { ...noShow, shift: { ...noShow.shift, status: 'CANCELLED' as const } };
      const shiftUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...freshShift, ...data }));
      const shiftEventCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => undefined);
      // Compartido por las dos transacciones: 1.ª lectura, la del ciclo de vida; las siguientes, la de la resolución.
      const txAssignmentsFindMany = vi.fn().mockImplementationOnce(async () => [staleAssignment]).mockImplementation(async () => [{ status: 'COMPLETED' }]);
      const prisma = {
        company: { upsert: companyUpsert() },
        shift: { findFirst: vi.fn(async () => freshShift) },
        shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]) },
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
          shiftAssignment: { findFirst: vi.fn(async () => noShowInTx),
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...noShow, ...data })),
            findMany: txAssignmentsFindMany,
          },
          shiftEvent: { create: shiftEventCreate },
          payment: { upsert: vi.fn(async () => undefined) },
          shift: { findUnique: vi.fn(async () => freshShift), update: shiftUpdate },
          shiftCancellation: { findFirst: cancellationFindFirstOver([]) },
        })),
      };
      const service = new DatabaseBusinessService(prisma as never);

      await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

      // 1.ª escritura: el ciclo de vida cierra el turno (CANCELLED); 2.ª: la resolución lo reabre a COMPLETED.
      expect(shiftUpdate.mock.calls.map(([args]) => args.data.status)).toEqual(['CANCELLED', 'COMPLETED']);
      expect(shiftEventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'UPDATED', actorId: session.userId, detail: expect.stringContaining('pasó de CANCELLED a COMPLETED') }) });
    });

    it('la base es el turno que devuelve el ciclo de vida, no la lectura previa: si ese turno figura cancelado por la empresa, no se reabre aunque la lectura previa dijera ASSIGNED', async () => {
      const staleRead = { ...shift, status: 'ASSIGNED' as const };
      const staleAssignment = { id: 'assignment-1', shiftId: 'shift-1', status: 'ASSIGNED', checkedInAt: null, checkedOutAt: null };
      const noShow = { ...noShowAssignment(), shift: { ...staleRead, company: { id: 'company-1', name: 'Restaurante Demo' } } };
      const noShowInTx = { ...noShow, shift: { ...noShow.shift, status: 'CANCELLED' as const } };
      const shiftUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...staleRead, ...data }));
      // Compartido por las dos transacciones: 1.ª lectura, la del ciclo de vida; las siguientes, la de la resolución.
      const txAssignmentsFindMany = vi.fn().mockImplementationOnce(async () => [staleAssignment]).mockImplementation(async () => [{ status: 'COMPLETED' }]);
      const prisma = {
        company: { upsert: companyUpsert() },
        shift: { findFirst: vi.fn(async () => staleRead) },
        shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]) },
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
          shiftAssignment: { findFirst: vi.fn(async () => noShowInTx),
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...noShow, ...data })),
            findMany: txAssignmentsFindMany,
          },
          shiftEvent: { create: vi.fn(async () => undefined) },
          payment: { upsert: vi.fn(async () => undefined) },
          shift: { findUnique: vi.fn(async () => staleRead), update: shiftUpdate },
          shiftCancellation: { findFirst: cancellationFindFirstOver([companyCancellation]) },
        })),
      };
      const service = new DatabaseBusinessService(prisma as never);

      await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

      expect(shiftUpdate.mock.calls.map(([args]) => args.data.status)).toEqual(['CANCELLED', 'CANCELLED']);
    });

    it('rechaza una asignación que no es NO_SHOW/ABANDONED sin tocar el turno ni crear pago', async () => {
      for (const status of ['ASSIGNED', 'COMPLETED', 'CANCELLED']) {
        const { service, paymentUpsert, shiftUpdate } = scenario({ source: status });

        await expect(service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED'))
          .rejects.toMatchObject({ message: 'ASSIGNMENT_NOT_RESOLVABLE' });
        expect(paymentUpsert).not.toHaveBeenCalled();
        expect(shiftUpdate).not.toHaveBeenCalled();
      }
    });

    // Punto 2 de CN-20260922-013: antes, la reapertura de un turno cerrado
    // por vencimiento exigía que ESTA llamada resolviera con outcome
    // COMPLETED. Si el último cupo pendiente se resuelve como CANCELLED
    // pero OTRO cupo ya se había completado en una llamada anterior, el
    // recálculo real da COMPLETED igual (con el fix del punto 1), pero la
    // condición vieja (`outcome === 'COMPLETED'`) ni siquiera intentaba
    // recalcular y el turno se quedaba CANCELLED para siempre pese a que ya
    // no quedaba ninguna decisión pendiente.
    it('reabre a COMPLETED un turno cerrado por vencimiento cuando ESTA llamada resuelve el último cupo pendiente como CANCELLED pero otro cupo ya se había completado antes', async () => {
      const multiSeat = { ...closedShift, requiredWorkers: 2 };
      const { service, shiftUpdate, paymentUpsert, cancellationFindFirst } = scenario({
        shiftRow: multiSeat,
        source: 'NO_SHOW',
        assignmentsAfterUpdate: [{ status: 'COMPLETED' }, { status: 'CANCELLED' }],
      });

      const result = await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'CANCELLED');

      expect(result).toMatchObject({ status: 'CANCELLED' });
      expect(shiftUpdate).toHaveBeenCalledWith(reopenedStatus);
      expect(cancellationFindFirst).toHaveBeenCalledOnce();
      // Esta llamada en particular resuelve CANCELLED (sin pago); el pago
      // del cupo que sí completó ya se generó en la llamada anterior.
      expect(paymentUpsert).not.toHaveBeenCalled();
    });

    // BAJO-2 de CN-20260923-001: el rastro de auditoría debe nombrar lo que
    // hizo ESTA llamada (cerrar sin pago), no decir que se confirmó trabajo.
    it('el evento UPDATED de una reapertura disparada por "Cerrar sin pago" dice que se cerró sin pago, y el de una confirmación sigue diciendo que se confirmó el trabajo', async () => {
      const multiSeat = { ...closedShift, requiredWorkers: 2 };
      const closedWithoutPay = scenario({
        shiftRow: multiSeat,
        source: 'NO_SHOW',
        assignmentsAfterUpdate: [{ status: 'COMPLETED' }, { status: 'CANCELLED' }],
      });
      await closedWithoutPay.service.resolveAssignment(session, 'shift-1', 'assignment-1', 'CANCELLED');
      const closedDetail = closedWithoutPay.shiftEventCreate.mock.calls
        .map(([args]) => args.data)
        .find((data) => data.type === 'UPDATED')?.detail as string;
      expect(closedDetail).toContain('pasó de CANCELLED a COMPLETED');
      expect(closedDetail).toContain('al cerrar la empresa sin pago la asignación assignment-1');
      expect(closedDetail).not.toContain('al confirmar la empresa el trabajo');

      const confirmed = scenario({ shiftRow: multiSeat, assignmentsAfterUpdate: [{ status: 'COMPLETED' }, { status: 'COMPLETED' }] });
      await confirmed.service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');
      const confirmedDetail = confirmed.shiftEventCreate.mock.calls
        .map(([args]) => args.data)
        .find((data) => data.type === 'UPDATED')?.detail as string;
      expect(confirmedDetail).toContain('al confirmar la empresa el trabajo de la asignación assignment-1');
      expect(confirmedDetail).not.toContain('sin pago');
    });

    it('no reabre (sigue CANCELLED) cuando esta llamada resuelve CANCELLED y ningún otro cupo completó', async () => {
      const multiSeat = { ...closedShift, requiredWorkers: 2 };
      const { service, shiftUpdate, cancellationFindFirst } = scenario({
        shiftRow: multiSeat,
        source: 'NO_SHOW',
        assignmentsAfterUpdate: [{ status: 'CANCELLED' }, { status: 'CANCELLED' }],
      });

      await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'CANCELLED');

      expect(shiftUpdate).toHaveBeenCalledWith(stillCancelled);
      // El recálculo (`deriveShiftStatus('PUBLISHED', ...)`) sí se ejecuta
      // (ya no depende del outcome de esta llamada), pero da CANCELLED
      // -ningún cupo completó-, así que ni siquiera llega a consultar si la
      // empresa canceló el turno: no hay nada que reabrir.
      expect(cancellationFindFirst).not.toHaveBeenCalled();
    });

    it('rechaza resolver una asignación de un turno de otra empresa: el turno se busca filtrado por la empresa de la sesión y nada se escribe', async () => {
      const shiftFindFirst = vi.fn(async (_args: { where: Record<string, unknown> }) => null);
      const prisma = {
        company: { upsert: companyUpsert() },
        shift: { findFirst: shiftFindFirst },
        shiftAssignment: { findMany: vi.fn(), findFirst: vi.fn() },
        $transaction: vi.fn(),
      };
      const service = new DatabaseBusinessService(prisma as never);

      await expect(service.resolveAssignment(session, 'shift-ajeno', 'assignment-1', 'COMPLETED'))
        .rejects.toMatchObject({ message: 'SHIFT_NOT_FOUND' });
      expect(shiftFindFirst).toHaveBeenCalledWith({ where: { id: 'shift-ajeno', companyId: 'company-1' } });
      expect(prisma.shiftAssignment.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});

describe('DatabaseBusinessService.cancelShift', () => {
  it('still allows cancelling an already-ended, never-covered shift', async () => {
    const expiredShift = {
      id: 'shift-no-show',
      companyId: 'company-1',
      status: 'PUBLISHED' as const,
      endsAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => expiredShift) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => undefined) },
        shiftApplication: { updateMany: vi.fn(async () => undefined) },
        shiftCancellation: { create: vi.fn(async () => undefined) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        shift: { findUnique: vi.fn(async () => expiredShift), update: vi.fn(async () => ({ ...expiredShift, status: 'CANCELLED' })) },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const cancelled = await service.cancelShift(session, 'shift-no-show', 'Nunca se cubrió y ya venció');

    expect(cancelled).toMatchObject({ status: 'CANCELLED' });
  });

  // Punto 3 de CN-20260922-013: `cancelShift` solo volcaba a CANCELLED las
  // asignaciones `ASSIGNED`. Una asignación `NO_SHOW` que quedó sin resolver
  // (posible: el guard de `checkedInAt` no la bloquea, porque `NO_SHOW`
  // nunca hizo check-in) sobrevivía intacta y seguía siendo resoluble vía
  // `resolveAssignment` después de que la empresa ya canceló el turno
  // completo, generando un `Payment` sobre un turno `CANCELLED`.
  // `ABANDONED` no puede coexistir con un turno cancelable (exige
  // `checkedInAt` no nulo, y el guard de `checkedIn > 0` ya bloquea la
  // cancelación en ese caso), así que basta con sumar `NO_SHOW` al filtro.
  it('also cancels a lingering unresolved NO_SHOW assignment, so it stops being resolvable once the company cancels the whole shift', async () => {
    const shift = {
      id: 'shift-1',
      companyId: 'company-1',
      status: 'PUBLISHED' as const,
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const assignmentUpdateMany = vi.fn(async () => undefined);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { count: vi.fn(async () => 0), updateMany: assignmentUpdateMany },
        shiftApplication: { updateMany: vi.fn(async () => undefined) },
        shiftCancellation: { create: vi.fn(async () => undefined) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        shift: { findUnique: vi.fn(async () => shift), update: vi.fn(async () => ({ ...shift, status: 'CANCELLED' })) },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await service.cancelShift(session, 'shift-1', 'La empresa ya no lo necesita');

    expect(assignmentUpdateMany).toHaveBeenCalledWith({
      where: { shiftId: 'shift-1', status: { in: ['ASSIGNED', 'NO_SHOW'] } },
      data: { status: 'CANCELLED' },
    });
  });
});

// BAJO-1 y BAJO-2 de CN-20260920-004: `cancelShift` corría sin aislamiento y
// sus guards se evaluaban fuera de la transacción, así que un
// `resolveAssignment` concurrente (Serializable) no quedaba aislado de él ni un
// reintento volvía a leer el estado. Ahora es Serializable con reintento
// (`P2034`) y el turno y las asignaciones se leen dentro de cada intento.
describe('DatabaseBusinessService.cancelShift: aislamiento y lecturas dentro de la transacción', () => {
  const futureShift = { id: 'shift-1', companyId: 'company-1', status: 'PUBLISHED' as const, endsAt: new Date(Date.now() + 60 * 60 * 1000) };
  const serializationConflict = () => Object.assign(new Error('write conflict'), { code: 'P2034' });

  function attempts(txs: Record<string, unknown>[]) {
    let next = 0;
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>, _options?: unknown) => callback(txs[Math.min(next++, txs.length - 1)]));
    const prisma = { company: { upsert: companyUpsert() }, shift: { findFirst: vi.fn(async () => futureShift) }, $transaction: transaction };
    return { transaction, service: new DatabaseBusinessService(prisma as never) };
  }
  function tx(overrides: { status?: string; checkedIn?: number; failUpdateOnce?: boolean } = {}) {
    let failed = false;
    return {
      shift: {
        findUnique: vi.fn(async () => ({ ...futureShift, status: overrides.status ?? 'PUBLISHED' })),
        update: vi.fn(async () => {
          if (overrides.failUpdateOnce && !failed) { failed = true; throw serializationConflict(); }
          return { ...futureShift, status: 'CANCELLED' };
        }),
      },
      shiftAssignment: { count: vi.fn(async () => overrides.checkedIn ?? 0), updateMany: vi.fn(async () => undefined) },
      shiftApplication: { updateMany: vi.fn(async () => undefined) },
      shiftCancellation: { create: vi.fn(async () => undefined) },
      shiftEvent: { create: vi.fn(async () => undefined) },
    };
  }

  it('opens its transaction with Serializable isolation', async () => {
    const { transaction, service } = attempts([tx()]);

    await service.cancelShift(session, 'shift-1', 'La empresa ya no lo necesita');

    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'Serializable' });
  });

  it('retries on a serialization conflict and re-reads the shift and its check-ins in every attempt', async () => {
    // 1.er intento: turno cancelable, pero la escritura choca con otra transacción.
    // 2.º intento: esa otra transacción fue un check-in; el turno ya no es cancelable.
    const first = tx({ failUpdateOnce: true });
    const second = tx({ status: 'CHECKED_IN' });
    const { transaction, service } = attempts([first, second]);

    await expect(service.cancelShift(session, 'shift-1', 'La empresa ya no lo necesita'))
      .rejects.toMatchObject({ message: 'SHIFT_NOT_CANCELLABLE' });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(first.shift.findUnique).toHaveBeenCalledOnce();
    expect(second.shift.findUnique).toHaveBeenCalledOnce();
    expect(second.shiftAssignment.updateMany).not.toHaveBeenCalled();
    expect(second.shiftCancellation.create).not.toHaveBeenCalled();
  });

  it('re-evaluates the check-in guard on the retry too', async () => {
    const { transaction, service } = attempts([tx({ failUpdateOnce: true }), tx({ checkedIn: 1 })]);

    await expect(service.cancelShift(session, 'shift-1', 'La empresa ya no lo necesita'))
      .rejects.toMatchObject({ message: 'SHIFT_NOT_CANCELLABLE' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the retry when the conflicting transaction left the shift cancellable', async () => {
    const { transaction, service } = attempts([tx({ failUpdateOnce: true }), tx()]);

    const cancelled = await service.cancelShift(session, 'shift-1', 'La empresa ya no lo necesita');

    expect(cancelled).toMatchObject({ status: 'CANCELLED' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it.each(['CHECKED_IN', 'COMPLETED', 'CANCELLED'])('rejects a %s shift without writing anything', async (status) => {
    const attempt = tx({ status });
    const { service } = attempts([attempt]);

    await expect(service.cancelShift(session, 'shift-1', 'La empresa ya no lo necesita'))
      .rejects.toMatchObject({ message: 'SHIFT_NOT_CANCELLABLE' });
    expect(attempt.shift.update).not.toHaveBeenCalled();
    expect(attempt.shiftAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('does not open a transaction when the shift belongs to another company', async () => {
    const prisma = { company: { upsert: companyUpsert() }, shift: { findFirst: vi.fn(async () => null) }, $transaction: vi.fn() };
    const service = new DatabaseBusinessService(prisma as never);

    await expect(service.cancelShift(session, 'shift-ajeno', 'La empresa ya no lo necesita'))
      .rejects.toMatchObject({ message: 'SHIFT_NOT_FOUND' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('DatabaseBusinessService.resolveAssignment: lecturas dentro de la transacción reintentable', () => {
  const past = { startsAt: new Date(Date.now() - 5 * 60 * 60 * 1000), endsAt: new Date(Date.now() - 3 * 60 * 60 * 1000) };
  const baseShift = { id: 'shift-1', companyId: 'company-1', status: 'CANCELLED' as const, requiredWorkers: 1, payCents: 10000, title: 'Mozo', ...past };
  const serializationConflict = () => Object.assign(new Error('write conflict'), { code: 'P2034' });

  function assignmentRow(status: string, shiftStatus: string) {
    return { id: 'assignment-1', shiftId: 'shift-1', status, completedAt: null, shift: { ...baseShift, status: shiftStatus, company: { id: 'company-1', name: 'Restaurante Demo' } } };
  }
  function harness(reads: { status: string; shiftStatus: string }[], options: { conflictOnFirstUpdate?: boolean } = {}) {
    let read = 0;
    let conflicted = false;
    const paymentUpsert = vi.fn(async (_args: unknown) => undefined);
    const shiftUpdate = vi.fn(async (_args: { data: Record<string, unknown> }) => undefined);
    const findFirst = vi.fn(async () => {
      const next = reads[Math.min(read++, reads.length - 1)];
      return assignmentRow(next.status, next.shiftStatus);
    });
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>, _options?: unknown) => callback({
      shiftAssignment: {
        findFirst,
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (options.conflictOnFirstUpdate && !conflicted) { conflicted = true; throw serializationConflict(); }
          return { ...assignmentRow('NO_SHOW', 'CANCELLED'), ...data };
        }),
        findMany: vi.fn(async () => [{ status: 'COMPLETED' }]),
      },
      shiftEvent: { create: vi.fn(async () => undefined) },
      payment: { upsert: paymentUpsert },
      shift: { update: shiftUpdate },
      shiftCancellation: { findFirst: vi.fn(async () => null) },
    }));
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => ({ ...baseShift, status: 'CHECKED_IN' })) },
      shiftAssignment: { findMany: vi.fn(async () => []) },
      $transaction: transaction,
    };
    return { service: new DatabaseBusinessService(prisma as never), transaction, findFirst, paymentUpsert, shiftUpdate };
  }

  it('opens its transaction with Serializable isolation', async () => {
    const { service, transaction } = harness([{ status: 'NO_SHOW', shiftStatus: 'CANCELLED' }]);

    await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

    expect(transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'Serializable' });
  });

  // La carrera con cancelShift: la resolución lee la asignación NO_SHOW, choca
  // con la cancelación del turno (que la deja CANCELLED) y en el reintento debe
  // ver esa cancelación. Con la lectura fuera de la transacción, el reintento
  // pisaba la asignación cancelada y registraba un pago sobre un turno cancelado.
  it('on a retry after cancelShift won the race, it sees the CANCELLED assignment and neither overwrites it nor creates a payment', async () => {
    const { service, transaction, findFirst, paymentUpsert, shiftUpdate } = harness(
      [{ status: 'NO_SHOW', shiftStatus: 'CHECKED_IN' }, { status: 'CANCELLED', shiftStatus: 'CANCELLED' }],
      { conflictOnFirstUpdate: true },
    );

    await expect(service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED'))
      .rejects.toMatchObject({ message: 'ASSIGNMENT_NOT_RESOLVABLE' });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(paymentUpsert).not.toHaveBeenCalled();
    expect(shiftUpdate).not.toHaveBeenCalled();
  });

  it('recomputes the shift state from the shift re-read on the retry, not from the one read on the first attempt', async () => {
    // 1.er intento: turno CHECKED_IN. Choque. 2.º intento: el turno ya figura CANCELLED
    // (cerrado por vencimiento) y la empresa no lo canceló: se reabre a COMPLETED.
    const { service, shiftUpdate, paymentUpsert } = harness(
      [{ status: 'NO_SHOW', shiftStatus: 'CHECKED_IN' }, { status: 'NO_SHOW', shiftStatus: 'CANCELLED' }],
      { conflictOnFirstUpdate: true },
    );

    await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED');

    expect(paymentUpsert).toHaveBeenCalledOnce();
    expect(shiftUpdate).toHaveBeenCalledWith({ where: { id: 'shift-1' }, data: { status: 'COMPLETED', confirmedWorkers: 0 } });
  });
});

// CN-20260918-005 (Alcance 2 del plan de cierre de brechas): antes,
// `getSubscription` hacía un `upsert` que dejaba una fila TRIAL real
// persistida en BD desde el primer `GET /business/subscription`, aunque
// nadie hubiera activado nada. Ahora no debe escribir nada mientras no exista
// una activación explícita (inexistente hoy): solo debe leer, y devolver un
// objeto sintético "sin plan activo" cuando no hay fila.
describe('DatabaseBusinessService.getSubscription', () => {
  it('never creates a CompanySubscription row and returns a synthetic INACTIVE object when none exists, even across repeated calls', async () => {
    const findUnique = vi.fn(async () => null);
    const prisma = {
      company: { upsert: companyUpsert() },
      companySubscription: {
        findUnique,
        upsert: vi.fn(() => {
          throw new Error('getSubscription must not write a subscription row on a mere GET');
        }),
      },
    };
    const service = new DatabaseBusinessService(prisma as never);

    const first = await service.getSubscription(session);
    const second = await service.getSubscription(session);

    expect(first).toMatchObject({ companyId: 'company-1', plan: 'PILOT', status: 'INACTIVE' });
    expect(second).toMatchObject({ companyId: 'company-1', plan: 'PILOT', status: 'INACTIVE' });
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
  });

  it('returns the real row untouched once a subscription was explicitly activated', async () => {
    const realSubscription = { id: 'sub-1', companyId: 'company-1', plan: 'PILOT', status: 'TRIAL', trialEndsAt: new Date() };
    const prisma = {
      company: { upsert: companyUpsert() },
      companySubscription: {
        findUnique: vi.fn(async () => realSubscription),
        upsert: vi.fn(() => {
          throw new Error('getSubscription must not upsert once a real row already exists');
        }),
      },
    };
    const service = new DatabaseBusinessService(prisma as never);

    const result = await service.getSubscription(session);

    expect(result).toBe(realSubscription);
  });
});

describe('DatabaseBusinessService.listShiftApplications: indicador hasCv', () => {
  const shift = {
    id: 'shift-1', companyId: 'company-1', status: 'PUBLISHED' as const, requiredWorkers: 1,
    startsAt: new Date(Date.now() + 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
  };

  function application(id: string, status: string, worker: { profile: { isVisible: boolean } | null; cv: boolean }) {
    return {
      id, shiftId: 'shift-1', workerId: `worker-${id}`, status, screeningAnswers: null, assignment: null,
      worker: {
        id: `worker-${id}`, name: `Trabajador ${id}`, email: `${id}@example.test`, identifier: '70000000',
        talentProfile: worker.profile,
        documents: worker.cv ? [{ id: `doc-${id}` }] : [],
      },
    };
  }

  function setup(applications: ReturnType<typeof application>[]) {
    const findMany = vi.fn(async () => applications);
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => []) },
      shiftApplication: { findMany },
    };
    return { service: new DatabaseBusinessService(prisma as never), findMany };
  }

  it('marks hasCv only when the CV exists, the profile is visible and the application is still active', async () => {
    const { service } = setup([
      application('pending-ok', 'PENDING', { profile: { isVisible: true }, cv: true }),
      application('accepted-ok', 'ACCEPTED', { profile: { isVisible: true }, cv: true }),
      application('hidden', 'PENDING', { profile: { isVisible: false }, cv: true }),
      application('no-profile', 'PENDING', { profile: null, cv: true }),
      application('no-cv', 'PENDING', { profile: { isVisible: true }, cv: false }),
      application('rejected', 'REJECTED', { profile: { isVisible: true }, cv: true }),
      application('withdrawn', 'WITHDRAWN', { profile: { isVisible: true }, cv: true }),
      application('cancelled', 'CANCELLED', { profile: { isVisible: true }, cv: true }),
    ]);

    const result = (await service.listShiftApplications(session, 'shift-1')) as Array<{ id: string; worker: { hasCv: boolean } }>;

    expect(Object.fromEntries(result.map((item) => [item.id, item.worker.hasCv]))).toEqual({
      'pending-ok': true,
      'accepted-ok': true,
      hidden: false,
      'no-profile': false,
      'no-cv': false,
      rejected: false,
      withdrawn: false,
      cancelled: false,
    });
  });

  it('never leaks the profile visibility or the document rows, only the boolean', async () => {
    const { service } = setup([application('a', 'PENDING', { profile: { isVisible: true }, cv: true })]);

    const [item] = (await service.listShiftApplications(session, 'shift-1')) as Array<{ worker: Record<string, unknown> }>;

    expect(Object.keys(item.worker).sort()).toEqual(['email', 'hasCv', 'id', 'identifier', 'name']);
  });

  it('resolves every applicant in a single query, selecting only the id of the CV row (no file, no N+1)', async () => {
    const { service, findMany } = setup([
      application('a', 'PENDING', { profile: { isVisible: true }, cv: true }),
      application('b', 'PENDING', { profile: { isVisible: true }, cv: true }),
      application('c', 'PENDING', { profile: { isVisible: true }, cv: true }),
    ]);

    await service.listShiftApplications(session, 'shift-1');

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0] as unknown as [{ include: { worker: { select: Record<string, unknown> } } }];
    expect(args[0].include.worker.select.documents).toEqual({ where: { kind: 'CV' }, select: { id: true } });
    expect(args[0].include.worker.select.talentProfile).toEqual({ select: { isVisible: true } });
  });
});
