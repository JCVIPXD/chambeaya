'use client';

import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { BadgeCheck, KeyRound, MailCheck, Search, Send, Sparkles, Star, UserSearch } from 'lucide-react';

import { businessApi, type BusinessTalentInvitationRecord, type SpecialtyRecord, type TalentCardRecord } from '../../lib/business-api';
import { CostActionDialog, type CostActionSpec } from './cost-action';
import { describeError, type DescribedError } from './errors';
import { formatDate } from './format';
import { useJobs } from './jobs-context';
import { jobsApi, type ContactRecord } from './jobs-api';
import { PdfButton } from './pdf-button';
import { EmptyBlock, ErrorBlock, Field, LoadingBlock, Modal, StatusPill, ViewHeading } from './ui';
import { LIMITS } from './validation';
import { usePagedList } from './use-paged';
import { useResource } from './use-resource';

type Filters = { query: string; district: string; specialtyId: string; availableOnly: boolean };
const NO_FILTERS: Filters = { query: '', district: '', specialtyId: '', availableOnly: false };

const INVITATION_LABEL: Record<BusinessTalentInvitationRecord['status'], string> = {
  PENDING: 'Pendiente', ACCEPTED: 'Aceptada', DECLINED: 'Rechazada', EXPIRED: 'Vencida', CANCELLED: 'Cancelada',
};

