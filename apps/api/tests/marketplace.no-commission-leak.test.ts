import { describe, expect, it, vi } from 'vitest';

import { DatabaseMarketplaceService } from '../src/modules/marketplace/marketplace.service.js';

// ALTO-1 de CN-20260926-012: el trabajador nunca debe recibir la comisión ni
// el IGV de Chambeaya (los paga la empresa, encima de su pago). Estos
// campos viven en las mismas filas `Payment`/`Shift` que sí expone la
// empresa, así que el riesgo real no es "olvidar un campo" sino que un
// `include`/spread futuro reintroduzca la fuga. Estas pruebas construyen el
// prisma simulado con esos campos YA PRESENTES en la fila cruda (como
// estarían en Postgres real) y verifican que ninguna clave prohibida
// sobrevive a ninguna profundidad de la respuesta.
const FORBIDDEN_KEYS = ['commissionBps', 'commissionCents', 'taxBps', 'taxCents', 'totalCents', 'provider', 'needsReview'];

function findForbiddenKeyPaths(value: unknown, path = '$'): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenKeyPaths(item, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
      const here = FORBIDDEN_KEYS.includes(key) ? [`${path}.${key}`] : [];
      return [...here, ...findForbiddenKeyPaths(nested, `${path}.${key}`)];
    });
  }
  return [];
}

function assertNoLeak(value: unknown) {
  const leaks = findForbiddenKeyPaths(value);
  expect(leaks, `La respuesta al trabajador filtró: ${leaks.join(', ')}`).toEqual([]);
}

// Fila `Payment` "de verdad": incluye todos los campos de la migración de
// comisión, como los tendría en Postgres real.
function paymentRowWithCommission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    description: 'Mozo · Restaurante Demo',
    amountCents: 10000,
    commissionBps: 1000,
    commissionCents: 1000,
    taxBps: 1800,
    taxCents: 180,
    totalCents: 11180,
    provider: 'manual',
    needsReview: false,
    status: 'PROCESSED',
    reference: 'CN-TEST-0001',
    dueAt: null,
    processedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    workerConfirmedAt: null,
    assignment: { shiftId: 'shift-1' },
    ...overrides,
  };
}

describe('confirmPayment nunca expone comisión, IGV, total ni provider al trabajador', () => {
  it('en la primera confirmación (escribe workerConfirmedAt)', async () => {
    const row = paymentRowWithCommission();
    const prisma = {
      payment: {
        findFirst: vi.fn(async () => row),
        update: vi.fn(async () => ({ ...row, workerConfirmedAt: new Date('2026-09-02T00:00:00.000Z') })),
      },
      shiftEvent: { create: vi.fn(async () => undefined) },
    };
    const service = new DatabaseMarketplaceService(prisma as never);

    const result = await service.confirmPayment('worker-1', 'payment-1');

    assertNoLeak(result);
    expect(result).toMatchObject({ id: 'payment-1', amountCents: 10000, status: 'PROCESSED', shiftId: 'shift-1' });
  });

  it('en una confirmación repetida (ya estaba confirmado, respuesta idempotente)', async () => {
    const row = paymentRowWithCommission({ workerConfirmedAt: new Date('2026-09-02T00:00:00.000Z') });
    const prisma = {
      payment: { findFirst: vi.fn(async () => row), update: vi.fn() },
      shiftEvent: { create: vi.fn(async () => undefined) },
    };
    const service = new DatabaseMarketplaceService(prisma as never);

    const result = await service.confirmPayment('worker-1', 'payment-1');

    assertNoLeak(result);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});

describe('getWorkerConversation nunca expone la comisión/IGV del turno', () => {
  it('el `select` del turno no pide ni puede recibir commissionBps/taxBps', async () => {
    const conversationFindFirst = vi.fn(async (_args: { where: unknown; include: { shift: unknown } }) => ({
      id: 'conversation-1',
      subject: 'Postulación · Mozo',
      updatedAt: new Date(),
      company: { name: 'Restaurante Demo' },
      worker: { id: 'contact-1', name: 'Contacto' },
      // Simula que, si el `select` fuera `true`, Postgres devolvería estos
      // campos igual: la prueba real está en el `select` explícito que
      // recibe `findFirst`, verificado abajo.
      shift: { id: 'shift-1', title: 'Mozo', startsAt: new Date(), endsAt: new Date() },
      messages: [],
    }));
    const prisma = {
      conversation: { findFirst: conversationFindFirst },
      message: { updateMany: vi.fn(async () => undefined) },
    };
    const service = new DatabaseMarketplaceService(prisma as never);

    const result = await service.getWorkerConversation('worker-1', 'conversation-1');

    assertNoLeak(result);
    const [{ include }] = conversationFindFirst.mock.calls[0] as [{ include: { shift: { select?: Record<string, unknown>; select_is_true?: never } } }];
    // El `include.shift` debe ser un `select` explícito (objeto), nunca `true`.
    expect(typeof include.shift).toBe('object');
    expect(include.shift).toEqual({ select: { id: true, title: true, startsAt: true, endsAt: true } });
  });
});
