import { demoPresentation } from './demo.seed.js';

type SmokeEnvironment = {
  NODE_ENV?: string;
  CHAMBEAYA_DEMO_SMOKE?: string;
};

type Session = { token: string; userId: string; role: string; email: string };
type Json = Record<string, unknown>;
type LoginAccount = { email: string; password: string; role: string };

export function assertDemoSmokeAllowed(environment: SmokeEnvironment = process.env) {
  if (environment.NODE_ENV !== 'development') throw new Error('DEMO_SMOKE_REQUIRES_LOCAL_DEVELOPMENT');
  if (environment.CHAMBEAYA_DEMO_SMOKE !== 'true') throw new Error('DEMO_SMOKE_REQUIRES_EXPLICIT_OPT_IN');
}

function record(value: unknown, code: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Json;
}

function records(value: unknown, code: string): Json[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value.map((item) => record(item, code));
}

export async function runDemoSmoke(options: {
  environment?: SmokeEnvironment;
  fetcher?: typeof fetch;
  baseUrl?: string;
} = {}) {
  const environment = options.environment ?? process.env;
  assertDemoSmokeAllowed(environment);
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (options.baseUrl ?? process.env.DEMO_SMOKE_API_BASE_URL ?? 'http://127.0.0.1:4000/api').replace(/\/$/, '');
  const cleanupTokens = new Set<string>();

  const request = async (path: string, init: RequestInit, expectedStatus: number, code: string) => {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, init);
    } catch {
      throw new Error('DEMO_SMOKE_API_UNREACHABLE: verifica que la API local esté saludable');
    }
    if (response.status !== expectedStatus) throw new Error(`DEMO_SMOKE_${code}: estado HTTP inesperado`);
    if (expectedStatus === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new Error(`DEMO_SMOKE_${code}: respuesta JSON inválida`);
    }
  };
  const auth = (session: Session): RequestInit => ({ headers: { authorization: `Bearer ${session.token}` } });
  const login = async (account: LoginAccount): Promise<Session> => {
    const value = record(await request('/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }),
    }, 200, 'LOGIN'), 'DEMO_SMOKE_LOGIN_CONTRACT');
    const token = typeof value.token === 'string' ? value.token.trim() : '';
    if (token) cleanupTokens.add(token);
    if (value.role !== account.role || !token || typeof value.userId !== 'string' || !value.userId || value.email !== account.email) {
      throw new Error('DEMO_SMOKE_LOGIN_CONTRACT');
    }
    return { token, userId: value.userId, role: value.role, email: value.email };
  };

  let failure: unknown;
  try {
    const loginResults = await Promise.allSettled([
      login(demoPresentation.accounts.business), login(demoPresentation.accounts.worker), login(demoPresentation.accounts.admin),
    ]);
    const failedLogin = loginResults.find((result) => result.status === 'rejected');
    if (failedLogin?.status === 'rejected') throw failedLogin.reason;
    const [business, worker, admin] = loginResults.map((result) => (result as PromiseFulfilledResult<Session>).value) as [Session, Session, Session];
    await Promise.all([
      request('/auth/session', auth(business), 200, 'BUSINESS_SESSION'),
      request('/auth/session', auth(worker), 200, 'WORKER_SESSION'),
      request('/auth/session', auth(admin), 200, 'ADMIN_SESSION'),
    ]);

    const company = record(await request('/business/company', auth(business), 200, 'BUSINESS_COMPANY'), 'DEMO_SMOKE_BUSINESS_COMPANY');
    const shifts = records(await request('/business/shifts', auth(business), 200, 'BUSINESS_SHIFTS'), 'DEMO_SMOKE_BUSINESS_SHIFTS');
    const flowShift = shifts.find((shift) => shift.id === demoPresentation.ids.flowShift);
    const historyShift = shifts.find((shift) => shift.id === demoPresentation.ids.historyShift);
    if (!flowShift || !historyShift || typeof company.id !== 'string') throw new Error('DEMO_SMOKE_BUSINESS_SCENARIO');
    const flowApplications = records(await request(`/business/shifts/${demoPresentation.ids.flowShift}/applications`, auth(business), 200, 'BUSINESS_APPLICATIONS'), 'DEMO_SMOKE_BUSINESS_APPLICATIONS');
    if (!flowApplications.some((application) => application.status === 'PENDING' && record(application.worker, 'DEMO_SMOKE_WORKER_LINK').id === worker.userId)) {
      throw new Error('DEMO_SMOKE_PENDING_APPLICATION');
    }

    const workerApplications = records(await request('/workers/applications', auth(worker), 200, 'WORKER_APPLICATIONS'), 'DEMO_SMOKE_WORKER_APPLICATIONS');
    if (!workerApplications.some((application) => application.shiftId === demoPresentation.ids.flowShift && application.status === 'PENDING')
      || !workerApplications.some((application) => application.shiftId === demoPresentation.ids.historyShift && application.status === 'ACCEPTED')) {
      throw new Error('DEMO_SMOKE_WORKER_SCENARIO');
    }
    const wallet = record(await request('/workers/wallet', auth(worker), 200, 'WORKER_WALLET'), 'DEMO_SMOKE_WORKER_WALLET');
    if (!records(wallet.movements, 'DEMO_SMOKE_WORKER_WALLET').some((movement) => movement.reference === 'DEMO-PAGO-HISTORIAL-001' && movement.status === 'RELEASED')) {
      throw new Error('DEMO_SMOKE_WORKER_PAYMENT');
    }
    await request('/workers/conversations', auth(worker), 200, 'WORKER_CONVERSATIONS');

    const overview = record(await request('/admin/overview', auth(admin), 200, 'ADMIN_OVERVIEW'), 'DEMO_SMOKE_ADMIN_OVERVIEW');
    if (![overview.companies, overview.workers, overview.activeShifts, overview.pendingApplications].every((value) => typeof value === 'number' && value >= 1)) {
      throw new Error('DEMO_SMOKE_ADMIN_METRICS');
    }
    const companies = records(await request('/admin/companies', auth(admin), 200, 'ADMIN_COMPANIES'), 'DEMO_SMOKE_ADMIN_COMPANIES');
    const demoCompany = companies.find((candidate) => candidate.id === company.id);
    if (!demoCompany || record(demoCompany.owner, 'DEMO_SMOKE_ADMIN_COMPANY_OWNER').id !== business.userId) throw new Error('DEMO_SMOKE_ADMIN_COMPANY');
    const workers = records(await request('/admin/workers', auth(admin), 200, 'ADMIN_WORKERS'), 'DEMO_SMOKE_ADMIN_WORKERS');
    if (!workers.some((candidate) => candidate.id === worker.userId)) throw new Error('DEMO_SMOKE_ADMIN_WORKER');

    await Promise.all([
      request('/business/company', auth(worker), 403, 'WORKER_FORBIDDEN_BUSINESS'),
      request('/admin/overview', auth(business), 403, 'BUSINESS_FORBIDDEN_ADMIN'),
      request('/business/company', auth(admin), 403, 'ADMIN_FORBIDDEN_BUSINESS'),
    ]);
    return { companyId: company.id, activeShifts: shifts.length, pendingApplications: flowApplications.length };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cleanups = await Promise.allSettled([...cleanupTokens].map((token) => request('/auth/session', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }, 204, 'SESSION_CLEANUP')));
    if (!failure && cleanups.some((result) => result.status === 'rejected')) throw new Error('DEMO_SMOKE_SESSION_CLEANUP_FAILED');
  }
}
