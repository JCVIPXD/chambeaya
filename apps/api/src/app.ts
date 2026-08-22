import cors from 'cors';
import express, { type Express } from 'express';

import { createMarketplaceRouter } from './modules/marketplace/marketplace.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { DatabaseAuthService, type AuthService } from './modules/auth/auth.service.js';
import { createBusinessRouter } from './modules/business/business.routes.js';
import type { BusinessOperations } from './modules/business/business.service.js';

export function createApp(options: { authService?: AuthService; businessService?: BusinessOperations } = {}): Express {
  const app = express();
  const authService = options.authService ?? new DatabaseAuthService();

  app.use(cors());
  app.use(express.json());
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.use('/api', createMarketplaceRouter());
  app.use('/api/auth', createAuthRouter(authService));
  app.use('/api/business', createBusinessRouter(authService, options.businessService));

  return app;
}
