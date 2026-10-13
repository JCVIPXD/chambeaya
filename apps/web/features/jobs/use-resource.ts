'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { acceptResponse, createRequestSequence, invalidateInFlight, issueRequest } from '../../lib/request-sequence';
import { describeError, type DescribedError } from './errors';

// Carga de datos de una vista con estados de carga, error y reintento. Reutiliza la secuenciación de
// `lib/request-sequence.ts`: una respuesta que llega tarde nunca pisa a una más nueva ni a una escritura
// confirmada (`touch()`), y una lectura "silenciosa" (la que dispara un aviso en vivo) no vuelve a mostrar
// el estado de carga ni borra lo que ya se ve si falla.

export type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: DescribedError | null;
  /** Un refresco silencioso falló pero se conservan los datos anteriores. */
  refreshFailed: boolean;
  reload: (options?: { silent?: boolean }) => Promise<void>;
  /** Reemplaza los datos (tras una escritura) e invalida las lecturas en vuelo. */
  replace: (next: T | ((current: T | null) => T | null)) => void;
};

export function useResource<T>(load: () => Promise<T>, key: string, options: { onUnauthorized?: () => void; currency?: string; enabled?: boolean } = {}): Resource<T> {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: DescribedError | null; refreshFailed: boolean }>({ data: null, loading: enabled, error: null, refreshFailed: false });
  const sequence = useRef(createRequestSequence());
  const loadRef = useRef(load);
  const optionsRef = useRef(options);
  const alive = useRef(true);
  useEffect(() => {
    loadRef.current = load;
    optionsRef.current = options;
  });
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reload = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const id = issueRequest(sequence.current);
    if (!silent) setState((current) => ({ ...current, loading: true, error: null, refreshFailed: false }));
    try {
      const data = await loadRef.current();
      if (!alive.current || !acceptResponse(sequence.current, id)) return;
      setState({ data, loading: false, error: null, refreshFailed: false });
    } catch (error) {
      if (!alive.current || !acceptResponse(sequence.current, id)) return;
      const described = describeError(error, optionsRef.current.currency);
      if (described.kind === 'session') {
        optionsRef.current.onUnauthorized?.();
        return;
      }
      setState((current) => (silent ? { ...current, refreshFailed: true } : { data: null, loading: false, error: described, refreshFailed: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setState({ data: null, loading: true, error: null, refreshFailed: false });
    void reload();
  }, [key, enabled, reload]);

  const replace = useCallback((next: T | ((current: T | null) => T | null)) => {
    invalidateInFlight(sequence.current);
    setState((current) => ({ ...current, data: typeof next === 'function' ? (next as (value: T | null) => T | null)(current.data) : next, refreshFailed: false }));
  }, []);

  return { ...state, reload, replace };
}
