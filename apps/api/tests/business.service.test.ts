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
