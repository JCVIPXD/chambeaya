import type {
  CheckoutResult,
  CreateCheckoutOptions,
  PaymentAttemptForCheckout,
  PaymentForCheckout,
  PaymentProvider,
  VerifiedProviderEvent,
} from './provider.js';
import { InvalidSignatureError, SIGNATURE_HEADER, signPayload, verifySignature } from './webhook-signature.js';

export class SimulatedProviderConfigError extends Error {}

/**
 * Resuelve la URL pública del panel para construir `redirectUrl`
 * (`${panel}/pago-simulado/<checkoutId>`, la página del Alcance F).
 *
 * Decisión (Alcance E, solo API): se agrega `PANEL_PUBLIC_URL` como variable
 * explícita en vez de derivarla en silencio de otra variable existente.
 * `NEXT_PUBLIC_API_URL` (la URL pública de la API, con sufijo `/api`) y
 * `NEXT_BASE_PATH` (el prefijo del panel, solo en producción) apuntan a
 * conceptos distintos del panel en sí, y derivarla mal dejaría un
 * `redirectUrl` roto sin que ningún `tsc` ni prueba de tipos lo detectara.
 * Si falta, se cae a un valor razonable para desarrollo local
 * (`http://localhost:3000`, el panel de `docker-compose.yml` sin
 * `NEXT_BASE_PATH`) en vez de fallar: el checkout simulado debe poder crearse
 * igual (por ejemplo, en una prueba) aunque el operador todavía no haya
 * configurado esta variable; solo la URL de retorno quedaría con un valor
 * por defecto. En producción, `assertPaymentConfig` no exige esta variable
 * (no es parte de las guardas de arranque del plan), pero
 * `scripts/deploy-hosting.sh` avisa si falta y el proveedor activo no es
 * `manual` (ver `docs/guides/deployment.md`).
 */
export function resolvePanelPublicUrl(): string {
  const explicit = process.env.PANEL_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    const withoutApiSuffix = apiUrl.replace(/\/api\/?$/, '');
    const basePath = process.env.NEXT_BASE_PATH?.trim() ?? '';
    return `${withoutApiSuffix}${basePath}`.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

function requireSecret(): string {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new SimulatedProviderConfigError(
      'PAYMENT_WEBHOOK_SECRET debe existir y tener al menos 32 caracteres para usar el proveedor simulado.',
    );
  }
  return secret;
}

/**
 * Proveedor simulado (Alcance E): recorre el flujo completo checkout ->
 * proveedor -> webhook firmado -> pagado, SIN mover dinero real y sin ningún
 * proveedor contratado. `createCheckout` no llama a ningún servicio externo
 * (no hay ninguno): solo genera el `redirectUrl` hacia la página de
 * aprobar/rechazar del Alcance F. La decisión real (aprobar/rechazar) la
 * toma la empresa desde esa página, vía
 * `POST /api/payments/simulated/:checkoutId/(approve|reject)`
 * (`payments.routes.ts`), que construye y firma un evento con el MISMO
 * formato que un webhook real y lo procesa con la MISMA función
 * (`processProviderEvent`), sin ningún atajo.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'simulated';

  async createCheckout(
    attempt: PaymentAttemptForCheckout,
    _payment: PaymentForCheckout,
    _options: CreateCheckoutOptions,
  ): Promise<CheckoutResult> {
    void _payment;
    void _options;
    return {
      checkoutId: attempt.checkoutId,
      redirectUrl: `${resolvePanelPublicUrl()}/pago-simulado/${attempt.checkoutId}`,
    };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): VerifiedProviderEvent {
    const secret = requireSecret();
    try {
      verifySignature(secret, rawBody, headers[SIGNATURE_HEADER]);
    } catch (error) {
      if (error instanceof InvalidSignatureError) throw error;
      throw new InvalidSignatureError('unexpected verification failure');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidSignatureError('malformed JSON body');
    }
    return parseSimulatedEvent(parsed);
  }
}

function parseSimulatedEvent(value: unknown): VerifiedProviderEvent {
  if (typeof value !== 'object' || value === null) throw new InvalidSignatureError('malformed body');
  const record = value as Record<string, unknown>;
  const { eventId, checkoutId, outcome, amountCents, currency } = record;
  if (
    typeof eventId !== 'string' ||
    typeof checkoutId !== 'string' ||
    (outcome !== 'APPROVED' && outcome !== 'REJECTED') ||
    typeof amountCents !== 'number' ||
    typeof currency !== 'string'
  ) {
    throw new InvalidSignatureError('malformed body');
  }
  return { eventId, checkoutId, outcome, amountCents, currency };
}

/**
 * Construye y firma (mismo formato que `verifyWebhook`) el evento simulado
 * de aprobar/rechazar un checkout. El identificador es determinista por
 * checkout y resultado: volver a pulsar el mismo botón representa el mismo
 * evento del simulador y la deduplicación lo absorbe, sin falsos dobles
 * cobros. El resultado opuesto conserva otro identificador para modelar una
 * decisión posterior del proveedor. Usado por
 * `payments.routes.ts#createPaymentsRouter` para
 * `POST /api/payments/simulated/:checkoutId/(approve|reject)`: el resultado
 * (`rawBody`, cabeceras) se pasa a `SimulatedPaymentProvider#verifyWebhook`
 * -la misma verificación que un webhook real recibiría- antes de
 * `processProviderEvent`, para no saltarse ningún paso.
 */
export function buildSimulatedEvent(
  checkoutId: string,
  outcome: 'APPROVED' | 'REJECTED',
  amountCents: number,
  currency = 'PEN',
): { rawBody: Buffer; headers: Record<string, string> } {
  const secret = requireSecret();
  const body: VerifiedProviderEvent = {
    eventId: `simulated:${checkoutId}:${outcome}`,
    checkoutId,
    outcome,
    amountCents,
    currency,
  };
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  return { rawBody, headers: { [SIGNATURE_HEADER]: signPayload(secret, rawBody) } };
}
