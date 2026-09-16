import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService, type AuthSession } from '../src/modules/auth/auth.service.js';
import {
  DatabaseTalentInvitationService,
  TalentInvitationError,
  type TalentInvitationErrorCode,
  type TalentInvitationOperations,
} from '../src/modules/talent/talent_invitation.service.js';

async function context() {
  const authService = new LocalAuthService();
  const worker = await authService.register({ role: 'WORKER', name: 'Ana Torres', email: 'ana@example.com', password: 'ClaveSegura1', dniOrRuc: '12345678' });
  const business = await authService.register({ role: 'BUSINESS', name: 'Café Central', email: 'cafe@example.com', password: 'ClaveSegura1', dniOrRuc: '20123456789' });
  return { authService, worker, business };
}

function noopInvitations(): TalentInvitationOperations {
  return {
    createInvitation: vi.fn(),
    listForBusiness: vi.fn(),
    listForWorker: vi.fn(),
    acceptInvitation: vi.fn(),
    declineInvitation: vi.fn(),
  };
}

describe('talent invitation routes (HTTP wiring)', () => {
  it('creates an invitation only from a BUSINESS session and validates the body', async () => {
    const createInvitation = vi.fn(async (_session: AuthSession, input: unknown) => ({ id: 'invitation-1', ...input as object }));
    const { authService, worker, business } = await context();
    const app = createApp({ authService, talentInvitationService: { ...noopInvitations(), createInvitation } });

    const ok = await request(app).post('/api/business/talent-invitations').set('Authorization', `Bearer ${business.token}`).send({ workerTalentProfileId: 'profile-1', message: 'Nos interesa tu perfil.' });
    expect(ok.status).toBe(201);
    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ userId: business.userId, role: 'BUSINESS' }), { workerTalentProfileId: 'profile-1', message: 'Nos interesa tu perfil.' });

    expect((await request(app).post('/api/business/talent-invitations').set('Authorization', `Bearer ${worker.token}`).send({ workerTalentProfileId: 'profile-1' })).status).toBe(403);
    expect((await request(app).post('/api/business/talent-invitations').send({ workerTalentProfileId: 'profile-1' })).status).toBe(401);
    expect((await request(app).post('/api/business/talent-invitations').set('Authorization', `Bearer ${business.token}`).send({})).status).toBe(400);
    expect((await request(app).post('/api/business/talent-invitations').set('Authorization', `Bearer ${business.token}`).send({ workerTalentProfileId: 'profile-1', message: 'a'.repeat(501) })).status).toBe(400);
  });

  it('lists invitations for the issuing business and for the addressed worker on their own routes', async () => {
    const listForBusiness = vi.fn(async () => [{ id: 'invitation-1' }]);
    const listForWorker = vi.fn(async () => [{ id: 'invitation-2' }]);
    const { authService, worker, business } = await context();
    const app = createApp({ authService, talentInvitationService: { ...noopInvitations(), listForBusiness, listForWorker } });

    const businessList = await request(app).get('/api/business/talent-invitations').set('Authorization', `Bearer ${business.token}`);
    expect(businessList.status).toBe(200);
    expect(businessList.body).toEqual([{ id: 'invitation-1' }]);
    expect(listForBusiness).toHaveBeenCalledWith(expect.objectContaining({ userId: business.userId, role: 'BUSINESS' }));
    expect((await request(app).get('/api/business/talent-invitations').set('Authorization', `Bearer ${worker.token}`)).status).toBe(403);

    const workerList = await request(app).get('/api/workers/me/talent-invitations').set('Authorization', `Bearer ${worker.token}`);
    expect(workerList.status).toBe(200);
    expect(workerList.body).toEqual([{ id: 'invitation-2' }]);
    expect(listForWorker).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId, role: 'WORKER' }));
    expect((await request(app).get('/api/workers/me/talent-invitations').set('Authorization', `Bearer ${business.token}`)).status).toBe(403);
    expect((await request(app).get('/api/workers/me/talent-invitations')).status).toBe(401);
  });

  it('lets only the addressed worker accept or decline, and maps service errors to their status codes', async () => {
    const acceptInvitation = vi.fn(async () => ({ id: 'invitation-1', status: 'ACCEPTED' }));
    const declineInvitation = vi.fn(async () => ({ id: 'invitation-1', status: 'DECLINED' }));
    const { authService, worker, business } = await context();
    const app = createApp({ authService, talentInvitationService: { ...noopInvitations(), acceptInvitation, declineInvitation } });

    const accepted = await request(app).post('/api/workers/me/talent-invitations/invitation-1/accept').set('Authorization', `Bearer ${worker.token}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ id: 'invitation-1', status: 'ACCEPTED' });
    expect(acceptInvitation).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId }), 'invitation-1');

    const declined = await request(app).post('/api/workers/me/talent-invitations/invitation-1/decline').set('Authorization', `Bearer ${worker.token}`);
    expect(declined.status).toBe(200);
    expect(declineInvitation).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId }), 'invitation-1');

    expect((await request(app).post('/api/workers/me/talent-invitations/invitation-1/accept').set('Authorization', `Bearer ${business.token}`)).status).toBe(403);
  });

  it('translates every TalentInvitationError code to its documented HTTP status', async () => {
    const cases: Array<[TalentInvitationErrorCode, number]> = [
      ['TALENT_PROFILE_NOT_AVAILABLE', 404],
      ['SHIFT_NOT_FOUND', 404],
      ['INVITATION_ALREADY_ACTIVE', 409],
      ['INVITATION_NOT_FOUND', 404],
      ['INVITATION_EXPIRED', 409],
      ['INVITATION_NOT_PENDING', 409],
    ];
    const { authService, business } = await context();
    for (const [code, status] of cases) {
      const createInvitation = vi.fn(async () => { throw new TalentInvitationError(code); });
      const app = createApp({ authService, talentInvitationService: { ...noopInvitations(), createInvitation } });
      const response = await request(app).post('/api/business/talent-invitations').set('Authorization', `Bearer ${business.token}`).send({ workerTalentProfileId: 'profile-1' });
      expect(response.status).toBe(status);
      expect(response.body).toEqual({ error: code });
    }
  });
});

describe('DatabaseTalentInvitationService against a fake Prisma client', () => {
  type FakeCompany = { id: string; ownerId: string; name: string };
  type FakeUser = { id: string; name: string };
  type FakeProfile = { id: string; userId: string; isVisible: boolean };
  type FakeShift = { id: string; companyId: string; title: string; startsAt: Date; endsAt: Date };
  type StoredInvitation = {
    id: string;
    companyId: string;
    workerTalentProfileId: string;
    shiftId: string | null;
    status: string;
    message: string | null;
    expiresAt: Date;
    respondedAt: Date | null;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  };

  function fakePrisma(fixtures: { companies: FakeCompany[]; users: FakeUser[]; profiles: FakeProfile[]; shifts?: FakeShift[] }) {
    const shifts = fixtures.shifts ?? [];
    const invitations = new Map<string, StoredInvitation>();
    let counter = 0;

    function hydrate(record: StoredInvitation) {
      const company = fixtures.companies.find((c) => c.id === record.companyId);
      const profile = fixtures.profiles.find((p) => p.id === record.workerTalentProfileId);
      const user = profile ? fixtures.users.find((u) => u.id === profile.userId) : undefined;
      const shift = record.shiftId ? shifts.find((s) => s.id === record.shiftId) ?? null : null;
      if (!company || !profile || !user) throw new Error('inconsistent test fixture');
      return {
        id: record.id,
        status: record.status,
        message: record.message,
        expiresAt: record.expiresAt,
        respondedAt: record.respondedAt,
        createdAt: record.createdAt,
        company: { id: company.id, name: company.name },
        workerTalentProfile: { id: profile.id, userId: profile.userId, user: { name: user.name } },
        shift: shift ? { id: shift.id, title: shift.title, startsAt: shift.startsAt, endsAt: shift.endsAt } : null,
      };
    }

    return {
      company: {
        upsert: vi.fn(async ({ where }: { where: { ownerId: string } }) => {
          const found = fixtures.companies.find((c) => c.ownerId === where.ownerId);
          if (!found) throw new Error('unexpected company owner in test fixture');
          return found;
        }),
      },
      workerTalentProfile: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; isVisible: boolean } }) => {
          const profile = fixtures.profiles.find((p) => p.id === where.id && p.isVisible === where.isVisible);
          return profile ? { id: profile.id, userId: profile.userId } : null;
        }),
      },
      shift: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
          const shift = shifts.find((s) => s.id === where.id && s.companyId === where.companyId);
          return shift ? { id: shift.id } : null;
        }),
      },
      talentInvitation: {
        create: vi.fn(async ({ data }: { data: Omit<StoredInvitation, 'id' | 'status' | 'respondedAt' | 'createdAt' | 'updatedAt'> }) => {
          counter += 1;
          const record: StoredInvitation = {
            id: `invitation-${counter}`,
            status: 'PENDING',
            respondedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          invitations.set(record.id, record);
          return hydrate(record);
        }),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const match = [...invitations.values()].find((inv) => {
            if (where.id !== undefined && inv.id !== where.id) return false;
            if (where.companyId !== undefined && inv.companyId !== where.companyId) return false;
            if (where.workerTalentProfileId !== undefined && inv.workerTalentProfileId !== where.workerTalentProfileId) return false;
            if ('shiftId' in where && inv.shiftId !== (where.shiftId as string | null)) return false;
            if (where.status && typeof where.status === 'object' && where.status !== null && 'in' in (where.status as object)) {
              const statuses = (where.status as { in: string[] }).in;
              if (!statuses.includes(inv.status)) return false;
            }
            if (where.workerTalentProfile && typeof where.workerTalentProfile === 'object') {
              const userId = (where.workerTalentProfile as { userId: string }).userId;
              const profile = fixtures.profiles.find((p) => p.id === inv.workerTalentProfileId);
              if (!profile || profile.userId !== userId) return false;
            }
            return true;
          });
          return match ? hydrate(match) : null;
        }),
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const list = [...invitations.values()].filter((inv) => {
            if (where.companyId !== undefined && inv.companyId !== where.companyId) return false;
            if (where.workerTalentProfile && typeof where.workerTalentProfile === 'object') {
              const userId = (where.workerTalentProfile as { userId: string }).userId;
              const profile = fixtures.profiles.find((p) => p.id === inv.workerTalentProfileId);
              if (!profile || profile.userId !== userId) return false;
            }
            return true;
          });
          list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return list.map(hydrate);
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Partial<StoredInvitation> }) => {
          const record = invitations.get(where.id);
          if (!record) return { count: 0 };
          if (where.status !== undefined && record.status !== where.status) return { count: 0 };
          Object.assign(record, data, { updatedAt: new Date() });
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
          const record = invitations.get(where.id);
          if (!record) throw new Error('TalentInvitation not found');
          return hydrate(record);
        }),
      },
    };
  }

  const companyA: FakeCompany = { id: 'company-a', ownerId: 'business-a', name: 'Café Central' };
  const companyB: FakeCompany = { id: 'company-b', ownerId: 'business-b', name: 'Panadería Norte' };
  const users: FakeUser[] = [{ id: 'user-1', name: 'Ana Torres' }, { id: 'user-2', name: 'Luis Paredes' }];
  const visibleProfile: FakeProfile = { id: 'profile-1', userId: 'user-1', isVisible: true };
  const hiddenProfile: FakeProfile = { id: 'profile-2', userId: 'user-2', isVisible: false };

  function businessSession(overrides: Partial<AuthSession> = {}): AuthSession {
    return { token: 't', userId: 'business-a', role: 'BUSINESS', name: 'Café Central', email: 'cafe@example.com', identifier: '20123456789', requiresPasswordSetup: false, ...overrides };
  }
  function workerSession(overrides: Partial<AuthSession> = {}): AuthSession {
    return { token: 't', userId: 'user-1', role: 'WORKER', name: 'Ana Torres', email: 'ana@example.com', identifier: '12345678', requiresPasswordSetup: false, ...overrides };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never distinguishes a nonexistent target from a target that exists but is not visible', async () => {
    const prisma = fakePrisma({ companies: [companyA], users, profiles: [visibleProfile, hiddenProfile] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const missing = await service.createInvitation(businessSession(), { workerTalentProfileId: 'profile-does-not-exist' }).catch((error) => error);
    const notVisible = await service.createInvitation(businessSession(), { workerTalentProfileId: hiddenProfile.id }).catch((error) => error);

    expect(missing).toMatchObject({ code: 'TALENT_PROFILE_NOT_AVAILABLE' });
    expect(notVisible).toMatchObject({ code: 'TALENT_PROFILE_NOT_AVAILABLE' });
  });

  it('blocks a second active invitation for the same company/profile pair without creating a second record', async () => {
    const prisma = fakePrisma({ companies: [companyA], users, profiles: [visibleProfile] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const first = (await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id })) as { id: string };
    expect(first.id).toBeTruthy();

    const duplicate = await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id }).catch((error) => error);
    expect(duplicate).toMatchObject({ code: 'INVITATION_ALREADY_ACTIVE' });

    const list = (await service.listForBusiness(businessSession())) as unknown[];
    expect(list).toHaveLength(1);
  });

  it('converts a unique-constraint violation raised by a concurrent duplicate into the same explicit error', async () => {
    const raceError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: 'P2002' });
    const prisma = {
      company: { upsert: vi.fn(async () => companyA) },
      workerTalentProfile: { findFirst: vi.fn(async () => ({ id: visibleProfile.id, userId: visibleProfile.userId })) },
      talentInvitation: {
        // Simula la ventana de carrera: el chequeo previo no ve nada, pero la
        // base de datos sí rechaza por el índice único parcial.
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => { throw raceError; }),
      },
    };
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const result = await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id }).catch((error) => error);
    expect(result).toMatchObject({ code: 'INVITATION_ALREADY_ACTIVE' });
  });

  it('allows a re-invitation after a previous one was declined, and allows a second invitation tied to a different shift', async () => {
    const shiftOne: FakeShift = { id: 'shift-1', companyId: companyA.id, title: 'Turno mañana', startsAt: new Date('2026-10-01T08:00:00Z'), endsAt: new Date('2026-10-01T14:00:00Z') };
    const shiftTwo: FakeShift = { id: 'shift-2', companyId: companyA.id, title: 'Turno tarde', startsAt: new Date('2026-10-01T14:00:00Z'), endsAt: new Date('2026-10-01T20:00:00Z') };
    const prisma = fakePrisma({ companies: [companyA], users, profiles: [visibleProfile], shifts: [shiftOne, shiftTwo] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const withoutShift = (await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id })) as { id: string };
    const withShift = (await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id, shiftId: shiftOne.id })) as { id: string };
    expect(withShift.id).not.toBe(withoutShift.id);

    await service.declineInvitation(workerSession(), withoutShift.id);
    const reinvited = await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id }).catch((error) => error);
    expect(reinvited).not.toHaveProperty('code', 'INVITATION_ALREADY_ACTIVE');

    const anotherShift = await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id, shiftId: shiftTwo.id }).catch((error) => error);
    expect(anotherShift).not.toHaveProperty('code', 'INVITATION_ALREADY_ACTIVE');
  });

  it('rejects a shift that does not belong to the inviting company', async () => {
    const foreignShift: FakeShift = { id: 'shift-foreign', companyId: companyB.id, title: 'Turno ajeno', startsAt: new Date(), endsAt: new Date() };
    const prisma = fakePrisma({ companies: [companyA, companyB], users, profiles: [visibleProfile], shifts: [foreignShift] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const result = await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id, shiftId: foreignShift.id }).catch((error) => error);
    expect(result).toMatchObject({ code: 'SHIFT_NOT_FOUND' });
  });

  it('isolates invitations between companies: business B never sees or receives business A invitations in its list', async () => {
    const prisma = fakePrisma({ companies: [companyA, companyB], users, profiles: [visibleProfile] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id });

    const businessAList = (await service.listForBusiness(businessSession())) as unknown[];
    const businessBList = (await service.listForBusiness(businessSession({ userId: 'business-b', name: 'Panadería Norte' }))) as unknown[];
    expect(businessAList).toHaveLength(1);
    expect(businessBList).toHaveLength(0);
  });

  it('isolates invitations between workers: worker 2 cannot list or respond to an invitation addressed to worker 1', async () => {
    const prisma = fakePrisma({ companies: [companyA], users, profiles: [visibleProfile] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const created = (await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id })) as { id: string };

    const worker2 = workerSession({ userId: 'user-2', name: 'Luis Paredes' });
    const worker2List = (await service.listForWorker(worker2)) as unknown[];
    expect(worker2List).toHaveLength(0);

    const forbiddenAccept = await service.acceptInvitation(worker2, created.id).catch((error) => error);
    expect(forbiddenAccept).toMatchObject({ code: 'INVITATION_NOT_FOUND' });

    const worker1List = (await service.listForWorker(workerSession())) as unknown[];
    expect(worker1List).toHaveLength(1);
  });

  it('never exposes the recipient userId in the business-facing invitation shape', async () => {
    const prisma = fakePrisma({ companies: [companyA], users, profiles: [visibleProfile] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const created = await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id });
    const raw = JSON.stringify(created);
    expect(raw).not.toContain('"userId"');
    expect(raw).not.toContain(visibleProfile.userId);
    expect(created).toMatchObject({ workerTalentProfileId: visibleProfile.id });
  });

  it('accepts a pending invitation once, and a second response is rejected as no-longer-pending', async () => {
    const prisma = fakePrisma({ companies: [companyA], users, profiles: [visibleProfile] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const created = (await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id })) as { id: string };
    const accepted = (await service.acceptInvitation(workerSession(), created.id)) as { status: string };
    expect(accepted.status).toBe('ACCEPTED');

    const secondResponse = await service.declineInvitation(workerSession(), created.id).catch((error) => error);
    expect(secondResponse).toMatchObject({ code: 'INVITATION_NOT_PENDING' });

    const reinviteWhileAccepted = await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id }).catch((error) => error);
    expect(reinviteWhileAccepted).toMatchObject({ code: 'INVITATION_ALREADY_ACTIVE' });
  });

  it('evaluates expiration on the server: a pending invitation past its expiresAt cannot be accepted and lists as EXPIRED', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
    const prisma = fakePrisma({ companies: [companyA], users, profiles: [visibleProfile] });
    const service = new DatabaseTalentInvitationService(prisma as unknown as PrismaClient);

    const created = (await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id })) as { id: string; expiresAt: string };
    expect(new Date(created.expiresAt).toISOString()).toBe('2026-09-23T00:00:00.000Z');

    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'));

    const expired = await service.acceptInvitation(workerSession(), created.id).catch((error) => error);
    expect(expired).toMatchObject({ code: 'INVITATION_EXPIRED' });

    const workerList = (await service.listForWorker(workerSession())) as Array<{ status: string }>;
    expect(workerList[0]?.status).toBe('EXPIRED');

    // Reinvitar tras el vencimiento debe permitirse: EXPIRED no es un estado activo.
    const reinvited = await service.createInvitation(businessSession(), { workerTalentProfileId: visibleProfile.id }).catch((error) => error);
    expect(reinvited).not.toHaveProperty('code', 'INVITATION_ALREADY_ACTIVE');
  });
});
