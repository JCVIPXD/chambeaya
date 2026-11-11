import { expect, test } from './fixtures/business-api';
import { FLAG_OFF_URL, login, openView } from './fixtures/fixed-jobs-ui';
import { installFixedJobsApi, sampleTalent } from './fixtures/fixed-jobs-api';

test.use({ baseURL: FLAG_OFF_URL });

test('la Billetera usa el nombre de la moneda de la API y muestra saldo, cuota, tope, costos, premios y movimientos paginados', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { currency: 'Soles Verdes', balance: 80, dailyCap: 150 });
  // 25 movimientos para forzar la segunda página (20 por página).
  for (let index = 1; index <= 25; index += 1) {
    server.state.movements.push({
      id: `m-${index}`, sequence: 26 - index, quantity: index % 2 === 0 ? -10 : 5, balanceAfter: 100 - index, action: index % 2 === 0 ? 'ACTION_CHARGE' : 'REWARD',
      actionKey: index % 2 === 0 ? 'JOB_HIGHLIGHT' : 'HIRE_CONFIRMED', reason: null, relatedEntity: null, refundOfId: null, actor: null, createdAt: new Date(Date.now() - index * 3_600_000).toISOString(),
    });
  }
  await login(page);
  await openView(page, isMobile, 'Billetera');
  await expect(page.getByRole('heading', { name: 'Billetera', exact: true })).toBeVisible();
  await expect(page.getByTestId('wallet-balance')).toHaveText('80 Soles Verdes');
  await expect(page.getByText('3 de 3 disponibles')).toBeVisible();
  await expect(page.getByText('0 Soles Verdes de 150 Soles Verdes')).toBeVisible();
  // Catálogo de costos y premios con su condición.
  await expect(page.getByRole('heading', { name: 'Destacar un puesto' })).toBeVisible();
  await expect(page.getByText('Devolución si no responden en 72 h')).toBeVisible();
  await expect(page.getByText('Cuando el equipo de Chambeaya verifica tu empresa.')).toBeVisible();
  await expect(page.getByText('Disponible', { exact: true }).first()).toBeVisible();
  // Nunca se escribe «Chambitas» a mano: solo el nombre de la API.
  await expect(page.locator('main')).not.toContainText('Chambitas');

  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(21); // encabezado + 20
  await expect(page.getByRole('columnheader', { name: 'Saldo resultante' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver más movimientos' }).click();
  await expect(rows).toHaveCount(26);
  await expect(page.getByRole('button', { name: 'Ver más movimientos' })).toHaveCount(0);
});

test('la Billetera vacía y los errores por sección ofrecen reintentar sin romper el resto', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 0 });
  server.failNext(/GET \/business\/currency\/rewards/, { status: 500, body: { error: 'INTERNAL_ERROR' } });
  await login(page);
  await openView(page, isMobile, 'Billetera');
  await expect(page.getByText('Todavía no tienes movimientos')).toBeVisible();
  await expect(page.getByText('No pudimos cargar los premios')).toBeVisible();
  await expect(page.getByTestId('wallet-balance')).toHaveText('0 Chambitas');
  await page.getByRole('region', { name: 'Premios' }).getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('Confirmar una contratación')).toBeVisible();
});

test('talento: invitar muestra el costo, desbloquear es idempotente y el contacto solo aparece tras desbloquear', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 20, talent: [sampleTalent({ id: 't-1', name: 'Bruno Vega', isHighlighted: true }), sampleTalent({ id: 't-2', name: 'Carmen Díaz' })] });
  await login(page);
  await openView(page, isMobile, 'Talento');
  await expect(page.getByRole('heading', { name: 'Bruno Vega' })).toBeVisible();
  await expect(page.getByText('Perfil destacado')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('@');

  // Invitar cuesta: mensaje opcional, luego costo y confirmación.
  await page.getByRole('button', { name: 'Invitar a Carmen Díaz' }).click();
  await page.getByRole('dialog').getByLabel('Mensaje (opcional)').fill('Hola Carmen');
  await page.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click();
  const invite = page.getByRole('dialog', { name: 'Invitar a Carmen Díaz' });
  await expect(invite.getByText('5 Chambitas').first()).toBeVisible();
  await expect(invite.locator('dd', { hasText: 'te devolvemos el costo' })).toBeVisible();
  await invite.getByRole('button', { name: 'Invitar por 5 Chambitas' }).click();
  await expect(page.getByText('Invitación enviada a Carmen Díaz.')).toBeVisible();
  expect(server.state.balance).toBe(15);
  expect(server.calls.find((call) => call.path === '/business/talent-invitations' && call.method === 'POST')?.body).toEqual({ workerTalentProfileId: 't-2', message: 'Hola Carmen' });
  await expect(page.getByText('Invitación pendiente')).toBeVisible();

  // Desbloquear: cobra una vez; ver el contacto después es gratis.
  await page.getByRole('button', { name: 'Desbloquear el contacto de Bruno Vega' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Desbloquear por 10 Chambitas' }).click();
  await expect(page.getByText('Contacto de Bruno Vega desbloqueado.')).toBeVisible();
  expect(server.state.balance).toBe(5);
  const contact = page.getByRole('group', { name: 'Contacto de Bruno Vega' });
  await expect(contact).toContainText('bruno@candidato.example');
  await expect(contact.getByRole('button', { name: 'Ver CV' })).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar el contacto de Bruno Vega' }).click();
  await page.getByRole('button', { name: 'Ver el contacto de Bruno Vega' }).click();
  await expect(contact).toBeVisible();
  expect(server.state.balance).toBe(5);

  // Sin saldo para otro desbloqueo: se explica sin ofrecer un botón de pago roto.
  await page.getByRole('button', { name: 'Desbloquear el contacto de Carmen Díaz' }).click();
  await expect(page.getByRole('dialog').getByText(/te faltan 5 Chambitas/)).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Desbloquear por/ })).toHaveCount(0);
});

test('un candidato ya invitado devuelve el 409 explícito sin cobrar de nuevo', async ({ page, isMobile }) => {
  const server = await installFixedJobsApi(page, { balance: 20, talent: [sampleTalent({ id: 't-3', name: 'Dora Paz' })] });
  await login(page);
  await openView(page, isMobile, 'Talento');
  server.failNext(/POST \/business\/talent-invitations/, { status: 409, body: { error: 'INVITATION_ALREADY_ACTIVE' } });
  await page.getByRole('button', { name: 'Invitar a Dora Paz' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Invitar por 5 Chambitas' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Ya invitaste a este candidato');
  expect(server.state.balance).toBe(20);
});
