import { raw, Router, type ErrorRequestHandler, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';

import { AuthError, DatabaseAuthService, type AccountRole, type AuthService, type AuthSession } from '../auth/auth.service.js';
import { JOB_APPLICATION_STATUSES } from './job-state.js';
import { JobError } from './jobs.errors.js';
import { jobEvents, type JobEvents } from './jobs.events.js';
import { JobService } from './jobs.service.js';

// ---------------------------------------------------------------------------
// Validación estricta de entradas
// ---------------------------------------------------------------------------

const id = z.string().trim().min(1).max(128);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'INVALID_DATE');
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const modality = z.enum(['ONSITE', 'REMOTE', 'HYBRID']);
const workload = z.enum(['FULL_TIME', 'PART_TIME']);
const contractType = z.enum(['INDEFINITE', 'FIXED_TERM', 'INTERNSHIP', 'OTHER']);
/** Tope razonable: 100 000 soles mensuales, en céntimos. */
const cents = z.number().int().min(1).max(10_000_000);

const postingFields = {
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(5_000),
  responsibilities: optionalText(3_000),
  requirements: optionalText(3_000),
  benefits: optionalText(3_000),
  modality,
  workload,
  salaryMinCents: cents,
  salaryMaxCents: cents,
  location: z.string().trim().min(2).max(160),
  contractType,
  expectedStartDate: calendarDate.nullable().optional(),
  vacancies: z.number().int().min(1).max(500),
  screeningQuestions: z.array(z.string().trim().min(10).max(240)).max(5)
    .refine((items) => new Set(items).size === items.length, 'DUPLICATE_SCREENING_QUESTIONS').optional(),
};
const postingSchema = z.object(postingFields).strict()
  .refine((value) => value.salaryMinCents <= value.salaryMaxCents, { message: 'INVALID_SALARY_RANGE', path: ['salaryMaxCents'] });
const postingPatchSchema = z.object(postingFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'NO_FIELD_TO_CHANGE' })
  .refine((value) => value.salaryMinCents === undefined || value.salaryMaxCents === undefined || value.salaryMinCents <= value.salaryMaxCents, {
    message: 'INVALID_SALARY_RANGE',
    path: ['salaryMaxCents'],
  });

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(256).optional(),
});
const statusList = z.string().trim().max(200).transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
  .pipe(z.array(z.enum(JOB_APPLICATION_STATUSES as unknown as [string, ...string[]])).max(8));
