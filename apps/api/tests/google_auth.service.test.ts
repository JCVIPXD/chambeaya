import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { DatabaseAuthService, type AuthSession } from '../src/modules/auth/auth.service.js';

type FakeUser = {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  localPasswordConfigured: boolean;
  role: 'WORKER' | 'BUSINESS' | 'ADMIN';
  name: string;
  identifier: string;
  createdAt: Date;
  updatedAt: Date;
};

type FakeExternalIdentity = { id: string; userId: string; provider: 'GOOGLE'; subject: string; email: string };
type FakeGoogleProfileSetup = { id: string; tokenHash: string; subject: string; email: string; name: string; expiresAt: Date };
type FakeAuthSession = { id: string; tokenHash: string; userId: string; expiresAt: Date };

/**
 * Minimal in-memory double of the Prisma models `DatabaseAuthService` touches
 * for the Google Sign-In flow. It only implements the exact delegate methods
 * used by startGoogleLogin/completeGoogleProfile/setInitialGooglePassword and
 * does not reproduce Prisma's real constraint/error semantics (e.g. P2002);
 * these tests validate the service's own logic, not the database's mapping
 * of unique-constraint violations.
 */
class FakePrisma {
  users: FakeUser[] = [];
  externalIdentities: FakeExternalIdentity[] = [];
  googleProfileSetups: FakeGoogleProfileSetup[] = [];
  authSessions: FakeAuthSession[] = [];
  private sequence = 0;

