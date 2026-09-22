import { raw, Router } from 'express';
import { z } from 'zod';

import { AuthError, type AuthService } from '../auth/auth.service.js';
import { DatabaseTalentService, TalentError, type TalentOperations } from './talent.service.js';
import {
  DatabaseTalentInvitationService,
  TalentInvitationError,
  type TalentInvitationErrorCode,
  type TalentInvitationOperations,
} from './talent_invitation.service.js';

function bearerToken(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

const nullableText = z.string().trim().min(1).max(800).nullable().optional();
const isoDate = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), 'INVALID_DATE');

// Experiencia laboral: varias entradas por perfil, con fecha de inicio
// obligatoria; `endDate` ausente significa puesto vigente. `startDate` no
// puede quedar después de `endDate` cuando ambas están presentes.
const experienceSchema = z.object({
  role: z.string().trim().min(1).max(120),
  employer: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(800).nullable().optional(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
}).strict().refine(
  (value) => !value.endDate || Date.parse(value.startDate) <= Date.parse(value.endDate),
  { message: 'INVALID_EXPERIENCE_RANGE', path: ['endDate'] },
);

// Certificación declarada por el trabajador: metadato, no verificación.
// A propósito no admite ningún campo de estado de verificación; `.strict()`
// rechaza cualquier campo extra como `verified`/`isVerified`.
const certificationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  issuer: z.string().trim().min(1).max(120).nullable().optional(),
  issueDate: isoDate.nullable().optional(),
  expirationDate: isoDate.nullable().optional(),
  credentialId: z.string().trim().min(1).max(80).nullable().optional(),
}).strict();

const languageSchema = z.object({
  language: z.string().trim().min(1).max(40),
  proficiency: z.enum(['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE']),
}).strict();

const profileSchema = z.object({
  headline: nullableText.refine((value) => value === undefined || value === null || value.length <= 120),
  bio: nullableText,
  district: nullableText.refine((value) => value === undefined || value === null || value.length <= 80),
  availabilityText: nullableText.refine((value) => value === undefined || value === null || value.length <= 160),
  availabilityDays: z.array(z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])).max(7).optional(),
  availabilityPeriods: z.array(z.enum(['MORNING', 'AFTERNOON', 'EVENING', 'OVERNIGHT'])).max(4).optional(),
  isAvailable: z.boolean().optional(),
  isVisible: z.boolean().optional(),
  specialtyIds: z.array(z.string().min(1)).max(12).optional(),
  specialties: z.array(z.object({
    specialtyId: z.string().min(1),
    proficiency: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
    yearsExperience: z.number().int().min(0).max(60).nullable().optional(),
  }).strict()).max(12).optional(),
  workRadiusKm: z.number().int().min(1).max(200).nullable().optional(),
  workDistricts: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  isExperienceVisible: z.boolean().optional(),
  isCertificationsVisible: z.boolean().optional(),
  isLanguagesVisible: z.boolean().optional(),
  isWorkAreaVisible: z.boolean().optional(),
  experiences: z.array(experienceSchema).max(20).optional(),
  certifications: z.array(certificationSchema).max(20).optional(),
  languages: z.array(languageSchema).max(20).optional()
    .refine(
      (value) => !value || new Set(value.map((item) => item.language.trim().toLowerCase())).size === value.length,
      'DUPLICATE_LANGUAGE',
    ),
}).strict().refine((value) => Object.keys(value).length > 0, 'EMPTY_UPDATE');

const searchSchema = z.object({
  specialtyId: z.string().min(1).optional(),
  district: z.string().trim().min(1).max(80).optional(),
  query: z.string().trim().min(1).max(100).optional(),
  availableOnly: z.enum(['true', 'false']).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(1).max(1000).optional() }).strict();

const createInvitationSchema = z.object({
  workerTalentProfileId: z.string().min(1),
  shiftId: z.string().min(1).nullable().optional(),
  message: z.string().trim().min(1).max(500).nullable().optional(),
}).strict();

