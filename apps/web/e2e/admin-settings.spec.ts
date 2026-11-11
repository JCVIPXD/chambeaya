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

// Sección "Configuración" del panel de superadmin (Alcance C del plan de
// pagos): ver y editar el % de comisión global. El IGV es de solo lectura y
// el cambio deja claro que solo aplica a turnos nuevos.
test('muestra el ajuste global vigente y permite editar la comisión', async ({ page, browserApi }) => {
  await login(page);
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();

  const commissionInput = page.getByLabel('Comisión de Chambeaya', { exact: true });
  await expect(commissionInput).toHaveValue('10');
  const taxInput = page.getByLabel('IGV sobre la comisión', { exact: true });
  await expect(taxInput).toHaveValue('18');
  await expect(taxInput).toBeDisabled();
  await expect(page.getByText('Todavía no se registró ningún cambio manual.', { exact: true })).toBeVisible();

  await commissionInput.fill('12.5');
  const patched = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/admin/settings'
    && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Guardar cambio', exact: true }).click();
  const response = await patched;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ commissionBps: 1250 });

  await expect(commissionInput).toHaveValue('12.5');
  await expect(page.getByText(`Último cambio por ${session.name}`, { exact: false })).toBeVisible();

  expect(browserApi.calls.filter((call) => call.path === '/api/admin/settings')).toEqual([
    { method: 'GET', path: '/api/admin/settings', authorization: `Bearer ${session.token}` },
    { method: 'PATCH', path: '/api/admin/settings', authorization: `Bearer ${session.token}` },
  ]);
});

test('muestra un error y no navega fuera de la sección si el porcentaje sale de rango', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();

  const commissionInput = page.getByLabel('Comisión de Chambeaya', { exact: true });
  await commissionInput.fill('75');
  await page.getByRole('button', { name: 'Guardar cambio', exact: true }).click();

  await expect(page.getByText('El porcentaje debe estar entre 0% y 50%.', { exact: true })).toBeVisible();
});
