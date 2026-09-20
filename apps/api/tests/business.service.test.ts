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
          shiftAssignment: {
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
      const shiftUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...freshShift, ...data }));
      const shiftEventCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => undefined);
      const prisma = {
        company: { upsert: companyUpsert() },
        shift: { findFirst: vi.fn(async () => freshShift) },
        shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]), findFirst: vi.fn(async () => noShow) },
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
          shiftAssignment: {
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...noShow, ...data })),
            findMany: vi.fn(async () => [{ status: 'COMPLETED' }]),
          },
          shiftEvent: { create: shiftEventCreate },
          payment: { upsert: vi.fn(async () => undefined) },
          shift: { update: shiftUpdate },
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
      const shiftUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...staleRead, ...data }));
      const prisma = {
        company: { upsert: companyUpsert() },
        shift: { findFirst: vi.fn(async () => staleRead) },
        shiftAssignment: { findMany: vi.fn(async () => [staleAssignment]), findFirst: vi.fn(async () => noShow) },
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
          shiftAssignment: {
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...noShow, ...data })),
            findMany: vi.fn(async () => [{ status: 'COMPLETED' }]),
          },
          shiftEvent: { create: vi.fn(async () => undefined) },
          payment: { upsert: vi.fn(async () => undefined) },
          shift: { update: shiftUpdate },
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
