import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Debe coincidir exactamente con `e2eAdminAccount` de
 * `apps/api/scripts/e2e-serve.ts`, que siembra esta cuenta directamente en
 * PostgreSQL antes de levantar la API real (el registro público rechaza el
 * rol ADMIN, así que no puede crearse por HTTP).
 */
export const adminAccount = {
  email: 'admin.e2e@chambeaya.test',
  password: 'AdminE2E-2026!',
};

const apiPort = Number(process.env.CHAMBEAYA_E2E_API_PORT ?? 4400);
export const apiOrigin = `http://127.0.0.1:${apiPort}`;

export type TestWorker = {
  name: string;
  email: string;
  password: string;
  identifier: string;
};

/**
 * Registra un trabajador real vía `POST /api/auth/register` (ruta pública,
 * permitida para el rol WORKER) para que la prueba tenga un registro propio
 * que borrar, sin depender de datos preexistentes de la base. El sufijo
 * aleatorio evita colisiones si la suite se ejecuta más de una vez contra la
 * misma base `_test` sin reiniciar el clúster.
 */
async function registerWorker(api: APIRequestContext): Promise<TestWorker> {
  const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const worker: TestWorker = {
    name: `Trabajador E2E ${unique}`,
    email: `trabajador.e2e.${unique}@chambeaya.test`,
    password: 'TrabajadorE2E-2026!',
    identifier: String(10000000 + Math.floor(Math.random() * 89999999)),
  };
  const response = await api.post('/api/auth/register', {
    data: {
      role: 'WORKER',
      name: worker.name,
      email: worker.email,
      password: worker.password,
      dniOrRuc: worker.identifier,
    },
  });
  if (!response.ok()) {
    throw new Error(
      `No se pudo registrar el trabajador de prueba: ${response.status()} ${await response.text()}`,
    );
  }
  return worker;
}

type Fixtures = {
  api: APIRequestContext;
  testWorker: TestWorker;
};

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = await playwrightRequest.newContext({ baseURL: apiOrigin });
    await use(api);
    await api.dispose();
  },
  testWorker: async ({ api }, use) => {
    const worker = await registerWorker(api);
    await use(worker);
    // No se limpia aquí a propósito: el propio spec borra este trabajador
    // desde el panel superadmin como parte de sus aserciones. Si un caso
    // termina sin llegar a borrarlo (falla antes), el registro queda en la
    // base `_test` de la ejecución, que es efímera y se descarta con el
    // clúster (ver README); no se reutiliza ninguna base persistente.
  },
});

export { expect };
