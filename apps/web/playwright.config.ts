import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3100';
// Segundo panel compilado SIN la bandera de turnos temporales (el valor por defecto de producción).
export const flagOffURL = 'http://127.0.0.1:3101';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npm run build && npm run start -- --hostname 127.0.0.1 --port 3100',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // The browser fixture intercepts this origin; no real API or accounts are used.
        NEXT_PUBLIC_API_URL: `${baseURL}/api`,
        TEMPORARY_SHIFTS_ENABLED: 'true',
        NEXT_PUBLIC_TEMPORARY_SHIFTS_ENABLED: 'true',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
    {
      command: 'npm run build && npm run start -- --hostname 127.0.0.1 --port 3101',
      url: flagOffURL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: `${flagOffURL}/api`,
        NEXT_PUBLIC_TEMPORARY_SHIFTS_ENABLED: 'false',
        NEXT_DIST_DIR: '.next-flag-off',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
