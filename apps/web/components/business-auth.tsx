'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { ArrowRight, BriefcaseBusiness, CheckCircle2, ShieldCheck } from 'lucide-react';

import { ApiError, authApi, type BusinessSession } from '../lib/business-api';

export function BusinessAuth({ onAuthenticated }: { onAuthenticated: (session: BusinessSession) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const session = await authApi.login(
        String(data.get('email')),
        String(data.get('password')),
      );
      if (session.role !== 'BUSINESS') {
        throw new ApiError(403, 'BUSINESS_ACCOUNT_REQUIRED');
      }
      onAuthenticated(session);
    } catch (reason) {
      const code = reason instanceof ApiError ? reason.code : 'REQUEST_FAILED';
      setError(
        code === 'INVALID_CREDENTIALS'
          ? 'Correo o contraseña incorrectos.'
          : code === 'BUSINESS_ACCOUNT_REQUIRED'
            ? 'Esta cuenta corresponde a un trabajador.'
            : 'No pudimos completar el acceso. Revisa los datos.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="business-auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand"><span>CN</span><strong>CUMPLE <i>NOW</i></strong></div>
        <div className="auth-promise">
          <p>Operación empresarial</p>
          <h1>Tu equipo temporal, bajo control.</h1>
          <span>Planifica turnos, coordina talento y supervisa pagos con información centralizada.</span>
        </div>
        <div className="auth-benefits">
          <div><CheckCircle2 size={17} /><span><strong>Cobertura visible</strong><small>Detecta necesidades antes del inicio.</small></span></div>
          <div><ShieldCheck size={17} /><span><strong>Acceso protegido</strong><small>Cada empresa administra únicamente sus datos.</small></span></div>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-card">
          <span className="auth-form-icon"><BriefcaseBusiness size={22} /></span>
          <p className="eyebrow">Panel para empresas</p>
          <h2>Inicia sesión</h2>
          <p>Los accesos empresariales son habilitados directamente por el equipo de Cumple Now.</p>
          <form onSubmit={submit}>
            <label className="field"><span>Correo empresarial</span><input name="email" required type="email" placeholder="operaciones@empresa.pe" /></label>
            <label className="field"><span>Contraseña</span><input name="password" required type="password" minLength={8} placeholder="Mínimo 8 caracteres" /></label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="primary-button auth-submit" disabled={loading} type="submit">
              {loading ? 'Procesando…' : 'Ingresar al panel'} <ArrowRight size={17} />
            </button>
          </form>
          <p className="auth-help">¿Tu empresa necesita acceso? Contáctanos para revisar y habilitar la cuenta.</p>
        </div>
      </section>
    </main>
  );
}
