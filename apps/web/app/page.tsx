'use client';

import type { FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BadgeCheck, Banknote, Bell, Bolt,
  BriefcaseBusiness, CalendarCheck2, CalendarDays, Check, CheckCheck, CheckCircle2,
  ChevronDown, CircleDollarSign, Clock3, Download, FileText, Filter, LayoutDashboard,
  Building2, LogOut, Mail, MapPin, Menu, MessageSquareText, MoreHorizontal, Paperclip, Pencil, Plus, ReceiptText,
  Search, Send, ShieldCheck, Sparkles, Star, TrendingUp, UserCheck, UserPlus, Users,
  Trash2, WalletCards, X,
} from 'lucide-react';

import {
  ApiError,
  authApi,
  businessApi,
  businessSessionKey,
  type BusinessSession,
  type CompanyRecord,
  type ConversationRecord,
  type PaymentRecord,
  type ShiftRecord,
  type WorkerRecord,
} from '../lib/business-api';
import { BusinessAuth } from '../components/business-auth';
import { CrudModal } from '../components/crud-modal';

type ViewName = 'Resumen' | 'Turnos' | 'Trabajadores' | 'Mensajes' | 'Pagos';
type Coverage = 'Completo' | 'Falta 1' | 'En selección';
type Shift = { id: string; role: string; date: string; schedule: string; location: string; confirmed: number; required: number; pay: number; coverage: Coverage; startsAt: string; endsAt: string; status: ShiftRecord['status']; rescueActive: boolean; notes?: string | null };
type Worker = { id: string; initials: string; name: string; role: string; match: number; score: number; available: string; status: 'Disponible' | 'En turno' | 'No disponible'; jobs: number; skills: string[]; email?: string | null; phone?: string | null; verified?: boolean };
type Conversation = { id: string; workerId: string; shiftId?: string | null; initials: string; name: string; role: string; preview: string; time: string; unread: number; online: boolean; subject: string; status: 'OPEN' | 'ARCHIVED' };
type ChatMessage = { id: string; sender: 'company' | 'worker'; text: string; time: string };
type Transaction = { id: string; description: string; date: string; workers: number; amount: number; status: 'Procesado' | 'Pendiente' | 'Programado' | 'Cancelado'; rawStatus: PaymentRecord['status']; reference: string; dueAt: string | null };
type ModalKind = 'worker' | 'payment' | 'conversation' | 'company' | null;

const navigation: { label: ViewName; icon: typeof LayoutDashboard; badge?: string }[] = [
  { label: 'Resumen', icon: LayoutDashboard }, { label: 'Turnos', icon: CalendarDays, badge: '8' },
  { label: 'Trabajadores', icon: Users }, { label: 'Mensajes', icon: MessageSquareText, badge: '3' },
  { label: 'Pagos', icon: CircleDollarSign },
];

const initialShifts: Shift[] = [];
const initialWorkers: Worker[] = [];
const initialConversations: Conversation[] = [];
const initialMessages: Record<string, ChatMessage[]> = {};
const initialTransactions: Transaction[] = [];

const activity = [
  { icon: UserCheck, title: 'Ana confirmó el turno', detail: 'Mozo de salón · hace 8 min', tone: 'teal' },
  { icon: MessageSquareText, title: 'Nuevo mensaje de Carlos', detail: 'Consulta sobre uniforme · hace 24 min', tone: 'navy' },
  { icon: ReceiptText, title: 'Pago de turno liberado', detail: 'S/ 360 · hace 1 h', tone: 'gold' },
];

function coverageClass(coverage: Coverage) {
  if (coverage === 'Completo') return 'complete';
  if (coverage === 'Falta 1') return 'urgent';
  return '';
}

const dateTimeFormat = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' });

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'CN'; }
function mapShift(record: ShiftRecord): Shift {
  const coverage: Coverage = record.confirmedWorkers >= record.requiredWorkers ? 'Completo' : record.requiredWorkers - record.confirmedWorkers === 1 ? 'Falta 1' : 'En selección';
  return { id: record.id, role: record.title, date: dateTimeFormat.format(new Date(record.startsAt)), schedule: `${timeFormat.format(new Date(record.startsAt))} – ${timeFormat.format(new Date(record.endsAt))}`, location: record.location, confirmed: record.confirmedWorkers, required: record.requiredWorkers, pay: record.payCents / 100, coverage, startsAt: record.startsAt, endsAt: record.endsAt, status: record.status, rescueActive: record.rescueActive, notes: record.notes };
}
function mapWorker(record: WorkerRecord): Worker {
  const status = record.status === 'AVAILABLE' ? 'Disponible' : record.status === 'ON_SHIFT' ? 'En turno' : 'No disponible';
  return { id: record.id, initials: initials(record.name), name: record.name, role: record.role, match: record.matchScore, score: record.cumpleScore, available: record.availability ?? status, status, jobs: record.completedJobs, skills: record.skills, email: record.email, phone: record.phone, verified: record.verified };
}
function mapConversation(record: ConversationRecord): Conversation {
  const last = record.messages.at(-1);
  return { id: record.id, workerId: record.workerId, shiftId: record.shiftId, initials: initials(record.worker.name), name: record.worker.name, role: record.worker.role, preview: last?.body ?? 'Conversación sin mensajes', time: timeFormat.format(new Date(record.updatedAt)), unread: record.messages.filter((message) => message.sender === 'WORKER' && !message.readAt).length, online: record.worker.status === 'AVAILABLE', subject: record.subject, status: record.status };
}
function mapMessages(record: ConversationRecord): ChatMessage[] { return record.messages.map((message) => ({ id: message.id, sender: message.sender === 'BUSINESS' ? 'company' : 'worker', text: message.body, time: timeFormat.format(new Date(message.createdAt)) })); }
function mapPayment(record: PaymentRecord): Transaction {
  const labels = { PENDING: 'Pendiente', SCHEDULED: 'Programado', PROCESSED: 'Procesado', CANCELLED: 'Cancelado' } as const;
  return { id: record.id, reference: record.reference, description: record.description, date: dateFormat.format(new Date(record.dueAt ?? record.createdAt)), workers: record.workerCount, amount: record.amountCents / 100, status: labels[record.status], rawStatus: record.status, dueAt: record.dueAt?.slice(0, 10) ?? null };
}