const applicantsQuerySchema = pageSchema.extend({ status: statusList.optional() });
const postingsQuerySchema = pageSchema.extend({ status: z.enum(['DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'FILLED']).optional() });
const searchQuerySchema = pageSchema.extend({
  query: z.string().trim().min(1).max(100).optional(),
  modality: modality.optional(),
  workload: workload.optional(),
  contractType: contractType.optional(),
  minSalaryCents: z.coerce.number().int().min(1).max(10_000_000).optional(),
  location: z.string().trim().min(1).max(100).optional(),
});
const stageSchema = z.object({ status: z.enum(['SHORTLISTED', 'INTERVIEW']) }).strict();
const interviewSchema = z.object({
  scheduledAt: z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), 'INVALID_DATE'),
  mode: z.enum(['ONSITE', 'VIDEO', 'PHONE']).nullable().optional(),
  note: optionalText(500),
}).strict();
const rejectSchema = z.object({ reason: optionalText(500) }).strict();
const offerSchema = z.object({
  salaryCents: cents,
  contractType,
  startDate: calendarDate,
  note: optionalText(1_000),
  documentId: id.nullable().optional(),
}).strict();
const applySchema = z.object({
  answers: z.array(z.object({ question: z.string().trim().min(1).max(240), answer: z.string().trim().min(1).max(1_000) }).strict()).max(5).default([]),
}).strict();

// ---------------------------------------------------------------------------
// Infraestructura de rutas
// ---------------------------------------------------------------------------

function bearerToken(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function param(request: Request, name: string) {
  const value = request.params[name];
  return z.string().trim().min(1).max(128).parse(Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
}

function sendError(response: Response, error: unknown) {
  if (error instanceof AuthError) {
    response.status(401).json({ error: 'INVALID_SESSION' });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'INVALID_INPUT', issues: error.issues });
    return;
  }
  if (error instanceof JobError) {
    response.status(error.statusCode).json({ error: error.code, ...error.details });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'INTERNAL_ERROR' });
}

function guarded(
  authService: AuthService,
  role: AccountRole,
  handler: (request: Request, response: Response, session: AuthSession) => Promise<void>,
) {
  return async (request: Request, response: Response) => {
    try {
      const session = await authService.restore(bearerToken(request.header('authorization')));
      if (session.role !== role) {
        response.status(403).json({ error: `${role}_ACCOUNT_REQUIRED` });
        return;
      }
      await handler(request, response, session);
    } catch (error) {
      sendError(response, error);
    }
  };
}

function sendDocument(response: Response, document: { originalName: string; mediaType: string; bytes: Buffer }) {
  const filename = encodeURIComponent(document.originalName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  response.set({
    'Cache-Control': 'private, no-store',
    'Content-Type': document.mediaType,
    'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    'X-Content-Type-Options': 'nosniff',
  });
  response.send(document.bytes);
}

/** Respuestas de las operaciones idempotentes: `201` al crear, `200` si no cambió nada. */
function withStatus(response: Response, result: { idempotent?: boolean }) {
  response.status(result.idempotent ? 200 : 201);
}

// ---------------------------------------------------------------------------
// Empresa
// ---------------------------------------------------------------------------

export function createBusinessJobsRouter(
  authService: AuthService = new DatabaseAuthService(),
  service: JobService = new JobService(),
) {
  const router = Router();
  const company = (handler: (request: Request, response: Response, session: AuthSession) => Promise<void>) => guarded(authService, 'BUSINESS', handler);

  router.post('/job-postings', company(async (request, response, session) => {
    response.status(201).json(await service.createPosting(session, postingSchema.parse(request.body)));
  }));
  router.get('/job-postings', company(async (request, response, session) => {
    const { limit, cursor, status } = postingsQuerySchema.parse(request.query);
    response.json(await service.listPostings(session, { limit, cursor, status }));
  }));
  router.get('/job-postings/:postingId', company(async (request, response, session) => {
    response.json(await service.getPosting(session, param(request, 'postingId')));
  }));
  router.patch('/job-postings/:postingId', company(async (request, response, session) => {
    response.json(await service.updatePosting(session, param(request, 'postingId'), postingPatchSchema.parse(request.body)));
  }));
  router.post('/job-postings/:postingId/publish', company(async (request, response, session) => {
    response.json(await service.publishPosting(session, param(request, 'postingId')));
  }));
  router.post('/job-postings/:postingId/pause', company(async (request, response, session) => {
    response.json(await service.pausePosting(session, param(request, 'postingId')));
  }));
  router.post('/job-postings/:postingId/close', company(async (request, response, session) => {
    response.json(await service.closePosting(session, param(request, 'postingId')));
  }));
  router.get('/job-postings/:postingId/applications', company(async (request, response, session) => {
    const { limit, cursor, status } = applicantsQuerySchema.parse(request.query);
    response.json(await service.listApplicants(session, param(request, 'postingId'), { limit, cursor, statuses: status as never }));
  }));

  router.get('/job-applications/:applicationId', company(async (request, response, session) => {
    response.json(await service.getApplicationForCompany(session, param(request, 'applicationId')));
  }));
  router.post('/job-applications/:applicationId/stage', company(async (request, response, session) => {
    const { status } = stageSchema.parse(request.body);
    response.json(await service.moveStage(session, param(request, 'applicationId'), status));
  }));
  router.post('/job-applications/:applicationId/interview', company(async (request, response, session) => {
    const body = interviewSchema.parse(request.body);
    const result = await service.scheduleInterview(session, param(request, 'applicationId'), {
      scheduledAt: new Date(body.scheduledAt),
      mode: body.mode,
      note: body.note,
    });
    response.json(result);
  }));
  router.post('/job-applications/:applicationId/reject', company(async (request, response, session) => {
    response.json(await service.rejectApplication(session, param(request, 'applicationId'), rejectSchema.parse(request.body ?? {}).reason));
  }));
  router.put('/job-applications/:applicationId/offer-documents', raw({ type: 'application/pdf', limit: '5mb' }), company(async (request, response, session) => {
    const body: unknown = request.body;
    const encodedName = request.header('x-file-name');
    if (!Buffer.isBuffer(body) || body.length === 0 || body.subarray(0, 5).toString('ascii') !== '%PDF-' || !encodedName) {
      response.status(400).json({ error: 'INVALID_OFFER_DOCUMENT' });
      return;
    }
    let originalName = '';
    try { originalName = decodeURIComponent(encodedName).trim(); } catch { /* se rechaza abajo */ }
    if (!originalName.toLowerCase().endsWith('.pdf') || originalName.length > 180) {
      response.status(400).json({ error: 'INVALID_OFFER_DOCUMENT' });
      return;
    }
    response.status(201).json(await service.uploadOfferDocument(session, param(request, 'applicationId'), { originalName, bytes: body }));
  }));
  router.post('/job-applications/:applicationId/offers', company(async (request, response, session) => {
    const result = await service.issueOffer(session, param(request, 'applicationId'), offerSchema.parse(request.body));
    withStatus(response, result);
    response.json(result);
  }));
  router.post('/job-applications/:applicationId/hire', company(async (request, response, session) => {
    response.json(await service.confirmHire(session, param(request, 'applicationId')));
  }));
  router.get('/job-applications/:applicationId/cv', company(async (request, response, session) => {
    sendDocument(response, await service.downloadApplicantCv(session, param(request, 'applicationId')));
  }));
  router.get('/job-applications/:applicationId/offers/:offerId/document', company(async (request, response, session) => {
    sendDocument(response, await service.downloadOfferDocument(session, 'COMPANY', param(request, 'applicationId'), param(request, 'offerId')));
  }));

  // Errores del cuerpo binario (documento demasiado grande) antes del manejador por defecto de Express.
  const bodyError: ErrorRequestHandler = (error, _request, response, next) => {
    if (error && typeof error === 'object' && (error as { type?: string }).type === 'entity.too.large') {
      response.status(413).json({ error: 'OFFER_DOCUMENT_TOO_LARGE' });
      return;
    }
    next(error);
  };
  router.use(bodyError);
  return router;
}

// ---------------------------------------------------------------------------
// Trabajador
// ---------------------------------------------------------------------------

export function createWorkerJobsRouter(
  authService: AuthService = new DatabaseAuthService(),
  service: JobService = new JobService(),
) {
  const router = Router();
  const worker = (handler: (request: Request, response: Response, session: AuthSession) => Promise<void>) => guarded(authService, 'WORKER', handler);

  router.get('/job-postings', worker(async (request, response, session) => {
    response.json(await service.searchPostings(session, searchQuerySchema.parse(request.query)));
  }));
  router.get('/job-postings/:postingId', worker(async (request, response, session) => {
    response.json(await service.getPublicPosting(session, param(request, 'postingId')));
  }));
  router.post('/job-postings/:postingId/applications', worker(async (request, response, session) => {
    const result = await service.apply(session, param(request, 'postingId'), applySchema.parse(request.body ?? {}).answers);
    response.status(result.created ? 201 : 200).json(result);
  }));
  router.get('/job-applications', worker(async (request, response, session) => {
    const { limit, cursor, status } = applicantsQuerySchema.parse(request.query);
    response.json(await service.listMyApplications(session, { limit, cursor, statuses: status as never }));
  }));
  router.get('/job-applications/:applicationId', worker(async (request, response, session) => {
    response.json(await service.getMyApplication(session, param(request, 'applicationId')));
  }));
  router.post('/job-applications/:applicationId/withdraw', worker(async (request, response, session) => {
    response.json(await service.withdraw(session, param(request, 'applicationId')));
  }));
  router.post('/job-applications/:applicationId/offers/:offerId/accept', worker(async (request, response, session) => {
    response.json(await service.acceptOffer(session, param(request, 'applicationId'), param(request, 'offerId')));
  }));
  router.post('/job-applications/:applicationId/offers/:offerId/decline', worker(async (request, response, session) => {
    response.json(await service.declineOffer(session, param(request, 'applicationId'), param(request, 'offerId')));
  }));
  router.get('/job-applications/:applicationId/offers/:offerId/document', worker(async (request, response, session) => {
    sendDocument(response, await service.downloadOfferDocument(session, 'WORKER', param(request, 'applicationId'), param(request, 'offerId')));
  }));
  return router;
}

// ---------------------------------------------------------------------------
// Avisos en tiempo real (SSE), mismo mecanismo que el feed de turnos
// ---------------------------------------------------------------------------

export function createJobEventsRouter(
  authService: AuthService = new DatabaseAuthService(),
  events: JobEvents = jobEvents,
  options: { heartbeatMs?: number } = {},
) {
  const router = Router();
  router.get('/job-events', async (request, response) => {
    let session: AuthSession;
    try {
      session = await authService.restore(bearerToken(request.header('authorization')));
    } catch (error) {
      sendError(response, error);
      return;
    }
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 2000\n\n');
    // Cada cuenta solo recibe los avisos dirigidos a ella.
    const unsubscribe = events.subscribe((event) => {
      if (event.recipientUserId !== session.userId || response.writableEnded) return;
      const { recipientUserId: _recipient, ...payload } = event;
      response.write(`event: job\ndata: ${JSON.stringify(payload)}\n\n`);
    });
    const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(': keep-alive\n\n'); }, options.heartbeatMs ?? 25_000);
    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  return router;
}
