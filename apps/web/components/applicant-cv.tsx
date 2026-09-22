"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

import { ApiError, businessApi } from "../lib/business-api";

type CvState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

// Tiempo que se conserva el objeto `blob:` de un CV abierto: la pestaña lo
// necesita mientras la persona lo lee (recargar, imprimir, guardar).
const BLOB_URL_LIFETIME_MS = 5 * 60 * 1000;

function cvErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Tu sesión venció. Vuelve a iniciar sesión para abrir el CV.";
    if (error.status === 403)
      return "Tu cuenta no tiene permiso para abrir este CV.";
    if (error.code === "CV_NOT_AVAILABLE")
      return "El CV ya no está disponible para esta postulación.";
    if (error.code === "APPLICATION_NOT_FOUND")
      return "No encontramos esta postulación.";
  }
  return "No pudimos abrir el CV. Inténtalo otra vez.";
}

/**
 * "Ver CV" de un postulante. Se dibuja solo cuando la API indicó `hasCv`, que ya
 * incorpora todas las reglas de acceso (postulación vigente, perfil visible);
 * aquí no se repite ninguna. El archivo se pide bajo demanda con la sesión de la
 * empresa (nunca hay una URL pública) y se abre como solo lectura.
 *
 * El estado de carga y de error vive en este componente a propósito: así abrir
 * un CV no vuelve a renderizar `HomePage`, que sondea postulaciones cada 4 s.
 */
export function ApplicantCvButton({
  token,
  shiftId,
  applicationId,
  workerName,
}: {
  token: string;
  shiftId: string;
  applicationId: string;
  workerName: string;
}) {
  const [state, setState] = useState<CvState>({ status: "idle" });
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function openCv() {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: "loading" });
    // La pestaña se abre en el mismo gesto del clic; después del `await` los
    // navegadores suelen bloquearla. Sin `opener` para que no controle el panel.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const blob = await businessApi.applications.cv(
        token,
        shiftId,
        applicationId,
      );
      const url = URL.createObjectURL(blob);
      window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
      if (tab) {
        tab.location.href = url;
      } else {
        // Ventana emergente bloqueada: se descarga en lugar de fallar.
        const link = document.createElement("a");
        link.href = url;
        link.download = `CV de ${workerName}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      if (mounted.current) setState({ status: "idle" });
    } catch (error) {
      tab?.close();
      if (mounted.current)
        setState({ status: "error", message: cvErrorMessage(error) });
    } finally {
      inFlight.current = false;
    }
  }

  const loading = state.status === "loading";
  return (
    <div className="applicant-cv">
      <button
        className="secondary-button applicant-cv-button"
        type="button"
        aria-label={`Ver CV de ${workerName}`}
        aria-busy={loading}
        aria-disabled={loading}
        onClick={() => void openCv()}
      >
        <FileText size={15} /> Ver CV
      </button>
      <small className="applicant-cv-note">
        PDF subido por el trabajador, solo lectura. Chambeaya no verifica su
        contenido.
      </small>
      {loading && (
        <small className="applicant-cv-note" role="status">
          Abriendo el CV…
        </small>
      )}
      {state.status === "error" && (
        <p className="applicant-cv-error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