export default function HomePage() {
  const [authChecking, setAuthChecking] = useState(true);
  const [session, setSession] = useState<BusinessSession | null>(null);
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [activeNav, setActiveNav] = useState<ViewName>('Resumen');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [shiftFilter, setShiftFilter] = useState<'Todos' | 'Por cubrir' | 'Completos'>('Todos');
  const [period, setPeriod] = useState('Esta semana');
  const [rescueActive, setRescueActive] = useState(false);
  const [shifts, setShifts] = useState(initialShifts);
  const [shiftSearch, setShiftSearch] = useState('');
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [workerRecords, setWorkerRecords] = useState(initialWorkers);
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerFilter, setWorkerFilter] = useState<'Todos' | 'Disponibles' | 'En turno'>('Todos');
  const [conversationRecords, setConversationRecords] = useState(initialConversations);
  const [selectedConversation, setSelectedConversation] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [chatMessages, setChatMessages] = useState(initialMessages);
  const [paymentRecords, setPaymentRecords] = useState(initialTransactions);
  const [paymentFilter, setPaymentFilter] = useState<'Todos' | 'Procesados' | 'Pendientes'>('Todos');
  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(businessSessionKey);
    if (!stored) { setAuthChecking(false); return; }
    try {
      const saved = JSON.parse(stored) as BusinessSession;
      authApi.restore(saved.token).then((restored) => {
        if (restored.role !== 'BUSINESS') throw new ApiError(403, 'BUSINESS_ACCOUNT_REQUIRED');
        setSession(restored);
        window.localStorage.setItem(businessSessionKey, JSON.stringify(restored));
      }).catch(() => window.localStorage.removeItem(businessSessionKey)).finally(() => setAuthChecking(false));
    } catch {
      window.localStorage.removeItem(businessSessionKey);
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => { if (session) void loadData(session.token); }, [session]);

  async function loadData(token: string) {
    setDataLoading(true);
    try {
      const [companyData, shiftData, workerData, conversationList, paymentData] = await Promise.all([
        businessApi.company.get(token), businessApi.shifts.list(token), businessApi.workers.list(token), businessApi.conversations.list(token), businessApi.payments.list(token),
      ]);
      const fullConversations = await Promise.all(conversationList.map((conversation) => businessApi.conversations.get(token, conversation.id)));
      const nextShifts = shiftData.map(mapShift);
      const nextConversations = fullConversations.map(mapConversation);
      setCompany(companyData); setShifts(nextShifts); setWorkerRecords(workerData.map(mapWorker)); setConversationRecords(nextConversations); setPaymentRecords(paymentData.map(mapPayment));
      setChatMessages(Object.fromEntries(fullConversations.map((conversation) => [conversation.id, mapMessages(conversation)])));
      setSelectedShiftId((current) => nextShifts.some((shift) => shift.id === current) ? current : (nextShifts[0]?.id ?? ''));
      setSelectedConversation((current) => nextConversations.some((conversation) => conversation.id === current) ? current : (nextConversations[0]?.id ?? ''));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await logout();
      else showToast('No se pudieron cargar los datos. Intenta nuevamente.');
    } finally { setDataLoading(false); }
  }

  const filteredShifts = useMemo(() => shifts.filter((shift) => {
    const matchesStatus = shiftFilter === 'Todos' || (shiftFilter === 'Por cubrir' ? shift.coverage !== 'Completo' : shift.coverage === 'Completo');
    const query = shiftSearch.trim().toLowerCase();
    return matchesStatus && (!query || `${shift.role} ${shift.location} ${shift.date}`.toLowerCase().includes(query));
  }), [shiftFilter, shiftSearch, shifts]);
  const filteredWorkers = useMemo(() => workerRecords.filter((worker) => {
    const matchesStatus = workerFilter === 'Todos' || (workerFilter === 'Disponibles' ? worker.status === 'Disponible' : worker.status === 'En turno');
    const query = workerSearch.trim().toLowerCase();
    return matchesStatus && (!query || `${worker.name} ${worker.role} ${worker.skills.join(' ')}`.toLowerCase().includes(query));
  }), [workerFilter, workerRecords, workerSearch]);
  const filteredConversations = conversationRecords.filter((item) => `${item.name} ${item.role}`.toLowerCase().includes(messageSearch.trim().toLowerCase()));
  const selectedConversationData = conversationRecords.find((item) => item.id === selectedConversation) ?? conversationRecords[0];
  const selectedShift = shifts.find((shift) => shift.id === selectedShiftId) ?? shifts[0];
  const filteredTransactions = paymentRecords.filter((item) => paymentFilter === 'Todos' || (paymentFilter === 'Procesados' ? item.status === 'Procesado' : item.status !== 'Procesado'));
  const modalRecord: Record<string, unknown> | null = modalKind === 'worker'
    ? (() => { const worker = workerRecords.find((item) => item.id === editingId); return worker ? { ...worker, rawStatus: worker.status === 'Disponible' ? 'AVAILABLE' : worker.status === 'En turno' ? 'ON_SHIFT' : 'UNAVAILABLE' } : null; })()
    : modalKind === 'payment' ? (paymentRecords.find((item) => item.id === editingId) as unknown as Record<string, unknown> | undefined) ?? null
    : modalKind === 'conversation' ? (conversationRecords.find((item) => item.id === editingId) as unknown as Record<string, unknown> | undefined) ?? null
    : null;

  function navigate(label: ViewName) { setActiveNav(label); setMobileMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function showToast(message: string) { setToast(message); window.setTimeout(() => setToast(null), 3200); }
  function authenticated(nextSession: BusinessSession) { window.localStorage.setItem(businessSessionKey, JSON.stringify(nextSession)); setSession(nextSession); }
  async function logout() { const token = session?.token; setSession(null); setCompany(null); setShifts([]); setWorkerRecords([]); setConversationRecords([]); setPaymentRecords([]); window.localStorage.removeItem(businessSessionKey); if (token) await authApi.logout(token).catch(() => undefined); }
  async function publishShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const data = new FormData(event.currentTarget);
    const input = { title: String(data.get('role')), location: String(data.get('location')), startsAt: new Date(String(data.get('startsAt'))).toISOString(), endsAt: new Date(String(data.get('endsAt'))).toISOString(), requiredWorkers: Number(data.get('required') || 1), confirmedWorkers: Number(data.get('confirmed') || 0), payCents: Math.round(Number(data.get('pay') || 0) * 100), notes: String(data.get('notes') || '') || null };
    setSaving(true);
    try {
      const saved = editingShift ? await businessApi.shifts.update(session.token, editingShift.id, input) : await businessApi.shifts.create(session.token, input);
      const mapped = mapShift(saved); setShifts((current) => editingShift ? current.map((shift) => shift.id === mapped.id ? mapped : shift) : [mapped, ...current]); setSelectedShiftId(mapped.id); setEditingShift(null); setPublishOpen(false); setShiftFilter('Todos'); navigate('Turnos'); showToast(editingShift ? 'Turno actualizado correctamente.' : 'Turno publicado. Ya puedes asignar talento.');
    } catch { showToast('No pudimos guardar el turno. Revisa las fechas y datos.'); } finally { setSaving(false); }
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session || !selectedConversation) return; const form = event.currentTarget; const text = String(new FormData(form).get('message') || '').trim(); if (!text) return;
    try { const saved = await businessApi.conversations.createMessage(session.token, selectedConversation, text); const mapped = { id: saved.id, sender: 'company' as const, text: saved.body, time: 'Ahora' }; setChatMessages((current) => ({ ...current, [selectedConversation]: [...(current[selectedConversation] ?? []), mapped] })); setConversationRecords((current) => current.map((item) => item.id === selectedConversation ? { ...item, preview: text, time: 'Ahora' } : item)); form.reset(); } catch { showToast('No se pudo enviar el mensaje.'); }
  }

  async function removeShift() { if (!session || !selectedShift || !window.confirm(`¿Eliminar el turno ${selectedShift.role}?`)) return; try { await businessApi.shifts.remove(session.token, selectedShift.id); const next = shifts.filter((item) => item.id !== selectedShift.id); setShifts(next); setSelectedShiftId(next[0]?.id ?? ''); showToast('Turno eliminado.'); } catch { showToast('No se pudo eliminar el turno.'); } }
  async function toggleRescue() { if (!session || !selectedShift) return; try { const saved = await businessApi.shifts.update(session.token, selectedShift.id, { rescueActive: true }); const mapped = mapShift(saved); setShifts((current) => current.map((item) => item.id === mapped.id ? mapped : item)); setRescueActive(true); showToast('CUMPLE Rescate activado.'); } catch { showToast('No se pudo activar el rescate.'); } }
  function openCrud(kind: Exclude<ModalKind, null>, id: string | null = null) { setEditingId(id); setModalKind(kind); }
  async function saveCrud(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session || !modalKind) return; const data = new FormData(event.currentTarget); setSaving(true);
    try {
      if (modalKind === 'company') { const saved = await businessApi.company.update(session.token, { name: String(data.get('name')), legalName: String(data.get('legalName')) || null, industry: String(data.get('industry')) || null, phone: String(data.get('phone')) || null, address: String(data.get('address')) || null, district: String(data.get('district')) || null }); setCompany(saved); }
      if (modalKind === 'worker') { const input = { name: String(data.get('name')), role: String(data.get('role')), email: String(data.get('email')) || null, phone: String(data.get('phone')) || null, skills: String(data.get('skills')).split(',').map((skill) => skill.trim()).filter(Boolean), availability: String(data.get('availability')) || null, status: String(data.get('status')) }; const saved = editingId ? await businessApi.workers.update(session.token, editingId, input) : await businessApi.workers.create(session.token, input); const mapped = mapWorker(saved); setWorkerRecords((current) => editingId ? current.map((item) => item.id === mapped.id ? mapped : item) : [...current, mapped]); }
      if (modalKind === 'payment') { const input = { reference: String(data.get('reference')), description: String(data.get('description')), amountCents: Math.round(Number(data.get('amount')) * 100), workerCount: Number(data.get('workerCount') || 0), status: String(data.get('status')), dueAt: data.get('dueAt') ? new Date(String(data.get('dueAt'))).toISOString() : null }; const saved = editingId ? await businessApi.payments.update(session.token, editingId, input) : await businessApi.payments.create(session.token, input); const mapped = mapPayment(saved); setPaymentRecords((current) => editingId ? current.map((item) => item.id === mapped.id ? mapped : item) : [mapped, ...current]); }
      if (modalKind === 'conversation') { const input = editingId ? { subject: String(data.get('subject')), status: String(data.get('status')) } : { subject: String(data.get('subject')), workerId: String(data.get('workerId')), shiftId: String(data.get('shiftId')) || null }; const saved = editingId ? await businessApi.conversations.update(session.token, editingId, input) : await businessApi.conversations.create(session.token, input); const full = await businessApi.conversations.get(session.token, saved.id); const mapped = mapConversation(full); setConversationRecords((current) => editingId ? current.map((item) => item.id === mapped.id ? mapped : item) : [mapped, ...current]); setChatMessages((current) => ({ ...current, [mapped.id]: mapMessages(full) })); setSelectedConversation(mapped.id); }
      setModalKind(null); setEditingId(null); showToast('Cambios guardados correctamente.');
    } catch (error) { showToast(error instanceof ApiError && error.code === 'DUPLICATE_RECORD' ? 'Ya existe un registro con esos datos.' : 'No se pudieron guardar los cambios.'); } finally { setSaving(false); }
  }
  async function removeWorker(id: string) { if (!session || !window.confirm('¿Eliminar este trabajador y sus conversaciones?')) return; try { await businessApi.workers.remove(session.token, id); setWorkerRecords((current) => current.filter((item) => item.id !== id)); setConversationRecords((current) => current.filter((item) => item.workerId !== id)); showToast('Trabajador eliminado.'); } catch { showToast('No se pudo eliminar el trabajador.'); } }
  async function removePayment(id: string) { if (!session || !window.confirm('¿Eliminar este movimiento?')) return; try { await businessApi.payments.remove(session.token, id); setPaymentRecords((current) => current.filter((item) => item.id !== id)); showToast('Movimiento eliminado.'); } catch { showToast('No se pudo eliminar el movimiento.'); } }
  async function removeConversation() { if (!session || !selectedConversation || !window.confirm('¿Eliminar esta conversación y sus mensajes?')) return; try { await businessApi.conversations.remove(session.token, selectedConversation); const next = conversationRecords.filter((item) => item.id !== selectedConversation); setConversationRecords(next); setSelectedConversation(next[0]?.id ?? ''); showToast('Conversación eliminada.'); } catch { showToast('No se pudo eliminar la conversación.'); } }

  if (authChecking) return <div className="app-loading"><span className="brand-mark">CN</span><p>Preparando tu panel…</p></div>;
  if (!session) return <BusinessAuth onAuthenticated={authenticated} />;

  return (
    <div className="app-shell">
      {mobileMenu && <button className="page-scrim" aria-label="Cerrar menú" onClick={() => setMobileMenu(false)} />}
      <aside className={`sidebar${mobileMenu ? ' open' : ''}`} aria-label="Navegación principal">
        <div className="brand"><div className="brand-mark">CN</div><div><div className="brand-name">CUMPLE <span>NOW</span></div><div className="brand-caption">Panel para empresas</div></div><button className="sidebar-close" aria-label="Cerrar menú" onClick={() => setMobileMenu(false)}><X size={19} /></button></div>
        <div className="nav-label">Operaciones</div>
        <nav className="nav">{navigation.map(({ label, icon: Icon, badge }) => <button className={`nav-item${activeNav === label ? ' active' : ''}`} aria-current={activeNav === label ? 'page' : undefined} key={label} type="button" onClick={() => navigate(label)}><Icon size={18} /><span>{label}</span>{badge && <span className="nav-badge">{badge}</span>}</button>)}</nav>
        <div className="sidebar-spacer" /><div className="support-card"><Sparkles size={17} /><div><strong>¿Necesitas ayuda?</strong><span>Habla con soporte</span></div><ArrowUpRight size={15} /></div>
        <button className="company-card" type="button" onClick={() => openCrud('company')}><span className="company-logo">{initials(company?.name ?? session.name)}</span><span className="company-copy"><strong>{company?.name ?? session.name}</strong><span>Empresa verificada</span></span><Pencil size={15} color="#718096" /></button>
        <button className="logout-button" type="button" onClick={() => void logout()}><LogOut size={15} /> Cerrar sesión</button>
      </aside>

      <main className="main">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" type="button" aria-label="Abrir menú" onClick={() => setMobileMenu(true)}><Menu size={20} /></button><div className="breadcrumb">Empresa / <strong>{activeNav}</strong>{dataLoading && <span className="sync-status">Sincronizando…</span>}</div></div><div className="topbar-actions"><label className="period-control"><span>Periodo</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option>Esta semana</option><option>Este mes</option><option>Últimos 30 días</option></select></label><button className="icon-button" type="button" aria-label="Ver notificaciones" onClick={() => setNotificationsOpen(true)}><Bell size={18} /><span className="notification-dot" /></button><button className="secondary-button" type="button" onClick={() => navigate('Trabajadores')}><Users size={17} /> Equipo</button><button className="primary-button" type="button" onClick={() => { setEditingShift(null); setPublishOpen(true); }}><Plus size={18} /><span>Publicar turno</span></button></div></header>

        {activeNav === 'Resumen' && <Overview companyName={company?.name ?? session.name} shifts={shifts} workers={workerRecords} payments={paymentRecords} period={period} rescueActive={rescueActive} onRescue={() => { if (shifts[0]) { setSelectedShiftId(shifts[0].id); void toggleRescue(); } else showToast('Publica un turno antes de activar el rescate.'); }} onNavigate={navigate} onShift={(id) => { setSelectedShiftId(id); navigate('Turnos'); }} onToast={showToast} />}

        {activeNav === 'Turnos' && <div className="workspace view-workspace">
          <ViewHeader eyebrow="Planificación operativa" title="Turnos" description="Publica, cubre y supervisa tus necesidades de personal desde un solo lugar."><button className="secondary-button" type="button" onClick={() => showToast('Calendario sincronizado con los turnos actuales.')}><CalendarCheck2 size={17} /> Calendario</button><button className="primary-button" type="button" onClick={() => { setEditingShift(null); setPublishOpen(true); }}><Plus size={17} /> Nuevo turno</button></ViewHeader>
          <section className="view-stat-grid"><MiniStat label="Publicados" value={String(shifts.length)} detail={`${shifts.filter((shift) => shift.status === 'PUBLISHED').length} activos`} icon={CalendarDays} /><MiniStat label="Por cubrir" value={String(shifts.filter((shift) => shift.coverage !== 'Completo').length)} detail="Requieren atención" icon={AlertTriangle} warning /><MiniStat label="Confirmaciones" value={`${shifts.reduce((sum, shift) => sum + shift.confirmed, 0)}/${shifts.reduce((sum, shift) => sum + shift.required, 0)}`} detail="Cobertura acumulada" icon={UserCheck} /><MiniStat label="Costo estimado" value={`S/ ${shifts.reduce((sum, shift) => sum + shift.pay * shift.required, 0).toLocaleString('es-PE')}`} detail="Personal requerido" icon={CircleDollarSign} /></section>
          <section className="management-grid"><article className="panel management-list"><div className="management-toolbar"><label className="search-control"><Search size={16} /><input aria-label="Buscar turnos" placeholder="Buscar por rol, sede o fecha" value={shiftSearch} onChange={(event) => setShiftSearch(event.target.value)} /></label><div className="filter-tabs">{(['Todos', 'Por cubrir', 'Completos'] as const).map((filter) => <button className={shiftFilter === filter ? 'active' : ''} key={filter} type="button" onClick={() => setShiftFilter(filter)}>{filter}</button>)}</div><button className="compact-button" type="button" onClick={() => showToast('Filtros ordenados por fecha más próxima.')}><Filter size={15} /> Más filtros</button></div><div className="managed-shifts">{filteredShifts.map((shift) => <ManagedShift key={shift.id} shift={shift} selected={selectedShift?.id === shift.id} onSelect={() => setSelectedShiftId(shift.id)} />)}{filteredShifts.length === 0 && <div className="empty-state"><Search size={24} /><strong>No encontramos turnos</strong><span>Ajusta la búsqueda o cambia el filtro.</span></div>}</div></article>
            {selectedShift && <aside className="panel detail-panel"><div className="detail-top"><span className={`coverage-badge ${coverageClass(selectedShift.coverage)}`}>{selectedShift.coverage}</span><span className="inline-actions"><button className="row-action" type="button" aria-label="Editar turno" onClick={() => { setEditingShift(selectedShift); setPublishOpen(true); }}><Pencil size={16} /></button><button className="row-action danger" type="button" aria-label="Eliminar turno" onClick={() => void removeShift()}><Trash2 size={16} /></button></span></div><div className="detail-icon"><BriefcaseBusiness size={22} /></div><p className="eyebrow">Detalle del turno</p><h2>{selectedShift.role}</h2><div className="detail-facts"><span><CalendarDays size={16} /><i><small>Fecha</small><strong>{selectedShift.date}</strong></i></span><span><Clock3 size={16} /><i><small>Horario</small><strong>{selectedShift.schedule}</strong></i></span><span><MapPin size={16} /><i><small>Sede</small><strong>{selectedShift.location}</strong></i></span></div><div className="detail-progress"><div><span>Cobertura</span><strong>{selectedShift.confirmed} de {selectedShift.required}</strong></div><div className="progress-track"><div style={{ width: `${Math.round(selectedShift.confirmed / selectedShift.required * 100)}%` }} /></div></div><div className="detail-cost"><span>Inversión estimada</span><strong>S/ {selectedShift.pay * selectedShift.required}</strong><small>S/ {selectedShift.pay} por persona</small></div><button className="primary-button full-action" type="button" disabled={selectedShift.rescueActive} onClick={() => void toggleRescue()}><Bolt size={17} /> {selectedShift.rescueActive ? 'Rescate activado' : selectedShift.coverage === 'Completo' ? 'Ver equipo asignado' : 'Acelerar cobertura'}</button><button className="secondary-button full-action" type="button" onClick={() => { setEditingShift(selectedShift); setPublishOpen(true); }}><FileText size={16} /> Editar información</button></aside>}
          </section>
        </div>}

        {activeNav === 'Trabajadores' && <div className="workspace view-workspace">
          <ViewHeader eyebrow="Red de talento" title="Trabajadores" description="Encuentra perfiles verificados, revisa su desempeño y forma tu equipo frecuente."><button className="secondary-button" type="button" onClick={() => showToast('Invitación privada lista para compartir.')}><Mail size={17} /> Invitar por enlace</button><button className="primary-button" type="button" onClick={() => openCrud('worker')}><UserPlus size={17} /> Agregar trabajador</button></ViewHeader>
          <section className="talent-summary"><article className="talent-highlight"><span className="talent-highlight-icon"><BadgeCheck size={23} /></span><div><p>Equipo frecuente</p><strong>{workerRecords.length} trabajadores</strong><small>{workerRecords.filter((worker) => worker.verified).length} perfiles verificados</small></div><div className="talent-avatars">{workerRecords.slice(0, 4).map((worker) => <i key={worker.id}>{worker.initials}</i>)}</div></article><MiniStat label="Disponibles hoy" value={String(workerRecords.filter((worker) => worker.status === 'Disponible').length)} detail="Listos para asignar" icon={UserCheck} /><MiniStat label="Índice promedio" value={workerRecords.length ? String(Math.round(workerRecords.reduce((sum, worker) => sum + worker.score, 0) / workerRecords.length)) : '—'} detail="Índice CUMPLE" icon={Star} /></section>
          <section className="panel directory-panel"><div className="directory-header"><div><h2>Directorio de talento</h2><p>Perfiles sugeridos según tu historial y necesidades activas.</p></div><span className="ai-chip"><Sparkles size={12} /> Ordenado por compatibilidad</span></div><div className="management-toolbar"><label className="search-control"><Search size={16} /><input aria-label="Buscar trabajadores" placeholder="Buscar por nombre, rol o habilidad" value={workerSearch} onChange={(event) => setWorkerSearch(event.target.value)} /></label><div className="filter-tabs">{(['Todos', 'Disponibles', 'En turno'] as const).map((filter) => <button className={workerFilter === filter ? 'active' : ''} key={filter} type="button" onClick={() => setWorkerFilter(filter)}>{filter}</button>)}</div><button className="compact-button" type="button" onClick={() => showToast('Filtros de habilidades disponibles.')}><Filter size={15} /> Habilidades</button></div>
            <div className="worker-directory">{filteredWorkers.map((worker) => <WorkerDirectoryCard key={worker.id} worker={worker} onMessage={() => { const conversation = conversationRecords.find((item) => item.workerId === worker.id); if (conversation) { setSelectedConversation(conversation.id); navigate('Mensajes'); } else { openCrud('conversation'); } }} onEdit={() => openCrud('worker', worker.id)} onDelete={() => void removeWorker(worker.id)} />)}{filteredWorkers.length === 0 && <div className="empty-state directory-empty"><Search size={24} /><strong>No hay perfiles con estos criterios</strong><span>Agrega un trabajador o cambia los filtros.</span></div>}</div>
          </section>
        </div>}

        {activeNav === 'Mensajes' && <div className="workspace view-workspace messages-workspace">
          <ViewHeader eyebrow="Comunicación centralizada" title="Mensajes" description="Coordina ingresos, indicaciones y cambios sin salir del panel."><button className="secondary-button" type="button" onClick={() => showToast('Los mensajes se marcan al abrir cada conversación.')}><CheckCheck size={17} /> Estado de lectura</button><button className="primary-button" type="button" disabled={!workerRecords.length} onClick={() => openCrud('conversation')}><Plus size={17} /> Nueva conversación</button></ViewHeader>
          <section className="messages-shell"><aside className="conversation-panel"><div className="conversation-header"><div><h2>Conversaciones</h2><span>{conversationRecords.reduce((sum, item) => sum + item.unread, 0)} sin leer</span></div><label className="search-control"><Search size={15} /><input aria-label="Buscar conversaciones" placeholder="Buscar conversación" value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} /></label></div><div className="conversation-list">{filteredConversations.map((conversation) => <button className={`conversation-item${selectedConversation === conversation.id ? ' active' : ''}`} type="button" key={conversation.id} onClick={() => setSelectedConversation(conversation.id)}><span className="conversation-avatar">{conversation.initials}{conversation.online && <i />}</span><span className="conversation-copy"><span><strong>{conversation.name}</strong><time>{conversation.time}</time></span><small>{conversation.role}</small><p>{conversation.preview}</p></span>{conversation.unread > 0 && <b>{conversation.unread}</b>}</button>)}{filteredConversations.length === 0 && <div className="empty-state"><Search size={23} /><strong>Sin conversaciones</strong><span>Agrega talento e inicia una conversación.</span></div>}</div></aside>
            {selectedConversationData ? <article className="chat-panel"><header className="chat-header"><div className="conversation-avatar large">{selectedConversationData.initials}{selectedConversationData.online && <i />}</div><div><h2>{selectedConversationData.name}</h2><p>{selectedConversationData.subject}</p></div><span className="inline-actions"><button className="row-action" type="button" aria-label="Editar conversación" onClick={() => openCrud('conversation', selectedConversationData.id)}><Pencil size={16} /></button><button className="row-action danger" type="button" aria-label="Eliminar conversación" onClick={() => void removeConversation()}><Trash2 size={16} /></button></span></header><div className="shift-context"><CalendarCheck2 size={17} /><span><small>Conversación sobre</small><strong>{selectedConversationData.subject}</strong></span>{selectedConversationData.shiftId && <button type="button" onClick={() => { setSelectedShiftId(selectedConversationData.shiftId ?? ''); navigate('Turnos'); }}>Ver turno</button>}</div><div className="chat-thread"><div className="day-divider"><span>Mensajes</span></div>{(chatMessages[selectedConversation] ?? []).map((message) => <div className={`message-bubble ${message.sender}`} key={message.id}><p>{message.text}</p><small>{message.time}{message.sender === 'company' && <CheckCheck size={12} />}</small></div>)}{!(chatMessages[selectedConversation] ?? []).length && <div className="empty-state"><MessageSquareText size={23} /><strong>Inicia la coordinación</strong><span>Envía la primera indicación.</span></div>}</div><form className="message-composer" onSubmit={sendMessage}><button type="button" aria-label="Adjuntar archivo" onClick={() => showToast('La carga de archivos se habilitará con almacenamiento de documentos.')}><Paperclip size={18} /></button><input name="message" autoComplete="off" aria-label="Escribir mensaje" placeholder="Escribe una indicación para el trabajador…" /><button className="send-button" type="submit" aria-label="Enviar mensaje"><Send size={17} /></button></form></article> : <article className="chat-panel chat-empty"><MessageSquareText size={34} /><h2>Selecciona una conversación</h2><p>O crea una nueva para coordinar con tu equipo.</p></article>}
          </section>
        </div>}

        {activeNav === 'Pagos' && <div className="workspace view-workspace">
          <ViewHeader eyebrow="Control financiero" title="Pagos" description="Supervisa fondos, validaciones y desembolsos de todos tus turnos."><button className="secondary-button" type="button" onClick={() => showToast('El reporte refleja los movimientos persistidos.')}><Download size={17} /> Exportar</button><button className="primary-button" type="button" onClick={() => openCrud('payment')}><Plus size={17} /> Registrar movimiento</button></ViewHeader>
          <section className="finance-overview"><article className="balance-card"><div className="balance-head"><span>Total registrado</span><ShieldCheck size={18} /></div><strong>S/ {paymentRecords.reduce((sum, item) => sum + item.amount, 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</strong><p>Movimientos asociados a las operaciones de tu empresa.</p><div><span><small>Comprometido</small><b>S/ {paymentRecords.filter((item) => item.rawStatus !== 'PROCESSED').reduce((sum, item) => sum + item.amount, 0).toLocaleString('es-PE')}</b></span><span><small>Procesado</small><b>S/ {paymentRecords.filter((item) => item.rawStatus === 'PROCESSED').reduce((sum, item) => sum + item.amount, 0).toLocaleString('es-PE')}</b></span></div></article><MiniStat label="Pagado" value={`S/ ${paymentRecords.filter((item) => item.rawStatus === 'PROCESSED').reduce((sum, item) => sum + item.amount, 0).toLocaleString('es-PE')}`} detail="Movimientos procesados" icon={TrendingUp} /><MiniStat label="Por validar" value={`S/ ${paymentRecords.filter((item) => item.rawStatus === 'PENDING').reduce((sum, item) => sum + item.amount, 0).toLocaleString('es-PE')}`} detail={`${paymentRecords.filter((item) => item.rawStatus === 'PENDING').length} movimientos pendientes`} icon={Clock3} warning /><MiniStat label="Programado" value={String(paymentRecords.filter((item) => item.rawStatus === 'SCHEDULED').length)} detail="Próximos desembolsos" icon={ReceiptText} /></section>
          <section className="payment-content-grid"><article className="panel transaction-panel"><div className="directory-header"><div><h2>Movimientos</h2><p>Pagos y desembolsos asociados a tus operaciones.</p></div><button className="compact-button" type="button" onClick={() => showToast('Comprobante consolidado listo.')}><FileText size={15} /> Comprobantes</button></div><div className="management-toolbar payment-toolbar"><div className="filter-tabs">{(['Todos', 'Procesados', 'Pendientes'] as const).map((filter) => <button className={paymentFilter === filter ? 'active' : ''} key={filter} type="button" onClick={() => setPaymentFilter(filter)}>{filter}</button>)}</div><button className="compact-button" type="button"><Filter size={15} /> Fecha</button></div><div className="transaction-table"><div className="transaction-head"><span>Movimiento</span><span>Trabajadores</span><span>Estado</span><span>Monto</span><span /></div>{filteredTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onEdit={() => openCrud('payment', transaction.id)} onDelete={() => void removePayment(transaction.id)} />)}{filteredTransactions.length === 0 && <div className="empty-state"><WalletCards size={24} /><strong>No hay movimientos</strong><span>Registra el primer movimiento financiero.</span></div>}</div></article>
            <aside className="payment-side"><article className="panel payout-card"><div className="payout-icon"><Banknote size={21} /></div><span>Próximo desembolso</span><strong>S/ 1,840.00</strong><small>Viernes, 28 de agosto</small><div className="payout-step"><span><Check size={13} /></span><div><strong>12 turnos validados</strong><small>Faltan 4 por validar</small></div></div><div className="payment-progress"><i /></div><button className="full-secondary" type="button" onClick={() => showToast('Revisando los 4 turnos pendientes.')}><CheckCircle2 size={16} /> Validar turnos</button></article><article className="panel billing-card"><div><WalletCards size={18} /><span><strong>Método de pago</strong><small>Visa empresarial ···· 4821</small></span></div><button type="button" onClick={() => showToast('Método de pago verificado.')}><ArrowUpRight size={15} /></button></article></aside>
          </section>
        </div>}
      </main>

      {publishOpen && <PublishModal shift={editingShift} saving={saving} onClose={() => { setPublishOpen(false); setEditingShift(null); }} onSubmit={publishShift} />}
      {modalKind && <CrudModal kind={modalKind} company={company} record={modalRecord} workers={workerRecords.map((worker) => ({ id: worker.id, label: `${worker.name} · ${worker.role}` }))} shifts={shifts.map((shift) => ({ id: shift.id, label: `${shift.role} · ${shift.date}` }))} saving={saving} onClose={() => { setModalKind(null); setEditingId(null); }} onSubmit={saveCrud} />}
      {notificationsOpen && <><button className="drawer-scrim" aria-label="Cerrar notificaciones" onClick={() => setNotificationsOpen(false)} /><aside className="notification-drawer" aria-label="Notificaciones"><div className="drawer-header"><div><p className="eyebrow">Centro de alertas</p><h2>Notificaciones</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={() => setNotificationsOpen(false)}><X size={18} /></button></div><div className="notice important"><span><Bolt size={18} /></span><div><strong>Turno con cobertura incompleta</strong><p>Falta una persona para el turno de mozo de salón de las 18:00.</p><button type="button" onClick={() => { setNotificationsOpen(false); setRescueActive(true); navigate('Turnos'); showToast('Rescate activado desde notificaciones.'); }}>Gestionar cobertura</button></div></div><div className="notice"><span><UserCheck size={18} /></span><div><strong>Nueva confirmación</strong><p>Ana Mendoza confirmó asistencia para hoy.</p><small>Hace 8 minutos</small></div></div><div className="notice"><span><Send size={18} /></span><div><strong>3 mensajes sin leer</strong><p>Tu equipo necesita indicaciones para el ingreso.</p><button type="button" onClick={() => { setNotificationsOpen(false); navigate('Mensajes'); }}>Revisar mensajes</button></div></div></aside></>}
      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle2 size={18} /><span>{toast}</span><button aria-label="Cerrar aviso" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  );
}

