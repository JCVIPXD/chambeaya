import { adminAccount, expect, test } from './fixtures/admin-real';

/**
 * Recorrido completo del panel superadmin contra el stack real: API Express
 * real, PostgreSQL real y el panel Next.js real (sin ningún mock de
 * `page.route`). A diferencia de `apps/web/e2e/*.spec.ts`, aquí una petición
 * HTTP realmente sale del navegador, cruza la red hacia la API real y toca
 * PostgreSQL.
 *
 * El trabajador que se borra lo crea la propia prueba (`testWorker`, vía
 * `POST /api/auth/register` real); no depende de ningún dato preexistente
 * de la estación. Ver `apps/web/e2e/README.md` para los requisitos de
 * arranque (base `_test`, opt-in explícito).
 */
test('el superadmin borra un trabajador real y la lista y el contador se actualizan', async ({
  page,
  testWorker,
}) => {
  await test.step('inicia sesión como ADMIN con la cuenta real sembrada', async () => {
    await page.goto('/admin');
    await page.getByLabel('Correo').fill(adminAccount.email);
    await page.getByLabel('Contraseña').fill(adminAccount.password);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.getByRole('heading', { name: 'Centro de control' })).toBeVisible();
  });

  await page.getByRole('button', { name: 'Trabajadores' }).click();

  const overviewWorkersMetric = page
    .locator('.admin-metric', { hasText: 'Trabajadores' })
    .locator('strong');
  const workersPanelCount = page.locator('.admin-panel-head:has(h2:text("Trabajadores")) .admin-count');
  const searchField = page.getByRole('textbox', { name: 'Buscar' });

  const overviewBefore = Number(await overviewWorkersMetric.textContent());
  const listBefore = Number(await workersPanelCount.textContent());

  await test.step('localiza al trabajador creado por la prueba y abre su detalle', async () => {
    await searchField.fill(testWorker.name);
    await expect(page.locator('.admin-worker', { hasText: testWorker.name })).toHaveCount(1);
    await page.locator('.admin-worker', { hasText: testWorker.name }).click();
    await expect(page.getByRole('heading', { name: testWorker.name })).toBeVisible();
    await expect(page.locator('dd', { hasText: testWorker.email })).toBeVisible();
  });

  await test.step('confirma el borrado real y verifica que la fila desaparece', async () => {
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Eliminar esta cuenta de trabajador');
      void dialog.accept();
    });
    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          /\/api\/admin\/workers\//.test(response.url()),
      ),
      page.getByRole('button', { name: 'Eliminar trabajador' }).click(),
    ]);
    expect(deleteResponse.status()).toBe(204);
    await expect(page.locator('.admin-worker', { hasText: testWorker.name })).toHaveCount(0);
    await expect(page.locator('.admin-error-banner')).toHaveCount(0);
  });

  await test.step('el contador de la lista y el resumen quedan en uno menos', async () => {
    await searchField.fill('');
    await expect(workersPanelCount).toHaveText(String(listBefore - 1));
    await expect(overviewWorkersMetric).toHaveText(String(overviewBefore - 1));
  });
});
