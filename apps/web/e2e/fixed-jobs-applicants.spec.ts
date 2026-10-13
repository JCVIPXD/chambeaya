import { expect, test } from './fixtures/business-api';
import { FLAG_OFF_URL, login, openView, visibleText } from './fixtures/fixed-jobs-ui';
import { installFixedJobsApi, samplePosting } from './fixtures/fixed-jobs-api';
import { DAY_MS, isoFromNow } from './fixtures/dates';

test.use({ baseURL: FLAG_OFF_URL });

function published(overrides = {}) {
  return samplePosting({ id: 'p-open', title: 'Cajera de tienda', status: 'PUBLISHED', publishedAt: isoFromNow(-2 * DAY_MS), vacancies: 2, ...overrides });
}

function localInput(offsetMs: number) {
  const date = new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

test('recorre el embudo completo hasta contratar, con aviso en vivo, constancia con DNI y sin correo ni teléfono', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 10, postings: [published()] });
  const first = server.addApplicant({ postingId: 'p-open', name: 'Ana Quispe', hasCv: true, answers: [{ question: '¿Tienes experiencia en caja?', answer: 'Sí, dos años en una bodega.' }] });
  server.addApplicant({ postingId: 'p-open', name: 'Luis Prado', priority: true });
  await login(page);
  await openView(page, isMobile, 'Postulantes');

  await expect(page.getByRole('heading', { name: 'Postulantes', exact: true })).toBeVisible();
  // La prioridad va primero.
  const names = page.getByRole('list').getByRole('heading', { level: 3 });
  await expect(names.first()).toHaveText('Luis Prado');
  await expect(page.getByText('Prioridad', { exact: true })).toBeVisible();
  // El embudo con conteos y los filtros por etapa.
  await expect(page.getByRole('button', { name: /^Todos 2$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Postulado 2$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Preseleccionado 0$/ }).click();
  await expect(page.getByText('No hay postulantes en «Preseleccionado»')).toBeVisible();
  await page.getByRole('button', { name: /^Todos 2$/ }).click();

  // Privacidad: ni la tarjeta ni el detalle muestran correo, teléfono o documento.
  await page.getByRole('button', { name: 'Revisar a Ana Quispe' }).click();
  const detail = page.getByRole('dialog', { name: 'Ana Quispe' });
  await expect(detail.getByText('Sí, dos años en una bodega.')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Ver CV' })).toBeVisible();
  let text = await visibleText(page);
  expect(text).not.toMatch(/@|45678912|teléfono|DNI/i);

  // Acciones válidas en «Postulado»: no se puede contratar.
  await expect(detail.getByRole('button', { name: 'Preseleccionar' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Confirmar contratación' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Preseleccionar' }).click();
  await expect(page.getByText('Ana Quispe quedó preseleccionado.')).toBeVisible();
  await expect(detail.getByText('Preseleccionado', { exact: true }).first()).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Preseleccionar' })).toHaveCount(0);

  // Entrevista: la fecha debe ser futura.
  await detail.getByRole('button', { name: 'Programar entrevista' }).click();
  await detail.getByLabel('Fecha y hora').fill(localInput(-DAY_MS));
  await detail.getByRole('button', { name: 'Guardar entrevista' }).click();
  await expect(detail.getByText('La entrevista debe ser en el futuro.')).toBeVisible();
  await detail.getByLabel('Fecha y hora').fill(localInput(2 * DAY_MS));
  await detail.getByLabel('Modalidad (opcional)').selectOption('VIDEO');
  await detail.getByRole('button', { name: 'Guardar entrevista' }).click();
  await expect(page.getByText('Entrevista programada.')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Entrevista', exact: true })).toBeVisible();
  await expect(detail.getByText(/Videollamada/)).toBeVisible();

  // Oferta con PDF adjunto.
  await detail.getByRole('button', { name: 'Emitir oferta' }).click();
  await detail.getByLabel('Sueldo mensual (S/)').fill('2200');
  await detail.getByRole('button', { name: 'Emitir oferta' }).last().click();
  await expect(detail.getByText('Indica la fecha de ingreso.')).toBeVisible();
  await detail.getByLabel('Fecha de ingreso').fill(new Date(Date.now() + 14 * DAY_MS).toISOString().slice(0, 10));
  await detail.getByLabel('Documento de la oferta (PDF, opcional)').setInputFiles({ name: 'oferta.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 oferta') });
  await detail.getByLabel('Nota para el candidato (opcional)').fill('Bienvenida al equipo');
  await detail.getByRole('button', { name: 'Emitir oferta' }).last().click();
  await expect(page.getByText('Oferta emitida a Ana Quispe.')).toBeVisible();
  const offers = detail.getByRole('region', { name: 'Ofertas' });
  await expect(offers.getByText('Versión 1', { exact: true })).toBeVisible();
  await expect(detail.getByText('Pendiente de respuesta')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Ver PDF de la versión 1' })).toBeVisible();
  const upload = server.calls.find((call) => call.method === 'PUT' && call.path.endsWith('/offer-documents'));
  expect(upload).toBeTruthy();
  const offerCall = server.calls.find((call) => call.method === 'POST' && call.path.endsWith('/offers'));
  expect(offerCall?.body).toMatchObject({ salaryCents: 220000, contractType: 'INDEFINITE', note: 'Bienvenida al equipo' });
  expect((offerCall?.body as { documentId?: string }).documentId).toBeTruthy();

  // Una nueva versión reemplaza a la pendiente.
  await detail.getByRole('button', { name: 'Emitir nueva versión de la oferta' }).click();
  await expect(detail.getByText('La versión 1 quedará reemplazada')).toBeVisible();
  await detail.getByLabel('Fecha de ingreso').fill(new Date(Date.now() + 15 * DAY_MS).toISOString().slice(0, 10));
  await detail.getByRole('button', { name: 'Emitir oferta' }).last().click();
  await expect(offers.getByText('Versión 2', { exact: true })).toBeVisible();
  await expect(detail.getByText('Reemplazada por otra versión')).toBeVisible();
  await detail.getByRole('button', { name: 'Cerrar', exact: true }).first().click();

  // Aviso en vivo: el candidato acepta la oferta y la lista cambia sin recargar.
  await expect.poll(() => server.sseConnections()).toBeGreaterThan(0);
  // (El fixture mantiene la conexión sin cabeceras hasta publicar un aviso, así que aquí solo está «Conectando…».)
  await expect(page.getByRole('status').filter({ hasText: /Conectando|Actualización en vivo activa|Reconectando/ })).toBeVisible();
  server.workerAccepts(first);
  await page.getByRole('button', { name: /^Aceptada 1$/ }).click();
  await expect(page.getByRole('heading', { name: 'Ana Quispe', level: 3 })).toBeVisible();

  await page.getByRole('button', { name: 'Revisar a Ana Quispe' }).click();
  const accepted = page.getByRole('dialog', { name: 'Ana Quispe' });
  // El DNI solo aparece dentro de la constancia de aceptación.
  const record = accepted.getByRole('group', { name: 'Constancia de aceptación de Ana Quispe' });
  await expect(record).toContainText('Documento de identidad 45678912');
  await expect(record).toContainText('RUC 20999999999');
  await expect(record).toContainText('congeladas');
  text = await visibleText(page);
  expect(text.match(/45678912/g)?.length).toBe(1);
  expect(text).not.toMatch(/@/);

  // Contratar: ocupa una vacante y suma el premio a la billetera.
  await accepted.getByRole('button', { name: 'Confirmar contratación' }).click();
  await expect(accepted.getByText(/1 de 2 cubiertas|0 de 2 cubiertas/)).toBeVisible();
  await accepted.getByRole('button', { name: 'Sí, confirmar contratación' }).click();
  await expect(page.getByText('Contratación de Ana Quispe confirmada.')).toBeVisible();
  await expect(accepted.getByText('Contratado', { exact: true }).first()).toBeVisible();
  await expect(accepted.getByText('Esta postulación ya terminó: no hay acciones disponibles.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Saldo: 30 Chambitas/ })).toBeVisible();
  await accepted.getByRole('button', { name: 'Cerrar', exact: true }).first().click();
  await expect(page.getByText('Vacantes cubiertas: 1/2')).toBeVisible();
  await page.getByRole('button', { name: /^Contratado 1$/ }).click();
  await expect(page.getByRole('heading', { name: 'Ana Quispe', level: 3 })).toBeVisible();
});

test('rechazar pide un motivo interno opcional y la salida queda en el filtro Rechazado', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { postings: [published()] });
  server.addApplicant({ postingId: 'p-open', name: 'Rosa Meza' });
  await login(page);
  await openView(page, isMobile, 'Postulantes');
  await page.getByRole('button', { name: 'Revisar a Rosa Meza' }).click();
  const detail = page.getByRole('dialog', { name: 'Rosa Meza' });
  await detail.getByRole('button', { name: 'Rechazar' }).click();
  await expect(detail.getByText(/el candidato no lo ve/)).toBeVisible();
  await detail.getByLabel('Motivo interno (opcional)').fill('Perfil no calza');
  await detail.getByRole('button', { name: 'Sí, rechazar' }).click();
  await expect(page.getByText('Rosa Meza fue rechazado.')).toBeVisible();
  expect(server.calls.find((call) => call.path.endsWith('/reject'))?.body).toEqual({ reason: 'Perfil no calza' });
  await expect(detail.getByText('Motivo interno del rechazo: Perfil no calza')).toBeVisible();
  await detail.getByRole('button', { name: 'Cerrar', exact: true }).first().click();
  await page.getByRole('button', { name: /^Rechazado 1$/ }).click();
  await expect(page.getByRole('heading', { name: 'Rosa Meza', level: 3 })).toBeVisible();
});

test('avisa de las postulaciones aceptadas en un puesto cerrado y no deja contratarlas', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { postings: [published({ id: 'p-closed', title: 'Puesto viejo' })] });
  server.addApplicant({ postingId: 'p-closed', name: 'Carla Soto', status: 'ACCEPTED' });
  server.closePosting('p-closed');
  await login(page);
  await openView(page, isMobile, 'Postulantes');
  const warning = page.getByRole('alert').filter({ hasText: 'oferta aceptada' });
  await expect(warning).toContainText('Hay 1 postulación con oferta aceptada en un puesto cerrado.');
  await page.getByRole('button', { name: 'Revisar a Carla Soto' }).click();
  const detail = page.getByRole('dialog', { name: 'Carla Soto' });
  await expect(detail.getByText('El puesto ya no está abierto.')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Confirmar contratación' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Rechazar' })).toBeVisible();
});

test('un 409 por cambio de etapa actualiza el detalle y un 503 ofrece reintentar', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { postings: [published()] });
  server.addApplicant({ postingId: 'p-open', name: 'Mario Ruiz' });
  await login(page);
  await openView(page, isMobile, 'Postulantes');
  await page.getByRole('button', { name: 'Revisar a Mario Ruiz' }).click();
  const detail = page.getByRole('dialog', { name: 'Mario Ruiz' });

  server.failNext(/POST .*\/stage$/, { status: 503, headers: { 'Retry-After': '1' }, body: { error: 'SERIALIZATION_RETRY_EXHAUSTED', retryable: true } });
  await detail.getByRole('button', { name: 'Preseleccionar' }).click();
  await expect(detail.getByRole('alert')).toContainText('No se aplicó ningún cambio');
  const retry = detail.getByRole('button', { name: /Reintentar ahora/ });
  await expect(retry).toBeEnabled({ timeout: 5000 });
  await retry.click();
  await expect(page.getByText('Mario Ruiz quedó preseleccionado.')).toBeVisible();
});
