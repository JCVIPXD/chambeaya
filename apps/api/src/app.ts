import { PrismaClient } from '@prisma/client';
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
import { DatabaseTalentService, type TalentOperations } from './modules/talent/talent.service.js';
import { DatabaseTalentInvitationService, type TalentInvitationOperations } from './modules/talent/talent_invitation.service.js';
import { DatabaseCandidateUnlockService, type CandidateUnlockOperations } from './modules/talent/candidate_unlock.service.js';
import { createRateLimitMiddleware, type RateLimitOptions } from './middleware/rate_limit.js';
import { createPaymentsWebhookRouter, createSimulatedPaymentsRouter } from './modules/payments/payments.routes.js';
import { temporaryShiftsEnabled } from './modules/temporary-shifts.js';
import { createAdminCurrencyRouter, createBusinessCurrencyRouter, createWorkerCurrencyRouter } from './modules/currency/currency.routes.js';
import { CurrencyCatalogService, type CurrencyUsageCounter } from './modules/currency/currency.catalog.service.js';
import { CurrencyLedgerService } from './modules/currency/currency.service.js';
import { CurrencyActionService } from './modules/currency/currency.actions.js';
import { createJobCurrencyHooks } from './modules/currency/currency.hooks.js';
import { CurrencyQuoteService } from './modules/currency/currency.quote.js';
import { CurrencyRefundService } from './modules/currency/currency.refunds.js';
import { ProfileRewardService } from './modules/currency/currency.profile-rewards.js';
import { WorkerReferralService } from './modules/currency/currency.referrals.js';
import { CurrencyRewardService } from './modules/currency/currency.rewards.js';
import { CurrencyRewardStatusService } from './modules/currency/currency.reward-status.js';
import { CurrencyVerificationService } from './modules/currency/currency.verification.js';
import { CurrencySettingsService } from './modules/currency/currency.settings.js';
import { WelcomeBonusService } from './modules/currency/currency.welcome.js';
import { createBusinessJobsRouter, createJobEventsRouter, createWorkerJobsRouter } from './modules/jobs/jobs.routes.js';
import { JobService, type JobHooks } from './modules/jobs/jobs.service.js';
import { jobEvents, type JobEvents } from './modules/jobs/jobs.events.js';
import type { PrivateDocumentStorage } from './modules/talent/private_document_storage.js';

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
  /** Desbloqueo de contacto y CV de candidatos que no postularon (M4). */
  candidateUnlockService?: CandidateUnlockOperations;
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
  /**
   * `PrismaClient` compartido por el webhook (`/api/payments/webhooks/:provider`)
   * y el checkout simulado (`/api/payments/simulated/:checkoutId/...`),
   * Alcance E. Las pruebas lo inyectan para apuntar a la base de pruebas;
   * sin esto, cada router abriría su propio `PrismaClient` por defecto.
   */
  paymentsPrisma?: PrismaClient;
  /** Cliente compartido por el libro mayor de Chambitas. */
  currencyPrisma?: PrismaClient;
  /** Contador de usos del catálogo mostrado por `/currency/catalog`; por defecto lee los usos reales (M4). */
  currencyUsageCounter?: CurrencyUsageCounter;
  /** Reloj de las acciones con costo (cuota mensual, tope diario, devolución); solo para pruebas. */
  currencyClock?: () => Date;
  /** Cliente, almacenamiento, ganchos (M4) y bus de avisos de los puestos fijos (M3). */
  jobsPrisma?: PrismaClient;
  jobsStorage?: PrivateDocumentStorage;
  jobsHooks?: JobHooks;
  jobsEvents?: JobEvents;
  /** Habilita el flujo legado de turnos temporales. Por defecto se toma de
   * `TEMPORARY_SHIFTS_ENABLED`, apagado salvo valor literal `true`. */
  temporaryShiftsEnabled?: boolean;
} = {}): Express {
  const app = express();
  const shiftEvents = options.marketplaceEvents ?? marketplaceShiftEvents;
  const paymentsPrisma = options.paymentsPrisma ?? new PrismaClient();
  const currencyPrisma = options.currencyPrisma ?? new PrismaClient();
  const currencyLedger = new CurrencyLedgerService(currencyPrisma);
  const currencyCatalog = new CurrencyCatalogService(currencyPrisma, options.currencyUsageCounter, undefined, options.currencyClock);
  // M4: cobro de acciones, bono de bienvenida y devolución comparten un reloj y un cliente.
  const currencyActions = new CurrencyActionService(options.currencyClock);
  const welcomeBonus = new WelcomeBonusService(currencyPrisma, currencyActions);
  const authService = options.authService ?? new DatabaseAuthService(undefined, { onWorkerCreated: async (workerId) => { await welcomeBonus.grantForWorker(workerId); } });
  const currencyQuotes = new CurrencyQuoteService(currencyPrisma, currencyActions);
  // M6: premios automáticos. Comparten reloj y cliente con el resto de la moneda.
  const currencyRewards = new CurrencyRewardService(options.currencyClock);
  const referrals = new WorkerReferralService(currencyPrisma, currencyRewards);
  const rewardStatus = new CurrencyRewardStatusService(currencyPrisma, currencyRewards);
  const talentService = options.talentService ?? new DatabaseTalentService(currencyPrisma, undefined, new ProfileRewardService(currencyRewards, referrals), currencyActions, options.currencyClock);
  const jobsService = new JobService(options.jobsPrisma ?? new PrismaClient(), {
    storage: options.jobsStorage,
    hooks: options.jobsHooks ?? createJobCurrencyHooks(currencyActions, currencyRewards),
    events: options.jobsEvents,
  });
  const talentInvitations = options.talentInvitationService ?? new DatabaseTalentInvitationService(currencyPrisma, currencyActions, currencyRewards);
  const candidateUnlocks = options.candidateUnlockService ?? new DatabaseCandidateUnlockService(currencyPrisma, currencyActions);
  const legacyShiftsEnabled = options.temporaryShiftsEnabled ?? temporaryShiftsEnabled();

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
  // Webhook de pagos (Alcance E): ANTES de `express.json()` global. La firma
  // (`webhook-signature.ts`) se calcula sobre el `rawBody` exacto que llegó
  // por la red; `express.json()` lo consumiría y lo dejaría irrecuperable.
  // Sin sesión: la única defensa es la firma HMAC + su propio rate limit
  // (`createPaymentsWebhookRouter`).
  app.use('/api/payments', createPaymentsWebhookRouter(paymentsPrisma));
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
    temporaryShiftsEnabled: legacyShiftsEnabled,
  }));
  app.use('/api', createWorkerCurrencyRouter(authService, currencyLedger, currencyCatalog, currencyQuotes, { rewards: rewardStatus, referrals }));
  app.use('/api', createTalentRouter(authService, talentService, talentInvitations, candidateUnlocks));
  app.use('/api/auth', createAuthRouter(authService, { rateLimiter: authRateLimiter }));
  app.use('/api/business', createBusinessRouter(authService, options.businessService, () => shiftEvents.publish(), legacyShiftsEnabled));
  app.use('/api/business', createBusinessCurrencyRouter(authService, currencyLedger, currencyCatalog, currencyQuotes, { rewards: rewardStatus }));
  app.use('/api/business', createBusinessJobsRouter(authService, jobsService));
  app.use('/api/workers', createWorkerJobsRouter(authService, jobsService));
  app.use('/api', createJobEventsRouter(authService, options.jobsEvents ?? jobEvents));
  app.use('/api/admin', createAdminRouter(authService, undefined, undefined, {
    onCompanyCreated: async (ownerId) => { await welcomeBonus.grantForCompanyOwner(ownerId); },
  }));
  app.use('/api/admin', createAdminCurrencyRouter(authService, currencyLedger, currencyCatalog, {
    settings: new CurrencySettingsService(currencyPrisma),
    welcome: welcomeBonus,
    refunds: new CurrencyRefundService(currencyPrisma, options.currencyClock),
    verification: new CurrencyVerificationService(currencyPrisma, currencyRewards),
  }));
  // Checkout simulado (Alcance E): sesión BUSINESS normal, después de
  // `express.json()` global, a diferencia del webhook de arriba.
  app.use('/api/payments', createSimulatedPaymentsRouter(authService, paymentsPrisma));

  return app;
}
