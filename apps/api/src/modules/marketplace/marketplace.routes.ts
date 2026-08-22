import { Router } from 'express';

import { marketplaceShiftEvents, type MarketplaceShiftEvents } from './marketplace.events.js';
import { DatabaseMarketplaceService, MarketplaceError, type MarketplaceOperations } from './marketplace.service.js';
import type { ShiftIndustry, ShiftSearchFilter } from './shift_search.js';

export function createMarketplaceRouter(
  service: MarketplaceOperations = new DatabaseMarketplaceService(),
  events: MarketplaceShiftEvents = marketplaceShiftEvents,
) {
  const router = Router();
  const workerId = (value: unknown) => typeof value === 'string' && value.trim() ? value : 'worker-demo';

  router.get('/shifts', async (request, response) => {
    const industry = request.query.industry;
    const minimumPay = request.query.minPayCents;
    const allowedIndustries: ShiftIndustry[] = ['HOSPITALITY', 'FOOD_SERVICE', 'RETAIL', 'EVENTS'];
    if (industry && (typeof industry !== 'string' || !allowedIndustries.includes(industry as ShiftIndustry))) {
      response.status(400).json({ error: 'Invalid industry filter' });
      return;
    }
    if (minimumPay && (typeof minimumPay !== 'string' || !/^\d+$/.test(minimumPay))) {
      response.status(400).json({ error: 'minPayCents must be a positive integer' });
      return;
    }
    const filter: ShiftSearchFilter = {
      query: typeof request.query.q === 'string' ? request.query.q : undefined,
      industry: industry as ShiftIndustry | undefined,
      minPayCents: minimumPay ? Number(minimumPay) : undefined,
      urgentOnly: request.query.urgentOnly === 'true',
      recommendedOnly: request.query.recommendedOnly === 'true',
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
    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    sendSnapshot();
  });
  router.get('/shifts/active', async (request, response) => response.json(await service.activeShift(workerId(request.header('x-demo-worker-id')))));
  router.put('/shifts/:id/accept', async (request, response) => {
    try {
      response.json(await service.acceptShift(workerId(request.header('x-demo-worker-id')), request.params.id));
    } catch (error) {
      if (error instanceof MarketplaceError) {
        response.status(error.statusCode).json({ error: error.code });
        return;
      }
      throw error;
    }
  });
  router.put('/workers/availability', async (request, response) => {
    if (typeof request.body?.isAvailable !== 'boolean') {
      response.status(400).json({ error: 'isAvailable must be a boolean' });
      return;
    }
    response.json(await service.updateAvailability(request.body.isAvailable));
  });
  router.get('/workers/wallet', async (_request, response) => response.json(await service.wallet()));

  return router;
}
