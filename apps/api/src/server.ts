import { PrismaClient } from '@prisma/client';

import { createApp } from './app.js';
import { refundSchedulerIntervalMs } from './modules/currency/currency.config.js';
import { CurrencyRefundService, startRefundScheduler } from './modules/currency/currency.refunds.js';
import { assertPaymentConfig, PaymentConfigError } from './modules/payments/payments.service.js';

const port = Number(process.env.API_PORT ?? 4000);

// Guardas de arranque de pagos (Alcance E): un valor de configuración
// inválido no debe dejar la API arriba aceptando tráfico con un adaptador a
// medio configurar. Ver `payments.service.ts#assertPaymentConfig`.
try {
  assertPaymentConfig();
} catch (error) {
  if (error instanceof PaymentConfigError) {
    console.error(`[payments] Configuración de pagos inválida: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

createApp().listen(port, () => {
  console.info(`Chambeaya API listening on port ${port}`);
});

// Devolución automática de monedas (M4): tarea en proceso, segura con varias instancias.
// `CURRENCY_REFUND_INTERVAL_MS=0` la desactiva; ver currency.config.ts.
const refundIntervalMs = refundSchedulerIntervalMs();
if (refundIntervalMs !== null) {
  startRefundScheduler(new CurrencyRefundService(new PrismaClient()), refundIntervalMs);
  console.info(`[currency] devolución automática cada ${refundIntervalMs} ms`);
}