function Overview({ companyName, shifts, workers, payments, period, rescueActive, onRescue, onNavigate, onShift, onToast }: { companyName: string; shifts: Shift[]; workers: Worker[]; payments: Transaction[]; period: string; rescueActive: boolean; onRescue: () => void; onNavigate: (view: ViewName) => void; onShift: (id: string) => void; onToast: (message: string) => void }) {
  const priority = shifts.find((shift) => shift.coverage !== 'Completo') ?? shifts[0];
  const required = shifts.reduce((sum, shift) => sum + shift.required, 0);
  const confirmed = shifts.reduce((sum, shift) => sum + shift.confirmed, 0);
  const pending = payments.filter((payment) => payment.rawStatus !== 'PROCESSED').reduce((sum, payment) => sum + payment.amount, 0);
  return <div className="workspace"><section className="welcome-row"><div><p className="eyebrow">Centro de operaciones</p><h1>Buenos días, {companyName}</h1><p className="welcome-copy">Gestiona la cobertura, el talento y los movimientos de tu empresa.</p></div><div className="date-chip"><CalendarDays size={15} /> {dateFormat.format(new Date())}</div></section>
    <section className="metric-grid"><MetricCard label="Turnos activos" value={String(shifts.filter((shift) => shift.status !== 'CANCELLED' && shift.status !== 'COMPLETED').length)} trend={`${shifts.length} registrados`} icon={CalendarDays} /><MetricCard label="Cobertura promedio" value={required ? `${Math.round(confirmed / required * 100)}%` : '—'} trend={`${confirmed}/${required}`} icon={ShieldCheck} /><MetricCard label="Talento registrado" value={String(workers.length)} trend={`${workers.filter((worker) => worker.status === 'Disponible').length} disponibles`} icon={Users} /><MetricCard label="Pago pendiente" value={`S/ ${pending.toLocaleString('es-PE')}`} trend={period} icon={CircleDollarSign} gold /></section>
    <section className="priority-grid"><article className="panel"><div className="panel-heading"><div><h2>Turno prioritario</h2><p>Monitorea la cobertura antes de iniciar la operación.</p></div>{priority && <span className={priority.rescueActive ? 'status-pill resolved' : 'status-pill'}>{priority.rescueActive ? 'Rescate activo' : priority.coverage}</span>}</div>{priority ? <button className="shift-feature overview-shift" type="button" onClick={() => onShift(priority.id)}><div><div className="shift-title-row"><span className="urgent-dot" /><h3>{priority.role}</h3></div><div className="shift-meta"><span><Clock3 size={14} /> {priority.schedule}</span><span><MapPin size={14} /> {priority.location}</span></div><div className="coverage"><div className="coverage-copy"><span>Cobertura confirmada</span><strong>{priority.confirmed} de {priority.required}</strong></div><div className="progress-track"><div style={{ width: `${priority.required ? Math.round(priority.confirmed / priority.required * 100) : 0}%` }} /></div></div></div><div className="shift-pay"><span>Pago por persona</span><strong>S/ {priority.pay}</strong><small>{priority.date}</small></div></button> : <div className="empty-state"><CalendarDays size={24} /><strong>Aún no hay turnos</strong><span>Publica el primero desde la vista de Turnos.</span></div>}</article><article className={`panel rescue-panel${rescueActive ? ' active' : ''}`}><div className="rescue-icon">{rescueActive ? <CheckCircle2 size={21} /> : <Bolt size={21} fill="currentColor" />}</div><h2>{rescueActive ? 'Rescate en curso' : 'CUMPLE Rescate'}</h2><p>Prioriza perfiles disponibles, cercanos y con alto índice CUMPLE cuando un turno queda descubierto.</p><button className="primary-button" type="button" disabled={rescueActive || !priority} onClick={onRescue}><BriefcaseBusiness size={17} /> {rescueActive ? 'Búsqueda activada' : 'Activar rescate'}</button></article></section>
    <section className="operations-grid"><article className="panel shifts-panel"><div className="panel-heading table-heading"><div><h2>Próximos turnos</h2><p>Información persistida de tu operación.</p></div><button className="text-button" type="button" onClick={() => onNavigate('Turnos')}>Gestionar turnos <ArrowUpRight size={14} /></button></div><div className="shift-table">{shifts.slice(0, 4).map((shift) => <ShiftRow key={shift.id} shift={shift} onSelect={() => onShift(shift.id)} />)}{!shifts.length && <div className="empty-state"><CalendarDays size={24} /><strong>Sin turnos registrados</strong><span>Crea un turno para iniciar.</span></div>}</div></article><aside className="panel talent-panel"><div className="panel-heading"><div><h2>Talento disponible</h2><p>Personas registradas en tu directorio.</p></div><span className="ai-chip"><Sparkles size={12} /> Índice CUMPLE</span></div><div className="worker-list">{workers.slice(0, 3).map((worker) => <WorkerCompact key={worker.id} worker={worker} onInvite={() => onToast(`Invitación enviada a ${worker.name}.`)} />)}{!workers.length && <div className="empty-state"><Users size={24} /><strong>Sin talento registrado</strong><span>Agrega trabajadores a tu directorio.</span></div>}</div><button className="full-secondary" type="button" onClick={() => onNavigate('Trabajadores')}><Users size={16} /> Gestionar trabajadores</button></aside></section>
    <section className="bottom-grid"><article className="panel"><div className="panel-heading"><div><h2>Control de pagos</h2><p>Resumen del periodo: {period.toLowerCase()}.</p></div><span className="safe-chip"><ShieldCheck size={13} /> Datos persistentes</span></div><div className="payments-layout"><div className="payment-total"><span>Total registrado</span><strong>S/ {payments.reduce((sum, payment) => sum + payment.amount, 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</strong><small>{payments.length} movimientos</small><div className="payment-progress"><i /></div><p><Check size={13} /> {payments.filter((payment) => payment.rawStatus === 'PROCESSED').length} procesados</p></div><div className="payment-stats"><div><span><WalletCards size={16} /> Procesado</span><strong>S/ {payments.filter((payment) => payment.rawStatus === 'PROCESSED').reduce((sum, payment) => sum + payment.amount, 0).toLocaleString('es-PE')}</strong></div><div><span><TrendingUp size={16} /> Pendiente</span><strong>S/ {pending.toLocaleString('es-PE')}</strong></div><button type="button" onClick={() => onNavigate('Pagos')}>Revisar detalle <ArrowUpRight size={14} /></button></div></div></article><article className="panel"><div className="panel-heading"><div><h2>Actividad reciente</h2><p>Accesos rápidos para tu equipo.</p></div><button className="row-action" type="button" aria-label="Ver mensajes" onClick={() => onNavigate('Mensajes')}><MoreHorizontal size={18} /></button></div><div className="activity-list">{activity.map(({ icon: Icon, title, detail, tone }) => <div className="activity-item" key={title}><span className={`activity-icon ${tone}`}><Icon size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span></div>)}</div></article></section>
  </div>;
}

function ViewHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) { return <section className="view-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><div className="view-header-actions">{children}</div></section>; }
function MetricCard({ label, value, trend, icon: Icon, gold = false }: { label: string; value: string; trend: string; icon: typeof CalendarDays; gold?: boolean }) { return <article className="metric-card"><div className="metric-top"><div className={`metric-icon${gold ? ' gold' : ''}`}><Icon size={19} /></div><span className="trend">{trend}</span></div><div className="metric-value">{value}</div><div className="metric-label">{label}</div></article>; }
function MiniStat({ label, value, detail, icon: Icon, warning = false }: { label: string; value: string; detail: string; icon: typeof CalendarDays; warning?: boolean }) { return <article className="mini-stat"><div className={`mini-stat-icon${warning ? ' warning' : ''}`}><Icon size={19} /></div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>; }

function ShiftRow({ shift, onSelect }: { shift: Shift; onSelect: () => void }) { return <button className="shift-row" role="row" type="button" onClick={onSelect}><span className="shift-role"><span className="role-icon"><BriefcaseBusiness size={17} /></span><span><strong>{shift.role}</strong><small>{shift.location} · {shift.schedule}</small></span></span><span className="staffing"><span className="avatar-stack">{Array.from({ length: Math.min(shift.confirmed, 3) }).map((_, index) => <i key={index}>{['AM', 'CR', 'LV'][index]}</i>)}</span><span><strong>{shift.confirmed}/{shift.required}</strong><small>confirmados</small></span></span><span><span className={`coverage-badge ${coverageClass(shift.coverage)}`}>{shift.coverage}</span></span><span className="row-pay"><strong>S/ {shift.pay}</strong><small>por persona</small></span><span className="row-action"><MoreHorizontal size={18} /></span></button>; }
function ManagedShift({ shift, selected, onSelect }: { shift: Shift; selected: boolean; onSelect: () => void }) { return <button className={`managed-shift${selected ? ' selected' : ''}`} type="button" onClick={onSelect}><span className="managed-date"><strong>{shift.date.split(',')[0]}</strong><small>{shift.date.includes(',') ? shift.date.split(',')[1] : 'Nuevo'}</small></span><span className="managed-copy"><strong>{shift.role}</strong><small><Clock3 size={13} /> {shift.schedule}<i /><MapPin size={13} /> {shift.location}</small></span><span className="managed-coverage"><span className={`coverage-badge ${coverageClass(shift.coverage)}`}>{shift.coverage}</span><small>{shift.confirmed}/{shift.required} confirmados</small></span><span className="managed-pay"><strong>S/ {shift.pay}</strong><small>por persona</small></span></button>; }
function WorkerCompact({ worker, onInvite }: { worker: Worker; onInvite: () => void }) { return <button className="worker-card" type="button" onClick={onInvite}><span className="worker-avatar">{worker.initials}<i /></span><span className="worker-info"><strong>{worker.name}</strong><small>{worker.role}</small><em>{worker.available}</em></span><span className="worker-match"><strong>{worker.match}%</strong><small>match</small></span></button>; }

function WorkerDirectoryCard({ worker, onMessage, onEdit, onDelete }: { worker: Worker; onMessage: () => void; onEdit: () => void; onDelete: () => void }) { return <article className="directory-card"><div className="directory-top"><span className="directory-avatar">{worker.initials}<i className={worker.status === 'Disponible' ? '' : 'away'} /></span><span className="inline-actions"><button className="row-action" type="button" aria-label={`Editar ${worker.name}`} onClick={onEdit}><Pencil size={15} /></button><button className="row-action danger" type="button" aria-label={`Eliminar ${worker.name}`} onClick={onDelete}><Trash2 size={15} /></button></span></div><div className="directory-identity"><h3>{worker.name} {worker.verified && <BadgeCheck size={15} />}</h3><p>{worker.role}</p><span className={`availability ${worker.status === 'Disponible' ? '' : 'muted'}`}>{worker.available}</span></div><div className="skill-row">{worker.skills.map((skill) => <span key={skill}>{skill}</span>)}</div><div className="worker-performance"><span><small>Índice CUMPLE</small><strong><Star size={13} fill="currentColor" /> {worker.score}</strong></span><span><small>Turnos realizados</small><strong>{worker.jobs}</strong></span></div><div className="directory-actions"><button className="secondary-button" type="button" onClick={onMessage}><MessageSquareText size={16} /> Mensaje</button><button className="primary-button" type="button" onClick={onEdit}><Pencil size={16} /> Editar</button></div></article>; }

function TransactionRow({ transaction, onEdit, onDelete }: { transaction: Transaction; onEdit: () => void; onDelete: () => void }) { return <div className="transaction-row"><span className="transaction-name"><i className={transaction.status === 'Procesado' ? 'in' : ''}>{transaction.status === 'Procesado' ? <ArrowDownLeft size={16} /> : <Clock3 size={16} />}</i><span><strong>{transaction.description}</strong><small>{transaction.reference} · {transaction.date}</small></span></span><span>{transaction.workers}</span><span><b className={`payment-status ${transaction.status.toLowerCase()}`}>{transaction.status}</b></span><span className="transaction-amount">S/ {transaction.amount.toLocaleString('es-PE')}</span><span className="inline-actions"><button className="row-action" type="button" aria-label={`Editar ${transaction.reference}`} onClick={onEdit}><Pencil size={15} /></button><button className="row-action danger" type="button" aria-label={`Eliminar ${transaction.reference}`} onClick={onDelete}><Trash2 size={15} /></button></span></div>; }

function PublishModal({ shift, saving, onClose, onSubmit }: { shift: Shift | null; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const localDateTime = (value?: string) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; return <div className="modal-layer" role="presentation" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="publish-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">Gestión de turnos</p><h2 id="publish-title">{shift ? 'Editar turno' : 'Publicar un turno'}</h2><p>La información quedará disponible para toda la operación.</p></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button></div><form onSubmit={onSubmit}><label className="field full"><span>Rol requerido</span><input name="role" required defaultValue={shift?.role} placeholder="Ej. Mozo de salón" /></label><div className="form-grid"><label className="field"><span>Inicio</span><input name="startsAt" type="datetime-local" required defaultValue={localDateTime(shift?.startsAt)} /></label><label className="field"><span>Fin</span><input name="endsAt" type="datetime-local" required defaultValue={localDateTime(shift?.endsAt)} /></label><label className="field"><span>Sede o distrito</span><input name="location" required defaultValue={shift?.location} placeholder="Miraflores" /></label><label className="field"><span>Personas requeridas</span><input name="required" min="1" max="200" type="number" defaultValue={shift?.required ?? 1} /></label><label className="field"><span>Confirmadas</span><input name="confirmed" min="0" max="200" type="number" defaultValue={shift?.confirmed ?? 0} /></label><label className="field"><span>Pago por persona</span><div className="money-input"><span>S/</span><input name="pay" min="1" step="0.01" type="number" defaultValue={shift?.pay ?? 100} /></div></label><label className="field full"><span>Notas operativas</span><input name="notes" defaultValue={shift?.notes ?? ''} placeholder="Uniforme, ingreso y responsable" /></label></div><div className="form-note"><ShieldCheck size={17} /><span><strong>Registro persistente</strong> Los cambios se guardarán en PostgreSQL.</span></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving} type="submit"><Plus size={17} /> {saving ? 'Guardando…' : shift ? 'Guardar cambios' : 'Publicar turno'}</button></div></form></section></div>; }
