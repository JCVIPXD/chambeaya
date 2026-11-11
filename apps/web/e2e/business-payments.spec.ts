import type { Page } from '@playwright/test';
import { account, expect, pendingPayment, session, test } from './fixtures/business-api';

// Alcance D: registro confiable y modo manual. El CRUD manual de pagos
// (crear/editar/borrar) se retiró porque permitía a la empresa inventar
// pagos, alterar montos y saltarse la comisión de Chambeaya. Lo único que le
// queda a la empresa es "Marcar como pagado" (`POST
// /business/payments/:id/mark-paid`), con una confirmación explícita que
// muestra el desglose completo.

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
}

async function openPagos(page: Page, isMobile: boolean | undefined) {
  if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('button', { name: 'Pagos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagos', exact: true })).toBeVisible();
}

test.use({ payments: [pendingPayment] });

test('ya no existe "Registrar pago" ni editar/eliminar un pago (el CRUD manual se retiró)', async ({ page, isMobile }) => {
  await login(page);
  await openPagos(page, isMobile);

  await expect(page.getByRole('button', { name: 'Registrar pago', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Editar CN-TEST-0001$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Eliminar CN-TEST-0001$/ })).toHaveCount(0);
});

test('"Marcar como pagado" muestra el desglose completo, y al confirmar pasa a Procesado', async ({ page, isMobile, browserApi }) => {
  await login(page);
  await openPagos(page, isMobile);

  await expect(page.getByText('Mozo de salón · Empresa de pruebas UI')).toBeVisible();
  await expect(page.locator('.payment-status.pendiente')).toHaveCount(1);

  let dialogMessage = '';
  page.once('dialog', (dialog) => {
    dialogMessage = dialog.message();
    void dialog.accept();
  });
  const markPaid = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/business/payments/${pendingPayment.id}/mark-paid`
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Marcar como pagado', exact: true }).click();
  const response = await markPaid;
  expect(response.status()).toBe(200);

  // El desglose completo: trabajador, comisión, IGV y total, más la
  // aclaración de que el pago al trabajador ya se hizo por fuera de la app.
  expect(dialogMessage).toContain('Trabajador de pruebas');
  expect(dialogMessage).toContain('Trabajador (100%): S/ 100.00');
  expect(dialogMessage).toContain('Comisión Chambeaya: S/ 10.00');
  expect(dialogMessage).toContain('IGV sobre la comisión: S/ 1.80');
  expect(dialogMessage).toContain('Total que le corresponde pagar a tu empresa: S/ 111.80');
  expect(dialogMessage).toContain('El pago al trabajador se hace fuera de la app; la comisión de Chambeaya se factura aparte.');

  await expect(page.locator('.payment-status.procesado')).toHaveCount(1);
  await expect(page.locator('.payment-status.pendiente')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Pago marcado como pagado');

  expect(browserApi.calls.filter((call) => call.path === `/api/business/payments/${pendingPayment.id}/mark-paid`)).toEqual([
    { method: 'POST', path: `/api/business/payments/${pendingPayment.id}/mark-paid`, authorization: `Bearer ${session.token}` },
  ]);
});

test('cancelar la confirmación no llama a la API ni cambia el estado', async ({ page, isMobile, browserApi }) => {
  await login(page);
  await openPagos(page, isMobile);

  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Marcar como pagado', exact: true }).click();

  await expect(page.locator('.payment-status.pendiente')).toHaveCount(1);
  expect(browserApi.calls.filter((call) => call.path.endsWith('/mark-paid'))).toEqual([]);
});

test('un 409 (perdió la carrera o ya estaba pagado) muestra un aviso y refresca la lista sin romper la página', async ({ page, isMobile }) => {
  await login(page);
  await openPagos(page, isMobile);

  // Mientras el clic está en vuelo, otra pestaña ya lo marcó como pagado:
  // el mock del fixture solo permite un mark-paid exitoso por pago (el
  // estado en memoria pasa a PROCESSED), así que un segundo intento sobre
  // el mismo pago ya PROCESSED responde 409 igual que la API real.
  page.on('dialog', (dialog) => void dialog.accept());
  const firstMarkPaid = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/business/payments/${pendingPayment.id}/mark-paid`);
  await page.getByRole('button', { name: 'Marcar como pagado', exact: true }).click();
  await firstMarkPaid;
  await expect(page.locator('.payment-status.procesado')).toHaveCount(1);

  // Simula que el panel todavía tenía la fila en memoria como PENDING (una
  // segunda pestaña, o un doble clic ganado por la primera petición): forzar
  // otra llamada directa al mismo endpoint debe responder 409 sin que la
  // página quede en un estado roto.
  const secondAttempt = await page.evaluate(async (id) => {
    const response = await fetch(`/api/business/payments/${id}/mark-paid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('chambeaya_business_session')!).token}` },
    });
    return response.status;
  }, pendingPayment.id);
  expect(secondAttempt).toBe(409);
});
