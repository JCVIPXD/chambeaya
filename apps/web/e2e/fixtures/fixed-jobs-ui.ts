import type { Page } from '@playwright/test';
import { account, expect } from './business-api';

/** Panel compilado SIN la bandera de turnos temporales (valor por defecto de producción). */
export const FLAG_OFF_URL = 'http://127.0.0.1:3101';

export async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
}

/** Abre una vista de la navegación lateral (en móvil, primero el menú). */
export async function openView(page: Page, isMobile: boolean | undefined, name: string) {
  if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('navigation', { name: undefined }).getByRole('button', { name, exact: true }).click();
}

/** Texto visible de todo el panel (sin cargar fuentes ni estilos). */
export async function visibleText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}
