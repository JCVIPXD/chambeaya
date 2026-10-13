'use client';

import { useEffect, useRef, useState } from 'react';

import { apiOrigin } from '../../lib/business-api';
import type { JobEventNotification } from './jobs-api';

// Avisos en vivo de las postulaciones (`GET /api/job-events`, SSE).
//
// `EventSource` no permite enviar `Authorization`, así que se lee el flujo con `fetch`. La conexión:
//  - se reabre sola con retroceso exponencial (1 s, 2 s, 4 s... hasta 30 s, con un poco de azar) y vuelve a
//    1 s en cuanto una conexión llega a vivir o a entregar un aviso;
//  - detecta un flujo mudo (la API manda un comentario cada 25 s) y lo reabre;
//  - se detiene del todo con un 401 (sesión vencida) y al desmontar, sin dejar ni lectores ni temporizadores.
// Los avisos solo dicen QUÉ cambió; quien los recibe vuelve a pedir los datos a la API.

export type JobEventsStatus = 'connecting' | 'live' | 'reconnecting';

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const SILENCE_LIMIT_MS = 70_000;
const HEALTHY_AFTER_MS = 5000;

function isNotification(value: unknown): value is JobEventNotification {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === 'string' && typeof record.applicationId === 'string' && typeof record.postingId === 'string';
}

/** Interpreta un bloque SSE (líneas hasta una línea en blanco). Devuelve el aviso de tipo `job`, si lo es. */
export function parseSseBlock(block: string): JobEventNotification | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (event !== 'job' || data.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(data.join('\n'));
    return isNotification(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type JobEventsConnection = {
  token: string;
  onEvent: (event: JobEventNotification) => void;
  onStatus?: (status: JobEventsStatus) => void;
  onUnauthorized?: () => void;
};

/** Abre la conexión y devuelve la función que la cierra por completo. */
export function connectJobEvents({ token, onEvent, onStatus, onUnauthorized }: JobEventsConnection): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    wake = resolve;
    sleepTimer = setTimeout(resolve, ms);
  });

  async function readStream(response: Response, signal: AbortSignal) {
    const reader = response.body?.getReader();
    if (!reader) return false;
    const decoder = new TextDecoder();
    let buffer = '';
    let delivered = false;
    let silence: ReturnType<typeof setTimeout> | null = null;
    const armSilence = () => {
      if (silence) clearTimeout(silence);
      silence = setTimeout(() => controller?.abort(), SILENCE_LIMIT_MS);
    };
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    armSilence();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armSilence();
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
          const notification = parseSseBlock(block);
          if (notification && !stopped) {
            delivered = true;
            try { onEvent(notification); } catch { /* un manejador roto no debe cortar el flujo */ }
          }
          boundary = buffer.search(/\r?\n\r?\n/);
        }
      }
    } finally {
      if (silence) clearTimeout(silence);
      signal.removeEventListener('abort', cancel);
    }
    return delivered;
  }

  async function run() {
    let failures = 0;
    onStatus?.('connecting');
    while (!stopped) {
      const startedAt = Date.now();
      let healthy = false;
      controller = new AbortController();
      try {
        const response = await fetch(`${apiOrigin()}/job-events`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (response.status === 401) {
          stopped = true;
          onUnauthorized?.();
          return;
        }
        if (!response.ok || !response.body) throw new Error(`SSE_HTTP_${response.status}`);
        if (stopped) return;
        onStatus?.('live');
        healthy = await readStream(response, controller.signal);
      } catch {
        // Corte de red, error HTTP o flujo mudo: se reintenta abajo (salvo que se haya cerrado a propósito).
      }
      if (stopped) return;
      healthy = healthy || Date.now() - startedAt >= HEALTHY_AFTER_MS;
      failures = healthy ? 0 : failures + 1;
      onStatus?.('reconnecting');
      const delay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** Math.max(0, failures - 1)) + Math.floor(Math.random() * 400);
      await sleep(delay);
    }
  }

  void run();

  return () => {
    stopped = true;
    controller?.abort();
    if (sleepTimer) clearTimeout(sleepTimer);
    wake?.();
  };
}

/**
 * Mantiene una conexión de avisos mientras `enabled` y hay sesión. `onEvent` puede cambiar en cada render sin
 * reabrir la conexión.
 */
export function useJobEvents(token: string, enabled: boolean, onEvent: (event: JobEventNotification) => void, onUnauthorized?: () => void): JobEventsStatus {
  const [status, setStatus] = useState<JobEventsStatus>('connecting');
  const handler = useRef(onEvent);
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => {
    handler.current = onEvent;
    unauthorized.current = onUnauthorized;
  });
  useEffect(() => {
    if (!enabled || !token) return undefined;
    const close = connectJobEvents({
      token,
      onEvent: (event) => handler.current(event),
      onStatus: setStatus,
      onUnauthorized: () => unauthorized.current?.(),
    });
    return () => {
      close();
      setStatus('connecting');
    };
  }, [token, enabled]);
  return status;
}
