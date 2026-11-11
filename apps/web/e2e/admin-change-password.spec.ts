import type { Page } from '@playwright/test';
import { account, expect, session, test } from './fixtures/admin-api';

async function login(page: Page) {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Acceso superadmin', exact: true })).toBeVisible();
  await page.getByLabel('Correo', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Centro de control', exact: true })).toBeVisible();
}

test('cambia la contraseña del superadmin y avisa que se cerraron las demás sesiones', async ({ page, browserApi }) => {
  await login(page);
  await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cambiar contraseña' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Contraseña actual', { exact: true }).fill(account.password);
  await dialog.getByLabel('Nueva contraseña', { exact: true }).fill('NuevaClaveSegura2');
  await dialog.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('NuevaClaveSegura2');

  const change = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/password/change'
    && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  expect((await change).status()).toBe(200);

  await expect(dialog.getByText('Se cerraron todas tus', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  expect(browserApi.calls.filter((call) => call.path === '/api/auth/password/change')).toEqual([
    { method: 'POST', path: '/api/auth/password/change', authorization: `Bearer ${session.token}` },
  ]);
});

test('muestra el error de la API cuando la contraseña actual es incorrecta', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cambiar contraseña' });

  await dialog.getByLabel('Contraseña actual', { exact: true }).fill('Una-clave-incorrecta1');
  await dialog.getByLabel('Nueva contraseña', { exact: true }).fill('NuevaClaveSegura2');
  await dialog.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('NuevaClaveSegura2');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();

  await expect(dialog.getByRole('alert')).toHaveText('La contraseña actual no es correcta.');
  await expect(dialog).toBeVisible();
});

// Corrección de CN-20260926-008 (BAJO-2): antes, "Salir" esperaba hasta 8 s
// la respuesta de la API (`AbortSignal.timeout`) antes de limpiar el estado
// local, sin ninguna señal para quien esperaba. Ahora limpia de inmediato y
// llama a `DELETE /api/auth/session` sin bloquear la salida.
test('"Salir" limpia el estado local de inmediato y llama a DELETE /api/auth/session sin bloquear (best effort)', async ({ page, browserApi }) => {
  await login(page);

  const closed = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/session'
    && response.request().method() === 'DELETE');

  await page.getByRole('button', { name: 'Salir', exact: true }).click();

  // El estado local ya está limpio sin esperar la respuesta del servidor.
  await expect(page.getByRole('heading', { name: 'Acceso superadmin', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('chambeaya_admin_session'))).toBeNull();

  // La llamada al servidor sigue ocurriendo, best effort.
  expect((await closed).status()).toBe(204);
  expect(browserApi.calls.filter((call) => call.path === '/api/auth/session')).toEqual([
    { method: 'DELETE', path: '/api/auth/session', authorization: `Bearer ${session.token}` },
  ]);
});

test.describe('con la API caída', () => {
  test.use({ deleteSessionFails: true });

  // Corrección de CN-20260926-008 (BAJO-5): faltaba cobertura de que
  // "Salir" limpie el estado local aunque `DELETE /api/auth/session` falle.
  test('"Salir" limpia el estado local igual aunque el DELETE falle', async ({ page, browserApi }) => {
    await login(page);

    const failedDelete = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/session'
      && response.request().method() === 'DELETE');

    await page.getByRole('button', { name: 'Salir', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Acceso superadmin', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('chambeaya_admin_session'))).toBeNull();

    expect((await failedDelete).status()).toBe(500);
    expect(browserApi.calls.filter((call) => call.path === '/api/auth/session')).toEqual([
      { method: 'DELETE', path: '/api/auth/session', authorization: `Bearer ${session.token}` },
    ]);
  });
});
