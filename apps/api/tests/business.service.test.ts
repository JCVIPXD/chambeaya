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
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { update: assignmentUpdate },
        shiftEvent: { create: shiftEventCreate },
        shift: { update: shiftUpdate },
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
      assignment: { ...staleAssignment, status: 'ABANDONED' },
    }];
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]) },
      shiftApplication: { findMany: vi.fn(async () => applicationsAfterResolution) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { update: assignmentUpdate },
        shiftEvent: { create: shiftEventCreate },
        shift: { update: shiftUpdate },
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
      shiftAssignment: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => abandonedAssignment({ status: 'ASSIGNED' })),
      },
    };
    const service = new DatabaseBusinessService(prisma as never);

    await expect(service.resolveAssignment(session, 'shift-1', 'assignment-1', 'COMPLETED'))
      .rejects.toMatchObject({ message: 'ASSIGNMENT_NOT_RESOLVABLE' });
  });

  it('rejects resolving an assignment that does not exist on this shift', async () => {
    const prisma = {
      company: { upsert: companyUpsert() },
      shift: { findFirst: vi.fn(async () => shift) },
      shiftAssignment: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
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
        shiftAssignment: { update: assignmentUpdate, findMany: vi.fn(async () => [{ status: 'COMPLETED' }]) },
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
        shiftAssignment: { update: assignmentUpdate, findMany: vi.fn(async () => [{ status: 'CANCELLED' }]) },
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
        shiftAssignment: { update: assignmentUpdate, findMany: vi.fn(async () => [{ status: 'CANCELLED' }]) },
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
        shiftAssignment: { update: assignmentUpdate, findMany: vi.fn(async () => [{ status: 'COMPLETED' }]) },
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
        shiftAssignment: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...abandonedAssignment(), ...data })), findMany: vi.fn(async () => [{ status: 'CANCELLED' }]) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        payment: { upsert: vi.fn(async () => undefined) },
        shift: { update: shiftUpdate },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    await service.resolveAssignment(session, 'shift-1', 'assignment-1', 'CANCELLED');

    expect(shiftUpdate).toHaveBeenCalledWith({ where: { id: 'shift-1' }, data: { status: 'CANCELLED', confirmedWorkers: 0 } });
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
      shiftAssignment: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        shiftAssignment: { updateMany: vi.fn(async () => undefined) },
        shiftApplication: { updateMany: vi.fn(async () => undefined) },
        shiftCancellation: { create: vi.fn(async () => undefined) },
        shiftEvent: { create: vi.fn(async () => undefined) },
        shift: { update: vi.fn(async () => ({ ...expiredShift, status: 'CANCELLED' })) },
      })),
    };
    const service = new DatabaseBusinessService(prisma as never);

    const cancelled = await service.cancelShift(session, 'shift-no-show', 'Nunca se cubrió y ya venció');

    expect(cancelled).toMatchObject({ status: 'CANCELLED' });
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
