import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService, type AuthSession } from '../src/modules/auth/auth.service.js';
import { DatabaseTalentService, type TalentOperations } from '../src/modules/talent/talent.service.js';

async function context() {
  const authService = new LocalAuthService();
  const worker = await authService.register({ role: 'WORKER', name: 'Ana Torres', email: 'ana@example.com', password: 'ClaveSegura1', dniOrRuc: '12345678' });
  const business = await authService.register({ role: 'BUSINESS', name: 'Café Central', email: 'cafe@example.com', password: 'ClaveSegura1', dniOrRuc: '20123456789' });
  return { authService, worker, business };
}

describe('worker talent routes', () => {
  it('accepts reviews only through the authenticated session and validates their shape', async () => {
    const createAssignmentReview = vi.fn(async (_session: AuthSession, assignmentId: string, input: unknown) => ({ id: 'review-1', assignmentId, ...input as object }));
    const { authService, worker } = await context();
    const app = createApp({ authService, talentService: { ownProfile: vi.fn(), updateOwnProfile: vi.fn(), listSpecialties: vi.fn(), searchTalent: vi.fn(), createAssignmentReview } as unknown as TalentOperations });

    expect((await request(app).post('/api/assignments/assignment-1/reviews').set('Authorization', `Bearer ${worker.token}`).send({ rating: 5, comment: 'Muy puntual.' })).status).toBe(201);
    expect((await request(app).post('/api/assignments/assignment-1/reviews').set('Authorization', `Bearer ${worker.token}`).send({ rating: 6 })).status).toBe(400);
    expect(createAssignmentReview).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId }), 'assignment-1', { rating: 5, comment: 'Muy puntual.' });
  });
  it('keeps the editable profile exclusive to the authenticated worker', async () => {
    const ownProfile = vi.fn(async (session: AuthSession) => ({ id: 'talent-1', name: session.name, specialties: [], completion: 0 }));
    const { authService, worker, business } = await context();
    const app = createApp({ authService, talentService: { ownProfile, updateOwnProfile: vi.fn(), listSpecialties: vi.fn(), searchTalent: vi.fn() } as unknown as TalentOperations });

    expect((await request(app).get('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`)).status).toBe(200);
    expect((await request(app).get('/api/workers/me/profile').set('Authorization', `Bearer ${business.token}`)).status).toBe(403);
    expect(ownProfile).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId, role: 'WORKER' }));
  });

  it('validates profile changes and does not accept arbitrary score fields', async () => {
    const updateOwnProfile = vi.fn(async (_session: AuthSession, input: unknown) => input);
    const { authService, worker } = await context();
    const app = createApp({ authService, talentService: { ownProfile: vi.fn(), updateOwnProfile, listSpecialties: vi.fn(), searchTalent: vi.fn() } as unknown as TalentOperations });
    const valid = { headline: 'Barista y atención al cliente', district: 'Miraflores', specialtyIds: ['specialty_barista'], isVisible: true };

    expect((await request(app).patch('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`).send(valid)).status).toBe(200);
    expect((await request(app).patch('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`).send({ ...valid, cumpleScore: 100 })).status).toBe(400);
    expect(updateOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId }), valid);
  });

  it('accepts the new profile sections (experience, certifications, languages, work area) and forwards them verbatim', async () => {
    const updateOwnProfile = vi.fn(async (_session: AuthSession, input: unknown) => input);
    const { authService, worker } = await context();
    const app = createApp({ authService, talentService: { ownProfile: vi.fn(), updateOwnProfile, listSpecialties: vi.fn(), searchTalent: vi.fn() } as unknown as TalentOperations });
    const valid = {
      workRadiusKm: 15,
      workDistricts: ['Miraflores', 'Surco'],
      isExperienceVisible: false,
      isCertificationsVisible: true,
      isLanguagesVisible: true,
      isWorkAreaVisible: true,
      experiences: [
        { role: 'Barista', employer: 'Café Central', startDate: '2023-01-01', endDate: '2023-12-31', description: 'Turno de mañana.' },
        { role: 'Mesero', employer: 'Restaurante El Sol', startDate: '2024-01-01' },
      ],
      certifications: [
        { name: 'Manipulación de alimentos', issuer: 'DIGESA', issueDate: '2022-05-01' },
      ],
      languages: [
        { language: 'Español', proficiency: 'NATIVE' },
        { language: 'Inglés', proficiency: 'CONVERSATIONAL' },
      ],
    };

    const response = await request(app).patch('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`).send(valid);
    expect(response.status).toBe(200);
    expect(updateOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId }), valid);
  });

  it('rejects a certification carrying a verification-like field: certifications are metadata, never verification', async () => {
    const updateOwnProfile = vi.fn(async (_session: AuthSession, input: unknown) => input);
    const { authService, worker } = await context();
    const app = createApp({ authService, talentService: { ownProfile: vi.fn(), updateOwnProfile, listSpecialties: vi.fn(), searchTalent: vi.fn() } as unknown as TalentOperations });

    const response = await request(app)
      .patch('/api/workers/me/profile')
      .set('Authorization', `Bearer ${worker.token}`)
      .send({ certifications: [{ name: 'Manipulación de alimentos', verified: true }] });
    expect(response.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();

    const responseAlt = await request(app)
      .patch('/api/workers/me/profile')
      .set('Authorization', `Bearer ${worker.token}`)
      .send({ certifications: [{ name: 'Manipulación de alimentos', isVerified: true }] });
    expect(responseAlt.status).toBe(400);
  });

  it('rejects an experience whose end date precedes its start date', async () => {
    const updateOwnProfile = vi.fn(async (_session: AuthSession, input: unknown) => input);
    const { authService, worker } = await context();
    const app = createApp({ authService, talentService: { ownProfile: vi.fn(), updateOwnProfile, listSpecialties: vi.fn(), searchTalent: vi.fn() } as unknown as TalentOperations });

    const response = await request(app)
      .patch('/api/workers/me/profile')
      .set('Authorization', `Bearer ${worker.token}`)
      .send({ experiences: [{ role: 'Barista', employer: 'Café Central', startDate: '2024-06-01', endDate: '2024-01-01' }] });
    expect(response.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it('rejects duplicate languages within the same update', async () => {
    const updateOwnProfile = vi.fn(async (_session: AuthSession, input: unknown) => input);
    const { authService, worker } = await context();
    const app = createApp({ authService, talentService: { ownProfile: vi.fn(), updateOwnProfile, listSpecialties: vi.fn(), searchTalent: vi.fn() } as unknown as TalentOperations });

    const response = await request(app)
      .patch('/api/workers/me/profile')
      .set('Authorization', `Bearer ${worker.token}`)
      .send({ languages: [{ language: 'Español', proficiency: 'NATIVE' }, { language: 'español', proficiency: 'FLUENT' }] });
    expect(response.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it('accepts a private PDF CV only from its authenticated worker', async () => {
    const uploadCv = vi.fn(async (_session: AuthSession, input: { originalName: string }) => ({ cv: input.originalName }));
    const { authService, worker } = await context();
    const app = createApp({ authService, talentService: {
      ownProfile: vi.fn(), updateOwnProfile: vi.fn(), listSpecialties: vi.fn(),
      searchTalent: vi.fn(), createAssignmentReview: vi.fn(), uploadCv,
      downloadCv: vi.fn(),
    } as unknown as TalentOperations });

    const response = await request(app)
      .put('/api/workers/me/cv')
      .set('Authorization', `Bearer ${worker.token}`)
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', encodeURIComponent('cv-ana.pdf'))
      .send(Buffer.from('%PDF-1.7 example'));

    expect(response.status).toBe(201);
    expect(uploadCv).toHaveBeenCalledWith(
      expect.objectContaining({ userId: worker.userId }),
      expect.objectContaining({ originalName: 'cv-ana.pdf', mediaType: 'application/pdf' }),
    );
    expect(
      (
        await request(app)
            .put('/api/workers/me/cv')
            .set('Authorization', `Bearer ${worker.token}`)
            .set('Content-Type', 'application/pdf')
            .set('X-File-Name', encodeURIComponent('no-es-un-pdf.pdf'))
            .send(Buffer.from('not a pdf'))
      ).status,
    ).toBe(400);
  });

  it('returns 401 for a missing or invalid session without masking role checks or body validation', async () => {
    const ownProfile = vi.fn(async (session: AuthSession) => ({ id: 'talent-1', name: session.name, specialties: [], completion: 0 }));
    const updateOwnProfile = vi.fn(async (_session: AuthSession, input: unknown) => input);
    const { authService, worker, business } = await context();
    const app = createApp({ authService, talentService: { ownProfile, updateOwnProfile, listSpecialties: vi.fn(), searchTalent: vi.fn() } as unknown as TalentOperations });

    const noToken = await request(app).get('/api/workers/me/profile');
    expect(noToken.status).toBe(401);
    expect(noToken.body).toEqual({ error: 'INVALID_SESSION' });

    const invalidToken = await request(app).get('/api/workers/me/profile').set('Authorization', 'Bearer not-a-real-token');
    expect(invalidToken.status).toBe(401);
    expect(invalidToken.body).toEqual({ error: 'INVALID_SESSION' });

    // Regression guard: role mismatch keeps returning 403 and body validation keeps returning 400.
    expect((await request(app).get('/api/workers/me/profile').set('Authorization', `Bearer ${business.token}`)).status).toBe(403);
    expect((await request(app).patch('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`).send({})).status).toBe(400);
  });

  it('limits talent search to business accounts and normalizes its filters', async () => {
    const searchTalent = vi.fn(async (_session: AuthSession, input: unknown) => ({ items: [], nextCursor: null, input }));
    const { authService, worker, business } = await context();
    const app = createApp({ authService, talentService: { ownProfile: vi.fn(), updateOwnProfile: vi.fn(), listSpecialties: vi.fn(), searchTalent } as unknown as TalentOperations });

    const response = await request(app).get('/api/business/talent?specialtyId=specialty_barista&district=Miraflores&query=Ana&availableOnly=true&limit=10').set('Authorization', `Bearer ${business.token}`);
    expect(response.status).toBe(200);
    expect(searchTalent).toHaveBeenCalledWith(expect.objectContaining({ role: 'BUSINESS' }), expect.objectContaining({ specialtyId: 'specialty_barista', district: 'Miraflores', query: 'Ana', availableOnly: true, limit: 10 }));
    expect((await request(app).get('/api/business/talent').set('Authorization', `Bearer ${worker.token}`)).status).toBe(403);
    expect((await request(app).get('/api/business/talent')).status).toBe(401);
  });

  it('rejects an oversized free-text query before it reaches the service', async () => {
    const searchTalent = vi.fn(async () => ({ items: [], nextCursor: null }));
    const { authService, business } = await context();
    const app = createApp({ authService, talentService: { ownProfile: vi.fn(), updateOwnProfile: vi.fn(), listSpecialties: vi.fn(), searchTalent } as unknown as TalentOperations });

    const response = await request(app).get(`/api/business/talent?query=${'a'.repeat(101)}`).set('Authorization', `Bearer ${business.token}`);
    expect(response.status).toBe(400);
    expect(searchTalent).not.toHaveBeenCalled();
  });

  describe('DatabaseTalentService.searchTalent against a fake Prisma client', () => {
    type FakeProfile = {
      id: string;
      isVisible: boolean;
      isAvailable: boolean;
      headline: string | null;
      bio: string | null;
      district: string | null;
      availabilityText: string | null;
      availabilityDays: string[];
      availabilityPeriods: string[];
      workRadiusKm: number | null;
      workDistricts: string[];
      isExperienceVisible: boolean;
      isCertificationsVisible: boolean;
      isLanguagesVisible: boolean;
      isWorkAreaVisible: boolean;
      user: {
        id: string;
        name: string;
        email: string;
        phone: string;
        identifier: string;
        reviewsReceived: { rating: number }[];
        documents: { kind: 'CV' | 'PROFILE_PHOTO'; originalName: string; mediaType: string; sizeBytes: number; updatedAt: Date }[];
      };
      specialties: { specialtyId: string; proficiency: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'; yearsExperience: number | null; specialty: { id: string; slug: string; name: string; category: string } }[];
      experiences: { id: string; role: string; employer: string; description: string | null; startDate: Date; endDate: Date | null }[];
      certifications: { id: string; name: string; issuer: string | null; issueDate: Date | null; expirationDate: Date | null; credentialId: string | null }[];
      languages: { id: string; language: string; proficiency: 'BASIC' | 'CONVERSATIONAL' | 'FLUENT' | 'NATIVE' }[];
    };

    function profile(overrides: Partial<Omit<FakeProfile, 'user'>> & { id: string; user?: Partial<FakeProfile['user']> }): FakeProfile {
      const { id, user: userOverrides, ...rest } = overrides;
      return {
        isVisible: true,
        isAvailable: true,
        headline: null,
        bio: null,
        district: null,
        availabilityText: null,
        availabilityDays: [],
        availabilityPeriods: [],
        workRadiusKm: null,
        workDistricts: [],
        isExperienceVisible: true,
        isCertificationsVisible: true,
        isLanguagesVisible: true,
        isWorkAreaVisible: true,
        specialties: [],
        experiences: [],
        certifications: [],
        languages: [],
        id,
        ...rest,
        user: {
          id: `user-${id}`,
          name: 'Trabajador de prueba',
          email: `${id}@privado.example`,
          phone: '+51 999 999 999',
          identifier: '87654321',
          reviewsReceived: [],
          documents: [
            { kind: 'CV', originalName: `cv-${id}.pdf`, mediaType: 'application/pdf', sizeBytes: 1200, updatedAt: new Date('2026-01-01') },
            { kind: 'PROFILE_PHOTO', originalName: `foto-${id}.jpg`, mediaType: 'image/jpeg', sizeBytes: 800, updatedAt: new Date('2026-01-01') },
          ],
          ...userOverrides,
        },
      };
    }

    function containsInsensitive(value: string | null | undefined, needle: string) {
      return (value ?? '').toLowerCase().includes(needle.toLowerCase());
    }

    function equalsInsensitive(value: string | null | undefined, needle: string) {
      return (value ?? '').toLowerCase() === needle.toLowerCase();
    }

    function matchesWhere(item: FakeProfile, where: Record<string, unknown>): boolean {
      const w = where as {
        isVisible?: boolean;
        isAvailable?: boolean;
        district?: { equals: string };
        specialties?: { some: { specialtyId: string } };
        OR?: Array<{ headline?: { contains: string }; district?: { contains: string }; user?: { name: { contains: string } } }>;
      };
      if (w.isVisible !== undefined && item.isVisible !== w.isVisible) return false;
      if (w.isAvailable !== undefined && item.isAvailable !== w.isAvailable) return false;
      if (w.district && !equalsInsensitive(item.district, w.district.equals)) return false;
      if (w.specialties && !item.specialties.some((entry) => entry.specialtyId === w.specialties!.some.specialtyId)) return false;
      if (w.OR) {
        const matches = w.OR.some((condition) => {
          if (condition.headline) return containsInsensitive(item.headline, condition.headline.contains);
          if (condition.district) return containsInsensitive(item.district, condition.district.contains);
          if (condition.user) return containsInsensitive(item.user.name, condition.user.name.contains);
          return false;
        });
        if (!matches) return false;
      }
      return true;
    }

    function fakePrisma(profiles: FakeProfile[]) {
      return {
        workerTalentProfile: {
          findMany: vi.fn(async ({ where, cursor, skip, take }: { where: Record<string, unknown>; cursor?: { id: string }; skip?: number; take: number }) => {
            const matched = profiles.filter((item) => matchesWhere(item, where)).sort((a, b) => a.id.localeCompare(b.id));
            let startIndex = 0;
            if (cursor?.id) {
              const cursorIndex = matched.findIndex((item) => item.id === cursor.id);
              startIndex = cursorIndex === -1 ? matched.length : cursorIndex + (skip ?? 0);
            }
            return matched.slice(startIndex, startIndex + take);
          }),
        },
      };
    }

    it('paginates a free-text search without skipping or repeating items, and keeps the id-ascending order stable', async () => {
      const profiles = [
        profile({ id: 'a1', headline: 'Barista con experiencia en cafeterías', district: 'Miraflores' }),
        profile({ id: 'a2', headline: 'Mesero de salón', district: 'Surco' }),
        profile({ id: 'a3', headline: 'Barista senior certificado', district: 'San Isidro', isAvailable: false }),
        profile({ id: 'a4', headline: 'Cocinero de eventos', district: 'Barranco' }),
        profile({ id: 'a5', headline: 'Barista junior', district: 'Lince' }),
        profile({ id: 'a6', headline: 'Barista invisible para el piloto', district: 'Ate', isVisible: false }),
      ];
      const { authService, business } = await context();
      const talentService = new DatabaseTalentService(fakePrisma(profiles) as unknown as PrismaClient);
      const app = createApp({ authService, talentService });

      const page1 = await request(app).get('/api/business/talent?query=barista&limit=2').set('Authorization', `Bearer ${business.token}`);
      expect(page1.status).toBe(200);
      expect(page1.body.items.map((item: { id: string }) => item.id)).toEqual(['a1', 'a3']);
      expect(page1.body.nextCursor).toBe('a3');

      const page2 = await request(app).get(`/api/business/talent?query=barista&limit=2&cursor=${page1.body.nextCursor}`).set('Authorization', `Bearer ${business.token}`);
      expect(page2.status).toBe(200);
      expect(page2.body.items.map((item: { id: string }) => item.id)).toEqual(['a5']);
      expect(page2.body.nextCursor).toBeNull();

      const allIds = [...page1.body.items, ...page2.body.items].map((item: { id: string }) => item.id);
      expect(allIds).toEqual(['a1', 'a3', 'a5']);
      expect(new Set(allIds).size).toBe(allIds.length);
    });

    it('never exposes private identity, contact or document data in the talent search response body', async () => {
      const profiles = [
        profile({ id: 'b1', headline: 'Barista con experiencia', district: 'Miraflores', user: { name: 'Ana Torres' } }),
      ];
      const { authService, business } = await context();
      const talentService = new DatabaseTalentService(fakePrisma(profiles) as unknown as PrismaClient);
      const app = createApp({ authService, talentService });

      const response = await request(app).get('/api/business/talent').set('Authorization', `Bearer ${business.token}`);
      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      const item = response.body.items[0];
      expect(Object.keys(item).sort()).toEqual(
        [
          'availabilityDays', 'availabilityPeriods', 'availabilityText', 'certifications', 'completion',
          'district', 'experiences', 'headline', 'id', 'isAvailable', 'languages', 'name', 'reputation',
          'specialties', 'workArea',
        ].sort(),
      );
      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain('privado.example');
      expect(raw).not.toContain('999 999 999');
      expect(raw).not.toContain('87654321');
      expect(raw).not.toContain('cv-b1.pdf');
      expect(raw).not.toContain('foto-b1.jpg');
      expect(raw).not.toContain('application/pdf');
      expect(raw).not.toContain('image/jpeg');
    });

    function fakePrismaWithUpsert(record: FakeProfile) {
      return {
        workerTalentProfile: {
          upsert: vi.fn(async () => record),
          findMany: vi.fn(async () => [record]),
        },
      };
    }

    it('keeps a hidden section fully available to its owner but empty in the public talent card, without deleting it', async () => {
      const record = profile({
        id: 'hide-1',
        isExperienceVisible: false,
        isCertificationsVisible: false,
        isLanguagesVisible: false,
        isWorkAreaVisible: false,
        workRadiusKm: 10,
        workDistricts: ['Miraflores'],
        experiences: [{ id: 'exp-1', role: 'Barista', employer: 'Café Central', description: null, startDate: new Date('2023-01-01'), endDate: null }],
        certifications: [{ id: 'cert-1', name: 'Manipulación de alimentos', issuer: 'DIGESA', issueDate: null, expirationDate: null, credentialId: null }],
        languages: [{ id: 'lang-1', language: 'Español', proficiency: 'NATIVE' }],
      });
      const { authService, worker, business } = await context();
      const talentService = new DatabaseTalentService(fakePrismaWithUpsert(record) as unknown as PrismaClient);
      const app = createApp({ authService, talentService });

      const own = await request(app).get('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`);
      expect(own.status).toBe(200);
      expect(own.body.experiences).toHaveLength(1);
      expect(own.body.certifications).toHaveLength(1);
      expect(own.body.languages).toHaveLength(1);
      expect(own.body.workRadiusKm).toBe(10);
      expect(own.body.workDistricts).toEqual(['Miraflores']);

      const card = await request(app).get('/api/business/talent').set('Authorization', `Bearer ${business.token}`);
      expect(card.status).toBe(200);
      const item = card.body.items[0];
      expect(item.experiences).toEqual([]);
      expect(item.certifications).toEqual([]);
      expect(item.languages).toEqual([]);
      expect(item.workArea).toBeNull();
    });

    it('never includes a verification-like key on a declared certification, for the owner or the public card', async () => {
      const record = profile({
        id: 'cert-vis-1',
        certifications: [{ id: 'cert-1', name: 'Manipulación de alimentos', issuer: 'DIGESA', issueDate: new Date('2022-05-01'), expirationDate: null, credentialId: 'DIGESA-001' }],
      });
      const { authService, worker, business } = await context();
      const talentService = new DatabaseTalentService(fakePrismaWithUpsert(record) as unknown as PrismaClient);
      const app = createApp({ authService, talentService });

      const own = await request(app).get('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`);
      expect(Object.keys(own.body.certifications[0]).sort()).toEqual(['credentialId', 'expirationDate', 'id', 'issueDate', 'issuer', 'name'].sort());

      const card = await request(app).get('/api/business/talent').set('Authorization', `Bearer ${business.token}`);
      expect(Object.keys(card.body.items[0].certifications[0]).sort()).toEqual(['credentialId', 'expirationDate', 'id', 'issueDate', 'issuer', 'name'].sort());
      const raw = JSON.stringify([own.body, card.body]);
      expect(raw.toLowerCase()).not.toContain('verified');
    });

    it('computes completion over all 13 real content signals, reaching 100% only when every one is filled and 0% when none is', async () => {
      const { authService, worker } = await context();

      const full = profile({
        id: 'complete-1',
        headline: 'Barista todo terreno', bio: 'Diez años en cafeterías de Lima.', district: 'Miraflores', availabilityText: 'Fines de semana',
        availabilityDays: ['SATURDAY', 'SUNDAY'], availabilityPeriods: ['MORNING'],
        specialties: [{ specialtyId: 's1', proficiency: 'ADVANCED', yearsExperience: 4, specialty: { id: 's1', slug: 'barista', name: 'Barista', category: 'Café' } }],
        workRadiusKm: 10, workDistricts: [],
        experiences: [{ id: 'exp-1', role: 'Barista', employer: 'Café Central', description: null, startDate: new Date('2023-01-01'), endDate: null }],
        certifications: [{ id: 'cert-1', name: 'Manipulación de alimentos', issuer: null, issueDate: null, expirationDate: null, credentialId: null }],
        languages: [{ id: 'lang-1', language: 'Español', proficiency: 'NATIVE' }],
      });
      const fullResponse = await request(createApp({ authService, talentService: new DatabaseTalentService(fakePrismaWithUpsert(full) as unknown as PrismaClient) }))
        .get('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`);
      expect(fullResponse.body.completion).toBe(100);

      const empty = profile({ id: 'empty-1', user: { documents: [] } });
      const emptyResponse = await request(createApp({ authService, talentService: new DatabaseTalentService(fakePrismaWithUpsert(empty) as unknown as PrismaClient) }))
        .get('/api/workers/me/profile').set('Authorization', `Bearer ${worker.token}`);
      expect(emptyResponse.body.completion).toBe(0);
    });
  });
});