const TALENT_INVITATION_ERROR_STATUS: Record<TalentInvitationErrorCode, number> = {
  BUSINESS_ACCOUNT_REQUIRED: 403,
  WORKER_ACCOUNT_REQUIRED: 403,
  TALENT_PROFILE_NOT_AVAILABLE: 404,
  SHIFT_NOT_FOUND: 404,
  INVITATION_ALREADY_ACTIVE: 409,
  INVITATION_NOT_FOUND: 404,
  INVITATION_EXPIRED: 409,
  INVITATION_NOT_PENDING: 409,
};

function imageUpload(body: unknown, originalName: string | undefined) {
  if (!Buffer.isBuffer(body) || body.length === 0 || !originalName) return null;
  const name = originalName.toLowerCase();
  if (
    body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) &&
    /\.jpe?g$/.test(name)
  ) {
    return { mediaType: 'image/jpeg' as const, extension: 'jpg' as const };
  }
  if (
    body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    name.endsWith('.png')
  ) {
    return { mediaType: 'image/png' as const, extension: 'png' as const };
  }
  if (
    body.subarray(0, 4).toString('ascii') === 'RIFF' &&
    body.subarray(8, 12).toString('ascii') === 'WEBP' &&
    name.endsWith('.webp')
  ) {
    return { mediaType: 'image/webp' as const, extension: 'webp' as const };
  }
  return null;
}

