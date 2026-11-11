'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Save, X } from 'lucide-react';

// Misma regla que valida la API (`isValidPassword` en
// `apps/api/src/modules/auth/auth.service.ts`): al menos 8 caracteres, una
// mayúscula y un número.
export function isValidPassword(password: string) {
  return password.length >= 8 && /\d/.test(password) && /[A-Z]/.test(password);
}

const WEAK_PASSWORD_HINT =
  'Debe tener al menos 8 caracteres, una mayúscula y un número.';

// Mapea los códigos estables que documenta `docs/reference/api.md` para
// `POST /api/auth/password/change`. Cualquier otro código (incluida una
// falla de red) cae en el mensaje genérico.
function errorMessage(code: string | null): string {
  switch (code) {
    case 'INVALID_CURRENT_PASSWORD':
      return 'La contraseña actual no es correcta.';
    case 'WEAK_PASSWORD':
      return `La nueva contraseña es demasiado débil. ${WEAK_PASSWORD_HINT}`;
    case 'PASSWORD_UNCHANGED':
      return 'La nueva contraseña debe ser distinta de la actual.';
    case 'GOOGLE_ONLY_ACCOUNT':
      return 'Esta cuenta todavía no tiene una contraseña propia: usa el flujo de primera contraseña (el que se ofrece tras iniciar sesión con Google) en vez de este formulario.';
    case 'INVALID_SESSION':
      return 'Tu sesión ya no es válida. Vuelve a iniciar sesión e inténtalo de nuevo.';
    default:
      return 'No pudimos cambiar tu contraseña. Revisa tu conexión e inténtalo nuevamente.';
  }
}

/**
 * Modal de "Cambiar contraseña", compartido por el panel de empresa
 * (`apps/web/app/page.tsx`) y el de superadmin (`apps/web/app/admin/page.tsx`).
 * `variant` solo cambia las clases del contenedor para calzar con el resto de
 * modales de cada panel (`modal-*` en empresa, `admin-modal*` en superadmin);
 * el formulario y la validación son idénticos.
 */
export function ChangePasswordModal({
  variant,
  onClose,
  onSubmit,
}: {
  variant: 'business' | 'admin';
  onClose: () => void;
  onSubmit: (input: {
    currentPassword: string;
    newPassword: string;
  }) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  // `onClose` cambia de referencia en cada render del padre (es una arrow
  // function inline en `page.tsx`/`admin/page.tsx`); guardarla en un ref
  // deja que el listener de Escape siempre llame a la versión vigente sin
  // que el efecto de abajo tenga que declararla como dependencia y
  // reinstalarse (y robarle el foco al campo) en cada tecla escrita.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Accesibilidad de teclado (corrección de CN-20260926-008, BAJO-1): al
  // abrir, el foco quedaba en el botón que abrió el modal y Escape no lo
  // cerraba. Efecto de una sola vez (monta/desmonta): mueve el foco al
  // primer campo, cierra con Escape y devuelve el foco a quien lo abrió.
  useEffect(() => {
    const trigger = document.activeElement;
    firstFieldRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (trigger instanceof HTMLElement) trigger.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al llegar a la pantalla de éxito, mueve el foco al único botón que
  // queda ("Listo") en vez de dejarlo perdido en el botón "Guardar cambios"
  // que ya no existe.
  useEffect(() => {
    if (success) doneButtonRef.current?.focus();
  }, [success]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    const confirmPassword = String(data.get('confirmPassword') ?? '');

    if (!isValidPassword(newPassword)) {
      setError(`La nueva contraseña es demasiado débil. ${WEAK_PASSWORD_HINT}`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('La nueva contraseña debe ser distinta de la actual.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({ currentPassword, newPassword });
      setSuccess(true);
    } catch (reason) {
      const code =
        reason && typeof reason === 'object' && 'code' in reason
          ? String((reason as { code: unknown }).code)
          : null;
      setError(errorMessage(code));
    } finally {
      setSaving(false);
    }
  }

  const isBusiness = variant === 'business';
  const backdropClass = isBusiness ? 'modal-layer' : 'admin-modal-backdrop';
  const cardClass = isBusiness ? 'modal-card' : 'admin-modal';
  const actionsClass = isBusiness ? 'modal-actions' : 'admin-modal-actions';
  const errorClass = isBusiness ? 'auth-error' : 'admin-error';

  return (
    <div
      className={backdropClass}
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className={cardClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {isBusiness ? (
          <div className="modal-header">
            <div>
              <span className="crud-modal-icon">
                <KeyRound size={20} />
              </span>
              <p className="eyebrow">Seguridad de la cuenta</p>
              <h2 id="change-password-title">Cambiar contraseña</h2>
              <p>
                Al guardar, se cerrarán todas tus demás sesiones activas.
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Cerrar"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <header>
            <div>
              <p className="eyebrow">Seguridad de la cuenta</p>
              <h2 id="change-password-title">Cambiar contraseña</h2>
            </div>
            <button
              type="button"
              className="admin-detail-close"
              aria-label="Cerrar"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </header>
        )}
        {success ? (
          <div>
            <p>
              Tu contraseña se actualizó correctamente. Se cerraron todas tus
              demás sesiones; esta sigue activa.
            </p>
            <div className={actionsClass}>
              <button
                ref={doneButtonRef}
                className="primary-button"
                type="button"
                onClick={onClose}
              >
                Listo
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className={isBusiness ? 'form-grid' : undefined}>
              <label className={isBusiness ? 'field full' : 'field'}>
                <span>Contraseña actual</span>
                <input
                  ref={firstFieldRef}
                  name="currentPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </label>
              <label className={isBusiness ? 'field full' : 'field'}>
                <span>Nueva contraseña</span>
                <input
                  name="newPassword"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Mayúscula, número y 8 caracteres"
                />
              </label>
              <label className={isBusiness ? 'field full' : 'field'}>
                <span>Confirmar nueva contraseña</span>
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {error && (
              <p className={errorClass} role="alert">
                {error}
              </p>
            )}
            <div className={actionsClass}>
              <button
                className="secondary-button"
                type="button"
                onClick={onClose}
              >
                Cancelar
              </button>
              <button className="primary-button" disabled={saving} type="submit">
                <Save size={17} /> {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
