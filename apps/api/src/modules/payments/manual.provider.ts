import type { PaymentProvider } from './provider.js';

export class ManualProviderUnsupportedError extends Error {}

/**
 * Adaptador para el modo sin pasarela (`PAYMENT_PROVIDER=manual`, el vigente
 * en producción hoy). No admite checkout: `payments.service.ts#checkoutPayment`
 * rechaza con `409 PROVIDER_MANUAL` ANTES de llegar a llamar cualquier método
 * de este adaptador, así que `createCheckout` nunca debería invocarse en la
 * práctica. Se implementa de todas formas (lanzando, nunca devolviendo un
 * checkout falso) para cumplir la interfaz sin dejar un camino silencioso.
 *
 * `verifyWebhook` también lanza siempre: en modo manual no hay ningún
 * webhook real que verificar. Si alguien golpea
 * `POST /api/payments/webhooks/manual` de todas formas, el router responde
 * `401 INVALID_SIGNATURE` (nunca `200`), porque este método nunca devuelve un
 * evento verificado.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual';

  createCheckout(): never {
    throw new ManualProviderUnsupportedError('El modo manual no admite checkout.');
  }

  verifyWebhook(): never {
    throw new ManualProviderUnsupportedError('El modo manual no recibe webhooks.');
  }
}
