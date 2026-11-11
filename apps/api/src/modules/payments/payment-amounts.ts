/**
 * Cálculo de los montos de un `Payment` con la comisión de Chambeaya y su
 * IGV. Ver "Alcance C" del plan de pagos: la empresa paga la comisión
 * ENCIMA del monto del trabajador; el trabajador siempre recibe el 100% de
 * `amountCents` (nunca se le descuenta nada).
 *
 * Todo el dinero es en céntimos enteros de PEN. Los porcentajes van en
 * puntos básicos enteros (`1000` = 10,00%). No se usa ningún tipo de punto
 * flotante para el dinero: solo enteros y `Math.floor`.
 */

export type PlatformSettingsSnapshot = {
  commissionBps: number;
  taxBps: number;
};

export type PaymentAmounts = {
  amountCents: number;
  commissionBps: number;
  commissionCents: number;
  taxBps: number;
  taxCents: number;
  totalCents: number;
};

/** Valores por defecto si la fila `PlatformSettings` (`id: 'global'`) no
 * existiera todavía (no debería ocurrir: la migración la inserta). Se usan
 * solo como defensa, nunca como sustituto silencioso de un problema real. */
export const DEFAULT_COMMISSION_BPS = 1000;
export const DEFAULT_TAX_BPS = 1800;

function assertNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} debe ser un entero no negativo (recibido: ${value})`);
  }
}

/**
 * Redondeo "la mitad hacia arriba" con enteros: `floor((numerator*bps +
 * 5000) / 10000)`. `5000` es la mitad de `10000` (un punto básico completo,
 * 100,00%), así que un residuo exacto de 0,5 céntimo sube. Nunca usa
 * `Math.round` sobre un float (`amountCents * bps / 10000`), que puede
 * arrastrar el error de redondeo binario de JavaScript para ciertos montos.
 */
function bpsOf(amountCents: number, bps: number): number {
  return Math.floor((amountCents * bps + 5000) / 10000);
}

/**
 * Calcula la comisión, el IGV sobre la comisión y el total que paga la
 * empresa por un monto al trabajador (`amountCents`, se mantiene intacto:
 * es lo que el trabajador recibe).
 *
 * `commissionBps`/`taxBps` deben ser los valores YA FIJADOS del turno o pago
 * (`Shift.commissionBps`/`taxBps`, o el ajuste global solo para un turno
 * anterior a esta migración) — esta función no los lee ni los decide, solo
 * calcula con lo que se le pasa.
 */
export function buildPaymentAmounts(
  amountCents: number,
  commissionBps: number,
  taxBps: number,
): PaymentAmounts {
  assertNonNegativeInteger(amountCents, 'amountCents');
  assertNonNegativeInteger(commissionBps, 'commissionBps');
  assertNonNegativeInteger(taxBps, 'taxBps');
  const commissionCents = bpsOf(amountCents, commissionBps);
  const taxCents = bpsOf(commissionCents, taxBps);
  const totalCents = amountCents + commissionCents + taxCents;
  return { amountCents, commissionBps, commissionCents, taxBps, taxCents, totalCents };
}

type PlatformSettingsClient = {
  platformSettings: {
    findUnique(args: { where: { id: string } }): Promise<PlatformSettingsSnapshot | null>;
  };
};

/**
 * Lee la fila única `PlatformSettings` (`id: 'global'`). Si no existiera
 * (no debería: la migración la crea), usa los valores por defecto y lo
 * registra como defensa, sin lanzar ni bloquear la operación en curso.
 *
 * Solo debe llamarse para un turno/pago ANTERIOR a esta migración
 * (`Shift.commissionBps` es `null`): un turno nuevo ya trae su propia
 * comisión fijada y no necesita leer el ajuste global.
 */
export async function getPlatformSettings(
  client: PlatformSettingsClient,
): Promise<PlatformSettingsSnapshot> {
  const settings = await client.platformSettings.findUnique({ where: { id: 'global' } });
  if (!settings) {
    console.error('PlatformSettings["global"] no existe; usando valores por defecto de defensa.');
    return { commissionBps: DEFAULT_COMMISSION_BPS, taxBps: DEFAULT_TAX_BPS };
  }
  return { commissionBps: settings.commissionBps, taxBps: settings.taxBps };
}
