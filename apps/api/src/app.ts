import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';

import { marketplaceShiftEvents, type MarketplaceShiftEvents } from './modules/marketplace/marketplace.events.js';
import { createMarketplaceRouter } from './modules/marketplace/marketplace.routes.js';
import type { MarketplaceOperations } from './modules/marketplace/marketplace.service.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { DatabaseAuthService, type AuthService } from './modules/auth/auth.service.js';
import { createBusinessRouter } from './modules/business/business.routes.js';
import type { BusinessOperations } from './modules/business/business.service.js';
import { createAdminRouter } from './modules/admin/admin.routes.js';
import { createTalentRouter } from './modules/talent/talent.routes.js';
import type { TalentOperations } from './modules/talent/talent.service.js';
import type { TalentInvitationOperations } from './modules/talent/talent_invitation.service.js';
import { createRateLimitMiddleware, type RateLimitOptions } from './middleware/rate_limit.js';

const DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_RATE_LIMIT_MAX = 20;

function resolveAuthRateLimitOptions(): RateLimitOptions {
  const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS);
  const max = Number(process.env.AUTH_RATE_LIMIT_MAX ?? DEFAULT_AUTH_RATE_LIMIT_MAX);
  return {
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS,
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_AUTH_RATE_LIMIT_MAX,
    errorCode: 'AUTH_RATE_LIMITED',
  };
}

/**
 * Resuelve los orígenes permitidos por CORS a partir de `CORS_ALLOWED_ORIGINS`
 * (lista separada por comas).
 *
 * - Si la variable está definida, solo esos orígenes exactos quedan
 *   habilitados, en cualquier entorno.
 * - Si no está definida y `NODE_ENV !== 'production'`, se conserva el
 *   comportamiento permisivo previo (`cors()` sin restricción) para no
 *   romper el desarrollo local ni los clientes Flutter/web sin configurar.
 * - Si no está definida y `NODE_ENV === 'production'`, se restringe de forma
 *   visible (se registra un error y no se permite ningún origen) en lugar de
 *   abrir el acceso en silencio.
 */
function resolveCorsOptions(): CorsOptions | undefined {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  const origins = raw
    ? raw.split(',').map((origin) => origin.trim()).filter((origin) => origin.length > 0)
    : [];

  if (origins.length > 0) {
    return { origin: origins };
  }

  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error(
      '[cors] CORS_ALLOWED_ORIGINS no está definida en producción; se bloquean todos los orígenes de navegador.',
    );
    return { origin: false };
  }

  return undefined;
}

export function createApp(options: {
  authService?: AuthService;
  businessService?: BusinessOperations;
  marketplaceService?: MarketplaceOperations;
  marketplaceEvents?: MarketplaceShiftEvents;
  talentService?: TalentOperations;
  talentInvitationService?: TalentInvitationOperations;
  /**
   * Configura el limitador de intentos de las rutas sensibles de
   * `/api/auth`. `false` lo desactiva por completo (uso exclusivo de
   * pruebas de otros módulos); un objeto parcial sobreescribe la ventana o
   * el máximo por defecto (leídos de `AUTH_RATE_LIMIT_WINDOW_MS` y
   * `AUTH_RATE_LIMIT_MAX`).
   */
  rateLimit?: false | Partial<RateLimitOptions>;
  /**
   * Intervalo (ms) del refresco periódico del feed en vivo de turnos
   * (`/api/shifts/events`), independiente de los eventos de publicación. Solo
   * se usa para acortarlo en pruebas; en producción se deja el valor por
   * defecto de `createMarketplaceRouter`.
   */
  marketplaceFeedRefreshIntervalMs?: number;
} = {}): Express {
  const app = express();
  const authService = options.authService ?? new DatabaseAuthService();
  const shiftEvents = options.marketplaceEvents ?? marketplaceShiftEvents;

  const authRateLimiter =
    options.rateLimit === false
      ? undefined
      : createRateLimitMiddleware({ ...resolveAuthRateLimitOptions(), ...(options.rateLimit ?? {}) });

  // El limitador de intentos cuenta por `request.ip`. Detrás de un proxy
  // inverso (Nginx/Caddy, ver docs/guides/deployment.md) Express ignora
  // `X-Forwarded-For` salvo que se configure `trust proxy` explícitamente:
  // sin esto, todas las solicitudes de producción comparten la IP del
  // proxy y, por lo tanto, un único cupo de intentos (riesgo declarado,
  // ver docs/PROGRESO.md). `API_TRUST_PROXY` acepta "true", "false", un
  // número de saltos o cualquier valor válido para `app.set('trust proxy', …)`.
  const trustProxySetting = process.env.API_TRUST_PROXY;
  if (trustProxySetting !== undefined) {
    if (trustProxySetting === 'true') {
      app.set('trust proxy', true);
    } else if (trustProxySetting === 'false') {
      app.set('trust proxy', false);
    } else if (trustProxySetting.trim() !== '' && !Number.isNaN(Number(trustProxySetting))) {
      app.set('trust proxy', Number(trustProxySetting));
    } else {
      app.set('trust proxy', trustProxySetting);
    }
  }

  app.use(cors(resolveCorsOptions()));
  app.use(express.json());
  app.get('/', (_request, response) => {
    response.json({
      name: 'Chambeaya API',
      health: '/api/health',
      status: 'ok',
    });
  });
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.use('/api', createMarketplaceRouter(options.marketplaceService, shiftEvents, authService, {
    feedRefreshIntervalMs: options.marketplaceFeedRefreshIntervalMs,
  }));
  app.use('/api', createTalentRouter(authService, options.talentService, options.talentInvitationService));
  app.use('/api/auth', createAuthRouter(authService, { rateLimiter: authRateLimiter }));
  app.use('/api/business', createBusinessRouter(authService, options.businessService, () => shiftEvents.publish()));
  app.use('/api/admin', createAdminRouter(authService));

  return app;
}
