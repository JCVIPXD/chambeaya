import { test as base, expect } from '@playwright/test';
import type { BusinessSession, CompanyRecord, PaymentRecord, PaymentSettingsRecord, SubscriptionRecord } from '../../lib/business-api';
import { DAY_MS, isoFromNow } from './dates';

// Synthetic identities only. These credentials do not belong to an API account.
export const account = {
  email: 'empresa@example.test',
  password: 'Clave-solo-para-pruebas-123',
};

export const session: BusinessSession = {
  token: 'synthetic-browser-session',
  userId: 'browser-test-business',
  role: 'BUSINESS',
  name: 'Responsable de pruebas',
  email: account.email,
  identifier: '20999999999',
};

export const company: CompanyRecord = {
  id: 'browser-test-company',
  name: 'Empresa de pruebas UI',
  legalName: null,
  ruc: session.identifier,
  industry: null,
  phone: null,
  address: null,
  district: null,
};

const activeSubscription: SubscriptionRecord = {
  id: 'browser-test-subscription',
  plan: 'PILOT',
  status: 'TRIAL',
  startsAt: isoFromNow(-23 * DAY_MS),
  endsAt: null,
  trialEndsAt: null,
};

// Respuesta sintética de `GET /business/subscription` para una empresa que no
// activó ningún plan: sin `id`/`startsAt` y con `status: 'INACTIVE'` (ver
// `business.service.ts#getSubscription`). Trae `plan: 'PILOT'` aunque no haya
// ningún plan vigente.
export const inactiveSubscription: SubscriptionRecord = {
  plan: 'PILOT',
  status: 'INACTIVE',
  endsAt: null,
  trialEndsAt: null,
};

// Ajuste global por defecto (10% de comisión + 18% de IGV sobre la comisión,
// ver el plan de pagos). Un test puede sobreescribirlo con `test.use({
// paymentSettings: { ... } })`, igual que `subscription`.
export const defaultPaymentSettings: PaymentSettingsRecord = {
  commissionBps: 1000,
  taxBps: 1800,
  currency: 'PEN',
  mode: 'manual',
};

// Empresa con un plan `PRO` activado de forma manual (no existe endpoint de
// activación; el plan solo puede venir de una fila creada por administración).
export const proSubscription: SubscriptionRecord = {
  id: 'browser-test-subscription-pro',
  plan: 'PRO',
  status: 'ACTIVE',
  startsAt: isoFromNow(-23 * DAY_MS),
  endsAt: null,
  trialEndsAt: null,
};

// Alcance D: un pago `PENDING` de ejemplo (nacido de `checkOut`/
// `resolveAssignment`, nunca del CRUD manual retirado) para los specs de
// "Marcar como pagado". Un test puede sobreescribirlo con
// `test.use({ payments: [...] })`, igual que `subscription`.
export const pendingPayment: PaymentRecord = {
  id: 'browser-test-payment-pending',
  reference: 'CN-TEST-0001',
  description: 'Mozo de salón · Empresa de pruebas UI',
  amountCents: 10000,
  commissionBps: 1000,
  commissionCents: 1000,
  taxBps: 1800,
  taxCents: 180,
  totalCents: 11180,
  provider: 'manual',
  workerCount: 1,
  status: 'PENDING',
  dueAt: isoFromNow(-1 * DAY_MS),
  processedAt: null,
  createdAt: isoFromNow(-1 * DAY_MS),
  shift: { id: 'browser-test-shift', title: 'Mozo de salón', startsAt: isoFromNow(-2 * DAY_MS), endsAt: isoFromNow(-1 * DAY_MS) },
  assignment: { id: 'browser-test-assignment', status: 'COMPLETED', worker: { id: 'browser-test-worker', name: 'Trabajador de pruebas', email: 'trabajador@example.test' } },
  workerConfirmedAt: null,
};

export const simulatedPendingPayment: PaymentRecord = {
  ...pendingPayment,
  id: 'browser-test-payment-simulated',
  reference: 'CN-TEST-SIM-0001',
  provider: 'simulated',
};

