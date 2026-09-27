import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createAdminRouter } from '../src/modules/admin/admin.routes.js';
import { AuthError, type AuthService, type AuthSession } from '../src/modules/auth/auth.service.js';
import type { PrivateDocumentStorage } from '../src/modules/talent/private_document_storage.js';

function fakeAuthService(sessions: Record<string, AuthSession>): AuthService {
  return {
    register: vi.fn(),
    login: vi.fn(),
    restore: async (token: string) => {
      const session = sessions[token];
      if (!session) throw new AuthError('INVALID_SESSION');
      return session;
    },
    logout: vi.fn(),
    startGoogleLogin: vi.fn(),
    completeGoogleProfile: vi.fn(),
    setInitialGooglePassword: vi.fn(),
    changePassword: vi.fn(),
  };
}

function session(overrides: Partial<AuthSession> & Pick<AuthSession, 'userId' | 'role'>): AuthSession {
  return {
    token: `token-${overrides.userId}`,
    name: 'Cuenta de prueba',
    email: `${overrides.userId}@example.com`,
    identifier: '12345678',
    requiresPasswordSetup: false,
    ...overrides,
  };
}

type FakeUser = { id: string; role: 'WORKER' | 'BUSINESS' | 'ADMIN' };
type FakeDocument = { id: string; userId: string; storageKey: string };

/**
 * Minimal in-memory Prisma double. It intentionally models the cascade delete
 * declared in schema.prisma (`onDelete: Cascade` on WorkerDocument,
 * ShiftApplication and ShiftAssignment) so the tests can assert that related
 * rows are gone after `prisma.user.delete`, without requiring a real Postgres
 * instance. It does not reproduce any other Prisma behaviour (errors, other
 * models, transactions).
 */
function fakePrisma(options: { users?: FakeUser[]; documents?: FakeDocument[] } = {}) {
  const users = new Map(options.users?.map((user) => [user.id, user]) ?? []);
  const documents = [...(options.documents ?? [])];
  const applications: { id: string; workerId: string }[] = [
    { id: 'application-1', workerId: 'worker-1' },
  ];
  const assignments: { id: string; workerId: string }[] = [
    { id: 'assignment-1', workerId: 'worker-1' },
  ];

  return {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = users.get(where.id);
        return found ? { role: found.role } : null;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (!users.has(where.id)) throw new Error('NOT_FOUND_IN_FAKE');
        users.delete(where.id);
        for (let i = documents.length - 1; i >= 0; i -= 1) {
          if (documents[i].userId === where.id) documents.splice(i, 1);
        }
        for (let i = applications.length - 1; i >= 0; i -= 1) {
          if (applications[i].workerId === where.id) applications.splice(i, 1);
        }
        for (let i = assignments.length - 1; i >= 0; i -= 1) {
          if (assignments[i].workerId === where.id) assignments.splice(i, 1);
        }
        return { id: where.id };
      }),
    },
    workerDocument: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        documents.filter((document) => document.userId === where.userId).map((document) => ({ storageKey: document.storageKey })),
      ),
    },
    inspect: () => ({ users, documents, applications, assignments }),
  };
}

function fakeDocumentStorage() {
  return { remove: vi.fn(async () => undefined) } as unknown as PrivateDocumentStorage;
}

function buildApp(
  prisma: ReturnType<typeof fakePrisma>,
  documents: PrivateDocumentStorage,
  sessions: Record<string, AuthSession>,
) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createAdminRouter(fakeAuthService(sessions), prisma as never, documents));
  return app;
}

