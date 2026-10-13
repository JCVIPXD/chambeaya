'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';

import { describeError, type DescribedError } from './errors';
import { formatCoins } from './format';
import { jobsApi, type QuotableAction, type Quote } from './jobs-api';
import { actionLabel } from './labels';
import { Modal, RetryButton } from './ui';

// Flujo común de toda acción que puede costar monedas (publicar fuera de cuota, destacar, invitar,
// desbloquear contacto/CV):
//   1. consulta el costo previo (`quote`, sin efectos);
//   2. si es gratis (cuota gratuita, ya registrado o acción sin costo) la ejecuta sin pedir confirmación;
//   3. si cuesta, muestra costo, saldo y cuota y pide confirmar; si no alcanza el saldo o el tope diario,
//      explica el camino siguiente en vez de dejar un botón roto;
//   4. un 409 de moneda o un 503 se muestran con un mensaje claro y, en el 503, un reintento seguro.
// Nunca se bloquea una acción GRATUITA por falta de saldo ni por un fallo de la cotización.

export type CostActionSpec = {
  title: string;
  summary?: string;
  actionKey: QuotableAction;
  targetId?: string;
  confirmLabel: string;
  /** Ejecuta la acción real. Devuelve el aviso de éxito (o nada). Lanza el error de la API tal cual. */
  execute: () => Promise<string | void>;
};

type Phase =
  | { name: 'quoting' }
  | { name: 'confirm'; quote: Quote }
  | { name: 'blocked'; quote: Quote }
  | { name: 'quote-error'; error: DescribedError }
  | { name: 'running'; quote: Quote | null }
  | { name: 'error'; error: DescribedError; quote: Quote | null };

const SHOW_LOADING_AFTER_MS = 350;