type ApiCall ={ method: string; path: string; authorization: string | undefined };
type BrowserApi = { calls: ApiCall[] };

export const test = base.extend<{ browserApi: BrowserApi; subscription: SubscriptionRecord; paymentSettings: PaymentSettingsRecord; payments: PaymentRecord[] }>({
  // Override per file/describe with `test.use({ subscription: ... })`.
  subscription: [activeSubscription, { option: true }],
  paymentSettings: [defaultPaymentSettings, { option: true }],
  payments: [[], { option: true }],
  browserApi: [async ({ context, baseURL, subscription, paymentSettings, payments }, use) => {
    const calls: ApiCall[] = [];
    // Estado propio de este test (nunca compartido entre tests): el
    // servidor simulado aplica `mark-paid` igual que la API real
    // (`updateMany` condicionado a `status: 'PENDING'`), sobre una copia
    // para no mutar el fixture importado.
    let paymentRecords: PaymentRecord[] = payments.map((payment) => ({ ...payment }));
    const simulatedAttempts = new Map<string, { paymentId: string; status: 'CREATED' | 'APPROVED' | 'REJECTED'; expiresAt: string }>();
    const unexpected: string[] = [];
    const pageErrors: string[] = [];
    let authenticated = false;

    context.on('page', (page) => {
      page.on('pageerror', (error) => pageErrors.push(error.message));
    });

    // Each test owns a new context and server state; no session is shared across tests.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== baseURL) {
        unexpected.push(`External request: ${url.origin}${url.pathname}`);
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }

      const method = request.method();
      const path = url.pathname;
      const authorization = request.headers().authorization;
      calls.push({ method, path, authorization });

      if (method === 'POST' && path === '/api/auth/login') {
        const body = request.postDataJSON();
        if (body?.email !== account.email || body?.password !== account.password) {
          await route.fulfill({ status: 401, json: { error: 'INVALID_CREDENTIALS' } });
          return;
        }
        authenticated = true;
        await route.fulfill({ json: session });
        return;
      }

      if (!authenticated || authorization !== `Bearer ${session.token}`) {
        unexpected.push(`Unauthenticated API request: ${method} ${path}`);
        await route.fulfill({ status: 401, json: { error: 'UNAUTHORIZED' } });
        return;
      }

      if (path === '/api/auth/session' && method === 'GET') {
        await route.fulfill({ json: session });
        return;
      }
      if (path === '/api/auth/session' && method === 'DELETE') {
        authenticated = false;
        await route.fulfill({ status: 204 });
        return;
      }
      if (path === '/api/auth/password/change' && method === 'POST') {
        const body = request.postDataJSON() as
          | { currentPassword?: string; newPassword?: string }
          | null;
        if (body?.currentPassword !== account.password) {
          await route.fulfill({ status: 401, json: { error: 'INVALID_CURRENT_PASSWORD' } });
          return;
        }
        await route.fulfill({ json: session });
        return;
      }

      // Alcance D: único escritor que le queda a la empresa sobre un pago.
      // Misma regla que la API real (`markPaymentPaid`): solo transiciona
      // `PENDING` -> `PROCESSED`; cualquier otro estado responde 409.
      const markPaidMatch = /^\/api\/business\/payments\/([^/]+)\/mark-paid$/.exec(path);
      if (method === 'POST' && markPaidMatch) {
        const id = markPaidMatch[1];
        const target = paymentRecords.find((item) => item.id === id);
        if (!target) {
          await route.fulfill({ status: 404, json: { error: 'PAYMENT_NOT_FOUND' } });
          return;
        }
        if (target.status !== 'PENDING') {
          await route.fulfill({ status: 409, json: { error: 'PAYMENT_NOT_PAYABLE' } });
          return;
        }
        const updated: PaymentRecord = { ...target, status: 'PROCESSED', processedAt: new Date().toISOString() };
        paymentRecords = paymentRecords.map((item) => (item.id === id ? updated : item));
        await route.fulfill({ json: updated });
        return;
      }

      const checkoutMatch = /^\/api\/business\/payments\/([^/]+)\/checkout$/.exec(path);
      if (method === 'POST' && checkoutMatch) {
        const id = checkoutMatch[1];
        const target = paymentRecords.find((item) => item.id === id);
        if (!target || target.provider !== 'simulated' || !['PENDING', 'SCHEDULED'].includes(target.status)) {
          await route.fulfill({ status: 409, json: { error: 'PAYMENT_NOT_PAYABLE' } });
          return;
        }
        const existing = [...simulatedAttempts.entries()].find(([, attempt]) => attempt.paymentId === id);
        const checkoutId = existing?.[0] ?? `checkout-${id}`;
        if (!existing) {
          simulatedAttempts.set(checkoutId, {
            paymentId: id,
            status: 'CREATED',
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          });
          paymentRecords = paymentRecords.map((item) => item.id === id ? { ...item, status: 'SCHEDULED' } : item);
        }
        const attempt = simulatedAttempts.get(checkoutId)!;
        await route.fulfill({ json: {
          attemptId: checkoutId,
          redirectUrl: new URL(`/pago-simulado/${checkoutId}`, baseURL).toString(),
          expiresAt: attempt.expiresAt,
        } });
        return;
      }

      const simulatedMatch = /^\/api\/payments\/simulated\/([^/]+)(?:\/(approve|reject))?$/.exec(path);
      if (simulatedMatch) {
        const [, checkoutId, outcome] = simulatedMatch;
        const attempt = simulatedAttempts.get(checkoutId);
        const target = attempt && paymentRecords.find((item) => item.id === attempt.paymentId);
        if (!attempt || !target) {
          await route.fulfill({ status: 404, json: { error: 'ATTEMPT_NOT_FOUND' } });
          return;
        }
        if (method === 'GET' && !outcome) {
          await route.fulfill({ json: {
            checkoutId,
            status: attempt.status,
            expiresAt: attempt.expiresAt,
            payment: {
              id: target.id,
              reference: target.reference,
              description: target.description,
              totalCents: target.totalCents,
              currency: 'PEN',
              status: target.status,
            },
          } });
          return;
        }
        if (method === 'POST' && outcome) {
          if (outcome === 'approve') {
            attempt.status = 'APPROVED';
            paymentRecords = paymentRecords.map((item) => item.id === target.id ? { ...item, status: 'PROCESSED', processedAt: new Date().toISOString() } : item);
            await route.fulfill({ json: { ok: true, result: 'approved' } });
            return;
          }
          attempt.status = 'REJECTED';
          if (target.status !== 'PROCESSED') {
            paymentRecords = paymentRecords.map((item) => item.id === target.id ? { ...item, status: 'PENDING' } : item);
          }
          await route.fulfill({ json: { ok: true, result: target.status === 'PROCESSED' ? 'noop' : 'rejected' } });
          return;
        }
      }

      const data: Record<string, unknown> = {
        '/api/business/company': company,
        '/api/business/subscription': subscription,
        '/api/business/payment-settings': paymentSettings,
        '/api/business/shifts': [],
        '/api/business/workers': [],
        '/api/business/conversations': [],
        '/api/business/payments': paymentRecords,
        '/api/business/applications/pending': { count: 0, shiftIds: [] },
        '/api/business/talent-invitations': [],
      };
      if (method === 'GET' && Object.hasOwn(data, path)) {
        await route.fulfill({ json: data[path] });
        return;
      }

      unexpected.push(`Unmocked API request: ${method} ${path}`);
      await route.fulfill({ status: 501, json: { error: 'UNMOCKED_TEST_REQUEST' } });
    });

    await use({ calls });
    expect(unexpected, 'Every API request must match the isolated test contract').toEqual([]);
    expect(pageErrors, 'No uncaught browser errors').toEqual([]);
  }, { auto: true }],
});

export { expect };
