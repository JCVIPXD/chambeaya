import { Router } from 'express';

import { DemoMarketplaceService, MarketplaceError } from './marketplace.service.js';
import type { ShiftIndustry, ShiftSearchFilter } from './shift_search.js';

export function createMarketplaceRouter(service = new DemoMarketplaceService()) {
  const router = Router();
  const workerId = (value: unknown) => typeof value === 'string' && value.trim() ? value : 'worker-demo';

  router.get('/shifts', (request, response) => {
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
    response.json(service.listAvailableShifts(filter));
  });
  router.get('/shifts/active', (request, response) => response.json(service.activeShift(workerId(request.header('x-demo-worker-id')))));
  router.put('/shifts/:id/accept', (request, response) => {
    try {
      response.json(service.acceptShift(workerId(request.header('x-demo-worker-id')), request.params.id));
    } catch (error) {
      if (error instanceof MarketplaceError) {
        response.status(error.statusCode).json({ error: error.code });
        return;
      }
      throw error;
    }
  });
  router.put('/workers/availability', (request, response) => {
    if (typeof request.body?.isAvailable !== 'boolean') {
      response.status(400).json({ error: 'isAvailable must be a boolean' });
      return;
    }
    response.json(service.updateAvailability(request.body.isAvailable));
  });
  router.get('/workers/wallet', (_request, response) => response.json(service.wallet()));

  return router;
}
