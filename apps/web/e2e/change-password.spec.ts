import type { Page } from '@playwright/test';
import { account, company, expect, test } from './fixtures/business-api';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toBeVisible();
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Buenos días, ${company.name}`, exact: true })).toBeVisible();
}

async function openChangePasswordModal(page: Page, isMobile: boolean | undefined) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Cambiar contraseña' })).toBeVisible();
}

test('cambia la contraseña y avisa que se cerraron las demás sesiones', async ({ page, browserApi, isMobile }) => {
  await login(page);
  await openChangePasswordModal(page, isMobile);

  const dialog = page.getByRole('dialog', { name: 'Cambiar contraseña' });
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
    { method: 'POST', path: '/api/auth/password/change', authorization: expect.stringContaining('Bearer ') },
  ]);
});

test('muestra el error de la API cuando la contraseña actual es incorrecta y no cierra el modal', async ({ page, isMobile }) => {
  await login(page);
  await openChangePasswordModal(page, isMobile);

  const dialog = page.getByRole('dialog', { name: 'Cambiar contraseña' });
  await dialog.getByLabel('Contraseña actual', { exact: true }).fill('Una-clave-incorrecta1');
  await dialog.getByLabel('Nueva contraseña', { exact: true }).fill('NuevaClaveSegura2');
  await dialog.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('NuevaClaveSegura2');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();

  await expect(dialog.getByRole('alert')).toHaveText('La contraseña actual no es correcta.');
  await expect(dialog).toBeVisible();
});

test('valida en el cliente antes de llamar a la API: nueva contraseña débil o distinta de la confirmación', async ({ page, browserApi, isMobile }) => {
  await login(page);
  await openChangePasswordModal(page, isMobile);

  const dialog = page.getByRole('dialog', { name: 'Cambiar contraseña' });
  // Suficientemente larga para no chocar con el `minLength={8}` nativo del
  // campo, pero sin mayúscula ni número: sigue siendo débil para
  // `isValidPassword` (misma regla que la API).
  await dialog.getByLabel('Contraseña actual', { exact: true }).fill(account.password);
  await dialog.getByLabel('Nueva contraseña', { exact: true }).fill('clavedebil');
  await dialog.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('clavedebil');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('demasiado débil');

  await dialog.getByLabel('Nueva contraseña', { exact: true }).fill('NuevaClaveSegura2');
  await dialog.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('OtraClaveSegura3');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('La confirmación no coincide con la nueva contraseña.');

  // Ninguna llamada llegó a la API: ambas se rechazaron en el cliente.
  expect(browserApi.calls.filter((call) => call.path === '/api/auth/password/change')).toEqual([]);
});

// Corrección de CN-20260926-008 (BAJO-1): antes, al abrir el modal el foco
// se quedaba en el botón que lo abrió y Escape no lo cerraba.
test('el modal mueve el foco al abrirse, se cierra con Escape y devuelve el foco al botón que lo abrió', async ({ page, isMobile }) => {
  await login(page);
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  const trigger = page.getByRole('button', { name: 'Cambiar contraseña', exact: true });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Cambiar contraseña' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Contraseña actual', { exact: true })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
