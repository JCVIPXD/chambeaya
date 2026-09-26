import { test as base, expect } from '@playwright/test';
import type { AdminSession } from '../../lib/admin-api';

// Synthetic identity only. This credential does not belong to an API account.
export const account = {
  email: 'superadmin@example.test',
  password: 'Clave-solo-para-pruebas-123',
};

export const session: AdminSession = {
  token: 'synthetic-browser-admin-session',
  userId: 'browser-test-admin',
  role: 'ADMIN',
  name: 'Superadmin de pruebas',
  email: account.email,
  identifier: 'ADMIN-000000000001',
};

const emptyOverview = {
  companies: 0,
  workers: 0,
  activeShifts: 0,
  openIncidents: 0,
  pendingApplications: 0,
};

type ApiCall = { method: string; path: string; authorization: string | undefined };
type BrowserApi = { calls: ApiCall[] };

export const test = base.extend<{ browserApi: BrowserApi; deleteSessionFails: boolean }>({
  // Override per file/describe with `test.use({ deleteSessionFails: true })`
  // to simulate `DELETE /api/auth/session` failing (CN-20260926-008, BAJO-5:
  // "Salir" debe limpiar el estado local igual aunque la API falle).
  deleteSessionFails: [false, { option: true }],
  browserApi: [async ({ context, baseURL, deleteSessionFails }, use) => {
    const calls: ApiCall[] = [];
    const unexpected: string[] = [];
    const pageErrors: string[] = [];
    let authenticated = false;

    context.on('page', (page) => {
      page.on('pageerror', (error) => pageErrors.push(error.message));
    });

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
        if (deleteSessionFails) {
          await route.fulfill({ status: 500, json: { error: 'INTERNAL_ERROR' } });
          return;
        }
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

      const data: Record<string, unknown> = {
        '/api/admin/overview': emptyOverview,
        '/api/admin/companies': [],
        '/api/admin/workers': [],
        '/api/admin/incidents': [],
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
