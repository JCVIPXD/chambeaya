'use client';

import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, X } from 'lucide-react';

import type { DescribedError } from './errors';
import { useCountdown } from './use-countdown';

// Piezas visuales compartidas por las vistas de puestos fijos. Estilos en `jobs.css` (prefijo `fx-`).

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal accesible: `role="dialog"`, foco inicial dentro, Tab atrapado, Escape y clic fuera cierran,
 * y al cerrar el foco vuelve al elemento que lo abrió.
 */
export function Modal({ title, description, onClose, children, size = 'md', busy = false, initialFocus }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Con una operación en curso no se cierra con Escape ni con clic fuera. */
  busy?: boolean;
  /** Selector CSS (dentro del diálogo) del elemento que recibe el foco; por defecto, el primero. */
  initialFocus?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = card.current;
    const first = (initialFocus && root?.querySelector<HTMLElement>(initialFocus)) || root?.querySelector<HTMLElement>(FOCUSABLE) || root;
    first?.focus();
    return () => {
      const target = opener.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [initialFocus]);

  // Teclado a nivel de documento: si el elemento enfocado desaparece (p. ej. al terminar una acción), el foco cae al
  // `body` y un `onKeyDown` del diálogo ya no oiría Escape ni Tab.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const root = card.current;
      if (!root) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null || item === document.activeElement);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      if (!root.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? lastItem : firstItem).focus();
      } else if (event.shiftKey && active === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Se dibuja en `document.body`: dentro de la vista, el `transform` de su animación de entrada convierte a la
  // vista en el bloque contenedor del diálogo y la barra superior (z-index 10) quedaría por encima.
  return createPortal(
    <div className="modal-layer fx-modal-layer" role="presentation" onMouseDown={() => { if (!busy) onClose(); }}>
      <div
        ref={card}
        className={`modal-card fx-modal fx-modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="fx-modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const PILL_TONE: Record<string, string> = {
  DRAFT: 'neutral', PUBLISHED: 'ok', PAUSED: 'warn', CLOSED: 'muted', FILLED: 'info',
  APPLIED: 'info', SHORTLISTED: 'info', INTERVIEW: 'info', OFFER: 'warn', ACCEPTED: 'ok', HIRED: 'ok', REJECTED: 'bad', WITHDRAWN: 'muted',
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return <span className={`fx-pill fx-pill-${PILL_TONE[status] ?? 'neutral'}`}>{label}</span>;
}

export function LoadingBlock({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="fx-state" role="status" aria-live="polite">
      <Loader2 className="fx-spin" size={20} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Contador regresivo del `Retry-After` del 503: el botón de reintentar se habilita al llegar a cero. */
export function RetryButton({ onRetry, seconds, label = 'Reintentar', busy = false }: { onRetry: () => void; seconds?: number | null; label?: string; busy?: boolean }) {
  const remaining = useCountdown(seconds ?? 0);
  return (
    <button className="secondary-button" type="button" disabled={remaining > 0 || busy} onClick={onRetry}>
      {remaining > 0 ? `${label} (${remaining} s)` : label}
    </button>
  );
}

export function ErrorBlock({ error, onRetry, title = 'No pudimos cargar esta información' }: { error: DescribedError; onRetry?: () => void; title?: string }) {
  return (
    <div className="fx-state fx-state-error" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{error.message}</span>
      {onRetry && <RetryButton onRetry={onRetry} seconds={error.retryAfterSeconds} />}
    </div>
  );
}

export function EmptyBlock({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="fx-state fx-state-empty">
      {icon}
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

export function Field({ label, error, hint, children, full = false }: { label: string; error?: string; hint?: string; children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode; full?: boolean }) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className={`fx-field${full ? ' fx-full' : ''}${error ? ' fx-field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': error || hint ? messageId : undefined })}
      {(error || hint) && <small id={messageId} className={error ? 'fx-field-error' : 'fx-field-hint'} role={error ? 'alert' : undefined}>{error ?? hint}</small>}
    </div>
  );
}

export function ViewHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="view-header fx-view-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="view-header-actions">{actions}</div>}
    </div>
  );
}
