import cors from 'cors';
import express, { type Express } from 'express';

import { marketplaceShiftEvents, type MarketplaceShiftEvents } from './modules/marketplace/marketplace.events.js';
import { createMarketplaceRouter } from './modules/marketplace/marketplace.routes.js';
import type { MarketplaceOperations } from './modules/marketplace/marketplace.service.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { DatabaseAuthService, type AuthService } from './modules/auth/auth.service.js';
import { createBusinessRouter } from './modules/business/business.routes.js';
import type { BusinessOperations } from './modules/business/business.service.js';

export function createApp(options: {
  authService?: AuthService;
  businessService?: BusinessOperations;
  marketplaceService?: MarketplaceOperations;
  marketplaceEvents?: MarketplaceShiftEvents;
} = {}): Express {
  const app = express();
  const authService = options.authService ?? new DatabaseAuthService();
  const shiftEvents = options.marketplaceEvents ?? marketplaceShiftEvents;

  app.use(cors());
  app.use(express.json());
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.use('/api', createMarketplaceRouter(options.marketplaceService, shiftEvents));
  app.use('/api/auth', createAuthRouter(authService));
  app.use('/api/business', createBusinessRouter(authService, options.businessService, () => shiftEvents.publish()));

  return app;
}
