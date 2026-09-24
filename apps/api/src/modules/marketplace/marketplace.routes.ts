import { Router, type Response } from 'express';
import { z } from 'zod';

import { AuthError, DatabaseAuthService, type AuthService } from '../auth/auth.service.js';
import { marketplaceShiftEvents, type MarketplaceShiftEvents } from './marketplace.events.js';
import { isRetryableTransactionError } from '../operations/serializable-retry.js';
import { DatabaseMarketplaceService, DemoMarketplaceService, MarketplaceError, type MarketplaceOperations } from './marketplace.service.js';
import type { ShiftIndustry, ShiftSearchFilter } from './shift_search.js';

const screeningAnswersSchema = z.object({
  answers: z.array(z.object({
    question: z.string().trim().min(10).max(240),
    answer: z.string().trim().min(1).max(1000),
  })).max(3).default([]),
});

// El feed en vivo (`/api/shifts/events`) solo reemitía una foto nueva cuando
// una empresa publicaba/editaba/cancelaba un turno (`events.publish()` desde
// `business.routes.ts`). El paso del tiempo por sí solo -un turno cuyo
// `endsAt` simplemente pasó- nunca disparaba una reemisión: un trabajador
// con la pantalla de descubrimiento abierta seguía viendo un turno vencido
// como disponible hasta el próximo cambio ajeno o hasta que la conexión SSE
// se cortara. Este refresco periódico complementa el refresco por evento y
// acota esa ventana de desfase a como máximo `feedRefreshIntervalMs`.
const DEFAULT_FEED_REFRESH_INTERVAL_MS = 60_000;

/**
 * Traduce un error de las rutas del trabajador a su respuesta HTTP:
 *  - `MarketplaceError`: su propio código y estado;
 *  - `AuthError` (sesión inexistente o vencida, de `authService.restore`):
 *    `401 INVALID_SESSION`, el único caso en que la app debe pedir otra sesión;
 *  - conflicto de serialización (`P2034`) o interbloqueo (`40P01`) agotado tras
 *    los reintentos de `withSerializableRetry`: `409 CONCURRENT_UPDATE`, un
 *    código explícito y reintentable (la operación no se aplicó);
 *  - cualquier otro error: `500 INTERNAL_ERROR`, como las rutas de empresa.
 * Antes todo lo que no era `MarketplaceError` respondía `401 INVALID_SESSION`,
 * lo que presentaba un fallo transitorio del servidor como una sesión
 * inválida (CN-20260923-011, MEDIO-1).
 */
