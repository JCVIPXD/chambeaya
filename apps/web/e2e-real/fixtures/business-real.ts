import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Debe coincidir exactamente con `e2eBusinessAccount` de
 * `apps/api/scripts/e2e-serve.ts`, que siembra esta cuenta directamente en
 * PostgreSQL (el registro público rechaza el rol BUSINESS).
 */
export const businessAccount = {
  email: 'empresa.e2e@chambeaya.test',
  password: 'EmpresaE2E-2026!',
};

const apiPort = Number(process.env.CHAMBEAYA_E2E_API_PORT ?? 4400);
export const apiOrigin = `http://127.0.0.1:${apiPort}`;

export type StrandedShift = {
  title: string;
  shiftId: string;
  workerName: string;
  businessToken: string;
  /** Instante (ms epoch) a partir del cual el turno ya venció. */
  endsAtMs: number;
};

type Fixtures = {
  api: APIRequestContext;
  /**
   * Un turno real con una asignación que ya quedará `NO_SHOW` la primera vez
   * que la empresa abra sus postulaciones. Todo se arma por HTTP contra la API
   * real (turno, postulación de un trabajador recién registrado y aceptación).
   * No hay endpoint que permita crear una asignación ya `NO_SHOW`, y tampoco
   * uno que deje `startsAt` en el pasado y `endsAt` ya vencido: por eso el
   * turno empieza hace 90 minutos (fuera de la ventana de check-in de 60) y
   * termina unos segundos después de crearse; la prueba espera a que venza.
   */
  strandedShift: StrandedShift;
};

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what} falló: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = await playwrightRequest.newContext({ baseURL: apiOrigin });
    await use(api);
    await api.dispose();
  },
  strandedShift: async ({ api }, use) => {
    const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const title = `Turno E2E ${unique}`;

    const business = await json<{ token: string }>(
      await api.post('/api/auth/login', { data: businessAccount }),
      'Login de la empresa sembrada',
    );
    const businessHeaders = { Authorization: `Bearer ${business.token}` };

    const endsAtMs = Date.now() + 12_000;
    const shift = await json<{ id: string }>(
      await api.post('/api/business/shifts', {
        headers: businessHeaders,
        data: {
          title,
          location: 'Sede E2E, Lima',
          startsAt: new Date(Date.now() - 90 * 60_000).toISOString(),
          endsAt: new Date(endsAtMs).toISOString(),
          payCents: 12000,
          requiredWorkers: 1,
        },
      }),
      'Crear el turno',
    );

    const workerName = `Trabajador E2E ${unique}`;
    const worker = await json<{ token: string }>(
      await api.post('/api/auth/register', {
        data: {
          role: 'WORKER',
          name: workerName,
          email: `trabajador.e2e.${unique}@chambeaya.test`,
          password: 'TrabajadorE2E-2026!',
          dniOrRuc: String(10000000 + Math.floor(Math.random() * 89999999)),
        },
      }),
      'Registrar al trabajador',
    );
    const application = await json<{ id: string }>(
      await api.post(`/api/shifts/${shift.id}/applications`, {
        headers: { Authorization: `Bearer ${worker.token}` },
        data: {},
      }),
      'Postular al trabajador',
    );
    await json(
      await api.patch(`/api/business/shifts/${shift.id}/applications/${application.id}`, {
        headers: businessHeaders,
        data: { decision: 'ACCEPTED' },
      }),
      'Aceptar la postulación',
    );

    await use({ title, shiftId: shift.id, workerName, businessToken: business.token, endsAtMs });
  },
});

export { expect };