export function TalentView() {
  const { token, currency, onUnauthorized, goTo, toast, refreshBalance } = useJobs();
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [inviting, setInviting] = useState<TalentCardRecord | null>(null);
  const [costSpec, setCostSpec] = useState<CostActionSpec | null>(null);
  const [contacts, setContacts] = useState<Record<string, ContactRecord>>({});
  const [contactErrors, setContactErrors] = useState<Record<string, DescribedError>>({});
  const [openingContact, setOpeningContact] = useState<string | null>(null);

  const specialties = useResource<SpecialtyRecord[]>(() => businessApi.talent.specialties(token), 'specialties', { onUnauthorized, currency });
  const unlocks = useResource(() => jobsApi.talent.unlocks(token), 'unlocks', { onUnauthorized, currency });
  const invitations = useResource(() => businessApi.talent.invitations.list(token), 'invitations', { onUnauthorized, currency });
  const list = usePagedList<TalentCardRecord>(
    async (cursor) => businessApi.talent.search(token, { specialtyId: filters.specialtyId || undefined, district: filters.district || undefined, query: filters.query || undefined, availableOnly: filters.availableOnly, cursor: cursor ?? undefined }),
    JSON.stringify(filters),
    { onUnauthorized, currency },
  );

  const unlocked = useMemo(() => new Set((unlocks.data?.items ?? []).map((item) => item.workerTalentProfileId)), [unlocks.data]);
  const invited = useMemo(() => new Map((invitations.data ?? []).filter((item) => item.status === 'PENDING' || item.status === 'ACCEPTED').map((item) => [item.workerTalentProfileId, item.status])), [invitations.data]);

  function search(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft, query: draft.query.trim(), district: draft.district.trim() });
  }

  function inviteSpec(card: TalentCardRecord, message: string): CostActionSpec {
    return {
      title: `Invitar a ${card.name}`,
      summary: 'La persona recibe tu invitación y decide si responde. Si no responde a tiempo, te devolvemos el costo.',
      actionKey: 'TALENT_INVITE',
      confirmLabel: 'Invitar',
      execute: async () => {
        await businessApi.talent.invitations.create(token, { workerTalentProfileId: card.id, ...(message.trim() ? { message: message.trim() } : {}) });
        return `Invitación enviada a ${card.name}.`;
      },
    };
  }

  function unlockSpec(card: TalentCardRecord): CostActionSpec {
    return {
      title: `Desbloquear el contacto de ${card.name}`,
      summary: 'Podrás ver su correo y su CV. Se paga una sola vez por candidato; si ya lo desbloqueaste no se cobra de nuevo.',
      actionKey: 'CANDIDATE_CONTACT_UNLOCK',
      targetId: card.id,
      confirmLabel: 'Desbloquear',
      execute: async () => {
        const result = await jobsApi.talent.unlock(token, card.id);
        setContacts((current) => ({ ...current, [card.id]: { unlocked: true, contact: result.contact, hasCv: result.hasCv } }));
        return result.idempotent
          ? `El contacto de ${card.name} ya estaba desbloqueado.`
          : result.viaApplication ? `Contacto de ${card.name} disponible (ya postuló a tu empresa, sin costo).` : `Contacto de ${card.name} desbloqueado.`;
      },
    };
  }

  async function showContact(card: TalentCardRecord) {
    if (contacts[card.id]) {
      setContacts((current) => {
        const next = { ...current };
        delete next[card.id];
        return next;
      });
      return;
    }
    setOpeningContact(card.id);
    setContactErrors((current) => { const next = { ...current }; delete next[card.id]; return next; });
    try {
      const contact = await jobsApi.talent.contact(token, card.id);
      setContacts((current) => ({ ...current, [card.id]: contact }));
    } catch (error) {
      const described = describeError(error, currency);
      if (described.kind === 'session') onUnauthorized();
      else setContactErrors((current) => ({ ...current, [card.id]: described }));
    } finally {
      setOpeningContact(null);
    }
  }

  return (
    <div className="workspace view-workspace fx-view">
      <ViewHeading eyebrow="Talento" title="Buscar talento" description="Encuentra candidatos, invítalos a postular y desbloquea su contacto y CV cuando lo necesites." />

      <form className="panel fx-panel fx-search" onSubmit={search} role="search" aria-label="Buscar talento">
        <div className="fx-grid">
          <Field label="Nombre, titular o distrito">
            {(props) => <input {...props} value={draft.query} maxLength={100} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="Ej.: cajera, barista…" />}
          </Field>
          <Field label="Distrito exacto">
            {(props) => <input {...props} value={draft.district} onChange={(event) => setDraft({ ...draft, district: event.target.value })} placeholder="Miraflores" />}
          </Field>
          <Field label="Especialidad">
            {(props) => (
              <select {...props} value={draft.specialtyId} onChange={(event) => setDraft({ ...draft, specialtyId: event.target.value })}>
                <option value="">Todas</option>
                {(specialties.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            )}
          </Field>
          <label className="fx-check">
            <input type="checkbox" checked={draft.availableOnly} onChange={(event) => setDraft({ ...draft, availableOnly: event.target.checked })} />
            <span>Solo candidatos disponibles</span>
          </label>
        </div>
        {specialties.error && <p className="fx-muted" role="status">No pudimos cargar las especialidades; puedes buscar sin ese filtro.</p>}
        <div className="fx-inline-actions">
          <button className="secondary-button" type="button" onClick={() => { setDraft(NO_FILTERS); setFilters(NO_FILTERS); }}>Limpiar</button>
          <button className="primary-button" type="submit"><Search size={16} aria-hidden="true" /> Buscar</button>
        </div>
      </form>

      <section className="panel fx-panel" aria-busy={list.loading} aria-label="Resultados de la búsqueda">
        {list.loading && <LoadingBlock label="Buscando talento…" />}
        {!list.loading && list.error && <ErrorBlock error={list.error} onRetry={() => void list.reload()} title="No pudimos buscar talento" />}
        {!list.loading && !list.error && list.items.length === 0 && (
          <EmptyBlock icon={<UserSearch size={26} aria-hidden="true" />} title="No encontramos candidatos con esos filtros">
            Prueba con menos filtros o con otra palabra.
          </EmptyBlock>
        )}
        {!list.loading && !list.error && list.items.length > 0 && (
          <ul className="fx-list">
            {list.items.map((card) => {
              const isUnlocked = unlocked.has(card.id) || Boolean(contacts[card.id]);
              const invitation = invited.get(card.id);
              const contact = contacts[card.id];
              const contactError = contactErrors[card.id];
              return (
                <li className="fx-row fx-row-talent" key={card.id}>
                  <div className="fx-row-main">
                    <div className="fx-row-title">
                      <h3>{card.name}</h3>
                      {card.isHighlighted && <span className="fx-pill fx-pill-gold"><Sparkles size={12} aria-hidden="true" /> Perfil destacado</span>}
                      <span className={`fx-pill ${card.isAvailable ? 'fx-pill-ok' : 'fx-pill-muted'}`}>{card.isAvailable ? 'Disponible' : 'No disponible'}</span>
                    </div>
                    <p className="fx-meta">
                      <span>{[card.headline, card.district].filter(Boolean).join(' · ') || 'Perfil sin titular'}</span>
                      {card.availabilityText && <span>{card.availabilityText}</span>}
                    </p>
                    <p className="fx-meta">
                      <span>Perfil {card.completion}% completo</span>
                      {card.reputation.reviewCount > 0 && card.reputation.averageRating !== null && <span><Star size={13} aria-hidden="true" /> {card.reputation.averageRating.toFixed(1)} ({card.reputation.reviewCount})</span>}
                    </p>
                    {card.specialties.length > 0 && <p className="fx-tags">{card.specialties.map((item) => <span className="fx-tag" key={item.id}>{item.name}</span>)}</p>}
                    {contactError && <p className="fx-field-error" role="alert">{contactError.message}</p>}
                    {contact && (
                      <div className="fx-contact" role="group" aria-label={`Contacto de ${card.name}`}>
                        <strong><MailCheck size={15} aria-hidden="true" /> Contacto desbloqueado</strong>
                        <p>{contact.contact.name} · <a href={`mailto:${contact.contact.email}`}>{contact.contact.email}</a></p>
                        {contact.hasCv ? (
                          <PdfButton label="Ver CV" downloadName={`CV de ${card.name}.pdf`} fetchBlob={(signal) => jobsApi.talent.cv(token, card.id, signal)} onUnauthorized={onUnauthorized} note="PDF subido por el candidato, solo lectura." />
                        ) : <small className="fx-muted">Este candidato no subió un CV.</small>}
                      </div>
                    )}
                  </div>
                  <div className="fx-row-actions">
                    {invitation ? (
                      <span className="fx-pill fx-pill-info"><BadgeCheck size={12} aria-hidden="true" /> Invitación {INVITATION_LABEL[invitation].toLowerCase()}</span>
                    ) : (
                      <button className="secondary-button fx-small-button" type="button" aria-label={`Invitar a ${card.name}`} onClick={() => setInviting(card)}>
                        <Send size={15} aria-hidden="true" /> Invitar
                      </button>
                    )}
                    {isUnlocked ? (
                      <button className="secondary-button fx-small-button" type="button" aria-label={`${contact ? 'Ocultar' : 'Ver'} el contacto de ${card.name}`} aria-expanded={Boolean(contact)} disabled={openingContact === card.id} onClick={() => void showContact(card)}>
                        <KeyRound size={15} aria-hidden="true" /> {openingContact === card.id ? 'Abriendo…' : contact ? 'Ocultar contacto' : 'Ver contacto'}
                      </button>
                    ) : (
                      <button className="secondary-button fx-small-button" type="button" aria-label={`Desbloquear el contacto de ${card.name}`} onClick={() => setCostSpec(unlockSpec(card))}>
                        <KeyRound size={15} aria-hidden="true" /> Desbloquear contacto
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {list.hasMore && !list.loading && (
          <div className="fx-more">
            <button className="secondary-button" type="button" disabled={list.loadingMore} onClick={() => void list.loadMore()}>{list.loadingMore ? 'Cargando…' : 'Ver más perfiles'}</button>
            {list.loadMoreError && <small className="fx-field-error" role="alert">{list.loadMoreError.message}</small>}
          </div>
        )}
      </section>

      <section className="panel fx-panel" aria-label="Invitaciones enviadas">
        <h2 className="fx-h2">Invitaciones enviadas</h2>
        {invitations.loading && <LoadingBlock label="Cargando invitaciones…" />}
        {!invitations.loading && invitations.error && <ErrorBlock error={invitations.error} onRetry={() => void invitations.reload()} title="No pudimos cargar tus invitaciones" />}
        {!invitations.loading && !invitations.error && (invitations.data?.length ?? 0) === 0 && <EmptyBlock title="Aún no enviaste invitaciones">Invita a un candidato desde los resultados.</EmptyBlock>}
        {(invitations.data?.length ?? 0) > 0 && (
          <ul className="fx-list fx-list-compact">
            {invitations.data!.map((item) => (
              <li className="fx-row" key={item.id}>
                <div className="fx-row-main">
                  <div className="fx-row-title"><h3>{item.workerName}</h3><StatusPill status={item.status === 'ACCEPTED' ? 'ACCEPTED' : item.status === 'PENDING' ? 'OFFER' : 'CLOSED'} label={INVITATION_LABEL[item.status]} /></div>
                  <p className="fx-meta"><span>Enviada el {formatDate(item.createdAt)}</span><span>Vence el {formatDate(item.expiresAt)}</span></p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {inviting && (
        <InviteMessageDialog
          card={inviting}
          onClose={() => setInviting(null)}
          onContinue={(message) => {
            const card = inviting;
            setInviting(null);
            setCostSpec(inviteSpec(card, message));
          }}
        />
      )}
      {costSpec && (
        <CostActionDialog
          spec={costSpec}
          token={token}
          currency={currency}
          onClose={() => setCostSpec(null)}
          onFailed={() => { void invitations.reload({ silent: true }); void unlocks.reload({ silent: true }); }}
          onUnauthorized={onUnauthorized}
          onOpenWallet={() => { setCostSpec(null); goTo('Billetera'); }}
          onDone={(message) => {
            setCostSpec(null);
            if (message) toast(message);
            void invitations.reload({ silent: true });
            void unlocks.reload({ silent: true });
            void refreshBalance();
          }}
        />
      )}
    </div>
  );
}

function InviteMessageDialog({ card, onContinue, onClose }: { card: TalentCardRecord; onContinue: (message: string) => void; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const tooLong = message.trim().length > LIMITS.inviteMessage.max;
  return (
    <Modal title={`Invitar a ${card.name}`} description="Puedes añadir un mensaje. Antes de enviar te mostramos el costo, si lo hay." onClose={onClose} size="sm">
      <form className="fx-form" onSubmit={(event) => { event.preventDefault(); if (!tooLong) onContinue(message); }} noValidate>
        <Field label="Mensaje (opcional)" error={tooLong ? `Máximo ${LIMITS.inviteMessage.max} caracteres.` : undefined} hint={`${message.trim().length} / ${LIMITS.inviteMessage.max}`}>
          {(props) => <textarea {...props} rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Hola, nos gustaría que postules a nuestro puesto…" />}
        </Field>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={tooLong}><Send size={16} aria-hidden="true" /> Continuar</button>
        </div>
      </form>
    </Modal>
  );
}
