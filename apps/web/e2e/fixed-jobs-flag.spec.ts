import { expect, test } from './fixtures/business-api';
import { FLAG_OFF_URL, login, visibleText } from './fixtures/fixed-jobs-ui';
import { installFixedJobsApi, samplePosting } from './fixtures/fixed-jobs-api';

const SHIFT_PATHS = [
  '/api/business/shifts', '/api/business/workers', '/api/business/conversations', '/api/business/payments',
  '/api/business/applications/pending', '/api/business/payment-settings',
];

test.describe('bandera de turnos temporales apagada', () => {
  test.use({ baseURL: FLAG_OFF_URL });

  test('la navegación solo ofrece puestos fijos y no queda ningún rastro del flujo de turnos', async ({ page, isMobile, browserApi }) => {
    await installFixedJobsApi(page, { postings: [samplePosting({ id: 'p-1', title: 'Cajera', status: 'PUBLISHED', publishedAt: new Date().toISOString() })] });
    await login(page);
    if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    const nav = page.getByRole('navigation');
    const labels = await nav.getByRole('button').allInnerTexts();
    expect(labels.map((label) => label.replace(/\s*\d+$/, '').trim())).toEqual(['Resumen', 'Puestos', 'Postulantes', 'Talento', 'Billetera', 'Perfil de empresa']);
    if (isMobile) await page.locator('.sidebar-close').click();

    // Resumen de puestos fijos.
    await expect(page.getByRole('heading', { name: /^Hola, / })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear un puesto' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar turno' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Equipo/ })).toHaveCount(0);
    await expect(page.getByLabel('Periodo')).toHaveCount(0);

    // Recorre cada vista y comprueba que no aparece vocabulario de turnos en ninguna.
    for (const name of ['Puestos', 'Postulantes', 'Talento', 'Billetera', 'Perfil de empresa', 'Resumen']) {
      if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
      await nav.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Cargando' })).toHaveCount(0, { timeout: 10_000 });
      const text = await visibleText(page);
      expect(text, `vista ${name}`).not.toMatch(/\bturnos?\b|rescate|check-in|asignaci[oó]n|Membres[ií]a|Mensajes|Pagos\b|Trabajadores/i);
    }

    // El drawer de notificaciones tampoco habla de turnos.
    await page.getByRole('button', { name: 'Ver notificaciones' }).click();
    expect(await page.getByRole('complementary', { name: 'Notificaciones' }).innerText()).not.toMatch(/turno/i);

    // Y el panel jamás consulta la API del flujo de turnos.
    const touched = browserApi.calls.filter((call) => SHIFT_PATHS.includes(call.path));
    expect(touched).toEqual([]);
  });
});

test.describe('bandera de turnos temporales encendida', () => {
  test('conserva el flujo de turnos y suma las vistas de puestos fijos sin regresión', async ({ page, isMobile }) => {
    await installFixedJobsApi(page);
    await login(page);
    if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    const nav = page.getByRole('navigation');
    const labels = (await nav.getByRole('button').allInnerTexts()).map((label) => label.replace(/\s*\d+$/, '').trim());
    expect(labels).toEqual(['Resumen', 'Puestos', 'Postulantes', 'Talento', 'Billetera', 'Turnos', 'Trabajadores', 'Mensajes', 'Pagos', 'Membresía', 'Perfil de empresa']);
    await nav.getByRole('button', { name: 'Turnos', exact: true }).click();
    await expect(page.getByRole('button', { name: /Nuevo turno/ })).toBeVisible();
    if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await nav.getByRole('button', { name: 'Puestos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Puestos', exact: true })).toBeVisible();
    await expect(page.getByText('Todavía no tienes puestos')).toBeVisible();
  });
});
