'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { describeError } from './errors';
import { jobsApi } from './jobs-api';

// Datos compartidos por las vistas de puestos fijos: sesión, nombre de la moneda (SIEMPRE el que entrega la
// API; mientras no responde se usa un texto neutro), saldo y el puesto elegido entre Puestos y Postulantes.

export type JobsView = 'Resumen' | 'Puestos' | 'Postulantes' | 'Talento' | 'Billetera' | 'Perfil de empresa';

export type JobsContextValue = {
  token: string;
  /** Nombre de la moneda virtual tal como lo entrega la API (por ejemplo «Chambitas»). */
  currency: string;
  balance: number | null;
  balanceError: boolean;
  refreshBalance: () => Promise<void>;
  /** Una vista recibió un 401: la sesión venció. */
  onUnauthorized: () => void;
  toast: (message: string) => void;
  goTo: (view: JobsView) => void;
  selectedPostingId: string;
  setSelectedPostingId: (id: string) => void;
  /** La barra superior pidió «Nuevo puesto» y Puestos todavía no abrió el formulario. */
  createPending: boolean;
  consumeCreate: () => void;
};

const JobsContext = createContext<JobsContextValue | null>(null);

export function useJobs(): JobsContextValue {
  const value = useContext(JobsContext);
  if (!value) throw new Error('JOBS_CONTEXT_MISSING');
  return value;
}

export const NEUTRAL_CURRENCY_NAME = 'monedas';

export function JobsProvider({ token, onUnauthorized, toast, goTo, createRequest, children, onBalance }: {
  token: string;
  onUnauthorized: () => void;
  toast: (message: string) => void;
  goTo: (view: JobsView) => void;
  createRequest: number;
  children: ReactNode;
  /** Lo usa la barra superior para mostrar el saldo sin pedirlo otra vez. */
  onBalance?: (state: { currency: string; balance: number | null }) => void;
}) {
  const [currency, setCurrency] = useState(NEUTRAL_CURRENCY_NAME);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [selectedPostingId, setSelectedPostingId] = useState('');
  const [handledCreate, setHandledCreate] = useState(createRequest);
  const createRef = useRef(createRequest);
  const alive = useRef(true);
  const unauthorizedRef = useRef(onUnauthorized);
  const balanceCallback = useRef(onBalance);
  const toastRef = useRef(toast);
  const goToRef = useRef(goTo);
  useEffect(() => {
    unauthorizedRef.current = onUnauthorized;
    balanceCallback.current = onBalance;
    toastRef.current = toast;
    goToRef.current = goTo;
    createRef.current = createRequest;
  });
  const consumeCreate = useCallback(() => setHandledCreate(createRef.current), []);
  // Estables entre renders: las vistas los usan dentro de efectos y temporizadores.
  const stableUnauthorized = useCallback(() => unauthorizedRef.current(), []);
  const stableToast = useCallback((message: string) => toastRef.current(message), []);
  const stableGoTo = useCallback((view: JobsView) => goToRef.current(view), []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refreshBalance = useCallback(async () => {
    try {
      const result = await jobsApi.currency.balance(token);
      if (!alive.current) return;
      setCurrency(result.currency);
      setBalance(result.balance);
      setBalanceError(false);
      balanceCallback.current?.({ currency: result.currency, balance: result.balance });
    } catch (error) {
      if (!alive.current) return;
      if (describeError(error).kind === 'session') unauthorizedRef.current();
      else setBalanceError(true);
    }
  }, [token]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const value = useMemo<JobsContextValue>(() => ({
    token, currency, balance, balanceError, refreshBalance,
    onUnauthorized: stableUnauthorized,
    toast: stableToast, goTo: stableGoTo, selectedPostingId, setSelectedPostingId, createPending: createRequest > handledCreate, consumeCreate,
  }), [token, currency, balance, balanceError, refreshBalance, stableUnauthorized, stableToast, stableGoTo, selectedPostingId, createRequest, handledCreate, consumeCreate]);

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}
