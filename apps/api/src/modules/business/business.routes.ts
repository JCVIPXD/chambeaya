import { MessageSender } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';

import { AuthError, DatabaseAuthService, type AuthService, type AuthSession } from '../auth/auth.service.js';
import {
  BusinessRecordNotFoundError,
  BusinessForbiddenError,
  BusinessValidationError,
  DatabaseBusinessService,
  type BusinessOperations,
} from './business.service.js';

const nullableText = z.string().trim().max(240).nullable().optional();
const companySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: nullableText,
  industry: nullableText,
  phone: nullableText,
  address: nullableText,
  district: nullableText,
}).refine((value) => Object.keys(value).length > 0, 'EMPTY_UPDATE');

const shiftFields = {
  title: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  payCents: z.number().int().positive().max(100_000_00),
  requiredWorkers: z.number().int().min(1).max(200),
  description: z.string().trim().min(20).max(4000).nullable().optional(),
  responsibilities: z.string().trim().min(10).max(3000).nullable().optional(),
  requirements: z.string().trim().min(5).max(3000).nullable().optional(),
  screeningQuestions: z.array(z.string().trim().min(10).max(240)).max(3).optional(),
  modality: z.enum(['PRESENCIAL', 'REMOTO', 'HIBRIDO']).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  rescueActive: z.boolean().optional(),
};
const shiftSchema = z.object(shiftFields).strict().refine((value) => value.endsAt > value.startsAt, { message: 'INVALID_DATE_RANGE', path: ['endsAt'] });
const shiftUpdateSchema = z.object(shiftFields).partial().refine((value) => Object.keys(value).length > 0, 'EMPTY_UPDATE').refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, { message: 'INVALID_DATE_RANGE', path: ['endsAt'] });

const workerFields = {
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  role: z.string().trim().min(2).max(120),
  skills: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  status: z.enum(['AVAILABLE', 'ON_SHIFT', 'UNAVAILABLE']).optional(),
  availability: z.string().trim().max(160).nullable().optional(),
};
const workerSchema = z.object(workerFields);
const workerUpdateSchema = workerSchema.partial().refine((value) => Object.keys(value).length > 0, 'EMPTY_UPDATE');

const conversationSchema = z.object({
  workerId: z.string().min(1),
  shiftId: z.string().min(1).nullable().optional(),
  subject: z.string().trim().min(2).max(180),
  status: z.enum(['OPEN', 'ARCHIVED']).optional(),
});
const conversationUpdateSchema = z.object({
  subject: z.string().trim().min(2).max(180).optional(),
  status: z.enum(['OPEN', 'ARCHIVED']).optional(),
}).refine((value) => Object.keys(value).length > 0, 'EMPTY_UPDATE');
const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const messageUpdateSchema = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  readAt: z.coerce.date().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'EMPTY_UPDATE');

const paymentFields = {
  reference: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(240),
  amountCents: z.number().int().positive().max(100_000_000_00),
  workerCount: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(['PENDING', 'SCHEDULED', 'PROCESSED', 'CANCELLED']).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  processedAt: z.coerce.date().nullable().optional(),
};
const paymentSchema = z.object(paymentFields);
const paymentUpdateSchema = paymentSchema.partial().refine((value) => Object.keys(value).length > 0, 'EMPTY_UPDATE');
const applicationDecisionSchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  reason: z.string().trim().min(3).max(500).optional(),
}).superRefine((value, context) => {
  if (value.decision === 'REJECTED' && !value.reason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'REJECTION_REASON_REQUIRED' });
  }
});
const cancellationSchema = z.object({ reason: z.string().trim().min(3).max(500) });

type BusinessHandler = (request: Request, response: Response, session: AuthSession) => Promise<void>;

function bearerToken(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function param(request: Request, name: string) {
  const value = request.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function route(authService: AuthService, handler: BusinessHandler) {
  return async (request: Request, response: Response) => {
    let session: AuthSession;
    try {
      session = await authService.restore(bearerToken(request.header('authorization')));
    } catch {
      response.status(401).json({ error: 'INVALID_SESSION' });
      return;
    }
    if (session.role !== 'BUSINESS') {
      response.status(403).json({ error: 'BUSINESS_ACCOUNT_REQUIRED' });
      return;
    }
    try {
      await handler(request, response, session);
    } catch (error) {
      sendError(response, error);
    }
  };
}

function sendError(response: Response, error: unknown) {
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'INVALID_INPUT', issues: error.issues });
    return;
  }
  if (error instanceof BusinessRecordNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof BusinessValidationError) {
    response.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof BusinessForbiddenError) {
    response.status(403).json({ error: error.message });
    return;
  }
  if (error instanceof AuthError) {
    response.status(401).json({ error: error.code });
    return;
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    response.status(409).json({ error: 'DUPLICATE_RECORD' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'INTERNAL_ERROR' });
}