export function createTalentRouter(
  authService: AuthService,
  service: TalentOperations = new DatabaseTalentService(),
  invitations: TalentInvitationOperations = new DatabaseTalentInvitationService(),
) {
  const router = Router();
  const session = async (request: import('express').Request) => authService.restore(bearerToken(request.header('authorization')));
  const workerSession = async (request: import('express').Request) => {
    const restored = await session(request);
    if (restored.role !== 'WORKER') throw new TalentError('WORKER_ACCOUNT_REQUIRED');
    return restored;
  };
  const businessSession = async (request: import('express').Request) => {
    const restored = await session(request);
    if (restored.role !== 'BUSINESS') throw new TalentError('BUSINESS_ACCOUNT_REQUIRED');
    return restored;
  };
  const route = (handler: (request: import('express').Request, response: import('express').Response) => Promise<void>) => async (request: import('express').Request, response: import('express').Response) => {
    try { await handler(request, response); } catch (error) {
      if (error instanceof AuthError) {
        response.status(401).json({ error: error.code });
        return;
      }
      if (error instanceof TalentInvitationError) {
        response.status(TALENT_INVITATION_ERROR_STATUS[error.code]).json({ error: error.code });
        return;
      }
      const code = error instanceof TalentError ? error.code : 'INVALID_TALENT_REQUEST';
      const status = code === 'WORKER_ACCOUNT_REQUIRED' || code === 'BUSINESS_ACCOUNT_REQUIRED' ? 403 : code === 'SPECIALTY_NOT_FOUND' || code === 'APPLICATION_NOT_FOUND' || code === 'CV_NOT_AVAILABLE' ? 404 : code === 'REVIEW_ALREADY_EXISTS' ? 409 : 400;
      response.status(status).json({ error: code });
    }
  };

  router.get('/specialties', route(async (_request, response) => { response.json(await service.listSpecialties()); }));
  router.get('/workers/me/profile', route(async (request, response) => { response.json(await service.ownProfile(await workerSession(request))); }));
  router.patch('/workers/me/profile', route(async (request, response) => { response.json(await service.updateOwnProfile(await workerSession(request), profileSchema.parse(request.body))); }));
  router.put('/workers/me/cv', raw({ type: 'application/pdf', limit: '5mb' }), route(async (request, response) => {
    const body = request.body;
    const encodedName = request.header('x-file-name');
    if (
      !Buffer.isBuffer(body) ||
      body.length === 0 ||
      body.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      !encodedName
    ) {
      response.status(400).json({ error: 'INVALID_CV_UPLOAD' });
      return;
    }
    let originalName = '';
    try {
      originalName = decodeURIComponent(encodedName).trim();
    } catch {
      response.status(400).json({ error: 'INVALID_CV_UPLOAD' });
      return;
    }
    if (!originalName.toLowerCase().endsWith('.pdf') || originalName.length > 180) {
      response.status(400).json({ error: 'INVALID_CV_UPLOAD' });
      return;
    }
    response.status(201).json(await service.uploadCv(await workerSession(request), {
      originalName,
      mediaType: 'application/pdf',
      bytes: body,
    }));
  }));
  router.get('/workers/me/cv/download', route(async (request, response) => {
    const document = await service.downloadCv(await workerSession(request));
    if (!document) {
      response.status(404).json({ error: 'CV_NOT_FOUND' });
      return;
    }
    response.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': document.mediaType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
    });
    response.send(document.bytes);
  }));
  // CV de un postulante para la empresa dueña del turno. Solo lectura, un
  // archivo por petición y siempre con sesión Bearer: nunca hay una URL pública.
  // `Content-Disposition` en `inline` para que el navegador lo muestre; el
  // nombre lo controla el trabajador, así que se codifica estrictamente.
  router.get('/business/shifts/:id/applications/:applicationId/cv', route(async (request, response) => {
    const param = (name: string) => {
      const value = request.params[name];
      return Array.isArray(value) ? value[0] ?? '' : value ?? '';
    };
    const document = await service.downloadApplicantCv(await businessSession(request), param('id'), param('applicationId'));
    const filename = encodeURIComponent(document.originalName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    response.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${filename}`,
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(document.bytes);
  }));
  router.put('/workers/me/photo', raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }), route(async (request, response) => {
    const encodedName = request.header('x-file-name');
    let originalName = '';
    try {
      originalName = encodedName ? decodeURIComponent(encodedName).trim() : '';
    } catch {
      response.status(400).json({ error: 'INVALID_PROFILE_PHOTO' });
      return;
    }
    const upload = imageUpload(request.body, originalName);
    if (!upload || originalName.length > 180) {
      response.status(400).json({ error: 'INVALID_PROFILE_PHOTO' });
      return;
    }
    response.status(201).json(await service.uploadProfilePhoto(await workerSession(request), {
      originalName,
      bytes: request.body,
      ...upload,
    }));
  }));
  router.get('/workers/me/photo', route(async (request, response) => {
    const photo = await service.downloadProfilePhoto(await workerSession(request));
    if (!photo) {
      response.status(404).json({ error: 'PROFILE_PHOTO_NOT_FOUND' });
      return;
    }
    response.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': photo.mediaType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(photo.originalName)}`,
    });
    response.send(photo.bytes);
  }));
  router.get('/business/talent', route(async (request, response) => {
    const query = searchSchema.parse(request.query);
    response.json(await service.searchTalent(await businessSession(request), { ...query, availableOnly: query.availableOnly === 'true' }));
  }));
  router.post('/assignments/:id/reviews', route(async (request, response) => {
    const assignmentId = Array.isArray(request.params.id) ? request.params.id[0] ?? '' : request.params.id;
    response.status(201).json(await service.createAssignmentReview(await session(request), assignmentId, reviewSchema.parse(request.body)));
  }));
  router.post('/business/talent-invitations', route(async (request, response) => {
    const input = createInvitationSchema.parse(request.body);
    response.status(201).json(await invitations.createInvitation(await businessSession(request), input));
  }));
  router.get('/business/talent-invitations', route(async (request, response) => {
    response.json(await invitations.listForBusiness(await businessSession(request)));
  }));
  router.get('/workers/me/talent-invitations', route(async (request, response) => {
    response.json(await invitations.listForWorker(await workerSession(request)));
  }));
  router.post('/workers/me/talent-invitations/:id/accept', route(async (request, response) => {
    const id = Array.isArray(request.params.id) ? request.params.id[0] ?? '' : request.params.id;
    response.json(await invitations.acceptInvitation(await workerSession(request), id));
  }));
  router.post('/workers/me/talent-invitations/:id/decline', route(async (request, response) => {
    const id = Array.isArray(request.params.id) ? request.params.id[0] ?? '' : request.params.id;
    response.json(await invitations.declineInvitation(await workerSession(request), id));
  }));
  return router;
}
