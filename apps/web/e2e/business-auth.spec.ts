import type { Page } from '@playwright/test';
import { account, company, expect, session, test } from './fixtures/business-api';

const sessionKey = 'cumplenow_business_session';

async function login(page: Page, password = account.password) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toBeVisible();
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
}

async function expectDashboard(page: Page) {
  // Company name comes from the API fixture, not the transient session fallback.
  await expect(page.getByRole('heading', { name: `Buenos días, ${company.name}`, exact: true }))
    .toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
}

test('accede con credenciales correctas y conserva la sesión al recargar', async ({ page, browserApi }) => {
  await login(page);
  await expectDashboard(page);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), sessionKey)).toEqual(session);

  await page.reload();
  await expectDashboard(page);
  expect(browserApi.calls.filter((call) => call.path === '/api/auth/login')).toHaveLength(1);
  expect(browserApi.calls.filter((call) => call.path === '/api/auth/session')).toEqual([
    { method: 'GET', path: '/api/auth/session', authorization: `Bearer ${session.token}` },
  ]);
});

test('rechaza credenciales incorrectas y permite corregirlas', async ({ page, browserApi }) => {
  await login(page, 'Una-clave-incorrecta');
  const formError = page.getByRole('main').getByRole('alert');
  await expect(formError).toHaveText('Correo o contraseña incorrectos.');
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ingresar al panel', exact: true })).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), sessionKey)).toBeNull();
  expect(browserApi.calls.map(({ method, path }) => ({ method, path }))).toEqual([
    { method: 'POST', path: '/api/auth/login' },
  ]);

  // Recovery uses the same form, without refreshing or bypassing the UI.
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expectDashboard(page);
  await expect(formError).toHaveCount(0);
});

test('cierra la sesión y permanece fuera del panel al recargar', async ({ page, browserApi, isMobile }) => {
  await login(page);
  await expectDashboard(page);
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }

  const closed = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/session'
    && response.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  expect((await closed).status()).toBe(204);
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), sessionKey)).toBeNull();
  await expect(page.getByRole('heading', { name: `Buenos días, ${company.name}`, exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toBeVisible();
  expect(browserApi.calls.filter((call) => call.path === '/api/auth/session')).toEqual([
    { method: 'DELETE', path: '/api/auth/session', authorization: `Bearer ${session.token}` },
  ]);
});
