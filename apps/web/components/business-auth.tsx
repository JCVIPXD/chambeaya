'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { ArrowRight, BriefcaseBusiness, CheckCircle2, ShieldCheck } from 'lucide-react';

import { ApiError, authApi, type BusinessSession } from '../lib/business-api';

export function BusinessAuth({ onAuthenticated }: { onAuthenticated: (session: BusinessSession) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const session = mode === 'login'
        ? await authApi.login(String(data.get('email')), String(data.get('password')))
        : await authApi.register({ name: String(data.get('name')), email: String(data.get('email')), password: String(data.get('password')), dniOrRuc: String(data.get('ruc')) });
      if (session.role !== 'BUSINESS') throw new ApiError(403, 'BUSINESS_ACCOUNT_REQUIRED');
      onAuthenticated(session);
    } catch (reason) {
      const code = reason instanceof ApiError ? reason.code : 'REQUEST_FAILED';
      setError(code === 'INVALID_CREDENTIALS' ? 'Correo o contraseña incorrectos.' : code === 'DUPLICATE_ACCOUNT' ? 'Ya existe una cuenta con ese correo o RUC.' : code === 'BUSINESS_ACCOUNT_REQUIRED' ? 'Esta cuenta corresponde a un trabajador.' : 'No pudimos completar el acceso. Revisa los datos.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="business-auth-page"><section className="auth-brand-panel"><div className="auth-brand"><span>CN</span><strong>CUMPLE <i>NOW</i></strong></div><div className="auth-promise"><p>Operación empresarial</p><h1>Tu equipo temporal, bajo control.</h1><span>Planifica turnos, coordina talento y supervisa pagos con información centralizada.</span></div><div className="auth-benefits"><div><CheckCircle2 size={17} /><span><strong>Cobertura visible</strong><small>Detecta necesidades antes del inicio.</small></span></div><div><ShieldCheck size={17} /><span><strong>Acceso protegido</strong><small>Cada empresa administra únicamente sus datos.</small></span></div></div></section><section className="auth-form-panel"><div className="auth-form-card"><span className="auth-form-icon"><BriefcaseBusiness size={22} /></span><p className="eyebrow">Panel para empresas</p><h2>{mode === 'login' ? 'Inicia sesión' : 'Crea tu cuenta empresarial'}</h2><p>{mode === 'login' ? 'Continúa gestionando tu operación.' : 'Configura el espacio de trabajo de tu empresa.'}</p><form onSubmit={submit}>{mode === 'register' && <><label className="field"><span>Nombre comercial</span><input name="name" required placeholder="Restaurante La Mar" /></label><label className="field"><span>RUC</span><input name="ruc" required inputMode="numeric" pattern="[0-9]{11}" placeholder="20123456789" /></label></>}<label className="field"><span>Correo empresarial</span><input name="email" required type="email" placeholder="operaciones@empresa.pe" /></label><label className="field"><span>Contraseña</span><input name="password" required type="password" minLength={8} placeholder="Mínimo 8 caracteres" /></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="primary-button auth-submit" disabled={loading} type="submit">{loading ? 'Procesando…' : mode === 'login' ? 'Ingresar al panel' : 'Crear empresa'} <ArrowRight size={17} /></button></form><button className="auth-switch" type="button" onClick={() => { setMode((current) => current === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? '¿Primera vez? Crear cuenta empresarial' : 'Ya tengo una cuenta empresarial'}</button></div></section></main>;
}
