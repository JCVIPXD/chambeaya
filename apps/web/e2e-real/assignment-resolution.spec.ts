import type { APIRequestContext, Page } from '@playwright/test';
import { businessAccount, expect, test } from './fixtures/business-real';
import { adminAccount } from './fixtures/admin-real';

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
 * `CANCELLED` por vencimiento y la empresa igual debe poder cobrar a quien sí
 * trabajó; al hacerlo, el turno deja de quedar `CANCELLED` (BAJO-5 de
 * CN-20260918-004). Cerrar sin pago, en cambio, no toca el turno.
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

type PaymentRow = {
  id: string; description: string; status: string; amountCents: number;
  commissionCents: number; taxCents: number; companyId: string;
  assignment: { status: string } | null;
};
type ApplicationRow = { assignment: { status: string } | null };
type EventRow = { type: string; actorRole: string; detail: string | null };
type ShiftRow = { status: string };
type CommissionsReport = {
  companies: { companyId: string; toInvoiceCents: number; toInvoiceTaxCents: number; payments: number; closedWithoutPayment: number; pendingResolution: number }[];
};

test('la empresa confirma que el trabajador sí trabajó tras un NO_SHOW y queda un pago pendiente', async ({ page, api, strandedShift }) => {
  await waitUntil(strandedShift.endsAtMs);
  await openStrandedShift(page, strandedShift.title);

  const row = page.locator('.application-row').filter({ hasText: strandedShift.workerName });
  await expect(row.getByText('No se presentó a tiempo', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: `Confirmar que ${strandedShift.workerName} sí trabajó`, exact: true }).click();
  // El turno venció sin asignaciones viables: la API ya lo cerró como cancelado.
  await expect(row).toContainText('Este turno figura como cancelado');
  await expect(row).toContainText('pasará a completado en cuanto ya no quede ningún cupo pendiente de tu decisión y al menos uno haya quedado confirmado como trabajado');
  await expect(row).toContainText('si lo cancelaste tú, seguirá cancelado');
  await expect(row).not.toContainText('Aunque este turno figure como cancelado');
  await expect(row).not.toContainText('se actualizará al confirmar');
  await expect(row).toContainText('El pago al trabajador se hace fuera de la app; la comisión de Chambeaya se factura aparte');

  const [resolveResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && /\/assignments\/[^/]+\/resolve$/.test(response.url())),
    row.getByRole('button', { name: `Sí, confirmar trabajo de ${strandedShift.workerName}`, exact: true }).click(),
  ]);
  expect(resolveResponse.status()).toBe(200);
  expect(resolveResponse.request().postDataJSON()).toEqual({ outcome: 'COMPLETED' });

  await expect(page.locator('.toast')).toContainText(`Trabajo de ${strandedShift.workerName} confirmado`);
  await expect(row.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);
  await expect(row.getByText('No se presentó a tiempo')).toHaveCount(0);

  // Persistencia real: asignación COMPLETED, exactamente un pago PENDING y el
  // turno ya no queda CANCELLED (era el cierre automático por vencimiento, no
  // una cancelación de la empresa).
  const shift = await get<ShiftRow>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}`);
  expect(shift.status).toBe('COMPLETED');
  const applications = await get<ApplicationRow[]>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}/applications`);
  expect(applications.map((application) => application.assignment?.status)).toEqual(['COMPLETED']);
  const payments = (await get<PaymentRow[]>(api, strandedShift.businessToken, '/api/business/payments')).filter((payment) => payment.description.startsWith(strandedShift.title));
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({ status: 'PENDING', amountCents: 12000 });
  const events = await get<EventRow[]>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}/events`);
  expect(events.some((event) => event.actorRole === 'BUSINESS' && event.type === 'COMPLETED' && /no-show/.test(event.detail ?? ''))).toBe(true);
  expect(events.some((event) => event.actorRole === 'BUSINESS' && event.type === 'UPDATED' && /pasó de CANCELLED a COMPLETED/.test(event.detail ?? ''))).toBe(true);

  // Y el pago pendiente aparece en la vista Pagos, sin recargar el panel.
  await page.getByRole('button', { name: 'Pagos', exact: true }).click();
  await expect(page.getByText(`${strandedShift.title} ·`)).toBeVisible();
  await expect(page.locator('.payment-status.pendiente').first()).toBeVisible();

  // Alcance D: "Marcar como pagado" (CRUD manual retirado) contra la API
  // real, y la comisión resultante aparece en el reporte del superadmin.
  const paymentRow = page.locator('.transaction-row').filter({ hasText: strandedShift.title });
  page.once('dialog', (dialog) => void dialog.accept());
  const markPaid = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/payments\/[^/]+\/mark-paid$/.test(response.url()));
  await paymentRow.getByRole('button', { name: 'Marcar como pagado', exact: true }).click();
  const markPaidResponse = await markPaid;
  expect(markPaidResponse.status()).toBe(200);
  await expect(paymentRow.locator('.payment-status.procesado')).toBeVisible();

  const [paidPayment] = (await get<PaymentRow[]>(api, strandedShift.businessToken, '/api/business/payments'))
    .filter((payment) => payment.description.startsWith(strandedShift.title));
  expect(paidPayment).toMatchObject({ status: 'PROCESSED' });

  const adminLogin = await api.post('/api/auth/login', { data: adminAccount });
  expect(adminLogin.ok(), `Login del admin sembrado → ${adminLogin.status()}`).toBe(true);
  const admin = (await adminLogin.json()) as { token: string };
  const report = await get<CommissionsReport>(api, admin.token, '/api/admin/commissions');
  const companyRow = report.companies.find((company) => company.companyId === paidPayment.companyId);
  expect(companyRow).toBeDefined();
  // "Por facturar" no depende de si ya se marcó pagado (modo manual: la
  // comisión de ESTE pago siempre suma), así que basta con que sea al menos
  // la de este pago -otros pagos de la misma empresa sembrada pueden sumar
  // más si la suite corrió antes en la misma base.
  expect(companyRow!.toInvoiceCents).toBeGreaterThanOrEqual(paidPayment.commissionCents);
  expect(companyRow!.toInvoiceTaxCents).toBeGreaterThanOrEqual(paidPayment.taxCents);
  expect(companyRow!.payments).toBeGreaterThanOrEqual(1);

  // Segundo intento sobre el mismo pago: ya no es marcable.
  const secondMarkPaid = await api.post(`/api/business/payments/${paidPayment.id}/mark-paid`, {
    headers: { Authorization: `Bearer ${strandedShift.businessToken}` },
  });
  expect(secondMarkPaid.status()).toBe(409);
  expect(await secondMarkPaid.json()).toEqual({ error: 'PAYMENT_NOT_PAYABLE' });
});

test('la empresa cierra sin pago un NO_SHOW con motivo y no se genera ningún pago', async ({ page, api, strandedShift }) => {
  await waitUntil(strandedShift.endsAtMs);
  await openStrandedShift(page, strandedShift.title);

  const row = page.locator('.application-row').filter({ hasText: strandedShift.workerName });
  await row.getByRole('button', { name: `Cerrar sin pago la asignación de ${strandedShift.workerName}`, exact: true }).click();
  await row.getByLabel('Motivo (opcional)').fill('Nunca llegó y no avisó');

  const [resolveResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && /\/assignments\/[^/]+\/resolve$/.test(response.url())),
    row.getByRole('button', { name: `Sí, cerrar sin pago la asignación de ${strandedShift.workerName}`, exact: true }).click(),
  ]);
  expect(resolveResponse.status()).toBe(200);
  expect(resolveResponse.request().postDataJSON()).toEqual({ outcome: 'CANCELLED', reason: 'Nunca llegó y no avisó' });

  await expect(page.locator('.toast')).toContainText(`Asignación de ${strandedShift.workerName} cerrada sin pago`);
  await expect(row.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);

  const applications = await get<ApplicationRow[]>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}/applications`);
  expect(applications.map((application) => application.assignment?.status)).toEqual(['CANCELLED']);
  // Cerrar sin pago no reabre nada: el turno cerrado por vencimiento sigue CANCELLED.
  expect((await get<ShiftRow>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}`)).status).toBe('CANCELLED');
  const payments = (await get<PaymentRow[]>(api, strandedShift.businessToken, '/api/business/payments')).filter((payment) => payment.description.startsWith(strandedShift.title));
  expect(payments).toEqual([]);
  const events = await get<EventRow[]>(api, strandedShift.businessToken, `/api/business/shifts/${strandedShift.shiftId}/events`);
  // El `detail` es el motivo tal cual lo escribió la empresa: `closedWithoutPayment`
  // (corrección de MEDIO-1 de CN-20260926-020) ya no depende de ningún
  // texto, así que este `detail` no necesita ningún prefijo fijo.
  expect(events.some((event) =>
    event.actorRole === 'BUSINESS' && event.type === 'CANCELLED' && event.detail === 'Nunca llegó y no avisó')).toBe(true);

  // La señal estructurada (nunca el texto): esta empresa debe aparecer con
  // al menos un `closedWithoutPayment` en el reporte de comisiones.
  const company = await get<{ id: string }>(api, strandedShift.businessToken, '/api/business/company');
  const adminLoginForClosed = await api.post('/api/auth/login', { data: adminAccount });
  expect(adminLoginForClosed.ok(), `Login del admin sembrado → ${adminLoginForClosed.status()}`).toBe(true);
  const adminForClosed = (await adminLoginForClosed.json()) as { token: string };
  const closedReport = await get<CommissionsReport>(api, adminForClosed.token, '/api/admin/commissions');
  const closedCompanyRow = closedReport.companies.find((row) => row.companyId === company.id);
  expect(closedCompanyRow?.closedWithoutPayment).toBeGreaterThanOrEqual(1);

  // Un segundo intento sobre la misma asignación ya no es válido.
  const assignment = applications[0].assignment as unknown as { id: string };
  const again = await api.post(`/api/business/shifts/${strandedShift.shiftId}/assignments/${assignment.id}/resolve`, {
    headers: { Authorization: `Bearer ${strandedShift.businessToken}` },
    data: { outcome: 'COMPLETED' },
  });
  expect(again.status()).toBe(400);
  expect(await again.json()).toEqual({ error: 'ASSIGNMENT_NOT_RESOLVABLE' });
});
