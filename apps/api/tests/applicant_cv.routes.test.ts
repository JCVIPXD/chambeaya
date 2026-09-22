import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService } from '../src/modules/auth/auth.service.js';
import { PrivateDocumentStorage } from '../src/modules/talent/private_document_storage.js';
import { DatabaseTalentService } from '../src/modules/talent/talent.service.js';

// La empresa lee el CV de un postulante: `GET /api/business/shifts/:id/applications/:applicationId/cv`.
// La regla de acceso (`cv_access.ts`) exige postulación vigente a un turno de
// la propia empresa + perfil visible + CV existente. Estas pruebas ejecutan el
// servicio real contra un almacenamiento privado real (directorio temporal) y
// una base de datos falsa que evalúa de verdad el `where` recibido: si el
// servicio dejara de filtrar por dueño, por turno o por estado, la prueba lo
// vería, en lugar de repetir lo que el servicio ya decidió.

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');

type FakeApplication = {
  id: string;
  shiftId: string;
  ownerId: string;
  status: string;
  worker: {
    profile: { isVisible: boolean } | null;
    documents: Array<{ kind: 'CV' | 'PROFILE_PHOTO'; originalName: string; mediaType: string; storageKey: string }>;
  };
};

// Un filtro ausente en el `where` recibido no filtra nada, como en Prisma.
type ApplicationWhere = { id?: string; shiftId?: string; shift?: { company?: { ownerId?: string } } };

type ApplicationQuery = {
  where: ApplicationWhere;
  select: { worker: { select: { documents: { where: { kind: string } } } } };
};

function fakePrisma(applications: FakeApplication[]) {
  const findFirst = vi.fn(async ({ where, select }: ApplicationQuery) => {
    const found = applications.find(
      (item) =>
        (where.id === undefined || item.id === where.id) &&
        (where.shiftId === undefined || item.shiftId === where.shiftId) &&
        (where.shift?.company?.ownerId === undefined || item.ownerId === where.shift.company.ownerId),
    );
    if (!found) return null;
    return {
      status: found.status,
      worker: {
        talentProfile: found.worker.profile,
        documents: found.worker.documents.filter((document) => document.kind === select.worker.select.documents.where.kind),
      },
    };
  });
  return { shiftApplication: { findFirst } };
}

let storageRoot = '';
let storage: PrivateDocumentStorage;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'chambeaya-cv-'));
  storage = new PrivateDocumentStorage(storageRoot);
});

afterAll(async () => {
  await rm(storageRoot, { recursive: true, force: true });
});

async function storeCv(originalName = 'cv-ana.pdf') {
  const stored = await storage.put({ originalName, mediaType: 'application/pdf', sizeBytes: PDF.byteLength, bytes: PDF, extension: 'pdf' });
  return { kind: 'CV' as const, originalName, mediaType: 'application/pdf', storageKey: stored.storageKey };
}

async function storePhoto() {
  const bytes = Buffer.from('not-a-cv-photo-bytes');
  const stored = await storage.put({ originalName: 'foto.jpg', mediaType: 'image/jpeg', sizeBytes: bytes.byteLength, bytes, extension: 'jpg' });
  return { kind: 'PROFILE_PHOTO' as const, originalName: 'foto.jpg', mediaType: 'image/jpeg', storageKey: stored.storageKey };
}

async function accounts() {
  const authService = new LocalAuthService();
  const owner = await authService.register({ role: 'BUSINESS', name: 'Café Central', email: 'cafe@example.com', password: 'ClaveSegura1', dniOrRuc: '20123456789' });
  const other = await authService.register({ role: 'BUSINESS', name: 'Bar Vecino', email: 'bar@example.com', password: 'ClaveSegura1', dniOrRuc: '20987654321' });
  const worker = await authService.register({ role: 'WORKER', name: 'Ana Torres', email: 'ana@example.com', password: 'ClaveSegura1', dniOrRuc: '12345678' });
  const otherWorker = await authService.register({ role: 'WORKER', name: 'Luis Ríos', email: 'luis@example.com', password: 'ClaveSegura1', dniOrRuc: '87654321' });
  return { authService, owner, other, worker, otherWorker };
}

function appWith(authService: LocalAuthService, applications: FakeApplication[]) {
  const talentService = new DatabaseTalentService(fakePrisma(applications) as unknown as PrismaClient, storage);
  return createApp({ authService, talentService });
}

