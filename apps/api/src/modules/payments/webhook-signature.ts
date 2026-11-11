import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Esquema de firma propio (Alcance E) para los adaptadores que Chambeaya
 * controla por completo (`manual` no lo usa nunca; `simulated` lo usa tanto
 * para firmar el evento que genera al aprobar/rechazar como para verificar el
 * que llega a `POST /api/payments/webhooks/:provider`). Un proveedor real
 * (Alcance futuro) tendrá su PROPIO esquema de firma -documentado por
 * ese proveedor-, así que este módulo nunca se usa fuera de
 * `simulated.provider.ts`.
 *
 * `HMAC-SHA256` sobre `${timestamp}.${rawBody}` (nunca sobre el body solo:
 * eso permitiría reproducir indefinidamente un webhook capturado). El
 * timestamp viaja en la cabecera junto con la firma, separados por coma
 * (formato inspirado en el de Stripe, sin ser Stripe): `t=<epoch_ms>,v1=<hex>`.
 */
export const SIGNATURE_HEADER = 'x-payment-signature';
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export class InvalidSignatureError extends Error {
  constructor(reason: string) {
    super(`INVALID_SIGNATURE: ${reason}`);
  }
}

function hmac(secret: string, timestamp: string, rawBody: Buffer): Buffer {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
}

/** Construye el valor de la cabecera `x-payment-signature` para `rawBody`. */
export function signPayload(secret: string, rawBody: Buffer, timestamp = Date.now()): string {
  const digest = hmac(secret, String(timestamp), rawBody).toString('hex');
  return `t=${timestamp},v1=${digest}`;
}

function parseHeaderValue(value: string | string[] | undefined): { timestamp: string; digest: string } {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) throw new InvalidSignatureError('missing header');
  const parts = new Map(
    raw.split(',').map((segment) => {
      const [key, ...rest] = segment.split('=');
      return [key?.trim(), rest.join('=').trim()] as const;
    }),
  );
  const timestamp = parts.get('t');
  const digest = parts.get('v1');
  if (!timestamp || !digest) throw new InvalidSignatureError('malformed header');
  return { timestamp, digest };
}

/**
 * Verifica `rawBody` contra la cabecera `x-payment-signature`. Lanza
 * `InvalidSignatureError` (nunca devuelve `false`: quien la llama debe
 * decidir el `401` una sola vez, sin un segundo camino silencioso) si:
 * - falta la cabecera o está mal formada;
 * - el timestamp está fuera de la tolerancia de 5 minutos (reloj desfasado o
 *   repetición de un webhook capturado hace tiempo);
 * - el HMAC no coincide (firma inválida o `rawBody` alterado en tránsito).
 *
 * La comparación usa `timingSafeEqual` (nunca `===` ni `Buffer.equals` sobre
 * datos derivados de la entrada): evita filtrar por temporización cuántos
 * bytes iniciales del HMAC coinciden.
 */
export function verifySignature(
  secret: string,
  rawBody: Buffer,
  headerValue: string | string[] | undefined,
  now = Date.now(),
): void {
  const { timestamp, digest } = parseHeaderValue(headerValue);
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) throw new InvalidSignatureError('invalid timestamp');
  if (Math.abs(now - timestampMs) > SIGNATURE_TOLERANCE_MS) {
    throw new InvalidSignatureError('timestamp outside tolerance');
  }
  const expected = hmac(secret, timestamp, rawBody);
  let provided: Buffer;
  try {
    provided = Buffer.from(digest, 'hex');
  } catch {
    throw new InvalidSignatureError('malformed digest');
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new InvalidSignatureError('digest mismatch');
  }
}
