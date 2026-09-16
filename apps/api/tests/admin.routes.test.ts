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