const cvUrl = (shiftId: string, applicationId: string) => `/api/business/shifts/${shiftId}/applications/${applicationId}/cv`;

async function baseApplication(ownerId: string, overrides: Partial<FakeApplication> = {}): Promise<FakeApplication> {
  return {
    id: 'app-1',
    shiftId: 'shift-1',
    ownerId,
    status: 'PENDING',
    worker: { profile: { isVisible: true }, documents: [await storePhoto(), await storeCv()] },
    ...overrides,
  };
}

function binaryBody(response: request.Response) {
  return Buffer.isBuffer(response.body) ? response.body : Buffer.from(JSON.stringify(response.body));
}

describe('CV de un postulante para la empresa', () => {
  it('entrega el PDF a la empresa dueña del turno con cabeceras seguras', async () => {
    const { authService, owner } = await accounts();
    const app = appWith(authService, [await baseApplication(owner.userId)]);

    const response = await request(app)
      .get(cvUrl('shift-1', 'app-1'))
      .set('Authorization', `Bearer ${owner.token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(binaryBody(response).equals(PDF)).toBe(true);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe("inline; filename*=UTF-8''cv-ana.pdf");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('también lo entrega cuando la postulación ya fue aceptada', async () => {
    const { authService, owner } = await accounts();
    const app = appWith(authService, [await baseApplication(owner.userId, { status: 'ACCEPTED' })]);

    expect((await request(app).get(cvUrl('shift-1', 'app-1')).set('Authorization', `Bearer ${owner.token}`)).status).toBe(200);
  });

  it('codifica el nombre del archivo, que controla el trabajador, sin permitir inyectar cabeceras', async () => {
    const { authService, owner } = await accounts();
    const hostile = `cv "ana" (1)'*\r\nX-Injected: 1.pdf`;
    const app = appWith(authService, [
      await baseApplication(owner.userId, { worker: { profile: { isVisible: true }, documents: [await storeCv(hostile)] } }),
    ]);

    const response = await request(app).get(cvUrl('shift-1', 'app-1')).set('Authorization', `Bearer ${owner.token}`);

    expect(response.status).toBe(200);
    expect(response.headers['x-injected']).toBeUndefined();
    const disposition = response.headers['content-disposition'] as string;
    expect(disposition.startsWith("inline; filename*=UTF-8''")).toBe(true);
    expect(decodeURIComponent(disposition.replace("inline; filename*=UTF-8''", ''))).toBe(hostile);
    expect(disposition.slice("inline; filename*=UTF-8''".length)).toMatch(/^[A-Za-z0-9._%~-]+$/);
  });

  it('una empresa sin relación con el turno recibe 404 APPLICATION_NOT_FOUND, igual que una postulación inexistente', async () => {
    const { authService, owner, other } = await accounts();
    const app = appWith(authService, [await baseApplication(owner.userId)]);

    const foreign = await request(app).get(cvUrl('shift-1', 'app-1')).set('Authorization', `Bearer ${other.token}`);
    const missing = await request(app).get(cvUrl('shift-1', 'no-existe')).set('Authorization', `Bearer ${owner.token}`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: 'APPLICATION_NOT_FOUND' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(foreign.body);
    expect(binaryBody(foreign).includes(PDF)).toBe(false);
  });

  it('una postulación consultada bajo otro turno de la misma empresa no se resuelve', async () => {
    const { authService, owner } = await accounts();
    const app = appWith(authService, [await baseApplication(owner.userId)]);

    const response = await request(app).get(cvUrl('shift-2', 'app-1')).set('Authorization', `Bearer ${owner.token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'APPLICATION_NOT_FOUND' });
  });

  it('un perfil oculto o inexistente no expone el CV y la respuesta no distingue que exista', async () => {
    const { authService, owner } = await accounts();
    const cv = await storeCv();
    const app = appWith(authService, [
      await baseApplication(owner.userId, { id: 'hidden', worker: { profile: { isVisible: false }, documents: [cv] } }),
      await baseApplication(owner.userId, { id: 'no-profile', worker: { profile: null, documents: [cv] } }),
      await baseApplication(owner.userId, { id: 'no-cv', worker: { profile: { isVisible: true }, documents: [] } }),
    ]);

    const responses = await Promise.all(
      ['hidden', 'no-profile', 'no-cv'].map((id) => request(app).get(cvUrl('shift-1', id)).set('Authorization', `Bearer ${owner.token}`)),
    );

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'CV_NOT_AVAILABLE' });
    }
  });

  it.each(['REJECTED', 'WITHDRAWN', 'CANCELLED'])('una postulación %s ya no da acceso al CV', async (status) => {
    const { authService, owner } = await accounts();
    const app = appWith(authService, [await baseApplication(owner.userId, { status })]);

    const response = await request(app).get(cvUrl('shift-1', 'app-1')).set('Authorization', `Bearer ${owner.token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'CV_NOT_AVAILABLE' });
  });

  it('si el archivo falta en el almacenamiento privado responde CV_NOT_AVAILABLE en lugar de un error genérico', async () => {
    const { authService, owner } = await accounts();
    const cv = await storeCv();
    await unlink(join(storageRoot, cv.storageKey));
    const app = appWith(authService, [await baseApplication(owner.userId, { worker: { profile: { isVisible: true }, documents: [cv] } })]);

    const response = await request(app).get(cvUrl('shift-1', 'app-1')).set('Authorization', `Bearer ${owner.token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'CV_NOT_AVAILABLE' });
  });

  it('un trabajador (incluido el dueño del CV) no puede usar la ruta de empresa: 403', async () => {
    const { authService, owner, worker, otherWorker } = await accounts();
    const prisma = fakePrisma([await baseApplication(owner.userId)]);
    const app = createApp({ authService, talentService: new DatabaseTalentService(prisma as unknown as PrismaClient, storage) });

    for (const session of [worker, otherWorker]) {
      const response = await request(app).get(cvUrl('shift-1', 'app-1')).set('Authorization', `Bearer ${session.token}`);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'BUSINESS_ACCOUNT_REQUIRED' });
    }
    expect(prisma.shiftApplication.findFirst).not.toHaveBeenCalled();
  });

  it('sin sesión o con un token inválido responde 401 y no consulta nada', async () => {
    const { authService, owner } = await accounts();
    const prisma = fakePrisma([await baseApplication(owner.userId)]);
    const app = createApp({ authService, talentService: new DatabaseTalentService(prisma as unknown as PrismaClient, storage) });

    expect((await request(app).get(cvUrl('shift-1', 'app-1'))).status).toBe(401);
    expect((await request(app).get(cvUrl('shift-1', 'app-1')).set('Authorization', 'Bearer no-es-un-token')).status).toBe(401);
    expect(prisma.shiftApplication.findFirst).not.toHaveBeenCalled();
  });

  it('el propio trabajador sigue descargando su CV solo por su ruta y la ruta de empresa no la amplía', async () => {
    // Guardia de regresión: la ruta del trabajador conserva `attachment` y no
    // acepta una sesión de empresa (403), como antes de este cierre.
    const { authService, owner } = await accounts();
    const app = appWith(authService, [await baseApplication(owner.userId)]);

    expect((await request(app).get('/api/workers/me/cv/download').set('Authorization', `Bearer ${owner.token}`)).status).toBe(403);
  });
});

describe('el directorio de talento sigue sin exponer el CV', () => {
  it('la tarjeta de talento no trae ni el CV ni un indicador hasCv', async () => {
    const { authService, owner } = await accounts();
    const profile = {
      id: 'p1', isVisible: true, isAvailable: true, headline: 'Barista', bio: 'secreto', district: 'Surco',
      availabilityText: null, availabilityDays: [], availabilityPeriods: [], workRadiusKm: null, workDistricts: [],
      isExperienceVisible: true, isCertificationsVisible: true, isLanguagesVisible: true, isWorkAreaVisible: true,
      specialties: [], experiences: [], certifications: [], languages: [],
      user: {
        id: 'u1', name: 'Ana Torres', reviewsReceived: [],
        documents: [{ kind: 'CV', originalName: 'cv-privado.pdf', mediaType: 'application/pdf', sizeBytes: 10, updatedAt: new Date('2026-01-01') }],
      },
    };
    const prisma = { workerTalentProfile: { findMany: vi.fn(async () => [profile]) } };
    const app = createApp({ authService, talentService: new DatabaseTalentService(prisma as unknown as PrismaClient, storage) });

    const response = await request(app).get('/api/business/talent').set('Authorization', `Bearer ${owner.token}`);

    expect(response.status).toBe(200);
    const [card] = response.body.items as Array<Record<string, unknown>>;
    expect(Object.keys(card)).not.toContain('cv');
    expect(Object.keys(card)).not.toContain('hasCv');
    expect(JSON.stringify(response.body)).not.toContain('cv-privado.pdf');
  });
});
