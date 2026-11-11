'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { acceptResponse, createRequestSequence, invalidateInFlight, issueRequest } from '../../lib/request-sequence';
import { describeError, type DescribedError } from './errors';
import type { Page } from './jobs-api';

// Lista paginada por cursor con "Ver más". Un cambio de `key` (filtro, puesto) reinicia la lista y descarta lo
// que estaba en vuelo; un refresco silencioso (aviso en vivo) vuelve a pedir lo ya cargado (hasta 100) sin
// mostrar el estado de carga ni vaciar la lista si falla.

export type PagedList<T> = {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: DescribedError | null;
  loadMoreError: DescribedError | null;
  refreshFailed: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  reload: (options?: { silent?: boolean }) => Promise<void>;
};

export function usePagedList<T extends { id: string }>(
  fetchPage: (cursor: string | null, limit: number) => Promise<Page<T>>,
  key: string,
  options: { onUnauthorized?: () => void; currency?: string; enabled?: boolean; pageSize?: number } = {},
): PagedList<T> {
  const enabled = options.enabled ?? true;
  const pageSize = options.pageSize ?? 25;
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<DescribedError | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<DescribedError | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const sequence = useRef(createRequestSequence());
  const fetchRef = useRef(fetchPage);
  const optionsRef = useRef(options);
  const itemsRef = useRef<T[]>([]);
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    fetchRef.current = fetchPage;
    optionsRef.current = options;
    itemsRef.current = items;
    cursorRef.current = cursor;
  });
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const fail = useCallback((caught: unknown): DescribedError | null => {
    const described = describeError(caught, optionsRef.current.currency);
    if (described.kind === 'session') {
      optionsRef.current.onUnauthorized?.();
      return null;
    }
    return described;
  }, []);

  const reload = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const id = issueRequest(sequence.current);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!silent) {
      setLoading(true);
      setError(null);
      setLoadMoreError(null);
    }
    const limit = silent ? Math.min(100, Math.max(pageSize, itemsRef.current.length)) : pageSize;
    try {
      const page = await fetchRef.current(null, limit);
      if (!alive.current || !acceptResponse(sequence.current, id)) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
      setLoadMoreError(null);
      setRefreshFailed(false);
      setLoading(false);
    } catch (caught) {
      if (!alive.current || !acceptResponse(sequence.current, id)) return;
      const described = fail(caught);
      if (!described) return;
      if (silent) setRefreshFailed(true);
      else {
        setItems([]);
        setCursor(null);
        setError(described);
        setLoading(false);
      }
    }
  }, [fail, pageSize]);

  useEffect(() => {
    if (!enabled) return;
    setItems([]);
    setCursor(null);
    void reload();
  }, [key, enabled, reload]);

  const loadMore = useCallback(async () => {
    const next = cursorRef.current;
    if (!next || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const id = issueRequest(sequence.current);
    try {
      const page = await fetchRef.current(next, pageSize);
      if (!alive.current || !acceptResponse(sequence.current, id)) return;
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch (caught) {
      if (!alive.current || !acceptResponse(sequence.current, id)) return;
      const described = fail(caught);
      if (described) setLoadMoreError(described);
    } finally {
      if (alive.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [fail, pageSize]);

  // Una escritura confirmada invalida lo que viajaba (ver `request-sequence.ts`).
  useEffect(() => () => invalidateInFlight(sequence.current), []);

  return { items, loading, loadingMore, error, loadMoreError, refreshFailed, hasMore: cursor !== null, loadMore, reload };
}
