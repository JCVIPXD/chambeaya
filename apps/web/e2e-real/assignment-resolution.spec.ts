import type { APIRequestContext, Page } from '@playwright/test';
import { businessAccount, expect, test } from './fixtures/business-real';

/**
 * Cierre manual de una asignación `NO_SHOW` desde el panel de la empresa,
 * contra el stack real (API Express, PostgreSQL y panel Next.js reales; ningún
 * `page.route`). Complementa `apps/web/e2e/assignment-resolution.spec.ts`, que
 * cubre la interfaz con la API simulada.
 *
 * Solo se cubre `NO_SHOW`: llegar a `ABANDONED` exige un check-in real y que
 * pasen 60 minutos desde `endsAt`, y ningún endpoint permite crear un turno ya
 * vencido ni adelantar el reloj. Ese caso queda cubierto por las pruebas de
 * servicio y por la suite simulada.
 *
 * El turno de cada prueba termina 12 s después de crearse (ver
 * `fixtures/business-real.ts`), así que la asignación varada se detecta con el
 * turno ya vencido: es exactamente el caso en que la API cierra el turno como
 * `CANCELLED` y la empresa igual debe poder cobrar a quien sí trabajó.
 */

async function openStrandedShift(page: Page, title: string) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(businessAccount.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(businessAccount.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Turnos', exact: true }).click();
  await page.locator('.managed-shift').filter({ hasText: title }).click();
  await expect(page.getByRole('heading', { name: `Postulaciones · ${title}` })).toBeVisible();
}

async function waitUntil(endsAtMs: number) {
  // El reloj real es el que decide el `NO_SHOW`: se espera a que el turno venza.
  await expect.poll(() => Date.now() > endsAtMs + 500, { intervals: [500], timeout: 30_000 }).toBe(true);
}

async function get<T>(api: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await api.get(path, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok(), `${path} → ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

type PaymentRow = { description: string; status: string; amountCents: number; assignment: { status: string } | null };
type ApplicationRow = { assignment: { status: string } | null };
type EventRow = { type: string; actorRole: string; detail: string | null };

test('la empresa confirma que el trabajador sí trabajó tras un NO_SHOW y queda un pago pendiente', async ({ page, api, strandedShift }) => {
  await waitUntil(strandedShift.endsAtMs);
  await openStrandedShift(page, strandedShift.title);

  const row = page.locator('.application-row').filter({ hasText: strandedShift.workerName });
  await expect(row.getByText('No se presentó a tiempo', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: `Confirmar que ${strandedShift.workerName} sí trabajó`, exact: true }).click();
  // El turno venció sin asignaciones viables: la API ya lo cerró como cancelado.
  await expect(row).toContainText('Aunque este turno figure como cancelado');
  await expect(row).toContainText('Chambeaya no cobra, guarda ni transfiere dinero');

  const [resolveResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && /\/assignments\/[^/]+\/resolve$/.test(response.url())),
    row.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true }).click(),
  ]);
  expect(resolveResponse.status()).toBe(200);
  expect(resolveResponse.request().postDataJSON()).toEqual({ outcome: 'COMPLETED' });

  await expect(page.locator('.toast')).toContainText(`Trabajo de ${strandedShift.workerName} confirmado`);
  await expect(row.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);
  await expect(row.getByText('No se presentó a tiempo')).toHaveCount(0);

  // Persistencia real: asignación COMPLETED y exactamente un pago PENDING.
  const applications = await get<ApplicationRow[]>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}/applications`);
  expect(applications.map((application) => application.assignment?.status)).toEqual(['COMPLETED']);
  const payments = (await get<PaymentRow[]>(api, strandedShift.businessToken, '/api/business/payments')).filter((payment) => payment.description.startsWith(strandedShift.title));
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({ status: 'PENDING', amountCents: 12000 });
  const events = await get<EventRow[]>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}/events`);
  expect(events.some((event) => event.actorRole === 'BUSINESS' && event.type === 'COMPLETED' && /no-show/.test(event.detail ?? ''))).toBe(true);

  // Y el pago pendiente aparece en la vista Pagos, sin recargar el panel.
  await page.getByRole('button', { name: 'Pagos', exact: true }).click();
  await expect(page.getByText(`${strandedShift.title} ·`)).toBeVisible();
  await expect(page.locator('.payment-status.pendiente').first()).toBeVisible();
});

test('la empresa cierra sin pago un NO_SHOW con motivo y no se genera ningún pago', async ({ page, api, strandedShift }) => {
  await waitUntil(strandedShift.endsAtMs);
  await openStrandedShift(page, strandedShift.title);

  const row = page.locator('.application-row').filter({ hasText: strandedShift.workerName });
  await row.getByRole('button', { name: `Cerrar sin pago la asignación de ${strandedShift.workerName}`, exact: true }).click();
  await row.getByLabel('Motivo (opcional)').fill('Nunca llegó y no avisó');

  const [resolveResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && /\/assignments\/[^/]+\/resolve$/.test(response.url())),
    row.getByRole('button', { name: 'Sí, cerrar sin pago', exact: true }).click(),
  ]);
  expect(resolveResponse.status()).toBe(200);
  expect(resolveResponse.request().postDataJSON()).toEqual({ outcome: 'CANCELLED', reason: 'Nunca llegó y no avisó' });

  await expect(page.locator('.toast')).toContainText(`Asignación de ${strandedShift.workerName} cerrada sin pago`);
  await expect(row.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);

  const applications = await get<ApplicationRow[]>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}/applications`);
  expect(applications.map((application) => application.assignment?.status)).toEqual(['CANCELLED']);
  const payments = (await get<PaymentRow[]>(api, strandedShift.businessToken, '/api/business/payments')).filter((payment) => payment.description.startsWith(strandedShift.title));
  expect(payments).toEqual([]);
  const events = await get<EventRow[]>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}/events`);
  expect(events.some((event) => event.actorRole === 'BUSINESS' && event.type === 'CANCELLED' && event.detail === 'Nunca llegó y no avisó')).toBe(true);

  // Un segundo intento sobre la misma asignación ya no es válido.
  const assignment = applications[0].assignment as unknown as { id: string };
  const again = await api.post(`/api/business/shifts/${strandedShift.shiftId}/assignments/${assignment.id}/resolve`, {
    headers: { Authorization: `Bearer ${strandedShift.businessToken}` },
    data: { outcome: 'COMPLETED' },
  });
  expect(again.status()).toBe(400);
  expect(await again.json()).toEqual({ error: 'ASSIGNMENT_NOT_RESOLVABLE' });
});
