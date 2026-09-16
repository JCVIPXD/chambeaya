import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RateLimitOptions {
  /** Tamaño de la ventana deslizante en milisegundos. */
  windowMs: number;
  /** Máximo de solicitudes permitidas por clave dentro de la ventana. */
  max: number;
  /** Código devuelto en el cuerpo `{ error: <codigo> }` al superar el límite. */
  errorCode?: string;
  /** Permite personalizar la clave de conteo; por defecto usa la IP de la solicitud. */
  keyGenerator?: (request: Request) => string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_ERROR_CODE = 'RATE_LIMITED';

/**
 * Limitador de intentos en memoria, de ventana fija por clave (IP por defecto).
 *
 * El almacén vive en el cierre de esta función, por lo que cada llamada a
 * `createRateLimitMiddleware` produce un limitador independiente: útil para
 * aislar pruebas y para que cada instancia de `createApp` arranque sin estado
 * heredado. No se comparte entre procesos ni sobrevive a un reinicio; con
 * varias réplicas de la API el límite efectivo se multiplica (riesgo
 * declarado y aceptado para este alcance, ver Bloque 8 del plan maestro).
 */
export function createRateLimitMiddleware(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, errorCode = DEFAULT_ERROR_CODE } = options;
  const keyGenerator = options.keyGenerator ?? ((request: Request) => request.ip ?? 'unknown');
  const hits = new Map<string, RateLimitEntry>();

  return function rateLimit(request: Request, response: Response, next: NextFunction) {
    const key = keyGenerator(request);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > max) {
      response.status(429).json({ error: errorCode });
      return;
    }

    next();
  };
}
