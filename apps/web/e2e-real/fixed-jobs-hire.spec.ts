import type { APIRequestContext, Page } from '@playwright/test';
import { businessAccount, expect, test } from './fixtures/business-real';
import { adminAccount } from './fixtures/admin-real';

/**
 * M5a contra el stack real (API Express, PostgreSQL y panel Next.js reales; ningún `page.route`):
 * la empresa crea y publica un puesto desde el panel, un trabajador postula POR API, la empresa lo
 * preselecciona y le ofrece, el trabajador acepta POR API, y la empresa confirma la contratación en el panel.
 * Al final se verifica por API el estado real: postulación `HIRED`, puesto `FILLED` y el premio en la billetera.
 */

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  if (!response.ok()) throw new Error(`${what} falló: ${response.status()} ${await response.text()}`);
  return (await response.json()) as T;
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(businessAccount.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(businessAccount.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
}

test('publicar un puesto, postular por API y contratar desde el panel deja todo coherente en la base', async ({ page, api }) => {
  const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const title = `Puesto E2E ${unique}`;
  const workerName = `Candidata E2E ${unique}`;

  const business = await json<{ token: string }>(await api.post('/api/auth/login', { data: businessAccount }), 'Login de la empresa');
  const admin = await json<{ token: string }>(await api.post('/api/auth/login', { data: { email: adminAccount.email, password: adminAccount.password } }), 'Login del admin');
  const businessHeaders = { Authorization: `Bearer ${business.token}` };
  const company = await json<{ id: string }>(await api.get('/api/business/company', { headers: businessHeaders }), 'Empresa');
  // Saldo de sobra por si la cuota gratuita del mes (compartida con otras corridas) ya se agotó.
  await json(await api.post(`/api/admin/currency/companies/${company.id}/adjustments`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { quantity: 100, reason: 'Fondos para la prueba E2E', idempotencyKey: `e2e-fixed-jobs-${unique}` },
  }), 'Abonar saldo de prueba');
  const before = await json<{ balance: number }>(await api.get('/api/business/currency/balance', { headers: businessHeaders }), 'Saldo inicial');

  await login(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Puestos', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo puesto', exact: true }).first().click();
  const form = page.getByRole('dialog', { name: 'Nuevo puesto' });
  await form.getByLabel('Título del puesto').fill(title);
  await form.getByLabel('Descripción', { exact: true }).fill('Atención al cliente, caja y reposición en una tienda de ropa en Lima.');
  await form.getByLabel('Ubicación').fill('Miraflores, Lima');
  await form.getByLabel('Sueldo mensual mínimo (S/)').fill('1500');
  await form.getByLabel('Sueldo mensual máximo (S/)').fill('2000');
  await form.getByLabel('Vacantes').fill('1');
  await form.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByText('Borrador guardado. Publícalo cuando esté listo.')).toBeVisible();

  const row = page.getByRole('listitem').filter({ hasText: title });
  await row.getByRole('button', { name: `Publicar ${title}` }).click();
  // Puede ser gratis (sin diálogo) o costar 10: en ese caso se confirma.
  const confirm = page.getByRole('dialog').getByRole('button', { name: /^Publicar por/ });
  await expect(row.getByText('Publicado', { exact: true }).or(confirm)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
  await expect(row.getByText('Publicado', { exact: true })).toBeVisible();

  const postings = await json<{ items: Array<{ id: string; title: string; status: string }> }>(await api.get('/api/business/job-postings?limit=50', { headers: businessHeaders }), 'Mis puestos');
  const posting = postings.items.find((item) => item.title === title)!;
  expect(posting.status).toBe('PUBLISHED');

  // El candidato postula por la API real.
  const worker = await json<{ token: string }>(await api.post('/api/auth/register', {
    data: { role: 'WORKER', name: workerName, email: `candidata.e2e.${unique}@chambeaya.test`, password: 'TrabajadorE2E-2026!', dniOrRuc: String(10000000 + Math.floor(Math.random() * 89999999)) },
  }), 'Registrar al trabajador');
  const workerHeaders = { Authorization: `Bearer ${worker.token}` };
  const application = await json<{ id: string }>(await api.post(`/api/workers/job-postings/${posting.id}/applications`, { headers: workerHeaders, data: {} }), 'Postular');

  await page.getByRole('navigation').getByRole('button', { name: 'Postulantes', exact: true }).click();
  await page.getByLabel('Puesto', { exact: true }).selectOption(posting.id);
  await page.getByRole('button', { name: `Revisar a ${workerName}` }).click();
  const detail = page.getByRole('dialog', { name: workerName });
  // Privacidad contra datos reales: ni correo ni documento en el panel.
  const emailLocal = `candidata.e2e.${unique}`;
  expect(await page.locator('body').innerText()).not.toContain(emailLocal);
  await detail.getByRole('button', { name: 'Preseleccionar' }).click();
  await expect(detail.getByText('Preseleccionado', { exact: true }).first()).toBeVisible();
  await detail.getByRole('button', { name: 'Emitir oferta' }).click();
  await detail.getByLabel('Sueldo mensual (S/)').fill('1800');
  await detail.getByLabel('Fecha de ingreso').fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
  await detail.getByRole('button', { name: 'Emitir oferta' }).last().click();
  await expect(detail.getByRole('region', { name: 'Ofertas' }).getByText('Pendiente de respuesta')).toBeVisible();

  // El candidato acepta por la API real; el panel se actualiza solo (aviso en vivo).
  const mine = await json<{ currentOfferId: string }>(await api.get(`/api/workers/job-applications/${application.id}`, { headers: workerHeaders }), 'Mi postulación');
  await json(await api.post(`/api/workers/job-applications/${application.id}/offers/${mine.currentOfferId}/accept`, { headers: workerHeaders }), 'Aceptar la oferta');
  await expect(detail.getByRole('button', { name: 'Confirmar contratación' })).toBeVisible({ timeout: 15_000 });
  const record = detail.getByRole('group', { name: `Constancia de aceptación de ${workerName}` });
  await expect(record).toContainText('Documento de identidad');

  await detail.getByRole('button', { name: 'Confirmar contratación' }).click();
  await detail.getByRole('button', { name: 'Sí, confirmar contratación' }).click();
  await expect(detail.getByText('Contratado', { exact: true }).first()).toBeVisible();

  // Estado real en la base, leído por la API.
  const hired = await json<{ status: string }>(await api.get(`/api/business/job-applications/${application.id}`, { headers: businessHeaders }), 'Postulación final');
  expect(hired.status).toBe('HIRED');
  const finalPosting = await json<{ status: string; filledVacancies: number }>(await api.get(`/api/business/job-postings/${posting.id}`, { headers: businessHeaders }), 'Puesto final');
  expect(finalPosting).toMatchObject({ status: 'FILLED', filledVacancies: 1 });
  const movements = await json<{ items: Array<{ actionKey: string | null; quantity: number }> }>(await api.get('/api/business/currency/movements?limit=10', { headers: businessHeaders }), 'Movimientos');
  expect(movements.items.some((item) => item.actionKey === 'HIRE_CONFIRMED' && item.quantity > 0)).toBe(true);
  const after = await json<{ balance: number }>(await api.get('/api/business/currency/balance', { headers: businessHeaders }), 'Saldo final');
  expect(after.balance).toBeGreaterThan(before.balance - 11);

  // La Billetera del panel muestra el premio con el saldo resultante.
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Billetera', exact: true }).click();
  await expect(page.getByRole('table').getByText('Confirmar una contratación').first()).toBeVisible();
});
