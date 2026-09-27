import type { Page } from '@playwright/test';
import { emptyCommissionsReport, expect, type AdminCommissionsReport } from './fixtures/admin-api';
import { account, session, test } from './fixtures/admin-api';

// Sección "Comisiones" del panel de superadmin (Alcance D): cuánto le
// corresponde facturar Chambeaya a cada empresa en modo manual, y el
// desglose de asignaciones cerradas sin pago (para detectar evasión de la
// comisión).

async function login(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Correo', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Centro de control', exact: true })).toBeVisible();
}

const sampleReport: AdminCommissionsReport = {
  period: { from: '2026-09-01', to: '2026-09-30', fromUtc: '2026-09-01T05:00:00.000Z', toUtcExclusive: '2026-10-01T05:00:00.000Z' },
  totals: { toInvoiceCents: 150000, toInvoiceTaxCents: 2700, collectedCents: 0, pendingCollectionCents: 0, payments: 2, pendingResolution: 3 },
  companies: [
    {
      companyId: 'company-a', name: 'Restaurante Demo', ruc: '20123456789',
      toInvoiceCents: 100000, toInvoiceTaxCents: 1800, collectedCents: 0, pendingCollectionCents: 0,
      payments: 1, closedWithoutPayment: 2, pendingResolution: 1,
    },
    {
      companyId: 'company-b', name: 'Café del Cielo', ruc: '20987654321',
      toInvoiceCents: 50000, toInvoiceTaxCents: 900, collectedCents: 0, pendingCollectionCents: 0,
      payments: 1, closedWithoutPayment: 0, pendingResolution: 2,
    },
  ],
};

test.use({ commissionsReport: sampleReport });

test('el resumen muestra la comisión por facturar del mes en curso, con el IGV aparte', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Comisión por facturar (mes en curso)', { exact: true })).toBeVisible();
  await expect(page.getByText('S/ 1,500.00', { exact: true })).toBeVisible();
  await expect(page.getByText('+ IGV S/ 27.00', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Ver desglose por empresa/ }).click();
  await expect(page.getByRole('heading', { name: 'Comisiones', exact: true })).toBeVisible();
});

test('la sección Comisiones muestra el desglose por empresa, incluido closedWithoutPayment y pendingResolution', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Comisiones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comisiones', exact: true })).toBeVisible();

  await expect(page.getByText('Restaurante Demo', { exact: true })).toBeVisible();
  await expect(page.getByText('Café del Cielo', { exact: true })).toBeVisible();
  await expect(page.getByText('2 cerrados sin pago', { exact: true })).toBeVisible();
  await expect(page.getByText('0 cerrados sin pago', { exact: true })).toBeVisible();
  await expect(page.getByText('1 pendientes de decisión', { exact: true })).toBeVisible();
  await expect(page.getByText('2 pendientes de decisión', { exact: true })).toBeVisible();
});

test('el filtro de período pide un nuevo reporte con from/to', async ({ page, browserApi }) => {
  await login(page);
  await page.getByRole('button', { name: 'Comisiones', exact: true }).click();

  await page.getByLabel('Desde', { exact: true }).fill('2026-08-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-08-31');
  const refetched = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/admin/commissions'
    && new URL(response.url()).searchParams.get('from') === '2026-08-01');
  await page.getByRole('button', { name: 'Aplicar filtro', exact: true }).click();
  const response = await refetched;
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get('to')).toBe('2026-08-31');

  const commissionCalls = browserApi.calls.filter((call) => call.path === '/api/admin/commissions');
  expect(commissionCalls.every((call) => call.authorization === `Bearer ${session.token}`)).toBe(true);
  // Al menos la carga inicial del resumen, la carga inicial de la sección y
  // el filtro aplicado.
  expect(commissionCalls.length).toBeGreaterThanOrEqual(3);
});

test.describe('sin actividad en el período', () => {
  test.use({ commissionsReport: emptyCommissionsReport });

  test('muestra un estado vacío en la sección y S/ 0.00 en el resumen, en vez de una tabla vacía silenciosa', async ({ page }) => {
    await login(page);
    await expect(page.getByText('Comisión por facturar (mes en curso)', { exact: true })).toBeVisible();
    await expect(page.getByText('S/ 0.00', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Comisiones', exact: true }).click();
    await expect(page.getByText('Sin actividad en el período', { exact: true })).toBeVisible();
  });
});
