import { describe, expect, it } from 'vitest';

import { assertDemoSmokeAllowed, runDemoSmoke } from '../src/demo/demo.smoke.js';

const environment = { NODE_ENV: 'development', CHAMBEAYA_DEMO_SMOKE: 'true' };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function fakeDemoApi() {
  const calls: Array<{ path: string; method: string; authorization?: string }> = [];
  const sessions = {
    'business-token': { token: 'business-token', userId: 'business-1', role: 'BUSINESS', email: 'empresa.demo@chambeaya.local' },
    'worker-token': { token: 'worker-token', userId: 'worker-1', role: 'WORKER', email: 'trabajador.demo@chambeaya.local' },
    'admin-token': { token: 'admin-token', userId: 'admin-1', role: 'ADMIN', email: 'superadmin@chambeaya.local' },
  } as const;

  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = url.pathname.replace('/api', '');
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string> | undefined;
    const authorization = headers?.authorization;
    calls.push({ path, method, authorization });
    const token = authorization?.replace('Bearer ', '') as keyof typeof sessions | undefined;
    const session = token ? sessions[token] : undefined;

    if (path === '/auth/login' && method === 'POST') {
      const email = JSON.parse(String(init?.body)).email;
      if (email === sessions['business-token'].email) return json(sessions['business-token']);
      if (email === sessions['worker-token'].email) return json(sessions['worker-token']);
      if (email === sessions['admin-token'].email) return json(sessions['admin-token']);
      return json({ error: 'INVALID_CREDENTIALS' }, 401);
    }
    if (path === '/auth/session' && method === 'DELETE') return new Response(null, { status: 204 });
    if (path === '/auth/session') return session ? json(session) : json({ error: 'INVALID_SESSION' }, 401);
    if (path === '/business/company') return session?.role === 'BUSINESS' ? json({ id: 'company-1' }) : json({ error: 'BUSINESS_ACCOUNT_REQUIRED' }, 403);
    if (path === '/business/shifts') return session?.role === 'BUSINESS' ? json([{ id: 'demo-presentation-flow-shift' }, { id: 'demo-presentation-history-shift' }]) : json({}, 403);
    if (path === '/business/shifts/demo-presentation-flow-shift/applications') return session?.role === 'BUSINESS'
      ? json([{ id: 'application-1', status: 'PENDING', worker: { id: 'worker-1' } }]) : json({}, 403);
    if (path === '/workers/applications') return session?.role === 'WORKER'
      ? json([{ shiftId: 'demo-presentation-flow-shift', status: 'PENDING' }, { shiftId: 'demo-presentation-history-shift', status: 'ACCEPTED' }]) : json({}, 403);
    if (path === '/workers/wallet') return session?.role === 'WORKER'
      ? json({ movements: [{ reference: 'DEMO-PAGO-HISTORIAL-001', status: 'RELEASED' }] }) : json({}, 403);
    if (path === '/workers/conversations') return session?.role === 'WORKER' ? json([]) : json({}, 403);
    if (path === '/admin/overview') return session?.role === 'ADMIN'
      ? json({ companies: 1, workers: 1, activeShifts: 1, pendingApplications: 1 }) : json({}, 403);
    if (path === '/admin/companies') return session?.role === 'ADMIN' ? json([{ id: 'company-1', owner: { id: 'business-1' } }]) : json({}, 403);
    if (path === '/admin/workers') return session?.role === 'ADMIN' ? json([{ id: 'worker-1' }]) : json({}, 403);
    return json({ error: 'UNEXPECTED_REQUEST' }, 404);
  }) as typeof fetch;

  return { fetcher, calls };
}

