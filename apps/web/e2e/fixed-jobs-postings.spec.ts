import { expect, test } from './fixtures/business-api';
import { FLAG_OFF_URL, login, openView } from './fixtures/fixed-jobs-ui';
import { installFixedJobsApi, samplePosting } from './fixtures/fixed-jobs-api';

// M5a: puestos fijos con el panel compilado SIN la bandera de turnos (el valor por defecto de producción).
test.use({ baseURL: FLAG_OFF_URL });

test('crea un borrador con validación espejo de la API y lo publica dentro de la cuota gratuita sin pedir confirmación', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 50 });
  await login(page);
  await openView(page, isMobile, 'Puestos');
  await expect(page.getByRole('heading', { name: 'Puestos', exact: true })).toBeVisible();
  await expect(page.getByText('Todavía no tienes puestos')).toBeVisible();

  await page.getByRole('button', { name: 'Nuevo puesto', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo puesto' });
  await expect(dialog).toBeVisible();

  // Validación en el cliente: nada viaja a la API.
  await dialog.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(dialog.getByText('El título debe tener entre 5 y 120 caracteres.')).toBeVisible();
  await expect(dialog.getByText('La descripción debe tener entre 20 y 5000 caracteres.')).toBeVisible();
  await expect(dialog.getByText('Ingresa el sueldo mensual mínimo en soles (hasta S/ 100 000).')).toBeVisible();
  expect(server.calls.some((call) => call.method === 'POST' && call.path === '/business/job-postings')).toBe(false);

  await dialog.getByLabel('Título del puesto').fill('Cajera de tienda de ropa');
  await dialog.getByLabel('Descripción', { exact: true }).fill('Atención al cliente, caja y reposición en una tienda de ropa en Lima.');
  await dialog.getByLabel('Ubicación').fill('Miraflores, Lima');
  await dialog.getByLabel('Sueldo mensual mínimo (S/)').fill('2000');
  await dialog.getByLabel('Sueldo mensual máximo (S/)').fill('1500');
  await dialog.getByLabel('Vacantes').fill('0');
  await dialog.getByRole('button', { name: 'Agregar pregunta' }).click();
  await dialog.getByLabel('Pregunta de filtro 1').fill('corta');
  await dialog.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(dialog.getByText('El máximo no puede ser menor que el mínimo.')).toBeVisible();
  await expect(dialog.getByText('Las vacantes deben ser un número entre 1 y 500.')).toBeVisible();
  await expect(dialog.getByText(/Cada pregunta debe tener entre 10 y 240/)).toBeVisible();

  await dialog.getByLabel('Sueldo mensual máximo (S/)').fill('2500');
  await dialog.getByLabel('Vacantes').fill('2');
  await dialog.getByLabel('Pregunta de filtro 1').fill('¿Tienes experiencia en caja?');
  await dialog.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Borrador guardado. Publícalo cuando esté listo.')).toBeVisible();

  const created = server.calls.find((call) => call.method === 'POST' && call.path === '/business/job-postings');
  expect(created?.body).toMatchObject({ title: 'Cajera de tienda de ropa', salaryMinCents: 200000, salaryMaxCents: 250000, vacancies: 2, screeningQuestions: ['¿Tienes experiencia en caja?'], modality: 'ONSITE', workload: 'FULL_TIME' });

  const row = page.getByRole('listitem').filter({ hasText: 'Cajera de tienda de ropa' });
  await expect(row.getByText('Borrador', { exact: true })).toBeVisible();
  await expect(row.getByText('Vacantes cubiertas: 0/2')).toBeVisible();

  // Dentro de la cuota gratuita (3/mes): se publica sin diálogo de confirmación y sin cobrar.
  await row.getByRole('button', { name: 'Publicar Cajera de tienda de ropa' }).click();
  await expect(page.getByText('«Cajera de tienda de ropa» publicado.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row.getByText('Publicado', { exact: true })).toBeVisible();
  expect(server.state.balance).toBe(50);
});

test('publicar fuera de la cuota muestra costo, cuota y saldo, y solo cobra al confirmar', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 25, freeQuota: 0, postings: [samplePosting({ id: 'p-cost', title: 'Auxiliar de almacén' })] });
  server.state.freeUsed = 0;
  await login(page);
  await openView(page, isMobile, 'Puestos');
  const row = page.getByRole('listitem').filter({ hasText: 'Auxiliar de almacén' });
  await row.getByRole('button', { name: 'Publicar Auxiliar de almacén' }).click();

  const dialog = page.getByRole('dialog', { name: 'Publicar «Auxiliar de almacén»' });
  await expect(dialog.locator('strong', { hasText: '10 Chambitas' })).toBeVisible();
  await expect(dialog.getByText('25 Chambitas')).toBeVisible(); // saldo actual
  await expect(dialog.getByText('15 Chambitas')).toBeVisible(); // saldo después
  await expect(dialog.getByText('Agotada (0 de 0 usadas)')).toBeVisible();
  expect(server.state.balance).toBe(25); // consultar el costo no cobra

  // Cancelar no cobra.
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  expect(server.state.balance).toBe(25);

  await row.getByRole('button', { name: 'Publicar Auxiliar de almacén' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar por 10 Chambitas' }).click();
  await expect(page.getByText('«Auxiliar de almacén» publicado. Se cobraron 10 Chambitas.')).toBeVisible();
  expect(server.state.balance).toBe(15);
  // El saldo de la barra superior se actualiza.
  await expect(page.getByRole('button', { name: /Saldo: 15 Chambitas/ })).toBeVisible();
});

test('saldo insuficiente bloquea solo la acción con costo, explica el camino y lleva a la Billetera', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 4, freeQuota: 0, postings: [samplePosting({ id: 'p-poor', title: 'Vendedor de mostrador' }), samplePosting({ id: 'p-live', title: 'Mozo', status: 'PUBLISHED', publishedAt: new Date().toISOString() })] });
  await login(page);
  await openView(page, isMobile, 'Puestos');

  await page.getByRole('listitem').filter({ hasText: 'Vendedor de mostrador' }).getByRole('button', { name: 'Publicar Vendedor de mostrador' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/No tienes saldo suficiente: te faltan/)).toContainText('6 Chambitas');
  await expect(dialog.getByRole('button', { name: /Publicar por/ })).toHaveCount(0);

  // Una acción gratuita (pausar) nunca se bloquea por saldo.
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Pausar Mozo' }).click();
  await expect(page.getByText('«Mozo» en pausa: ya no recibe postulaciones.')).toBeVisible();
  expect(server.state.balance).toBe(4);

  await page.getByRole('listitem').filter({ hasText: 'Vendedor de mostrador' }).getByRole('button', { name: 'Publicar Vendedor de mostrador' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ver mi Billetera' }).click();
  await expect(page.getByRole('heading', { name: 'Billetera', exact: true })).toBeVisible();
});

