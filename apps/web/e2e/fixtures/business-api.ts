import { test as base, expect } from '@playwright/test';
import type { BusinessSession, CompanyRecord, SubscriptionRecord } from '../../lib/business-api';

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

const subscription: SubscriptionRecord = {
  id: 'browser-test-subscription',
  plan: 'PILOT',
  status: 'TRIAL',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: null,
  trialEndsAt: null,
};

type ApiCall = { method: string; path: string; authorization: string | undefined };
type BrowserApi = { calls: ApiCall[] };

export const test = base.extend<{ browserApi: BrowserApi }>({
  browserApi: [async ({ context, baseURL }, use) => {
    const calls: ApiCall[] = [];
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

      const data: Record<string, unknown> = {
        '/api/business/company': company,
        '/api/business/subscription': subscription,
        '/api/business/shifts': [],
        '/api/business/workers': [],
        '/api/business/conversations': [],
        '/api/business/payments': [],
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
