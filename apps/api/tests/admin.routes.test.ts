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