test('un 409 del servidor por saldo y por tope diario muestra mensajes claros sin cobrar', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 100, freeQuota: 0, postings: [samplePosting({ id: 'p-a', title: 'Puesto A' }), samplePosting({ id: 'p-b', title: 'Puesto B' })] });
  await login(page);
  await openView(page, isMobile, 'Puestos');

  // El saldo cambió entre la cotización y el cobro: el servidor responde 409.
  server.failNext(/POST \/business\/job-postings\/p-a\/publish/, { status: 409, body: { error: 'INSUFFICIENT_CURRENCY', cost: 10, balance: 3 } });
  await page.getByRole('button', { name: 'Publicar Puesto A' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar por 10 Chambitas' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('No tienes saldo suficiente.');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('te faltan 7 Chambitas');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).first().click();

  server.failNext(/POST \/business\/job-postings\/p-b\/publish/, { status: 409, body: { error: 'DAILY_SPEND_CAP_REACHED', cost: 10, dailyCap: 200, spentToday: 195 } });
  await page.getByRole('button', { name: 'Publicar Puesto B' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar por 10 Chambitas' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Alcanzaste el tope diario de gasto.');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('195 Chambitas de un tope de 200 Chambitas');
  expect(server.state.balance).toBe(100);
});

test('un 503 por reintentos agotados ofrece reintentar tras el Retry-After y no deja efectos a medias', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 40, freeQuota: 0, postings: [samplePosting({ id: 'p-busy', title: 'Puesto ocupado' })] });
  await login(page);
  await openView(page, isMobile, 'Puestos');
  server.failNext(/POST \/business\/job-postings\/p-busy\/publish/, {
    status: 503,
    headers: { 'Retry-After': '1' },
    body: { error: 'SERIALIZATION_RETRY_EXHAUSTED', message: 'ocupado', retryable: true },
  });

  await page.getByRole('button', { name: 'Publicar Puesto ocupado' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar por 10 Chambitas' }).click();
  const alert = page.getByRole('dialog').getByRole('alert');
  await expect(alert).toContainText('No se aplicó ningún cambio');
  expect(server.state.balance).toBe(40);
  const retry = page.getByRole('dialog').getByRole('button', { name: /Reintentar ahora/ });
  await expect(retry).toBeDisabled();
  await expect(retry).toBeEnabled({ timeout: 5000 });
  await retry.click();
  await expect(page.getByText('«Puesto ocupado» publicado. Se cobraron 10 Chambitas.')).toBeVisible();
  expect(server.state.balance).toBe(30);
});

