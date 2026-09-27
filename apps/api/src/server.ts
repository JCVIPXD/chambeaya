import { createApp } from './app.js';
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