  private nextId(prefix: string) {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  seedUser(overrides: Partial<FakeUser> = {}): FakeUser {
    const user: FakeUser = {
      id: this.nextId('user'),
      email: 'worker@example.com',
      passwordHash: 'hash',
      salt: 'salt',
      localPasswordConfigured: true,
      role: 'WORKER',
      name: 'Ana Torres',
      identifier: '12345678',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    this.users.push(user);
    return user;
  }

  seedExternalIdentity(overrides: Partial<FakeExternalIdentity> & { userId: string; subject: string }): FakeExternalIdentity {
    const identity: FakeExternalIdentity = {
      id: this.nextId('identity'),
      provider: 'GOOGLE',
      email: 'worker@example.com',
      ...overrides,
    };
    this.externalIdentities.push(identity);
    return identity;
  }

  seedGoogleProfileSetup(overrides: Partial<FakeGoogleProfileSetup> & { tokenHash: string }): FakeGoogleProfileSetup {
    const setup: FakeGoogleProfileSetup = {
      id: this.nextId('setup'),
      subject: 'google-subject',
      email: 'nueva@example.com',
      name: 'Nueva Trabajadora',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ...overrides,
    };
    this.googleProfileSetups.push(setup);
    return setup;
  }

  seedAuthSession(overrides: Partial<FakeAuthSession> & { tokenHash: string; userId: string }): FakeAuthSession {
    const session: FakeAuthSession = {
      id: this.nextId('session'),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    };
    this.authSessions.push(session);
    return session;
  }

  user = {
    findUnique: async ({ where, select }: any) => {
      const found = 'email' in where
        ? this.users.find((u) => u.email === where.email)
        : this.users.find((u) => u.id === where.id);
      if (!found) return null;
      if (select) {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(select)) projected[key] = (found as Record<string, unknown>)[key];
        return projected;
      }
      return { ...found };
    },
    create: async ({ data }: any) => {
      const user: FakeUser = {
        id: this.nextId('user'),
        email: data.email,
        passwordHash: data.passwordHash,
        salt: data.salt,
        localPasswordConfigured: data.localPasswordConfigured ?? true,
        role: data.role,
        name: data.name,
        identifier: data.identifier,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.push(user);
      if (data.externalIdentities?.create) {
        const create = data.externalIdentities.create;
        this.seedExternalIdentity({
          userId: user.id,
          subject: create.subject,
          provider: create.provider,
          email: create.email,
        });
      }
      return { ...user };
    },
    update: async ({ where, data }: any) => {
      const user = this.users.find((u) => u.id === where.id);
      if (!user) throw new Error('FAKE_PRISMA: user not found');
      Object.assign(user, data, { updatedAt: new Date() });
      return { ...user };
    },
  };

  externalIdentity = {
    findUnique: async ({ where }: any) => {
      const compound = where.provider_subject;
      const identity = this.externalIdentities.find(
        (i) => i.provider === compound.provider && i.subject === compound.subject,
      );
      if (!identity) return null;
      const user = this.users.find((u) => u.id === identity.userId);
      return { ...identity, user: user ? { ...user } : null };
    },
  };

  googleProfileSetup = {
    deleteMany: async ({ where }: any) => {
      const cutoff: Date | undefined = where?.expiresAt?.lte;
      const before = this.googleProfileSetups.length;
      if (cutoff) {
        this.googleProfileSetups = this.googleProfileSetups.filter((s) => s.expiresAt > cutoff);
      }
      return { count: before - this.googleProfileSetups.length };
    },
    create: async ({ data }: any) => {
      const setup: FakeGoogleProfileSetup = {
        id: this.nextId('setup'),
        tokenHash: data.tokenHash,
        subject: data.subject,
        email: data.email,
        name: data.name,
        expiresAt: data.expiresAt,
      };
      this.googleProfileSetups.push(setup);
      return { ...setup };
    },
    findUnique: async ({ where }: any) => {
      const found = this.googleProfileSetups.find((s) => s.tokenHash === where.tokenHash);
      return found ? { ...found } : null;
    },
    delete: async ({ where }: any) => {
      const index = this.googleProfileSetups.findIndex((s) => s.id === where.id);
      if (index === -1) throw new Error('FAKE_PRISMA: setup not found');
      const [removed] = this.googleProfileSetups.splice(index, 1);
      return removed;
    },
  };

  authSession = {
    create: async ({ data }: any) => {
      const session: FakeAuthSession = {
        id: this.nextId('session'),
        tokenHash: data.tokenHash,
        userId: data.userId,
        expiresAt: data.expiresAt,
      };
      this.authSessions.push(session);
      return { ...session };
    },
    findUnique: async ({ where }: any) => {
      const session = this.authSessions.find((s) => s.tokenHash === where.tokenHash);
      if (!session) return null;
      const user = this.users.find((u) => u.id === session.userId);
      const externalIdentities = this.externalIdentities.filter((i) => i.userId === session.userId);
      return { ...session, user: user ? { ...user, externalIdentities } : null };
    },
    delete: async ({ where }: any) => {
      const index = this.authSessions.findIndex((s) => s.id === where.id);
      if (index === -1) throw new Error('FAKE_PRISMA: session not found');
      const [removed] = this.authSessions.splice(index, 1);
      return removed;
    },
  };
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createService() {
  const prisma = new FakePrisma();
  const service = new DatabaseAuthService(prisma as unknown as PrismaClient);
  return { prisma, service };
}

describe('DatabaseAuthService — Google Sign-In flow', () => {
  describe('startGoogleLogin', () => {
    it('returns a session when the Google identity is already linked to an account', async () => {
      const { prisma, service } = createService();
      const user = prisma.seedUser({ email: 'ana@example.com' });
      prisma.seedExternalIdentity({ userId: user.id, subject: 'google-sub-1', email: 'ana@example.com' });

      const result = await service.startGoogleLogin({
        subject: 'google-sub-1',
        email: 'ana@example.com',
        name: 'Ana Torres',
      });

      expect(result).toHaveProperty('token');
      expect((result as AuthSession).userId).toBe(user.id);
    });

    it('rejects a new Google identity whose email is already registered locally', async () => {
      const { prisma, service } = createService();
      prisma.seedUser({ email: 'ana@example.com' });

      await expect(
        service.startGoogleLogin({ subject: 'google-sub-2', email: 'ana@example.com', name: 'Ana Torres' }),
      ).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_ALREADY_REGISTERED' });
    });

    it('rejects a Google identity with an empty subject or an empty/blank name', async () => {
      const { service } = createService();

      await expect(
        service.startGoogleLogin({ subject: '', email: 'carla@example.com', name: 'Carla Nunez' }),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION' });

      await expect(
        service.startGoogleLogin({ subject: 'google-sub-8', email: 'diego@example.com', name: '   ' }),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION' });
    });

    it('starts a profile setup and persists it when neither the identity nor the email exist', async () => {
      const { prisma, service } = createService();

      const result = await service.startGoogleLogin({
        subject: 'google-sub-3',
        email: 'beatriz@example.com',
        name: 'Beatriz Ramos',
      });

      expect(result).toHaveProperty('profileSetupToken');
      expect(prisma.googleProfileSetups).toHaveLength(1);
      expect(prisma.googleProfileSetups[0]).toMatchObject({
        subject: 'google-sub-3',
        email: 'beatriz@example.com',
        name: 'Beatriz Ramos',
        tokenHash: tokenHash((result as { profileSetupToken: string }).profileSetupToken),
      });
    });
  });

  describe('completeGoogleProfile', () => {
    it('rejects an invalid DNI', async () => {
      const { service } = createService();

      await expect(
        service.completeGoogleProfile('irrelevant-token', '123', 'ClaveSegura1'),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION' });
    });

    it('rejects a weak password', async () => {
      const { service } = createService();

      await expect(
        service.completeGoogleProfile('irrelevant-token', '12345678', 'weak'),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION' });
    });

    it('rejects a nonexistent or expired setup token', async () => {
      const { prisma, service } = createService();
      prisma.seedGoogleProfileSetup({ tokenHash: tokenHash('expired-token'), expiresAt: new Date(Date.now() - 1000) });

      await expect(
        service.completeGoogleProfile('missing-token', '12345678', 'ClaveSegura1'),
      ).rejects.toMatchObject({ code: 'GOOGLE_PROFILE_SETUP_EXPIRED' });

      await expect(
        service.completeGoogleProfile('expired-token', '12345678', 'ClaveSegura1'),
      ).rejects.toMatchObject({ code: 'GOOGLE_PROFILE_SETUP_EXPIRED' });
    });

    it('rejects when the setup email is already registered', async () => {
      const { prisma, service } = createService();
      prisma.seedUser({ email: 'nueva@example.com' });
      prisma.seedGoogleProfileSetup({ tokenHash: tokenHash('setup-token'), email: 'nueva@example.com' });

      await expect(
        service.completeGoogleProfile('setup-token', '12345678', 'ClaveSegura1'),
      ).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_ALREADY_REGISTERED' });
    });

    it('creates a WORKER account with a local password and the Google identity on the happy path', async () => {
      const { prisma, service } = createService();
      prisma.seedGoogleProfileSetup({
        tokenHash: tokenHash('setup-token'),
        subject: 'google-sub-4',
        email: 'nueva@example.com',
        name: 'Nueva Trabajadora',
      });

      const session = await service.completeGoogleProfile('setup-token', '87654321', 'ClaveSegura1');

      expect(session).toHaveProperty('token');
      expect(session.role).toBe('WORKER');
      expect(session.requiresPasswordSetup).toBe(false);

      const created = prisma.users.find((u) => u.email === 'nueva@example.com');
      expect(created?.localPasswordConfigured).toBe(true);
      expect(created?.identifier).toBe('87654321');
      expect(
        prisma.externalIdentities.some(
          (i) => i.userId === created?.id && i.provider === 'GOOGLE' && i.subject === 'google-sub-4',
        ),
      ).toBe(true);
      expect(prisma.googleProfileSetups).toHaveLength(0);
    });
  });

  describe('setInitialGooglePassword', () => {
    it('rejects a nonexistent or expired session token', async () => {
      const { prisma, service } = createService();
      const user = prisma.seedUser({ email: 'ana@example.com', localPasswordConfigured: false });
      prisma.seedExternalIdentity({ userId: user.id, subject: 'google-sub-5' });
      prisma.seedAuthSession({ tokenHash: tokenHash('expired-session'), userId: user.id, expiresAt: new Date(Date.now() - 1000) });

      await expect(
        service.setInitialGooglePassword('missing-session', 'ClaveSegura1'),
      ).rejects.toMatchObject({ code: 'INVALID_SESSION' });

      await expect(
        service.setInitialGooglePassword('expired-session', 'ClaveSegura1'),
      ).rejects.toMatchObject({ code: 'INVALID_SESSION' });
    });

    it('rejects accounts without a Google identity or that already configured a local password', async () => {
      const { prisma, service } = createService();
      const localUser = prisma.seedUser({ email: 'local@example.com', localPasswordConfigured: false });
      prisma.seedAuthSession({ tokenHash: tokenHash('no-google-session'), userId: localUser.id });

      await expect(
        service.setInitialGooglePassword('no-google-session', 'ClaveSegura1'),
      ).rejects.toMatchObject({ code: 'PASSWORD_SETUP_NOT_AVAILABLE' });

      const configuredUser = prisma.seedUser({ email: 'configured@example.com', localPasswordConfigured: true });
      prisma.seedExternalIdentity({ userId: configuredUser.id, subject: 'google-sub-6' });
      prisma.seedAuthSession({ tokenHash: tokenHash('already-configured-session'), userId: configuredUser.id });

      await expect(
        service.setInitialGooglePassword('already-configured-session', 'ClaveSegura1'),
      ).rejects.toMatchObject({ code: 'PASSWORD_SETUP_NOT_AVAILABLE' });
    });

    it('sets the local password hash and clears requiresPasswordSetup on the happy path', async () => {
      const { prisma, service } = createService();
      const user = prisma.seedUser({
        email: 'ana@example.com',
        localPasswordConfigured: false,
        passwordHash: 'placeholder',
        salt: 'placeholder',
      });
      prisma.seedExternalIdentity({ userId: user.id, subject: 'google-sub-7' });
      prisma.seedAuthSession({ tokenHash: tokenHash('session-token'), userId: user.id });

      const session = await service.setInitialGooglePassword('session-token', 'ClaveSegura1');

      expect(session.requiresPasswordSetup).toBe(false);
      const updated = prisma.users.find((u) => u.id === user.id);
      expect(updated?.localPasswordConfigured).toBe(true);
      expect(updated?.passwordHash).not.toBe('placeholder');
      expect(updated?.salt).not.toBe('placeholder');
    });
  });
});
