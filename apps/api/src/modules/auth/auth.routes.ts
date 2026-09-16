import { Router, type RequestHandler } from 'express';

import {
  AuthError,
  DatabaseAuthService,
  type AuthService,
  type RegisterInput,
} from './auth.service.js';
import { GoogleIdentityError, googleSignInEnabled, verifyGoogleIdToken } from './google_identity.js';

function bearerToken(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

export interface AuthRouterOptions {
  /**
   * Middleware aplicado únicamente a las rutas sensibles a fuerza bruta o
   * enumeración (`register`, `login`, `google`, `google/complete`,
   * `password`). Se omite si no se provee.
   */
  rateLimiter?: RequestHandler;
}

export function createAuthRouter(
  service: AuthService = new DatabaseAuthService(),
  { rateLimiter }: AuthRouterOptions = {},
) {
  const router = Router();
  const guarded: RequestHandler[] = rateLimiter ? [rateLimiter] : [];

  router.post('/register', ...guarded, async (request, response) => {
    if (request.body?.role !== 'WORKER') {
      response.status(403).json({ error: 'BUSINESS_REGISTRATION_DISABLED' });
      return;
    }
    try {
      response.status(201).json(await service.register(request.body as RegisterInput));
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'INVALID_REGISTRATION';
      response
        .status(
          code === 'DUPLICATE_ACCOUNT' || code === 'DUPLICATE_IDENTIFIER'
            ? 409
            : 400,
        )
        .json({ error: code });
    }
  });

  router.post('/login', ...guarded, async (request, response) => {
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

  router.get('/providers', (_request, response) => {
    response.json({ google: { enabled: googleSignInEnabled() } });
  });

  router.post('/google', ...guarded, async (request, response) => {
    try {
      const idToken = String(request.body?.idToken ?? '');
      if (!idToken) {
        response.status(400).json({ error: 'INVALID_REGISTRATION' });
        return;
      }
      const identity = await verifyGoogleIdToken(idToken);
      const result = await service.startGoogleLogin(identity);
      response.status('profileSetupToken' in result ? 202 : 200).json(result);
    } catch (error) {
      const code = error instanceof GoogleIdentityError || error instanceof AuthError
        ? error.code
        : 'INVALID_GOOGLE_TOKEN';
      response.status(code === 'GOOGLE_SIGN_IN_UNAVAILABLE' ? 503 : code === 'GOOGLE_EMAIL_ALREADY_REGISTERED' ? 409 : 400).json({ error: code });
    }
  });

  router.post('/google/complete', ...guarded, async (request, response) => {
    try {
      const profileSetupToken = String(request.body?.profileSetupToken ?? '');
      const dni = String(request.body?.dni ?? '');
      const password = String(request.body?.password ?? '');
      response.status(201).json(
        await service.completeGoogleProfile(profileSetupToken, dni, password),
      );
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'INVALID_REGISTRATION';
      response.status(code === 'GOOGLE_SIGN_IN_UNAVAILABLE' ? 503 : code === 'GOOGLE_EMAIL_ALREADY_REGISTERED' ? 409 : 400).json({ error: code });
    }
  });

  router.post('/password', ...guarded, async (request, response) => {
    try {
      response.json(
        await service.setInitialGooglePassword(
          bearerToken(request.header('authorization')),
          String(request.body?.password ?? ''),
        ),
      );
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'INVALID_REGISTRATION';
      response.status(code === 'INVALID_SESSION' ? 401 : 400).json({ error: code });
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
