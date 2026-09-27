'use client';

import type { FormEvent } from 'react';
import { Building2, MessageSquareText, Save, UserPlus, X } from 'lucide-react';

import type { CompanyRecord } from '../lib/business-api';

type Option = { id: string; label: string };

// Alcance D: `payment` se retiró de este modal (y del CRUD manual de
// pagos que lo usaba) — la empresa ya no puede inventar pagos ni alterar
// montos. "Marcar como pagado" es una confirmación aparte (ver
// `markPaymentProcessed` en `app/page.tsx`), no un formulario.
export function CrudModal({ kind, company, record, workers, shifts, saving, onClose, onSubmit }: {
  kind: 'worker' | 'conversation' | 'company';
  company: CompanyRecord | null;
  record?: Record<string, unknown> | null;
  workers: Option[];
  shifts: Option[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const titles = { worker: record ? 'Editar trabajador' : 'Agregar trabajador', conversation: record ? 'Editar conversación' : 'Nueva conversación', company: 'Perfil empresarial' };
  const icons = { worker: UserPlus, conversation: MessageSquareText, company: Building2 };
  const Icon = icons[kind];
  return <div className="modal-layer" role="presentation" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="crud-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="crud-modal-icon"><Icon size={20} /></span><p className="eyebrow">Gestión empresarial</p><h2 id="crud-title">{titles[kind]}</h2><p>Los cambios se guardarán en la base de datos de tu empresa.</p></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button></div><form onSubmit={onSubmit}>
    {kind === 'company' && <div className="form-grid"><label className="field"><span>Nombre comercial</span><input name="name" required defaultValue={company?.name} /></label><label className="field"><span>Razón social</span><input name="legalName" defaultValue={company?.legalName ?? ''} /></label><label className="field"><span>Industria</span><input name="industry" defaultValue={company?.industry ?? ''} placeholder="Gastronomía" /></label><label className="field"><span>Teléfono</span><input name="phone" defaultValue={company?.phone ?? ''} /></label><label className="field"><span>Dirección</span><input name="address" defaultValue={company?.address ?? ''} /></label><label className="field"><span>Distrito</span><input name="district" defaultValue={company?.district ?? ''} /></label></div>}
    {kind === 'worker' && <div className="form-grid"><label className="field"><span>Nombre completo</span><input name="name" required defaultValue={String(record?.name ?? '')} /></label><label className="field"><span>Rol principal</span><input name="role" required defaultValue={String(record?.role ?? '')} placeholder="Servicio y eventos" /></label><label className="field"><span>Correo</span><input name="email" type="email" defaultValue={String(record?.email ?? '')} /></label><label className="field"><span>Teléfono</span><input name="phone" defaultValue={String(record?.phone ?? '')} /></label><label className="field full"><span>Habilidades separadas por coma</span><input name="skills" defaultValue={Array.isArray(record?.skills) ? record.skills.join(', ') : ''} placeholder="Servicio, Eventos" /></label><label className="field"><span>Disponibilidad</span><input name="availability" defaultValue={String(record?.available ?? '')} /></label><label className="field"><span>Estado</span><select name="status" defaultValue={String(record?.rawStatus ?? 'AVAILABLE')}><option value="AVAILABLE">Disponible</option><option value="ON_SHIFT">En turno</option><option value="UNAVAILABLE">No disponible</option></select></label></div>}
    {kind === 'conversation' && <div className="form-grid"><label className="field full"><span>Asunto</span><input name="subject" required defaultValue={String(record?.subject ?? '')} placeholder="Indicaciones para el ingreso" /></label>{!record && <label className="field"><span>Trabajador</span><select name="workerId" required defaultValue=""><option value="" disabled>Seleccionar</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.label}</option>)}</select></label>}<label className="field"><span>Turno relacionado</span><select name="shiftId" defaultValue={String(record?.shiftId ?? '')}><option value="">Sin turno</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.label}</option>)}</select></label>{record && <label className="field"><span>Estado</span><select name="status" defaultValue={String(record.status ?? 'OPEN')}><option value="OPEN">Abierta</option><option value="ARCHIVED">Archivada</option></select></label>}</div>}
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving} type="submit"><Save size={17} /> {saving ? 'Guardando…' : 'Guardar cambios'}</button></div>
  </form></section></div>;
}
