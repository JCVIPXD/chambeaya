import type { Page, Route } from '@playwright/test';
import type {
  ApplicantSummary,
  ApplicationDetail,
  ApplicationStatus,
  MovementRecord,
  OfferRecord,
  PostingRecord,
  PostingStatus,
  Quote,
  RewardItem,
} from '../../features/jobs/jobs-api';
import type { TalentCardRecord } from '../../lib/business-api';
import { DAY_MS, isoFromNow } from './dates';

// API simulada (con estado) de puestos fijos, moneda virtual y talento para el panel de empresa (M5a).
// Se instala con `page.route`, que tiene prioridad sobre el `context.route` del fixture base: todo lo que no
// se define aquí cae al fixture base (y de ahí a «petición sin mock», que hace fallar la prueba).
// Reproduce las reglas de la API real que el panel usa: cuota gratuita, tope diario, 409 de moneda,
// máquina de estados del embudo, constancia de aceptación y el aviso SSE a la empresa.

export type Json = Record<string, unknown>;

type Stored = {
  detail: ApplicationDetail;
  postingId: string;
  workerIdentifier: string;
};

export type FixedJobsOptions = {
  currency?: string;
  balance?: number;
  freeQuota?: number;
  dailyCap?: number;
  postings?: PostingRecord[];
  talent?: TalentCardRecord[];
};

export type ScriptedFailure = { status: number; body: Json; headers?: Record<string, string>; times?: number };

export type FixedJobsServer = {
  calls: Array<{ method: string; path: string; body: unknown }>;
  state: { balance: number; spentToday: number; freeUsed: number; postings: PostingRecord[]; movements: MovementRecord[] };
  /** Hace fallar las próximas `times` peticiones que coincidan con `METHOD /ruta` (regex sobre el path). */
  failNext: (match: RegExp, failure: ScriptedFailure) => void;
  addPosting: (overrides?: Partial<PostingRecord>) => PostingRecord;
  addApplicant: (input: { postingId: string; name: string; status?: ApplicationStatus; priority?: boolean; hasCv?: boolean; answers?: Array<{ question: string; answer: string }> }) => string;
  /** El candidato acepta la oferta vigente (como si lo hiciera desde su app): deja la constancia y avisa en vivo. */
  workerAccepts: (applicationId: string) => void;
  /** Publica un aviso SSE a la conexión abierta del panel. */
  pushEvent: (event: { type: string; applicationId: string; postingId: string; status: ApplicationStatus }) => void;
  sseConnections: () => number;
  closePosting: (postingId: string) => void;
};

const CATALOG = [
  { actionKey: 'JOB_PUBLISH_EXTRA', kind: 'COST', amount: 10, freeMonthlyQuota: 3, refundWindowHours: null },
  { actionKey: 'JOB_HIGHLIGHT', kind: 'COST', amount: 10, freeMonthlyQuota: 0, refundWindowHours: null },
  { actionKey: 'TALENT_INVITE', kind: 'COST', amount: 5, freeMonthlyQuota: 0, refundWindowHours: 72 },
  { actionKey: 'CANDIDATE_CONTACT_UNLOCK', kind: 'COST', amount: 10, freeMonthlyQuota: 0, refundWindowHours: null },
] as const;

export function samplePosting(overrides: Partial<PostingRecord> = {}): PostingRecord {
  return {
    id: 'posting-1',
    title: 'Cajera de tienda',
    description: 'Atención al cliente, caja y reposición en tienda de ropa en Lima.',
    responsibilities: null,
    requirements: null,
    benefits: null,
    modality: 'ONSITE',
    workload: 'FULL_TIME',
    salary: { minCents: 150000, maxCents: 200000, currency: 'PEN' },
    location: 'Miraflores, Lima',
    contractType: 'INDEFINITE',
    expectedStartDate: null,
    vacancies: 2,
    filledVacancies: 0,
    screeningQuestions: [],
    status: 'DRAFT',
    publishedAt: null,
    closedAt: null,
    highlightedUntil: null,
    createdAt: isoFromNow(-3 * DAY_MS),
    updatedAt: isoFromNow(-3 * DAY_MS),
    applicationsCount: 0,
    ...overrides,
  };
}

