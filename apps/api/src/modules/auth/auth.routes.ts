import { Router } from 'express';

import {
  AuthError,
  DatabaseAuthService,
  type AuthService,
  type RegisterInput,
} from './auth.service.js';

function bearerToken(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

export function createAuthRouter(service: AuthService = new DatabaseAuthService()) {
  const router = Router();

  router.post('/register', async (request, response) => {
    if (request.body?.role !== 'WORKER') {
      response.status(403).json({ error: 'BUSINESS_REGISTRATION_DISABLED' });
      return;
    }
    try {
      response.status(201).json(await service.register(request.body as RegisterInput));
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'INVALID_REGISTRATION';
      response.status(code === 'DUPLICATE_ACCOUNT' ? 409 : 400).json({ error: code });
    }
  });

  router.post('/login', async (request, response) => {
    try {
      response.json(
        await service.login(
          String(request.body?.email ?? ''),
          String(request.body?.password ?? ''),
        ),
      );
    } catch (error) {
      response.status(401).json({
        error: error instanceof AuthError ? error.code : 'INVALID_CREDENTIALS',
      });
    }
  });

  router.get('/session', async (request, response) => {
    try {
      response.json(await service.restore(bearerToken(request.header('authorization'))));
    } catch {
      response.status(401).json({ error: 'INVALID_SESSION' });
    }
  });

  router.delete('/session', async (request, response) => {
    await service.logout(bearerToken(request.header('authorization')));
    response.status(204).send();
  });

  return router;
}