function sendMarketplaceError(response: Response, error: unknown) {
  if (error instanceof MarketplaceError) {
    response.status(error.statusCode).json({ error: error.code });
    return;
  }
  if (error instanceof AuthError) {
    response.status(401).json({ error: 'INVALID_SESSION' });
    return;
  }
  if (isRetryableTransactionError(error)) {
    console.error('Marketplace transaction gave up after repeated serialization conflicts or deadlocks', error);
    response.status(409).json({ error: 'CONCURRENT_UPDATE' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'INTERNAL_ERROR' });
}

export function createMarketplaceRouter(
  service: MarketplaceOperations = new DatabaseMarketplaceService(),
  events: MarketplaceShiftEvents = marketplaceShiftEvents,
  authService: AuthService = new DatabaseAuthService(),
  options: { feedRefreshIntervalMs?: number } = {},
) {
  const feedRefreshIntervalMs = options.feedRefreshIntervalMs ?? DEFAULT_FEED_REFRESH_INTERVAL_MS;
  const router = Router();
  const workerId = (value: unknown) => typeof value === 'string' && value.trim() ? value : 'worker-demo';
  const authenticatedWorkerId = async (request: import('express').Request) => {
    const authorization = request.header('authorization') ?? '';
    if (authorization.startsWith('Bearer ')) {
      const session = await authService.restore(authorization.slice(7).trim());
      if (session.role !== 'WORKER') throw new MarketplaceError('SHIFT_UNAVAILABLE', 403);
      return session.userId;
    }
    if (service instanceof DemoMarketplaceService) return workerId(request.header('x-demo-worker-id'));
    throw new MarketplaceError('SHIFT_UNAVAILABLE', 401);
  };

  router.get('/shifts', async (request, response) => {
    const industry = request.query.industry;
    const minimumPay = request.query.minPayCents;
    const modality = request.query.modality;
    const allowedIndustries: ShiftIndustry[] = ['HOSPITALITY', 'FOOD_SERVICE', 'RETAIL', 'EVENTS'];
    if (industry && (typeof industry !== 'string' || !allowedIndustries.includes(industry as ShiftIndustry))) {
      response.status(400).json({ error: 'Invalid industry filter' });
      return;
    }
    if (minimumPay && (typeof minimumPay !== 'string' || !/^\d+$/.test(minimumPay))) {
      response.status(400).json({ error: 'minPayCents must be a positive integer' });
      return;
    }
    const allowedModalities = ['PRESENCIAL', 'REMOTO', 'HIBRIDO'];
    if (modality && (typeof modality !== 'string' || !allowedModalities.includes(modality))) {
      response.status(400).json({ error: 'Invalid modality filter' });
      return;
    }
    const filter: ShiftSearchFilter = {
      query: typeof request.query.q === 'string' ? request.query.q : undefined,
      industry: industry as ShiftIndustry | undefined,
      minPayCents: minimumPay ? Number(minimumPay) : undefined,
      urgentOnly: request.query.urgentOnly === 'true',
      recommendedOnly: request.query.recommendedOnly === 'true',
      modality: modality as string | undefined,
    };
    response.json(await service.listAvailableShifts(filter));
  });
  router.get('/shifts/events', async (request, response) => {
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 2000\n\n');

    let sending = Promise.resolve();
    const sendSnapshot = () => {
      sending = sending.then(async () => {
        if (response.writableEnded) return;
        const shifts = await service.listAvailableShifts();
        response.write(`event: shifts\ndata: ${JSON.stringify(shifts)}\n\n`);
      }).catch(() => {
        if (!response.writableEnded) response.write('event: error\ndata: {"error":"FEED_UNAVAILABLE"}\n\n');
      });
    };
    const unsubscribe = events.subscribe(sendSnapshot);
    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(': keep-alive\n\n');
    }, 15_000);
    // Reemite la lista incluso sin ningún cambio publicado por una empresa,
    // para que los turnos que vencieron por el simple paso del tiempo se
    // retiren del feed de los clientes conectados sin depender de un evento
    // ajeno ni de que la conexión SSE se reinicie.
    const timeRefresh = setInterval(sendSnapshot, feedRefreshIntervalMs);
    request.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(timeRefresh);
      unsubscribe();
    });
    sendSnapshot();
  });
  router.get('/shifts/active', async (request, response) => {
    try {
      response.json(await service.activeShift(await authenticatedWorkerId(request)));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.get('/workers/applications', async (request, response) => {
    try {
      response.json(await service.listApplications(await authenticatedWorkerId(request)));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.get('/workers/conversations', async (request, response) => {
    try {
      response.json(await service.listWorkerConversations(await authenticatedWorkerId(request)));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.post('/workers/payments/:id/confirm', async (request, response) => {
    try {
      response.json(await service.confirmPayment(await authenticatedWorkerId(request), request.params.id));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.get('/workers/conversations/:id', async (request, response) => {
    try {
      response.json(await service.getWorkerConversation(await authenticatedWorkerId(request), request.params.id));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.post('/workers/conversations/:id/messages', async (request, response) => {
    try {
      const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
      if (body.length < 1 || body.length > 4000) {
        response.status(400).json({ error: 'INVALID_MESSAGE' });
        return;
      }
      response.status(201).json(await service.createWorkerMessage(await authenticatedWorkerId(request), request.params.id, body));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.post('/shifts/:id/applications', async (request, response) => {
    try {
      const input = screeningAnswersSchema.parse(request.body ?? {});
      const application = await service.applyToShift(await authenticatedWorkerId(request), request.params.id, input.answers);
      response.status(201).json(application);
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: 'INVALID_SCREENING_ANSWERS', issues: error.issues });
        return;
      }
      sendMarketplaceError(response, error);
    }
  });
  router.post('/shifts/:id/confirm', async (request, response) => {
    try {
      response.json(await service.confirmAssignment(await authenticatedWorkerId(request), request.params.id));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.post('/shifts/:id/check-in', async (request, response) => {
    try {
      const credential = typeof request.body?.credential === 'string' ? request.body.credential : '';
      response.json(await service.checkIn(await authenticatedWorkerId(request), request.params.id, credential));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.post('/shifts/:id/check-out', async (request, response) => {
    try {
      response.json(await service.checkOut(await authenticatedWorkerId(request), request.params.id));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.post('/shifts/:id/cancel', async (request, response) => {
    try {
      const reason = typeof request.body?.reason === 'string' ? request.body.reason : '';
      response.json(await service.cancelAssignment(await authenticatedWorkerId(request), request.params.id, reason));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.put('/shifts/:id/accept', async (request, response) => {
    try {
      response.json(await service.acceptShift(await authenticatedWorkerId(request), request.params.id));
    } catch (error) {
      if (error instanceof MarketplaceError) {
        response.status(error.statusCode).json({ error: error.code });
        return;
      }
      throw error;
    }
  });
  router.put('/workers/availability', async (request, response) => {
    try {
      const authenticatedId = await authenticatedWorkerId(request);
      if (typeof request.body?.isAvailable !== 'boolean') {
        response.status(400).json({ error: 'isAvailable must be a boolean' });
        return;
      }
      response.json(await service.updateAvailability(authenticatedId, request.body.isAvailable));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.get('/workers/availability', async (request, response) => {
    try {
      response.json(await service.workerAvailability(await authenticatedWorkerId(request)));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });
  router.get('/workers/wallet', async (request, response) => {
    try {
      const authenticatedId = await authenticatedWorkerId(request);
      response.json(await service.wallet(authenticatedId));
    } catch (error) {
      sendMarketplaceError(response, error);
    }
  });

  return router;
}