describe('DELETE /api/admin/workers/:id', () => {
  it('rejects a request without a valid session', async () => {
    const prisma = fakePrisma();
    const app = buildApp(prisma, fakeDocumentStorage(), {});

    const response = await request(app).delete('/api/admin/workers/worker-1');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'INVALID_SESSION' });
  });

  it('rejects a session that is not ADMIN', async () => {
    const prisma = fakePrisma({ users: [{ id: 'worker-1', role: 'WORKER' }] });
    const worker = session({ userId: 'worker-1', role: 'WORKER' });
    const app = buildApp(prisma, fakeDocumentStorage(), { [worker.token]: worker });

    const response = await request(app)
      .delete('/api/admin/workers/worker-1')
      .set('Authorization', `Bearer ${worker.token}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'ADMIN_ACCOUNT_REQUIRED' });
  });

  it('returns 404 when the id does not exist or does not belong to a WORKER account', async () => {
    const prisma = fakePrisma({
      users: [
        { id: 'company-owner-1', role: 'BUSINESS' },
      ],
    });
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildApp(prisma, fakeDocumentStorage(), { [admin.token]: admin });

    const missing = await request(app)
      .delete('/api/admin/workers/does-not-exist')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'WORKER_NOT_FOUND' });

    const wrongRole = await request(app)
      .delete('/api/admin/workers/company-owner-1')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(wrongRole.status).toBe(404);
    expect(wrongRole.body).toEqual({ error: 'WORKER_NOT_FOUND' });
  });

  it('deletes a worker, its cascaded rows and its private documents on disk', async () => {
    const prisma = fakePrisma({
      users: [
        { id: 'worker-1', role: 'WORKER' },
        { id: 'admin-1', role: 'ADMIN' },
      ],
      documents: [
        { id: 'doc-cv', userId: 'worker-1', storageKey: 'cv-key.pdf' },
        { id: 'doc-photo', userId: 'worker-1', storageKey: 'photo-key.jpg' },
      ],
    });
    const documents = fakeDocumentStorage();
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildApp(prisma, documents, { [admin.token]: admin });

    const response = await request(app)
      .delete('/api/admin/workers/worker-1')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    // The two private documents (CV and photo) must be removed from disk
    // before the database row disappears via cascade.
    expect(documents.remove).toHaveBeenCalledTimes(2);
    expect(documents.remove).toHaveBeenCalledWith('cv-key.pdf');
    expect(documents.remove).toHaveBeenCalledWith('photo-key.jpg');

    const state = prisma.inspect();
    expect(state.users.has('worker-1')).toBe(false);
    expect(state.documents.some((document) => document.userId === 'worker-1')).toBe(false);
    expect(state.applications.some((application) => application.workerId === 'worker-1')).toBe(false);
    expect(state.assignments.some((assignment) => assignment.workerId === 'worker-1')).toBe(false);

    // The admin account itself is untouched: no self-delete guard is needed
    // for this route because an ADMIN can never match role === 'WORKER'.
    expect(state.users.has('admin-1')).toBe(true);
  });

  it('deletes a worker without documents without attempting any file cleanup', async () => {
    const prisma = fakePrisma({ users: [{ id: 'worker-2', role: 'WORKER' }] });
    const documents = fakeDocumentStorage();
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildApp(prisma, documents, { [admin.token]: admin });

    const response = await request(app)
      .delete('/api/admin/workers/worker-2')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(204);
    expect(documents.remove).not.toHaveBeenCalled();
    expect(prisma.inspect().users.has('worker-2')).toBe(false);
  });
});

describe('GET/PATCH /api/admin/settings', () => {
  function fakeSettingsPrisma(initial: { commissionBps: number; taxBps: number; updatedById: string | null; updatedAt: Date } = {
    commissionBps: 1000, taxBps: 1800, updatedById: null, updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  }) {
    const state = { settings: { id: 'global', ...initial } };
    const changes: Record<string, unknown>[] = [];
    const users: Record<string, { id: string; name: string }> = { 'admin-1': { id: 'admin-1', name: 'Superadmin de pruebas' } };
    const platformSettings = {
      findUnique: vi.fn(async () => ({ ...state.settings, updatedBy: state.settings.updatedById ? users[state.settings.updatedById] : null })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.settings, data);
        return { ...state.settings, updatedBy: state.settings.updatedById ? users[state.settings.updatedById] : null };
      }),
    };
    const platformSettingChange = {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { changes.push(data); return { id: `change-${changes.length}`, ...data }; }),
    };
    // El `PATCH` real bloquea la fila con `SELECT ... FOR UPDATE` dentro de
    // `$executeRaw`/`$queryRaw` (ver MEDIO-1 de CN-20260926-012); este doble
    // no modela concurrencia real (esa cobertura es de integración contra
    // Postgres, ver `tests/integration/payment-commission.integration.test.ts`),
    // solo que el flujo secuencial lee el `commissionBps` vigente ANTES del
    // `update` de esta misma llamada.
    const executeRaw = vi.fn(async () => 0);
    const queryRaw = vi.fn(async () => [{ commissionBps: state.settings.commissionBps }]);
    const prisma = {
      platformSettings,
      platformSettingChange,
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ platformSettings, platformSettingChange, $executeRaw: executeRaw, $queryRaw: queryRaw })),
    };
    return { prisma, state, changes, platformSettings, platformSettingChange, queryRaw };
  }

  function buildSettingsApp(prisma: ReturnType<typeof fakeSettingsPrisma>['prisma'], sessions: Record<string, AuthSession>) {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminRouter(fakeAuthService(sessions), prisma as never, fakeDocumentStorage()));
    return app;
  }

  it('rejects a request without a valid session', async () => {
    const { prisma } = fakeSettingsPrisma();
    const app = buildSettingsApp(prisma, {});

    const response = await request(app).get('/api/admin/settings');
    expect(response.status).toBe(401);
  });

  it('rejects a session that is not ADMIN', async () => {
    const { prisma } = fakeSettingsPrisma();
    const worker = session({ userId: 'worker-1', role: 'WORKER' });
    const app = buildSettingsApp(prisma, { [worker.token]: worker });

    const getResponse = await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${worker.token}`);
    expect(getResponse.status).toBe(403);
    expect(getResponse.body).toEqual({ error: 'ADMIN_ACCOUNT_REQUIRED' });

    const patchResponse = await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${worker.token}`).send({ commissionBps: 1200 });
    expect(patchResponse.status).toBe(403);
  });

  it('returns the current global settings, including who last changed them', async () => {
    const { prisma } = fakeSettingsPrisma({ commissionBps: 1000, taxBps: 1800, updatedById: 'admin-1', updatedAt: new Date('2026-09-20T00:00:00.000Z') });
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildSettingsApp(prisma, { [admin.token]: admin });

    const response = await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${admin.token}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      commissionBps: 1000, taxBps: 1800,
      updatedBy: { id: 'admin-1', name: 'Superadmin de pruebas' },
    });
  });

  it('rejects a commissionBps out of the 0-5000 range', async () => {
    const { prisma, platformSettingChange } = fakeSettingsPrisma();
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildSettingsApp(prisma, { [admin.token]: admin });

    const tooHigh = await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${admin.token}`).send({ commissionBps: 5001 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error).toBe('INVALID_INPUT');

    const negative = await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${admin.token}`).send({ commissionBps: -1 });
    expect(negative.status).toBe(400);

    const notAnInteger = await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${admin.token}`).send({ commissionBps: 12.5 });
    expect(notAnInteger.status).toBe(400);

    expect(platformSettingChange.create).not.toHaveBeenCalled();
  });

  it('updates commissionBps, leaves taxBps untouched, and records the change in PlatformSettingChange', async () => {
    const { prisma, state, changes } = fakeSettingsPrisma({ commissionBps: 1000, taxBps: 1800, updatedById: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') });
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildSettingsApp(prisma, { [admin.token]: admin });

    const response = await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${admin.token}`).send({ commissionBps: 1200 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ commissionBps: 1200, taxBps: 1800 });
    expect(state.settings.commissionBps).toBe(1200);
    expect(state.settings.taxBps).toBe(1800);
    expect(changes).toEqual([expect.objectContaining({
      field: 'commissionBps', oldValue: '1000', newValue: '1200', changedById: 'admin-1',
    })]);
  });
});

describe('GET /api/admin/commissions', () => {
  type FakePayment = {
    companyId: string; provider: string; status: string;
    commissionCents: number; taxCents: number; createdAt: Date;
  };
  type FakeAssignment = {
    companyId: string; status: string;
    closedWithoutPayment?: boolean; closedWithoutPaymentAt?: Date;
    assignedAt?: Date; checkedInAt?: Date | null; checkedOutAt?: Date | null;
    shiftStartsAt?: Date; shiftEndsAt?: Date;
  };

  function matchesDateRange(date: Date, where: { gte?: Date; lt?: Date } | undefined) {
    if (!where) return true;
    if (where.gte && date < where.gte) return false;
    if (where.lt && date >= where.lt) return false;
    return true;
  }

  function fakeCommissionsPrisma(payments: FakePayment[], assignments: FakeAssignment[], companies: { id: string; name: string; ruc: string }[]) {
    const groupBy = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const rows = payments.filter((payment) => {
        if (typeof where.provider === 'string' && payment.provider !== where.provider) return false;
        const providerNotIn = (where.provider as { notIn?: string[] } | undefined)?.notIn;
        if (providerNotIn && providerNotIn.includes(payment.provider)) return false;
        const statusNot = (where.status as { not?: string } | undefined)?.not;
        if (statusNot && payment.status === statusNot) return false;
        const statusIn = (where.status as { in?: string[] } | undefined)?.in;
        if (statusIn && !statusIn.includes(payment.status)) return false;
        if (typeof where.status === 'string' && payment.status !== where.status) return false;
        if (!matchesDateRange(payment.createdAt, where.createdAt as { gte?: Date; lt?: Date } | undefined)) return false;
        return true;
      });
      const byCompany = new Map<string, { companyId: string; _sum: { commissionCents: number; taxCents: number }; _count: { _all: number } }>();
      for (const row of rows) {
        const entry = byCompany.get(row.companyId) ?? { companyId: row.companyId, _sum: { commissionCents: 0, taxCents: 0 }, _count: { _all: 0 } };
        entry._sum.commissionCents += row.commissionCents;
        entry._sum.taxCents += row.taxCents;
        entry._count._all += 1;
        byCompany.set(row.companyId, entry);
      }
      return [...byCompany.values()];
    });
    // Estructurado (ver `business.service.ts`): nunca lee `detail`. Dos formas
    // distintas de `where`, igual que hace la ruta real: `closedWithoutPayment:
    // true` (con `closedWithoutPaymentAt` filtrado por período), o el `OR` de
    // `pendingResolution` (`status: {in: [NO_SHOW, ABANDONED]}` ya persistido,
    // o `status: 'ASSIGNED'` con el turno empezado hace más de una hora). La
    // función real `resolveAssignmentLifecycle` -importada, no mockeada- es
    // la que decide si una `ASSIGNED` cuenta o no; este doble solo filtra las
    // filas como lo haría Postgres.
    const shiftAssignmentFindMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const toRow = (assignment: FakeAssignment) => ({
        status: assignment.status,
        assignedAt: assignment.assignedAt ?? null,
        checkedInAt: assignment.checkedInAt ?? null,
        checkedOutAt: assignment.checkedOutAt ?? null,
        shift: { companyId: assignment.companyId, startsAt: assignment.shiftStartsAt ?? new Date(0), endsAt: assignment.shiftEndsAt ?? new Date(0) },
      });
      if (where.closedWithoutPayment === true) {
        return assignments
          .filter((assignment) => assignment.closedWithoutPayment
            && matchesDateRange(assignment.closedWithoutPaymentAt!, where.closedWithoutPaymentAt as { gte?: Date; lt?: Date } | undefined))
          .map(toRow);
      }
      const or = where.OR as Record<string, unknown>[] | undefined;
      if (or) {
        return assignments
          .filter((assignment) => or.some((clause) => {
            const statusIn = (clause.status as { in?: string[] } | undefined)?.in;
            if (statusIn) return statusIn.includes(assignment.status);
            if (clause.status === 'ASSIGNED') {
              const shiftClause = clause.shift as { startsAt?: { lte?: Date } } | undefined;
              const threshold = shiftClause?.startsAt?.lte;
              const startsAt = assignment.shiftStartsAt ?? new Date(0);
              return assignment.status === 'ASSIGNED' && (!threshold || startsAt <= threshold);
            }
            return false;
          }))
          .map(toRow);
      }
      return [];
    });
    const companyFindMany = vi.fn(async () => companies);
    const prisma = { payment: { groupBy }, shiftAssignment: { findMany: shiftAssignmentFindMany }, company: { findMany: companyFindMany } };
    return { prisma };
  }

  function buildCommissionsApp(prisma: ReturnType<typeof fakeCommissionsPrisma>['prisma'], sessions: Record<string, AuthSession>) {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminRouter(fakeAuthService(sessions), prisma as never, fakeDocumentStorage()));
    return app;
  }

  it('sums "por facturar" only from non-cancelled manual payments, excluding legacy (zero commission by construction)', async () => {
    const { prisma } = fakeCommissionsPrisma(
      [
        { companyId: 'company-a', provider: 'manual', status: 'PENDING', commissionCents: 1000, taxCents: 180, createdAt: new Date('2026-09-10T12:00:00.000Z') },
        { companyId: 'company-a', provider: 'manual', status: 'PROCESSED', commissionCents: 500, taxCents: 90, createdAt: new Date('2026-09-15T12:00:00.000Z') },
        { companyId: 'company-a', provider: 'manual', status: 'CANCELLED', commissionCents: 999, taxCents: 999, createdAt: new Date('2026-09-11T12:00:00.000Z') },
        { companyId: 'company-a', provider: 'legacy', status: 'PROCESSED', commissionCents: 0, taxCents: 0, createdAt: new Date('2026-09-12T12:00:00.000Z') },
      ],
      [],
      [{ id: 'company-a', name: 'Restaurante Demo', ruc: '20123456789' }],
    );
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app).get('/api/admin/commissions').set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.companies).toEqual([
      expect.objectContaining({
        companyId: 'company-a', toInvoiceCents: 1500, toInvoiceTaxCents: 270,
        collectedCents: 0, pendingCollectionCents: 0, payments: 2, closedWithoutPayment: 0, pendingResolution: 0,
      }),
    ]);
    expect(response.body.totals).toMatchObject({ toInvoiceCents: 1500, toInvoiceTaxCents: 270, collectedCents: 0, pendingCollectionCents: 0, payments: 2 });
  });

  it('counts closedWithoutPayment from the structured flag only, per company and period (never from ShiftEvent.detail)', async () => {
    const { prisma } = fakeCommissionsPrisma(
      [],
      [
        { companyId: 'company-a', status: 'CANCELLED', closedWithoutPayment: true, closedWithoutPaymentAt: new Date('2026-09-10T12:00:00.000Z') },
        { companyId: 'company-a', status: 'CANCELLED', closedWithoutPayment: true, closedWithoutPaymentAt: new Date('2026-09-11T12:00:00.000Z') },
        { companyId: 'company-b', status: 'CANCELLED', closedWithoutPayment: true, closedWithoutPaymentAt: new Date('2026-08-01T12:00:00.000Z') },
        // `ASSIGNED` cancelada por `cancelShift`: nunca cuenta, ni siquiera si
        // alguien intentara marcarla (la ruta real nunca lo hace).
        { companyId: 'company-a', status: 'CANCELLED', closedWithoutPayment: false },
      ],
      [
        { id: 'company-a', name: 'Restaurante Demo', ruc: '20123456789' },
        { id: 'company-b', name: 'Café del Cielo', ruc: '20987654321' },
      ],
    );
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app)
      .get('/api/admin/commissions')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.companies).toEqual([
      expect.objectContaining({ companyId: 'company-a', closedWithoutPayment: 2 }),
    ]);
  });

  // Corrección de MEDIO-1 (CN-20260926-020, "ocultar, primera vía"):
  // `pendingResolution` nunca se filtra por período y saca a la empresa del
  // reporte aunque no tenga ningún pago ni cierre en el rango consultado.
  it('surfaces pendingResolution (unresolved NO_SHOW/ABANDONED) regardless of the period, so leaving them unresolved cannot hide the company', async () => {
    const { prisma } = fakeCommissionsPrisma(
      [],
      [
        { companyId: 'company-a', status: 'NO_SHOW' },
        { companyId: 'company-a', status: 'ABANDONED' },
        // Todavía vigente (el turno empieza en el futuro): una `ASSIGNED`
        // que ni siquiera tuvo la oportunidad de no presentarse nunca cuenta.
        { companyId: 'company-a', status: 'ASSIGNED', shiftStartsAt: new Date(Date.now() + 60 * 60 * 1000) },
        { companyId: 'company-a', status: 'COMPLETED' },
      ],
      [{ id: 'company-a', name: 'Restaurante Demo', ruc: '20123456789' }],
    );
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    // Un período viejo, sin ningún pago ni cierre: la empresa debe aparecer
    // igual, solo por tener asignaciones pendientes de decisión.
    const response = await request(app)
      .get('/api/admin/commissions')
      .query({ from: '2020-01-01', to: '2020-01-31' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.companies).toEqual([
      expect.objectContaining({ companyId: 'company-a', pendingResolution: 2, closedWithoutPayment: 0 }),
    ]);
    expect(response.body.totals.pendingResolution).toBe(2);
  });

  // MEDIO-1 (nuevo) de CN-20260926-022: `NO_SHOW`/`ABANDONED` son perezosos
  // (los calcula `resolveAssignmentLifecycle` la próxima vez que algo toca
  // la asignación, nunca un job de fondo). Una `ASSIGNED` cuya ventana de
  // check-in ya venció, pero que sigue `ASSIGNED` en la base porque nadie
  // volvió a abrir el turno, debe contar igual: el reporte nunca puede
  // depender de que alguien haya leído antes.
  it('counts an ASSIGNED assignment whose check-in window already expired as pendingResolution, even though its persisted status is still ASSIGNED', async () => {
    const now = Date.now();
    const { prisma } = fakeCommissionsPrisma(
      [],
      [{
        companyId: 'company-a', status: 'ASSIGNED',
        shiftStartsAt: new Date(now - 3 * 60 * 60 * 1000), shiftEndsAt: new Date(now + 5 * 60 * 60 * 1000),
      }],
      [{ id: 'company-a', name: 'Restaurante Demo', ruc: '20123456789' }],
    );
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app).get('/api/admin/commissions').set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.companies).toEqual([
      expect.objectContaining({ companyId: 'company-a', pendingResolution: 1 }),
    ]);
  });

  // Corrección de ALTO-1 (CN-20260926-020): límites de calendario de Lima,
  // no de UTC. 31/08 23:59:59 hora Lima cae DENTRO de agosto; 01/09 00:00:00
  // hora Lima cae FUERA (ya es setiembre). En UTC serían, respectivamente,
  // 01/09 04:59:59 y 01/09 05:00:00 — la prueba falla si el código volviera
  // a tratar `to` como medianoche UTC.
  it('treats from/to as Lima calendar dates: the last second of the last Lima day is included, the first second of the next day is not', async () => {
    const { prisma } = fakeCommissionsPrisma(
      [
        { companyId: 'company-a', provider: 'manual', status: 'PENDING', commissionCents: 100, taxCents: 18, createdAt: new Date('2026-08-31T23:59:59.000-05:00') },
        { companyId: 'company-a', provider: 'manual', status: 'PENDING', commissionCents: 200, taxCents: 36, createdAt: new Date('2026-09-01T00:00:00.000-05:00') },
      ],
      [],
      [{ id: 'company-a', name: 'Restaurante Demo', ruc: '20123456789' }],
    );
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app)
      .get('/api/admin/commissions')
      .query({ from: '2026-08-01', to: '2026-08-31' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.companies).toEqual([
      expect.objectContaining({ companyId: 'company-a', toInvoiceCents: 100, payments: 1 }),
    ]);
    expect(response.body.period).toMatchObject({
      from: '2026-08-01', to: '2026-08-31',
      fromUtc: '2026-08-01T05:00:00.000Z', toUtcExclusive: '2026-09-01T05:00:00.000Z',
    });
  });

  it('rejects a date that is not strictly AAAA-MM-DD (no full ISO datetime accepted)', async () => {
    const { prisma } = fakeCommissionsPrisma([], [], []);
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app)
      .get('/api/admin/commissions')
      .query({ from: '2026-09-01T00:00:00.000Z' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_INPUT');
  });

  // BAJO-1 de CN-20260926-022: el formato "AAAA-MM-DD" no basta. `2026-02-30`
  // no existe (ni en 2026, que no es bisiesto) y antes respondía 200 con el
  // `Date` corrido en silencio al 02/03; `2026-13-01` no existe y antes
  // respondía 500 (`Invalid Date` llegaba a Prisma). Ambas deben ser 400 con
  // un código explícito (`INVALID_CALENDAR_DATE`, en `issues`).
  it.each([
    ['2026-02-30', 'day that does not exist in February (not a leap year)'],
    ['2026-13-01', 'month 13'],
    ['2026-00-10', 'month 0'],
    ['2026-01-32', 'day 32'],
  ])('rejects %s (%s) with 400, never a 500 from an Invalid Date reaching Prisma', async (value) => {
    const { prisma } = fakeCommissionsPrisma([], [], []);
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app)
      .get('/api/admin/commissions')
      .query({ from: value })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_INPUT');
  });

  // 2024 es bisiesto: el 29 de febrero sí existe y debe aceptarse.
  it('accepts 2024-02-29 (a real leap day)', async () => {
    const { prisma } = fakeCommissionsPrisma([], [], []);
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app)
      .get('/api/admin/commissions')
      .query({ from: '2024-02-29', to: '2024-02-29' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
  });

  it('rejects an invalid date range (from after to) with 400 INVALID_INPUT', async () => {
    const { prisma } = fakeCommissionsPrisma([], [], []);
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app)
      .get('/api/admin/commissions')
      .query({ from: '2026-09-30', to: '2026-09-01' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_INPUT');
  });

  it('requires an ADMIN session', async () => {
    const { prisma } = fakeCommissionsPrisma([], [], []);
    const app = buildCommissionsApp(prisma, {});

    const response = await request(app).get('/api/admin/commissions');
    expect(response.status).toBe(401);
  });

  it('returns an empty report (no companies, zero totals) when there is no activity in the period', async () => {
    const { prisma } = fakeCommissionsPrisma([], [], [{ id: 'company-a', name: 'Restaurante Demo', ruc: '20123456789' }]);
    const admin = session({ userId: 'admin-1', role: 'ADMIN' });
    const app = buildCommissionsApp(prisma, { [admin.token]: admin });

    const response = await request(app).get('/api/admin/commissions').set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.companies).toEqual([]);
    expect(response.body.totals).toEqual({ toInvoiceCents: 0, toInvoiceTaxCents: 0, collectedCents: 0, pendingCollectionCents: 0, payments: 0, pendingResolution: 0 });
  });
});