export function createBusinessRouter(
  authService: AuthService = new DatabaseAuthService(),
  operations: BusinessOperations = new DatabaseBusinessService(),
  onShiftsChanged: () => void = () => {},
) {
  const router = Router();

  router.get('/company', route(authService, async (_request, response, session) => { response.json(await operations.getCompany(session)); }));
  router.get('/subscription', route(authService, async (_request, response, session) => { response.json(await operations.getSubscription(session)); }));
  router.patch('/company', route(authService, async (request, response, session) => { response.json(await operations.updateCompany(session, companySchema.parse(request.body))); }));

  router.get('/shifts', route(authService, async (_request, response, session) => { response.json(await operations.listShifts(session)); }));
  router.post('/shifts', route(authService, async (request, response, session) => {
    const shift = await operations.createShift(session, shiftSchema.parse(request.body));
    onShiftsChanged();
    response.status(201).json(shift);
  }));
  router.get('/shifts/:id', route(authService, async (request, response, session) => { response.json(await operations.getShift(session, param(request, 'id'))); }));
  router.patch('/shifts/:id', route(authService, async (request, response, session) => {
    const shift = await operations.updateShift(session, param(request, 'id'), shiftUpdateSchema.parse(request.body));
    onShiftsChanged();
    response.json(shift);
  }));
  router.delete('/shifts/:id', route(authService, async (request, response, session) => {
    await operations.deleteShift(session, param(request, 'id'));
    onShiftsChanged();
    response.status(204).send();
  }));
  router.post('/shifts/:id/cancel', route(authService, async (request, response, session) => {
    const result = await operations.cancelShift(session, param(request, 'id'), cancellationSchema.parse(request.body).reason);
    onShiftsChanged();
    response.json(result);
  }));
  router.get('/shifts/:id/applications', route(authService, async (request, response, session) => {
    response.json(await operations.listShiftApplications(session, param(request, 'id')));
  }));
  router.get('/applications/pending', route(authService, async (_request, response, session) => {
    response.json(await operations.pendingApplications(session));
  }));
  router.get('/shifts/:id/events', route(authService, async (request, response, session) => {
    response.json(await operations.listShiftEvents(session, param(request, 'id')));
  }));
  router.patch('/shifts/:id/applications/:applicationId', route(authService, async (request, response, session) => {
    const input = applicationDecisionSchema.parse(request.body);
    const result = await operations.decideShiftApplication(session, param(request, 'id'), param(request, 'applicationId'), input.decision, input.reason);
    onShiftsChanged();
    response.json(result);
  }));

  router.get('/workers', route(authService, async (_request, response, session) => { response.json(await operations.listWorkers(session)); }));
  router.post('/workers', route(authService, async (request, response, session) => { response.status(201).json(await operations.createWorker(session, workerSchema.parse(request.body))); }));
  router.get('/workers/:id', route(authService, async (request, response, session) => { response.json(await operations.getWorker(session, param(request, 'id'))); }));
  router.patch('/workers/:id', route(authService, async (request, response, session) => { response.json(await operations.updateWorker(session, param(request, 'id'), workerUpdateSchema.parse(request.body))); }));
  router.delete('/workers/:id', route(authService, async (request, response, session) => { await operations.deleteWorker(session, param(request, 'id')); response.status(204).send(); }));

  router.get('/conversations', route(authService, async (_request, response, session) => { response.json(await operations.listConversations(session)); }));
  router.post('/conversations', route(authService, async (request, response, session) => { response.status(201).json(await operations.createConversation(session, conversationSchema.parse(request.body))); }));
  router.get('/conversations/:id', route(authService, async (request, response, session) => { response.json(await operations.getConversation(session, param(request, 'id'))); }));
  router.patch('/conversations/:id', route(authService, async (request, response, session) => { response.json(await operations.updateConversation(session, param(request, 'id'), conversationUpdateSchema.parse(request.body))); }));
  router.delete('/conversations/:id', route(authService, async (request, response, session) => { await operations.deleteConversation(session, param(request, 'id')); response.status(204).send(); }));
  router.post('/conversations/:id/messages', route(authService, async (request, response, session) => { const input = messageSchema.parse(request.body); response.status(201).json(await operations.createMessage(session, param(request, 'id'), input.body, MessageSender.BUSINESS)); }));
  router.patch('/conversations/:id/messages/:messageId', route(authService, async (request, response, session) => { response.json(await operations.updateMessage(session, param(request, 'id'), param(request, 'messageId'), messageUpdateSchema.parse(request.body))); }));
  router.delete('/conversations/:id/messages/:messageId', route(authService, async (request, response, session) => { await operations.deleteMessage(session, param(request, 'id'), param(request, 'messageId')); response.status(204).send(); }));

  router.get('/payments', route(authService, async (_request, response, session) => { response.json(await operations.listPayments(session)); }));
  router.post('/payments', route(authService, async (request, response, session) => { response.status(201).json(await operations.createPayment(session, paymentSchema.parse(request.body))); }));
  router.get('/payments/:id', route(authService, async (request, response, session) => { response.json(await operations.getPayment(session, param(request, 'id'))); }));
  router.patch('/payments/:id', route(authService, async (request, response, session) => { response.json(await operations.updatePayment(session, param(request, 'id'), paymentUpdateSchema.parse(request.body))); }));
  router.delete('/payments/:id', route(authService, async (request, response, session) => { await operations.deletePayment(session, param(request, 'id')); response.status(204).send(); }));

  return router;
}