export function sampleTalent(overrides: Partial<TalentCardRecord> = {}): TalentCardRecord {
  return {
    id: 'talent-1',
    isHighlighted: false,
    name: 'Bruno Vega',
    headline: 'Barista con experiencia',
    district: 'Miraflores',
    availabilityText: 'Disponible por las mañanas',
    isAvailable: true,
    specialties: [],
    completion: 80,
    reputation: { averageRating: null, reviewCount: 0 },
    ...overrides,
  };
}

export async function installFixedJobsApi(page: Page, options: FixedJobsOptions = {}): Promise<FixedJobsServer> {
  const currency = options.currency ?? 'Chambitas';
  const dailyCap = options.dailyCap ?? 200;
  const freeQuota = options.freeQuota ?? 3;
  const calls: FixedJobsServer['calls'] = [];
  const failures: Array<{ match: RegExp; failure: ScriptedFailure; left: number }> = [];
  const postings: PostingRecord[] = (options.postings ?? []).map((posting) => ({ ...posting }));
  const applications = new Map<string, Stored>();
  const movements: MovementRecord[] = [];
  const unlocked = new Set<string>();
  const invitations: Array<Json> = [];
  const talent = (options.talent ?? []).map((card) => ({ ...card }));
  const sse: Array<{ route: Route }> = [];
  let sseOpened = 0;
  let counter = 0;
  const state = { balance: options.balance ?? 50, spentToday: 0, freeUsed: 0, postings, movements };

  const id = (prefix: string) => `${prefix}-${(counter += 1)}`;
  const find = (postingId: string) => postings.find((item) => item.id === postingId);
  const countsOf = (postingId: string) => {
    const counts: Partial<Record<ApplicationStatus, number>> = {};
    for (const stored of applications.values()) if (stored.postingId === postingId) counts[stored.detail.status] = (counts[stored.detail.status] ?? 0) + 1;
    return counts;
  };
  const withCounts = (posting: PostingRecord, detail = false): PostingRecord => {
    const counts = countsOf(posting.id);
    return { ...posting, applicationsCount: Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0), ...(detail ? { applicantCounts: counts } : {}) };
  };

  function record(quantity: number, action: MovementRecord['action'], actionKey: string | null, reason: string | null = null) {
    state.balance += quantity;
    movements.unshift({
      id: id('mov'), sequence: movements.length + 1, quantity, balanceAfter: state.balance, action, actionKey, reason,
      relatedEntity: null, refundOfId: null, actor: null, createdAt: new Date().toISOString(),
    });
  }

  function quote(actionKey: string, targetId?: string | null): Quote {
    let cost = CATALOG.find((item) => item.actionKey === actionKey)?.amount ?? 0;
    let reason: Quote['reason'] = 'CHARGE';
    let quota: Quote['freeQuota'] = null;
    if (actionKey === 'JOB_PUBLISH_EXTRA') {
      const remaining = Math.max(0, freeQuota - state.freeUsed);
      quota = { monthlyLimit: freeQuota, used: state.freeUsed, remaining, periodStart: isoFromNow(-10 * DAY_MS), periodEnd: isoFromNow(20 * DAY_MS) };
      const posting = targetId ? find(targetId) : undefined;
      if (posting?.publishedAt) { cost = 0; reason = 'ALREADY_REGISTERED'; } else if (remaining > 0) { cost = 0; reason = 'FREE_QUOTA'; }
    }
    if (actionKey === 'JOB_HIGHLIGHT' && targetId) {
      const posting = find(targetId);
      if (posting?.highlightedUntil && new Date(posting.highlightedUntil).getTime() > Date.now()) { cost = 0; reason = 'ALREADY_REGISTERED'; }
    }
    if (actionKey === 'CANDIDATE_CONTACT_UNLOCK' && targetId && unlocked.has(targetId)) { cost = 0; reason = 'ALREADY_REGISTERED'; }
    const sufficientBalance = state.balance >= cost;
    const withinDailyCap = cost === 0 || state.spentToday + cost <= dailyCap;
    return {
      currency, actionKey, actor: 'COMPANY', active: true, cost, catalogAmount: CATALOG.find((item) => item.actionKey === actionKey)?.amount ?? 0, reason,
      freeQuota: quota, balance: state.balance, sufficientBalance,
      dailyCap: { limit: dailyCap, spentToday: state.spentToday, remaining: Math.max(0, dailyCap - state.spentToday) },
      withinDailyCap, canExecute: sufficientBalance && withinDailyCap,
      refundWindowHours: CATALOG.find((item) => item.actionKey === actionKey)?.refundWindowHours ?? null,
    };
  }

  /** Cobra como la API: 409 sin efectos si falta saldo o se pasa del tope; si no, débito y uso. */
  function charge(actionKey: string, targetId: string | undefined, reasonText: string): { error: { status: number; body: Json } } | { charged: number } {
    const priced = quote(actionKey, targetId);
    if (priced.cost > 0 && !priced.sufficientBalance) return { error: { status: 409, body: { error: 'INSUFFICIENT_CURRENCY', cost: priced.cost, balance: state.balance } } };
    if (priced.cost > 0 && !priced.withinDailyCap) return { error: { status: 409, body: { error: 'DAILY_SPEND_CAP_REACHED', cost: priced.cost, dailyCap, spentToday: state.spentToday } } };
    if (priced.reason === 'FREE_QUOTA') state.freeUsed += 1;
    if (priced.cost > 0) {
      state.spentToday += priced.cost;
      record(-priced.cost, 'ACTION_CHARGE', actionKey, reasonText);
    }
    return { charged: priced.cost };
  }

  function summary(stored: Stored): ApplicantSummary {
    const { detail } = stored;
    return {
      id: detail.id, status: detail.status, createdAt: detail.createdAt, updatedAt: detail.updatedAt, isPriority: detail.isPriority, prioritizedAt: detail.prioritizedAt,
      worker: detail.worker, interview: detail.interview, currentOfferStatus: detail.offers.at(-1)?.status ?? null,
    };
  }

  function addEvent(stored: Stored, type: string, actorRole: string, from: ApplicationStatus | null, to: ApplicationStatus | null, detail: string | null = null) {
    stored.detail.events.push({ id: id('evt'), type, actorRole, fromStatus: from, toStatus: to, detail, createdAt: new Date().toISOString() });
    stored.detail.updatedAt = new Date().toISOString();
  }

  function pushToPanel(event: { type: string; applicationId: string; postingId: string; status: ApplicationStatus }) {
    // Las conexiones de vistas que ya se cerraron quedan pendientes en la lista (el navegador las abortó):
    // se usa la más reciente y, si esa ya no existe, la anterior.
    const body = `retry: 2000

event: job
data: ${JSON.stringify({ ...event, at: new Date().toISOString() })}

`;
    void (async () => {
      while (sse.length > 0) {
        const waiting = sse.pop()!;
        try {
          await waiting.route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body });
          return;
        } catch {
          // conexión abortada: se prueba con la siguiente
        }
      }
    })();
  }

  const server: FixedJobsServer = {
    calls,
    state,
    failNext: (match, failure) => { failures.push({ match, failure, left: failure.times ?? 1 }); },
    addPosting: (overrides = {}) => {
      const posting = samplePosting({ id: id('posting'), ...overrides });
      postings.unshift(posting);
      return posting;
    },
    addApplicant: ({ postingId, name, status = 'APPLIED', priority = false, hasCv = false, answers = [] }) => {
      const applicationId = id('app');
      const now = new Date().toISOString();
      const stored: Stored = {
        postingId,
        workerIdentifier: '45678912',
        detail: {
          id: applicationId, status, createdAt: now, updatedAt: now, isPriority: priority, prioritizedAt: priority ? now : null,
          worker: { name, headline: 'Atención al cliente', district: 'San Isidro', hasCv }, interview: null, currentOfferStatus: null,
          posting: { id: postingId, title: find(postingId)?.title ?? 'Puesto', status: find(postingId)?.status ?? 'PUBLISHED' },
          screeningAnswers: answers, decisionReason: null, hiredAt: null, offers: [], events: [],
        },
      };
      addEvent(stored, 'APPLIED', 'WORKER', null, 'APPLIED');
      applications.set(applicationId, stored);
      return applicationId;
    },
    workerAccepts: (applicationId) => {
      const stored = applications.get(applicationId)!;
      const offer = stored.detail.offers.at(-1)!;
      const posting = find(stored.postingId)!;
      offer.status = 'ACCEPTED';
      offer.respondedAt = new Date().toISOString();
      offer.acceptanceSnapshot = {
        acceptedAt: offer.respondedAt, offerVersion: offer.version,
        company: { id: 'company-1', name: 'Empresa de pruebas UI', legalName: null, ruc: '20999999999' },
        worker: { id: 'worker-1', name: stored.detail.worker.name, identifier: stored.workerIdentifier },
        posting: { id: posting.id, title: posting.title, modality: posting.modality, workload: posting.workload, location: posting.location, salaryRange: posting.salary },
        conditions: { salaryCents: offer.salaryCents, currency: 'PEN', contractType: offer.contractType, startDate: offer.startDate.slice(0, 10), note: offer.note },
        document: offer.document,
      };
      stored.detail.status = 'ACCEPTED';
      addEvent(stored, 'OFFER_ACCEPTED', 'WORKER', 'OFFER', 'ACCEPTED');
      pushToPanel({ type: 'OFFER_ACCEPTED', applicationId, postingId: stored.postingId, status: 'ACCEPTED' });
    },
    pushEvent: pushToPanel,
    sseConnections: () => sseOpened,
    closePosting: (postingId) => {
      const posting = find(postingId)!;
      posting.status = 'CLOSED';
      posting.closedAt = new Date().toISOString();
    },
  };

  // Un punto de entrada por petición: primero los fallos programados, luego las rutas.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^\/api/, '');
    const query = url.searchParams;
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { body = null; }

    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });

    if (path === '/job-events') {
      sseOpened += 1;
      sse.push({ route });
      return; // la conexión queda abierta hasta que `pushEvent` la completa (o se cierra la página)
    }
    if (!path.startsWith('/business/') && path !== '/specialties') return route.fallback();
    calls.push({ method, path, body });

    const scripted = failures.find((item) => item.left > 0 && item.match.test(`${method} ${path}`));
    if (scripted) {
      scripted.left -= 1;
      return route.fulfill({ status: scripted.failure.status, headers: scripted.failure.headers, json: scripted.failure.body });
    }

    // ---- moneda ----
    if (method === 'GET' && path === '/business/currency/balance') return reply({ currency, balance: state.balance });
    if (method === 'GET' && path === '/business/currency/quote') return reply(quote(query.get('actionKey') ?? '', query.get('targetId')));
    if (method === 'GET' && path === '/business/currency/catalog') {
      return reply({
        currency,
        items: [
          ...CATALOG.map((item) => ({ ...item, freeRemaining: item.actionKey === 'JOB_PUBLISH_EXTRA' ? Math.max(0, freeQuota - state.freeUsed) : 0 })),
          { actionKey: 'COMPANY_VERIFIED', kind: 'REWARD', amount: 20 },
          { actionKey: 'HIRE_CONFIRMED', kind: 'REWARD', amount: 20 },
        ],
      });
    }
    if (method === 'GET' && path === '/business/currency/rewards') {
      const hires = movements.filter((movement) => movement.actionKey === 'HIRE_CONFIRMED');
      const items: RewardItem[] = [
        { actionKey: 'COMPANY_VERIFIED', amount: 20, repeatable: false, earnedCount: 0, earnedAmount: 0, status: 'AVAILABLE', verified: false },
        { actionKey: 'HIRE_CONFIRMED', amount: 20, repeatable: true, earnedCount: hires.length, earnedAmount: hires.length * 20, status: 'AVAILABLE' },
      ];
      return reply({ currency, items, caps: { daily: { limit: 100, earned: hires.length * 20, remaining: 100 - hires.length * 20 }, monthly: { limit: 600, earned: hires.length * 20, remaining: 600 - hires.length * 20 } } });
    }
    if (method === 'GET' && path === '/business/currency/movements') {
      const limit = Number(query.get('limit') ?? 20);
      const cursor = query.get('cursor');
      const start = cursor ? movements.findIndex((item) => item.id === cursor) + 1 : 0;
      const items = movements.slice(start, start + limit);
      return reply({ currency, items, nextCursor: start + limit < movements.length ? items.at(-1)!.id : null });
    }

    // ---- puestos ----
    if (method === 'GET' && path === '/business/job-postings') {
      const status = query.get('status');
      const limit = Number(query.get('limit') ?? 25);
      const cursor = query.get('cursor');
      const all = postings.filter((item) => !status || item.status === status);
      const start = cursor ? all.findIndex((item) => item.id === cursor) + 1 : 0;
      const items = all.slice(start, start + limit).map((item) => withCounts(item));
      return reply({ items, nextCursor: start + limit < all.length ? items.at(-1)!.id : null });
    }
    if (method === 'POST' && path === '/business/job-postings') {
      const input = body as Partial<PostingRecord> & { salaryMinCents: number; salaryMaxCents: number };
      const { salaryMinCents, salaryMaxCents, ...rest } = input;
      const posting = samplePosting({ ...rest, id: id('posting'), salary: { minCents: salaryMinCents, maxCents: salaryMaxCents, currency: 'PEN' }, status: 'DRAFT', createdAt: new Date().toISOString(), applicationsCount: 0 });
      postings.unshift(posting);
      return reply(posting, 201);
    }
    const postingMatch = /^\/business\/job-postings\/([^/]+)(?:\/(publish|pause|close|highlight|applications))?$/.exec(path);
    if (postingMatch) {
      const posting = find(postingMatch[1]!);
      const action = postingMatch[2];
      if (!posting) return reply({ error: 'JOB_POSTING_NOT_FOUND' }, 404);
      if (method === 'GET' && !action) return reply(withCounts(posting, true));
      if (method === 'PATCH' && !action) {
        if (posting.status !== 'DRAFT' && posting.status !== 'PAUSED') return reply({ error: 'POSTING_NOT_EDITABLE', status: posting.status }, 409);
        const { salaryMinCents, salaryMaxCents, ...rest } = body as Json & { salaryMinCents?: number; salaryMaxCents?: number };
        Object.assign(posting, rest);
        if (salaryMinCents !== undefined) posting.salary = { ...posting.salary, minCents: salaryMinCents };
        if (salaryMaxCents !== undefined) posting.salary = { ...posting.salary, maxCents: salaryMaxCents };
        return reply(withCounts(posting));
      }
      if (method === 'POST' && action === 'publish') {
        if (posting.status === 'PUBLISHED') return reply({ ...posting, idempotent: true, chargedAmount: 0 });
        if (posting.status !== 'DRAFT' && posting.status !== 'PAUSED') return reply({ error: 'INVALID_STATE_TRANSITION', status: posting.status, requested: 'PUBLISHED' }, 409);
        const result = charge('JOB_PUBLISH_EXTRA', posting.id, 'Publicación de un puesto');
        if ('error' in result) return reply(result.error.body, result.error.status);
        posting.status = 'PUBLISHED';
        posting.publishedAt ??= new Date().toISOString();
        return reply({ ...withCounts(posting), idempotent: false, chargedAmount: result.charged });
      }
      if (method === 'POST' && action === 'pause') {
        if (posting.status !== 'PUBLISHED') return reply({ error: 'INVALID_STATE_TRANSITION', status: posting.status, requested: 'PAUSED' }, 409);
        posting.status = 'PAUSED';
        return reply({ ...withCounts(posting), idempotent: false, chargedAmount: 0 });
      }
      if (method === 'POST' && action === 'close') {
        if (posting.status === 'CLOSED' || posting.status === 'FILLED') return reply({ error: 'INVALID_STATE_TRANSITION', status: posting.status, requested: 'CLOSED' }, 409);
        posting.status = 'CLOSED';
        posting.closedAt = new Date().toISOString();
        for (const stored of applications.values()) {
          if (stored.postingId === posting.id && (stored.detail.status === 'OFFER' || stored.detail.status === 'ACCEPTED')) {
            stored.detail.status = 'REJECTED';
            addEvent(stored, 'REJECTED', 'COMPANY', null, 'REJECTED', 'POSTING_CLOSED');
          }
        }
        return reply({ ...withCounts(posting), idempotent: false, chargedAmount: 0 });
      }
      if (method === 'POST' && action === 'highlight') {
        if (posting.status !== 'PUBLISHED') return reply({ error: 'POSTING_NOT_PUBLISHED' }, 409);
        const already = posting.highlightedUntil !== null && new Date(posting.highlightedUntil).getTime() > Date.now();
        if (already) return reply({ ...withCounts(posting), idempotent: true, chargedAmount: 0 });
        const result = charge('JOB_HIGHLIGHT', posting.id, 'Puesto destacado');
        if ('error' in result) return reply(result.error.body, result.error.status);
        posting.highlightedUntil = isoFromNow(7 * DAY_MS);
        return reply({ ...withCounts(posting), idempotent: false, chargedAmount: result.charged });
      }
      if (method === 'GET' && action === 'applications') {
        const wanted = (query.get('status') ?? '').split(',').filter(Boolean);
        const items = [...applications.values()]
          .filter((stored) => stored.postingId === posting.id && (wanted.length === 0 || wanted.includes(stored.detail.status)))
          .sort((a, b) => Number(b.detail.isPriority) - Number(a.detail.isPriority))
          .map(summary);
        return reply({ items, nextCursor: null });
      }
    }

    // ---- postulaciones ----
    const appMatch = /^\/business\/job-applications\/([^/]+)(?:\/(stage|interview|reject|hire|offers|offer-documents|cv))?$/.exec(path);
    if (appMatch) {
      const stored = applications.get(appMatch[1]!);
      const action = appMatch[2];
      if (!stored) return reply({ error: 'JOB_APPLICATION_NOT_FOUND' }, 404);
      const posting = find(stored.postingId)!;
      const open = posting.status === 'PUBLISHED' || posting.status === 'PAUSED';
      const detail = stored.detail;
      detail.posting = { id: posting.id, title: posting.title, status: posting.status };
      const invalid = (requested: string) => reply({ error: 'INVALID_STATE_TRANSITION', status: detail.status, requested }, 409);
      const done = () => reply({ ...detail, idempotent: false });
      if (method === 'GET' && !action) return reply(detail);
      if (method === 'GET' && action === 'cv') return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 cv' });
      if (method === 'POST' && action === 'stage') {
        const next = (body as { status: ApplicationStatus }).status;
        if (!open) return reply({ error: 'POSTING_NOT_OPEN', status: posting.status }, 409);
        if (next === 'SHORTLISTED' && detail.status !== 'APPLIED') return invalid(next);
        if (next === 'INTERVIEW' && !['APPLIED', 'SHORTLISTED'].includes(detail.status)) return invalid(next);
        addEvent(stored, next === 'SHORTLISTED' ? 'SHORTLISTED' : 'INTERVIEW_SCHEDULED', 'COMPANY', detail.status, next);
        detail.status = next;
        return done();
      }
      if (method === 'POST' && action === 'interview') {
        const input = body as { scheduledAt: string; mode?: 'ONSITE' | 'VIDEO' | 'PHONE' | null; note?: string | null };
        if (!open) return reply({ error: 'POSTING_NOT_OPEN', status: posting.status }, 409);
        if (!['APPLIED', 'SHORTLISTED', 'INTERVIEW'].includes(detail.status)) return invalid('INTERVIEW');
        addEvent(stored, 'INTERVIEW_SCHEDULED', 'COMPANY', detail.status, 'INTERVIEW', input.scheduledAt);
        detail.status = 'INTERVIEW';
        detail.interview = { scheduledAt: input.scheduledAt, mode: input.mode ?? null, note: input.note ?? null };
        return done();
      }
      if (method === 'PUT' && action === 'offer-documents') {
        return reply({ id: id('upload'), name: decodeURIComponent(request.headers()['x-file-name'] ?? 'oferta.pdf'), mediaType: 'application/pdf', sizeBytes: 1234, sha256: 'a'.repeat(64) }, 201);
      }
      if (method === 'POST' && action === 'offers') {
        const input = body as { salaryCents: number; contractType: OfferRecord['contractType']; startDate: string; note?: string | null; documentId?: string | null };
        if (!open) return reply({ error: 'POSTING_NOT_OPEN', status: posting.status }, 409);
        if (!['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER'].includes(detail.status)) return invalid('OFFER');
        for (const offer of detail.offers) if (offer.status === 'PENDING') offer.status = 'SUPERSEDED';
        const version = detail.offers.length + 1;
        detail.offers.push({
          id: id('offer'), version, status: 'PENDING', salaryCents: input.salaryCents, currency: 'PEN', contractType: input.contractType, startDate: `${input.startDate}T00:00:00.000Z`,
          note: input.note ?? null, document: input.documentId ? { name: 'oferta.pdf', mediaType: 'application/pdf', sizeBytes: 1234, sha256: 'a'.repeat(64) } : null,
          createdAt: new Date().toISOString(), respondedAt: null, acceptanceSnapshot: null,
        });
        addEvent(stored, 'OFFER_ISSUED', 'COMPANY', detail.status, 'OFFER', `v${version}`);
        detail.status = 'OFFER';
        return reply({ ...detail, idempotent: false }, 201);
      }
      if (method === 'POST' && action === 'hire') {
        if (detail.status !== 'ACCEPTED') return invalid('HIRED');
        if (!open) return reply({ error: posting.status === 'FILLED' ? 'POSTING_FILLED' : 'POSTING_NOT_OPEN', status: posting.status }, 409);
        detail.status = 'HIRED';
        detail.hiredAt = new Date().toISOString();
        addEvent(stored, 'HIRED', 'COMPANY', 'ACCEPTED', 'HIRED');
        posting.filledVacancies += 1;
        if (posting.filledVacancies >= posting.vacancies) { posting.status = 'FILLED'; posting.closedAt = new Date().toISOString(); }
        record(20, 'REWARD', 'HIRE_CONFIRMED', 'Contratación confirmada');
        return done();
      }
      if (method === 'POST' && action === 'reject') {
        if (!['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'ACCEPTED'].includes(detail.status)) return invalid('REJECTED');
        const reason = (body as { reason?: string } | null)?.reason ?? null;
        for (const offer of detail.offers) if (offer.status === 'PENDING') offer.status = 'WITHDRAWN';
        addEvent(stored, 'REJECTED', 'COMPANY', detail.status, 'REJECTED', reason);
        detail.status = 'REJECTED';
        detail.decisionReason = reason;
        return done();
      }
    }

    // ---- talento ----
    if (method === 'GET' && path === '/specialties') return reply([]);
    if (method === 'GET' && path === '/business/talent') {
      const text = (query.get('query') ?? '').toLowerCase();
      return reply({ items: talent.filter((card) => !text || `${card.name} ${card.headline ?? ''} ${card.district ?? ''}`.toLowerCase().includes(text)), nextCursor: null });
    }
    if (method === 'GET' && path === '/business/talent-unlocks') return reply({ items: [...unlocked].map((profileId) => ({ workerTalentProfileId: profileId, unlockedAt: new Date().toISOString() })) });
    if (method === 'GET' && path === '/business/talent-invitations') return reply(invitations);
    if (method === 'POST' && path === '/business/talent-invitations') {
      const input = body as { workerTalentProfileId: string; message?: string };
      const card = talent.find((item) => item.id === input.workerTalentProfileId);
      if (!card) return reply({ error: 'TALENT_PROFILE_NOT_AVAILABLE' }, 404);
      if (invitations.some((item) => item.workerTalentProfileId === card.id && ['PENDING', 'ACCEPTED'].includes(String(item.status)))) return reply({ error: 'INVITATION_ALREADY_ACTIVE' }, 409);
      const result = charge('TALENT_INVITE', undefined, 'Invitación a un candidato');
      if ('error' in result) return reply(result.error.body, result.error.status);
      const invitation = { id: id('inv'), status: 'PENDING', message: input.message ?? null, expiresAt: isoFromNow(7 * DAY_MS), respondedAt: null, createdAt: new Date().toISOString(), shift: null, workerTalentProfileId: card.id, workerName: card.name };
      invitations.unshift(invitation);
      return reply(invitation, 201);
    }
    const talentMatch = /^\/business\/talent\/([^/]+)\/(unlock-contact|contact|cv)$/.exec(path);
    if (talentMatch) {
      const card = talent.find((item) => item.id === talentMatch[1]);
      if (!card) return reply({ error: 'TALENT_PROFILE_NOT_AVAILABLE' }, 404);
      const contact = { name: card.name, email: `${card.name.split(' ')[0]!.toLowerCase()}@candidato.example` };
      if (talentMatch[2] === 'unlock-contact') {
        const already = unlocked.has(card.id);
        if (!already) {
          const result = charge('CANDIDATE_CONTACT_UNLOCK', card.id, 'Desbloqueo de contacto y CV');
          if ('error' in result) return reply(result.error.body, result.error.status);
          unlocked.add(card.id);
          return reply({ unlocked: true, idempotent: false, chargedAmount: result.charged, viaApplication: false, contact, hasCv: true }, 201);
        }
        return reply({ unlocked: true, idempotent: true, chargedAmount: 0, viaApplication: false, contact, hasCv: true });
      }
      if (!unlocked.has(card.id)) return reply({ error: 'CONTACT_NOT_UNLOCKED' }, 403);
      if (talentMatch[2] === 'contact') return reply({ unlocked: true, contact, hasCv: true });
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 cv' });
    }

    return route.fallback();
  });

  return server;
}

export type { PostingStatus };
