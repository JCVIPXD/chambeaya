'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';

import { describeError } from './errors';

// Tiempo que se conserva el objeto `blob:` de un PDF abierto (la pestaña lo necesita mientras se lee).
const BLOB_URL_LIFETIME_MS = 5 * 60 * 1000;

/**
 * Abre un PDF privado (CV de un postulante o de un candidato desbloqueado, PDF de una oferta) en una pestaña
 * nueva, sin `opener`. El archivo se pide con la sesión de la empresa: nunca hay una URL pública. El estado
 * de carga vive aquí para que abrir un PDF no vuelva a renderizar la vista.
 */
export function PdfButton({ label, downloadName, fetchBlob, onUnauthorized, note }: {
  label: string;
  downloadName: string;
  fetchBlob: (signal: AbortSignal) => Promise<Blob>;
  onUnauthorized?: () => void;
  note?: string;
}) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' } | { status: 'error'; message: string }>({ status: 'idle' });
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  async function open() {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: 'loading' });
    // La pestaña se abre en el mismo gesto del clic: después del `await` los navegadores suelen bloquearla.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    controller.current = new AbortController();
    try {
      const blob = await fetchBlob(controller.current.signal);
      const url = URL.createObjectURL(blob);
      window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
      if (tab) tab.location.href = url;
      else {
        // Ventana emergente bloqueada: se descarga en lugar de fallar.
        const link = document.createElement('a');
        link.href = url;
        link.download = downloadName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      if (mounted.current) setState({ status: 'idle' });
    } catch (error) {
      tab?.close();
      if (!mounted.current) return;
      const described = describeError(error);
      if (described.kind === 'session') onUnauthorized?.();
      setState({ status: 'error', message: described.kind === 'not-found' ? 'El archivo ya no está disponible.' : `No pudimos abrir el archivo. ${described.message}` });
    } finally {
      inFlight.current = false;
    }
  }

  const loading = state.status === 'loading';
  return (
    <span className="fx-pdf">
      <button className="secondary-button fx-small-button" type="button" aria-busy={loading} aria-disabled={loading} onClick={() => void open()}>
        <FileText size={15} aria-hidden="true" /> {label}
      </button>
      {note && <small className="fx-muted">{note}</small>}
      {loading && <small className="fx-muted" role="status">Abriendo el archivo…</small>}
      {state.status === 'error' && <small className="fx-field-error" role="alert">{state.message}</small>}
    </span>
  );
}