test('destacar un puesto publicado muestra el costo, edita un borrador, pausa y cierra con aviso de consecuencias', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, {
    balance: 30,
    postings: [
      samplePosting({ id: 'p-live', title: 'Cocinero', status: 'PUBLISHED', publishedAt: new Date().toISOString() }),
      samplePosting({ id: 'p-draft', title: 'Borrador editable' }),
    ],
  });
  await login(page);
  await openView(page, isMobile, 'Puestos');

  await page.getByRole('button', { name: 'Destacar Cocinero' }).click();
  await expect(page.getByRole('dialog').locator('strong', { hasText: '10 Chambitas' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Destacar por 10 Chambitas' }).click();
  await expect(page.getByText(/«Cocinero» destacado hasta el/)).toBeVisible();
  await expect(page.getByText(/Destacado hasta el/)).toBeVisible();
  expect(server.state.balance).toBe(20);
  // Ya destacado: repetir no cobra ni pide confirmación.
  await page.getByRole('button', { name: 'Destacar Cocinero' }).click();
  await expect(page.getByText('«Cocinero» ya estaba destacado.')).toBeVisible();
  expect(server.state.balance).toBe(20);

  // Editar un borrador solo envía lo que cambió.
  await page.getByRole('button', { name: 'Editar Borrador editable' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar puesto' });
  await dialog.getByLabel('Título del puesto').fill('Borrador editado');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Puesto actualizado.')).toBeVisible();
  const patch = server.calls.find((call) => call.method === 'PATCH');
  expect(patch?.body).toEqual({ title: 'Borrador editado' });

  await page.getByRole('button', { name: 'Cerrar Cocinero' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Cerrar «Cocinero»?' });
  await expect(confirm.getByText(/las ofertas pendientes se retiran/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Sí, cerrar el puesto' }).click();
  await expect(page.getByText('«Cocinero» cerrado.')).toBeVisible();
  const closed = page.getByRole('listitem').filter({ hasText: 'Cocinero' });
  await expect(closed.getByText('Cerrado', { exact: true })).toBeVisible();
  await expect(closed.getByRole('button', { name: 'Cerrar Cocinero' })).toHaveCount(0);
});

test('el diálogo se maneja con teclado: Escape cierra y el foco vuelve al botón que lo abrió', async ({ page, isMobile }) => {
  await installFixedJobsApi(page, { postings: [samplePosting({ id: 'p-k', title: 'Puesto teclado' })] });
  await login(page);
  await openView(page, isMobile, 'Puestos');
  const edit = page.getByRole('button', { name: 'Editar Puesto teclado' });
  await edit.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Editar puesto' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
});
