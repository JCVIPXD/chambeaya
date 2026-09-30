import type { Page } from '@playwright/test';

import { account, expect, session, simulatedPendingPayment, test } from './fixtures/business-api';

async function loginAndOpenPayments(page: Page, isMobile: boolean | undefined) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('button', { name: 'Pagos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagos', exact: true })).toBeVisible();
}

test.use({
  paymentSettings: { commissionBps: 1000, taxBps: 1800, currency: 'PEN', mode: 'simulated' },
  payments: [simulatedPendingPayment],
});

test('la empresa completa el checkout simulado y la aprobación usa el flujo persistido', async ({ page, isMobile, browserApi }) => {
  await loginAndOpenPayments(page, isMobile);

  await page.getByRole('button', { name: 'Pagar en simulador', exact: true }).click();
  await page.waitForURL(/\/pago-simulado\/checkout-browser-test-payment-simulated$/);
  await expect(page.getByRole('heading', { name: 'Pago simulado', exact: true })).toBeVisible();
  await expect(page.getByText('S/ 111.80', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Aprobar pago simulado', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pago simulado aprobado', exact: true })).toBeVisible();

  expect(browserApi.calls.filter((call) => call.path === `/api/business/payments/${simulatedPendingPayment.id}/checkout`)).toEqual([
    { method: 'POST', path: `/api/business/payments/${simulatedPendingPayment.id}/checkout`, authorization: `Bearer ${session.token}` },
  ]);
  expect(browserApi.calls.some((call) => call.path.endsWith('/approve') && call.method === 'POST')).toBe(true);
  expect(browserApi.calls.some((call) => call.path.endsWith('/mark-paid'))).toBe(false);
});

test('rechazar el checkout simulado devuelve el pago a pendiente', async ({ page, isMobile, browserApi }) => {
  await loginAndOpenPayments(page, isMobile);
  await page.getByRole('button', { name: 'Pagar en simulador', exact: true }).click();
  await page.waitForURL(/\/pago-simulado\//);

  await page.getByRole('button', { name: 'Rechazar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pago simulado rechazado', exact: true })).toBeVisible();
  expect(browserApi.calls.some((call) => call.path.endsWith('/reject') && call.method === 'POST')).toBe(true);
});

test('un checkout sin sesión no revela datos ni permite aprobarlo', async ({ page, browserApi }) => {
  await page.goto('/pago-simulado/checkout-no-autorizado');
  await expect(page.getByRole('heading', { name: 'Inicia sesión para continuar', exact: true })).toBeVisible();
  expect(browserApi.calls).toEqual([]);
});