export function CostActionDialog({ spec, token, currency, onClose, onDone, onFailed, onUnauthorized, onOpenWallet }: {
  spec: CostActionSpec;
  token: string;
  currency: string;
  onClose: () => void;
  /** La acción se ejecutó (con `message` del aviso). */
  onDone: (message: string | undefined, quote: Quote | null) => void;
  /** La acción falló (o ya no era posible): quien llama puede refrescar su lista. */
  onFailed?: (error: DescribedError) => void;
  onUnauthorized: () => void;
  onOpenWallet?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: 'quoting' });
  const [visible, setVisible] = useState(false);
  const alive = useRef(true);
  const specRef = useRef(spec);
  // Los manejadores del padre pueden cambiar en cada render: se leen por ref para que la cotización
  // (que corre una sola vez al abrir) no se repita.
  const handlers = useRef({ onDone, onFailed, onUnauthorized });
  useEffect(() => {
    specRef.current = spec;
    handlers.current = { onDone, onFailed, onUnauthorized };
  });
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async (quote: Quote | null) => {
    setPhase({ name: 'running', quote });
    try {
      const message = await specRef.current.execute();
      if (!alive.current) return;
      handlers.current.onDone(message ?? undefined, quote);
    } catch (error) {
      if (!alive.current) return;
      const described = describeError(error, currency);
      if (described.kind === 'session') {
        handlers.current.onUnauthorized();
        return;
      }
      handlers.current.onFailed?.(described);
      setPhase({ name: 'error', error: described, quote });
    }
  }, [currency]);

  const quoteIt = useCallback(async () => {
    setPhase({ name: 'quoting' });
    try {
      const quote = await jobsApi.currency.quote(token, specRef.current.actionKey, specRef.current.targetId);
      if (!alive.current) return;
      if (quote.cost <= 0) {
        // Gratis: se ejecuta sin pedir confirmación y sin importar el saldo.
        await run(quote);
        return;
      }
      setPhase(quote.canExecute ? { name: 'confirm', quote } : { name: 'blocked', quote });
    } catch (error) {
      if (!alive.current) return;
      const described = describeError(error, currency);
      if (described.kind === 'session') {
        handlers.current.onUnauthorized();
        return;
      }
      setPhase({ name: 'quote-error', error: described });
    }
  }, [token, currency, run]);

  useEffect(() => {
    void quoteIt();
  }, [quoteIt]);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), SHOW_LOADING_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const transient = phase.name === 'quoting' || (phase.name === 'running' && phase.quote !== null && phase.quote.cost <= 0);
  if (transient && !visible) {
    return <div className="fx-sr-only" role="status" aria-live="polite">Calculando el costo…</div>;
  }

  const busy = phase.name === 'quoting' || phase.name === 'running';
  return (
    <Modal title={spec.title} description={spec.summary} onClose={onClose} busy={busy} size="sm" initialFocus="[data-autofocus]">
      <div className="fx-cost" aria-live="polite">
        {phase.name === 'quoting' && <p role="status">Calculando el costo…</p>}
        {phase.name === 'running' && <p role="status">{phase.quote && phase.quote.cost > 0 ? 'Procesando y cobrando…' : 'Procesando…'}</p>}
        {phase.name === 'confirm' && <QuoteDetails quote={phase.quote} currency={currency} />}
        {phase.name === 'blocked' && (
          <>
            <QuoteDetails quote={phase.quote} currency={currency} />
            <div className="fx-callout fx-callout-warn" role="alert">
              {!phase.quote.sufficientBalance ? (
                <p>
                  No tienes saldo suficiente: te faltan <strong>{formatCoins(phase.quote.cost - phase.quote.balance, currency)}</strong>. No se cobró nada.
                  Revisa en tu Billetera cómo ganar más {currency} (por ejemplo, verificando tu empresa o confirmando contrataciones).
                </p>
              ) : (
                <p>
                  Alcanzaste el tope diario de gasto: hoy gastaste <strong>{formatCoins(phase.quote.dailyCap.spentToday, currency)}</strong> de {formatCoins(phase.quote.dailyCap.limit, currency)}.
                  Podrás volver a hacerlo mañana (el día cambia a medianoche, hora de Lima). No se cobró nada.
                </p>
              )}
            </div>
          </>
        )}
        {phase.name === 'quote-error' && (
          <div className="fx-callout fx-callout-warn" role="alert">
            <p>No pudimos calcular el costo de esta acción. {phase.error.message}</p>
            <p>Si continúas, el servidor te avisará antes de cobrar si falta saldo o si superas el tope diario.</p>
          </div>
        )}
        {phase.name === 'error' && (
          <>
            {phase.quote && phase.quote.cost > 0 && <QuoteDetails quote={phase.quote} currency={currency} />}
            <div className={`fx-callout ${phase.error.kind === 'retry' ? 'fx-callout-warn' : 'fx-callout-bad'}`} role="alert">
              <p>{phase.error.message}</p>
              {phase.error.kind === 'insufficient' && <p>Revisa tu Billetera para ver cómo ganar más {currency}.</p>}
            </div>
          </>
        )}
      </div>

      <div className="modal-actions">
        {(phase.name === 'confirm' || phase.name === 'quote-error') && <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>}
        {phase.name === 'confirm' && (
          <button className="primary-button" type="button" data-autofocus onClick={() => void run(phase.quote)}>
            <Coins size={16} aria-hidden="true" /> {spec.confirmLabel} por {formatCoins(phase.quote.cost, currency)}
          </button>
        )}
        {phase.name === 'quote-error' && (
          <>
            <RetryButton onRetry={() => void quoteIt()} seconds={phase.error.retryAfterSeconds} label="Reintentar el cálculo" />
            <button className="primary-button" type="button" data-autofocus onClick={() => void run(null)}>{spec.confirmLabel} de todos modos</button>
          </>
        )}
        {phase.name === 'blocked' && (
          <>
            <button className="secondary-button" type="button" data-autofocus onClick={onClose}>Cerrar</button>
            {onOpenWallet && <button className="primary-button" type="button" onClick={onOpenWallet}>Ver mi Billetera</button>}
          </>
        )}
        {phase.name === 'error' && (
          <>
            <button className="secondary-button" type="button" data-autofocus onClick={onClose}>Cerrar</button>
            {phase.error.kind === 'retry' && <RetryButton onRetry={() => void run(phase.quote)} seconds={phase.error.retryAfterSeconds} label="Reintentar ahora" />}
            {(phase.error.kind === 'insufficient' || phase.error.kind === 'daily-cap') && onOpenWallet && <button className="primary-button" type="button" onClick={onOpenWallet}>Ver mi Billetera</button>}
            {phase.error.kind === 'network' && <button className="primary-button" type="button" onClick={() => void run(phase.quote)}>Reintentar</button>}
          </>
        )}
        {busy && <button className="secondary-button" type="button" disabled>Espera…</button>}
      </div>
    </Modal>
  );
}

export function QuoteDetails({ quote, currency }: { quote: Quote; currency: string }) {
  const after = quote.balance - quote.cost;
  return (
    <dl className="fx-quote">
      <div><dt>{actionLabel(quote.actionKey)}</dt><dd><strong>{formatCoins(quote.cost, currency)}</strong></dd></div>
      <div><dt>Tu saldo</dt><dd>{formatCoins(quote.balance, currency)}</dd></div>
      {quote.sufficientBalance && <div><dt>Saldo después</dt><dd>{formatCoins(after, currency)}</dd></div>}
      {quote.freeQuota && (
        <div>
          <dt>Cuota gratuita del mes</dt>
          <dd>{quote.freeQuota.remaining > 0 ? `${quote.freeQuota.remaining} de ${quote.freeQuota.monthlyLimit} disponibles` : `Agotada (${quote.freeQuota.monthlyLimit} de ${quote.freeQuota.monthlyLimit} usadas)`}</dd>
        </div>
      )}
      <div><dt>Gasto de hoy</dt><dd>{formatCoins(quote.dailyCap.spentToday, currency)} de {formatCoins(quote.dailyCap.limit, currency)}</dd></div>
      {quote.refundWindowHours ? <div><dt>Devolución</dt><dd>Si no te responden en {quote.refundWindowHours} h, te devolvemos el costo.</dd></div> : null}
    </dl>
  );
}