describe('demo smoke runner', () => {
  it('fails closed outside explicit local development', () => {
    expect(() => assertDemoSmokeAllowed({ NODE_ENV: 'production', CHAMBEAYA_DEMO_SMOKE: 'true' })).toThrow('DEMO_SMOKE_REQUIRES_LOCAL_DEVELOPMENT');
    expect(() => assertDemoSmokeAllowed({ NODE_ENV: 'development' })).toThrow('DEMO_SMOKE_REQUIRES_EXPLICIT_OPT_IN');
  });

  it('checks all three roles and removes the temporary sessions afterwards', async () => {
    const api = fakeDemoApi();

    const result = await runDemoSmoke({ environment, fetcher: api.fetcher, baseUrl: 'http://demo.local/api' });

    expect(result).toEqual({ companyId: 'company-1', activeShifts: 2, pendingApplications: 1 });
    expect(api.calls.filter((call) => call.path === '/auth/login')).toHaveLength(3);
    expect(api.calls.filter((call) => call.path === '/auth/session' && call.method === 'DELETE')).toHaveLength(3);
    expect(api.calls.some((call) => call.path === '/business/company' && call.authorization === 'Bearer worker-token')).toBe(true);
    expect(api.calls.some((call) => call.path === '/admin/overview' && call.authorization === 'Bearer business-token')).toBe(true);
  });

  it('waits for delayed successful logins and cleans them when another login fails', async () => {
    const closedTokens: string[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' ? input : input.toString()).pathname.replace('/api', '');
      const method = init?.method ?? 'GET';
      const headers = init?.headers as Record<string, string> | undefined;
      if (path === '/auth/session' && method === 'DELETE') {
        closedTokens.push(String(headers?.authorization).replace('Bearer ', ''));
        return new Response(null, { status: 204 });
      }
      if (path !== '/auth/login') return json({ error: 'UNEXPECTED_REQUEST' }, 500);
      const email = JSON.parse(String(init?.body)).email;
      if (email === 'superadmin@chambeaya.local') return json({ error: 'INVALID_CREDENTIALS' }, 401);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return json(email === 'empresa.demo@chambeaya.local'
        ? { token: 'delayed-business', userId: 'business-1', role: 'BUSINESS', email }
        : { token: 'delayed-worker', userId: 'worker-1', role: 'WORKER', email });
    }) as typeof fetch;

    await expect(runDemoSmoke({ environment, fetcher, baseUrl: 'http://demo.local/api' })).rejects.toThrow('DEMO_SMOKE_LOGIN');
    expect(closedTokens.sort()).toEqual(['delayed-business', 'delayed-worker']);
  });

  it('cleans every usable login token when one successful response violates the identity contract', async () => {
    const closedTokens: string[] = [];
    const liveTokens = new Set<string>();
    const issue = (session: { token: string; userId: string; role: string; email: string }) => {
      liveTokens.add(session.token);
      return json(session);
    };
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' ? input : input.toString()).pathname.replace('/api', '');
      const method = init?.method ?? 'GET';
      const headers = init?.headers as Record<string, string> | undefined;
      if (path === '/auth/session' && method === 'DELETE') {
        const token = String(headers?.authorization).replace('Bearer ', '');
        closedTokens.push(token);
        liveTokens.delete(token);
        return new Response(null, { status: 204 });
      }
      if (path !== '/auth/login') return json({ error: 'UNEXPECTED_REQUEST' }, 500);
      const email = JSON.parse(String(init?.body)).email;
      if (email === 'empresa.demo@chambeaya.local') {
        return issue({ token: 'mismatch-business', userId: 'business-1', role: 'BUSINESS', email });
      }
      if (email === 'trabajador.demo@chambeaya.local') {
        return issue({ token: 'mismatch-worker', userId: 'worker-1', role: 'BUSINESS', email });
      }
      return issue({ token: 'mismatch-admin', userId: 'admin-1', role: 'ADMIN', email });
    }) as typeof fetch;

    await expect(runDemoSmoke({ environment, fetcher, baseUrl: 'http://demo.local/api' })).rejects.toThrow('DEMO_SMOKE_LOGIN_CONTRACT');
    expect(closedTokens.sort()).toEqual(['mismatch-admin', 'mismatch-business', 'mismatch-worker']);
    expect(liveTokens).toEqual(new Set());
  });
});
