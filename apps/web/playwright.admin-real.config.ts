import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración separada y deliberadamente NO conectada a `npm test` ni a
 * `npm run test:web`. A diferencia de `playwright.config.ts` (que simula la
 * API en el navegador, ver `apps/web/e2e/fixtures/business-api.ts`), esta
 * suite arranca la API real de Express contra PostgreSQL real y el panel
 * Next.js real, y ejecuta Playwright contra ese stack completo.
 *
 * Requiere una base PostgreSQL ya creada y accesible, con nombre terminado
 * en `_test`, y las variables de entorno documentadas en
 * `apps/web/e2e/README.md` (sección "Suite E2E real del panel superadmin").
 * Sin `CHAMBEAYA_E2E_REAL_TESTS=true` y `CHAMBEAYA_E2E_DATABASE_URL`, el
 * arranque de la API falla con un error explícito antes de tocar ninguna
 * base de datos (ver `apps/api/scripts/e2e-serve.ts`).
 */
const webPort = Number(process.env.CHAMBEAYA_E2E_WEB_PORT ?? 3400);
const apiPort = Number(process.env.CHAMBEAYA_E2E_API_PORT ?? 4400);
const baseURL = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm exec --workspace=@chambeaya/api -- tsx scripts/e2e-serve.ts',
      cwd: '../..',
      url: `${apiOrigin}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        CHAMBEAYA_E2E_REAL_TESTS: 'true',
        DATABASE_URL: process.env.CHAMBEAYA_E2E_DATABASE_URL ?? '',
        API_PORT: String(apiPort),
      },
    },
    {
      command: `npm run build --workspace=@chambeaya/web && npm run start --workspace=@chambeaya/web -- --hostname 127.0.0.1 --port ${webPort}`,
      cwd: '../..',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: `${apiOrigin}/api`,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
