"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  authApi,
  businessApi,
  businessSessionKey,
  type BusinessSession,
  type SimulatedCheckoutRecord,
} from "../../../lib/business-api";

type PageState = "loading" | "sign-in" | "unavailable" | "ready" | "approved" | "rejected" | "error";

function money(cents: number) {
  return `S/ ${(cents / 100).toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function SimulatedPaymentPage() {
  const { checkoutId } = useParams<{ checkoutId: string }>();
  const [state, setState] = useState<PageState>("loading");
  const [checkout, setCheckout] = useState<SimulatedCheckoutRecord | null>(null);
  const [session, setSession] = useState<BusinessSession | null>(null);
  const [busy, setBusy] = useState(false);

  const expired = useMemo(
    () => Boolean(checkout && new Date(checkout.expiresAt).getTime() <= Date.now()),
    [checkout],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const saved = window.localStorage.getItem(businessSessionKey);
      if (!saved) {
        if (!cancelled) setState("sign-in");
        return;
      }
      try {
        const parsed = JSON.parse(saved) as BusinessSession;
        const restored = await authApi.restore(parsed.token);
        if (restored.role !== "BUSINESS") throw new ApiError(403, "BUSINESS_ACCOUNT_REQUIRED");
        const record = await businessApi.payments.simulatedCheckout(restored.token, checkoutId);
        if (cancelled) return;
        setSession(restored);
        setCheckout(record);
        setState(record.payment.status === "PROCESSED" ? "approved" : record.status === "REJECTED" ? "rejected" : "ready");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          window.localStorage.removeItem(businessSessionKey);
          setState("sign-in");
          return;
        }
        setState(error instanceof ApiError && error.status === 404 ? "unavailable" : "error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [checkoutId]);

  async function decide(outcome: "approve" | "reject") {
    if (!session || !checkout || busy || expired) return;
    setBusy(true);
    try {
      if (outcome === "approve") {
        await businessApi.payments.approveSimulated(session.token, checkout.checkoutId);
      } else {
        await businessApi.payments.rejectSimulated(session.token, checkout.checkoutId);
      }
      const refreshed = await businessApi.payments.simulatedCheckout(session.token, checkout.checkoutId);
      setCheckout(refreshed);
      setState(
        refreshed.payment.status === "PROCESSED"
          ? "approved"
          : refreshed.status === "REJECTED"
            ? "rejected"
            : "ready",
      );
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <main className="simulated-payment-page"><p className="simulated-payment-loading"><LoaderCircle size={20} /> Cargando el pago de prueba…</p></main>;
  }

  if (state === "sign-in") {
    return <PaymentNotice icon={<ShieldCheck size={26} />} title="Inicia sesión para continuar" detail="Este checkout de prueba solo está disponible para la empresa dueña del pago." />;
  }

  if (state === "unavailable") {
    return <PaymentNotice icon={<CircleAlert size={26} />} title="Este checkout no está disponible" detail="Puede haber vencido, pertenecer a otra empresa o el modo simulado no estar activo." />;
  }

  if (state === "error" || !checkout) {
    return <PaymentNotice icon={<CircleAlert size={26} />} title="No pudimos procesar el pago de prueba" detail="Vuelve al panel e inténtalo nuevamente. No se registró ningún cobro." />;
  }

  const canDecide = state === "ready" && checkout.status === "CREATED" && checkout.payment.status === "SCHEDULED" && !expired;
  const title = state === "approved" ? "Pago simulado aprobado" : state === "rejected" ? "Pago simulado rechazado" : "Pago simulado";

  return (
    <main className="simulated-payment-page">
      <section className="simulated-payment-card" aria-live="polite">
        <span className={`simulated-payment-icon ${state}`}>
          {state === "approved" ? <CheckCircle2 size={28} /> : state === "rejected" ? <XCircle size={28} /> : <ShieldCheck size={28} />}
        </span>
        <p className="eyebrow">Entorno de pruebas</p>
        <h1>{title}</h1>
        <p className="simulated-payment-copy">
          {state === "approved"
            ? "La API recibió y verificó la confirmación simulada. El pago quedó registrado como procesado."
            : state === "rejected"
              ? "La API recibió el rechazo simulado. El pago volvió a quedar pendiente en el panel."
              : "No se moverá dinero real. Esta pantalla prueba el mismo flujo de checkout y webhook que usaría un proveedor."}
        </p>

        <dl className="simulated-payment-summary">
          <div><dt>Concepto</dt><dd>{checkout.payment.description}</dd></div>
          <div><dt>Referencia</dt><dd>{checkout.payment.reference}</dd></div>
          <div><dt>Total de prueba</dt><dd>{money(checkout.payment.totalCents)}</dd></div>
        </dl>

        {expired && state === "ready" && (
          <p className="simulated-payment-expired"><Clock3 size={16} /> Este checkout venció. Vuelve al panel para crear uno nuevo.</p>
        )}

        {canDecide && (
          <div className="simulated-payment-actions">
            <button className="primary-button" type="button" disabled={busy} onClick={() => void decide("approve")}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} Aprobar pago simulado
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void decide("reject")}>
              <XCircle size={17} /> Rechazar
            </button>
          </div>
        )}

        <Link className="simulated-payment-back" href="/">Volver a Pagos</Link>
      </section>
    </main>
  );
}

function PaymentNotice({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <main className="simulated-payment-page">
      <section className="simulated-payment-card simulated-payment-notice">
        <span className="simulated-payment-icon error">{icon}</span>
        <h1>{title}</h1>
        <p className="simulated-payment-copy">{detail}</p>
        <Link className="simulated-payment-back" href="/">Ir al panel</Link>
      </section>
    </main>
  );
}
