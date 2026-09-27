/**
 * Capa de adaptadores de proveedor de pago (Alcance E del plan de pagos, ver
 * `docs/PROGRESO.md`). Hoy solo existen dos adaptadores: `manual.provider.ts`
 * (sin pasarela, el modo vigente en producción) y `simulated.provider.ts`
 * (recorre el flujo completo checkout -> webhook firmado -> pagado, SIN mover
 * dinero real). Un proveedor real (Mercado Pago, Culqi, Niubiz o Izipay, sin
 * decidir todavía) implementará esta misma interfaz.
 *
 * SUPUESTO DE DISEÑO (decisión del usuario, ver `dynamic-prancing-bear.md`):
 * con un proveedor real se usará **pago dividido (split)**. El proveedor
 * cobra a la empresa, paga al trabajador y entrega la comisión de Chambeaya
 * en la misma operación; Chambeaya **nunca custodia** la paga del
 * trabajador. Esta interfaz no modela todavía el destino de pago del
 * trabajador (cuenta bancaria, billetera) ni la consulta de estado al
 * proveedor de un proveedor real: eso queda fuera de este alcance, exigido
 * explícitamente al elegir proveedor (ver "Fuera de alcance" del plan).
 */

export type PaymentAttemptForCheckout = {
  id: string;
  checkoutId: string;
  totalCents: number;
  currency: string;
  expiresAt: Date;
};

export type PaymentForCheckout = {
  id: string;
  companyId: string;
  reference: string;
  description: string;
  totalCents: number;
};

export type CreateCheckoutOptions = {
  /** `attempt.id`: mismo intento pedido dos veces (doble clic) debe producir
   * el mismo checkout del lado del proveedor, nunca dos cargos. */
  idempotencyKey: string;
};

export type CheckoutResult = {
  checkoutId: string;
  redirectUrl: string;
};

/** Evento YA VERIFICADO (firma válida, dentro de tolerancia de reloj) que
 * `verifyWebhook` devuelve, listo para procesar. */
export type VerifiedProviderEvent = {
  /** Identificador único del evento del lado del proveedor. Junto con el
   * nombre del proveedor, es la clave de deduplicación
   * (`PaymentProviderEvent.@@unique([provider, eventId])`). */
  eventId: string;
  /** El `checkoutId` del `PaymentAttempt` al que se refiere este evento. */
  checkoutId: string;
  outcome: 'APPROVED' | 'REJECTED';
  amountCents: number;
  currency: string;
};

/** Estado de un checkout consultado directamente al proveedor (reconciliación
 * activa), en vez de esperar su webhook. Opcional: ningún adaptador de este
 * alcance lo implementa (`manual` no tiene checkout; `simulated` solo avanza
 * por acción explícita de la empresa). Un proveedor real lo usará para
 * confirmar el estado si su webhook se perdiera o llegara tarde. */
export type CheckoutStatus = {
  outcome: 'PENDING' | 'APPROVED' | 'REJECTED';
  amountCents: number;
  currency: string;
};

export interface PaymentProvider {
  /** Nombre del adaptador. Coincide siempre con el valor de `PAYMENT_PROVIDER`
   * que lo seleccionó y con `Payment.provider`/`PaymentAttempt.provider`. */
  readonly name: string;

  /**
   * Crea un checkout del lado del proveedor para este intento. Se llama
   * SIEMPRE fuera de la transacción que crea el `PaymentAttempt`
   * (`payments.service.ts#checkoutPayment`): un proveedor real implica una
   * llamada de red, y no debe mantener abierta ninguna transacción de base
   * de datos mientras espera esa respuesta.
   */
  createCheckout(
    attempt: PaymentAttemptForCheckout,
    payment: PaymentForCheckout,
    options: CreateCheckoutOptions,
  ): Promise<CheckoutResult>;

  /**
   * Verifica la autenticidad de un webhook entrante (firma, y para nuestros
   * propios adaptadores -`simulated`- también la tolerancia de reloj) y
   * devuelve el evento ya verificado. Debe RECHAZAR (lanzar) ante cualquier
   * firma inválida, ausente o vencida: nunca debe devolver un evento sin
   * haber verificado la firma primero.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<VerifiedProviderEvent> | VerifiedProviderEvent;

  /** Opcional: consulta activa del estado de un checkout directamente al
   * proveedor (reconciliación), en vez de depender solo de su webhook. */
  fetchCheckoutStatus?(checkoutId: string): Promise<CheckoutStatus>;
}
