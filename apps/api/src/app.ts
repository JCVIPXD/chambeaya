import cors from 'cors';
import express, { type Express } from 'express';

import { createMarketplaceRouter } from './modules/marketplace/marketplace.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import type { AuthService } from './modules/auth/auth.service.js';

export function createApp(options: { authService?: AuthService } = {}): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.use('/api', createMarketplaceRouter());
  app.use('/api/auth', createAuthRouter(options.authService));

  return app;
}
