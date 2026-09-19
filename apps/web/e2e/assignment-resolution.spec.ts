import type { Page } from '@playwright/test';
import { account, expect, test } from './fixtures/business-api';
import {
  buildApplication,
  buildShift,
  installShiftAssignmentsApi,
  type ShiftAssignmentsServer,
} from './fixtures/shift-assignments';

// Cierre manual de asignaciones `NO_SHOW` / `ABANDONED` desde el panel de la
// empresa (MEDIO-5 de CN-20260918-004). Sin esta pantalla, un turno donde el
// trabajador llegó tarde o no registró su salida quedaba varado: el endpoint
// `POST /api/business/shifts/:id/assignments/:assignmentId/resolve` solo se
// podía llamar a mano. La API es simulada; el cierre real (API + base de
// datos) lo cubre `apps/web/e2e-real/assignment-resolution.spec.ts`.

const CONFIRM_NO_CUSTODY = 'Chambeaya no cobra, guarda ni transfiere dinero';

async function openShifts(page: Page, isMobile: boolean | undefined) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Turnos', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Postulaciones · / })).toBeVisible();
}

function row(page: Page, workerName: string) {
  return page.locator('.application-row').filter({ hasText: workerName });
}

function confirmAction(worker: string) {
  return `Confirmar que ${worker} sí trabajó`;
}
function closeAction(worker: string) {
  return `Cerrar sin pago la asignación de ${worker}`;
}

function callsAfterLastPost(server: ShiftAssignmentsServer) {
  const post = server.log.map((entry) => entry.startsWith('POST ')).lastIndexOf(true);
  return post === -1 ? [] : server.log.slice(post + 1);
}

test.describe('asignación NO_SHOW', () => {
  test('confirmar que sí trabajó pide confirmación explícita, registra el pago pendiente y refresca sin recargar', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);

    const ana = row(page, 'Ana Pérez');
    await expect(ana.getByText('No se presentó a tiempo', { exact: true })).toBeVisible();
    await expect(ana.getByText('Registra tu llegada en la sede')).toHaveCount(0);
    await expect(ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true })).toBeVisible();
    await expect(ana.getByRole('button', { name: closeAction('Ana Pérez'), exact: true })).toBeVisible();

    // Elegir la acción NO ejecuta nada: solo abre la confirmación.
    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await expect(ana.getByText('¿Confirmas que Ana Pérez sí trabajó este turno?')).toBeVisible();
    await expect(ana).toContainText('pago pendiente de S/ 120');
    await expect(ana).toContainText('tú pagas directamente al trabajador');
    await expect(ana).toContainText(CONFIRM_NO_CUSTODY);
    await expect(ana).toContainText('no se puede deshacer');
    expect(server.resolveCalls).toEqual([]);

    // "Volver" tampoco ejecuta nada y devuelve las dos acciones.
    await ana.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true })).toBeVisible();
    expect(server.resolveCalls).toEqual([]);

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');
    await expect(page.locator('.toast')).toContainText('tú lo pagas directamente al trabajador');
    expect(server.resolveCalls).toEqual([
      { shiftId: 'shift-resolution-1', assignmentId: 'assignment-app-ana', body: { outcome: 'COMPLETED' } },
    ]);

    // El estado se refresca sin recargar: acciones fuera y lectura de turno,
    // postulaciones y pagos después del POST (antes de abrir "Pagos").
    await expect(ana.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);
    await expect(ana.getByText('No se presentó a tiempo')).toHaveCount(0);
    await expect(ana.getByText('Turno finalizado; revisa el pago reportado')).toBeVisible();
    const after = callsAfterLastPost(server);
    expect(after).toContain('GET /api/business/shifts/shift-resolution-1');
    expect(after).toContain('GET /api/business/payments');
    expect(after).toContain('GET /api/business/shifts/shift-resolution-1/applications');

    // El pago pendiente ya aparece en Pagos.
    if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await page.getByRole('button', { name: 'Pagos', exact: true }).click();
    await expect(page.getByText('Mozo de salón · Empresa de pruebas UI')).toBeVisible();
    await expect(page.locator('.payment-status.pendiente')).toHaveCount(1);
  });

  test('cerrar sin pago acepta un motivo opcional, no genera ningún pago y no promete dinero', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await ana.getByRole('button', { name: closeAction('Ana Pérez'), exact: true }).click();
    await expect(ana.getByText('¿Cerrar la asignación de Ana Pérez sin pago?')).toBeVisible();
    await expect(ana).toContainText('No se registrará ninguna obligación de pago');
    await expect(ana).not.toContainText('pago pendiente de');
    expect(server.resolveCalls).toEqual([]);

    await ana.getByLabel('Motivo (opcional)').fill('Nunca llegó y no avisó');
    await ana.getByRole('button', { name: 'Sí, cerrar sin pago', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Asignación de Ana Pérez cerrada sin pago');
    expect(server.resolveCalls).toEqual([
      { shiftId: 'shift-resolution-1', assignmentId: 'assignment-app-ana', body: { outcome: 'CANCELLED', reason: 'Nunca llegó y no avisó' } },
    ]);
    await expect(ana.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);
    expect(server.payments).toEqual([]);
    expect(callsAfterLastPost(server)).toContain('GET /api/business/payments');
  });

  test('sin motivo no envía el campo `reason`', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await ana.getByRole('button', { name: closeAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: 'Sí, cerrar sin pago', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('cerrada sin pago');
    expect(server.resolveCalls).toHaveLength(1);
    expect(server.resolveCalls[0].body).toEqual({ outcome: 'CANCELLED' });
  });

  test('un motivo de menos de 3 caracteres se rechaza en el panel, sin llamar a la API', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await ana.getByRole('button', { name: closeAction('Ana Pérez'), exact: true }).click();
    await ana.getByLabel('Motivo (opcional)').fill('no');
    await ana.getByRole('button', { name: 'Sí, cerrar sin pago', exact: true }).click();

    await expect(ana.getByRole('alert')).toContainText('al menos 3 caracteres');
    expect(server.resolveCalls).toEqual([]);
    // Sigue abierta y corregible.
    await ana.getByLabel('Motivo (opcional)').fill('No se presentó');
    await ana.getByRole('button', { name: 'Sí, cerrar sin pago', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('cerrada sin pago');
    expect(server.resolveCalls).toHaveLength(1);
  });
});

test.describe('asignación ABANDONED', () => {
  test('confirmar que sí trabajó registra el pago pendiente', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift({ status: 'CANCELLED' }),
      applications: [buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'ABANDONED' })],
    });
    await openShifts(page, isMobile);
    const luis = row(page, 'Luis Rojas');

    await expect(luis.getByText('Sin salida registrada', { exact: true })).toBeVisible();
    await expect(luis).toContainText('registró su llegada pero nunca registró su salida');

    await luis.getByRole('button', { name: confirmAction('Luis Rojas'), exact: true }).click();
    await expect(luis).toContainText(CONFIRM_NO_CUSTODY);
    await luis.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Trabajo de Luis Rojas confirmado');
    expect(server.resolveCalls).toEqual([
      { shiftId: 'shift-resolution-1', assignmentId: 'assignment-app-luis', body: { outcome: 'COMPLETED' } },
    ]);
    await expect(luis.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);
    expect(server.payments).toHaveLength(1);
  });

  test('cerrar sin pago cierra la asignación', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift({ status: 'CANCELLED' }),
      applications: [buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'ABANDONED' })],
    });
    await openShifts(page, isMobile);
    const luis = row(page, 'Luis Rojas');

    await luis.getByRole('button', { name: closeAction('Luis Rojas'), exact: true }).click();
    await luis.getByRole('button', { name: 'Sí, cerrar sin pago', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Asignación de Luis Rojas cerrada sin pago');
    expect(server.resolveCalls[0].body.outcome).toBe('CANCELLED');
    expect(server.payments).toEqual([]);
    await expect(luis.getByText('Sin salida registrada')).toHaveCount(0);
  });
});

test.describe('turno ya cerrado como cancelado', () => {
  test('una asignación NO_SHOW sigue pudiendo cobrarse y el copy no promete más que el pago pendiente', async ({ page, isMobile }) => {
    // La API cierra como `CANCELLED` el turno vencido sin asignaciones viables
    // (ver docs/reference/api.md). Su `nextAction` dice "Proceso cerrado", pero
    // `resolve` no depende del estado del turno.
    const application = buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' });
    application.nextAction = { actor: 'NONE', code: 'NONE', label: 'Proceso cerrado' };
    const server = await installShiftAssignmentsApi(page, { shift: buildShift({ status: 'CANCELLED' }), applications: [application] });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await expect(ana.getByText('No se presentó a tiempo', { exact: true })).toBeVisible();
    await expect(ana.getByText('Proceso cerrado')).toHaveCount(0);

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await expect(ana).toContainText('Aunque este turno figure como cancelado, el pago pendiente se registra igualmente');
    await ana.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');
    expect(server.payments).toHaveLength(1);
  });

  test('el aviso usa el estado real del turno aunque el listado cargado antes lo mostrara sin cancelar', async ({ page, isMobile }) => {
    // La API detecta el `NO_SHOW` al abrir las postulaciones y, en ese mismo
    // movimiento, cierra el turno vencido como `CANCELLED`. El listado que el
    // panel cargó al iniciar sesión todavía lo trae como `ASSIGNED`.
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift({ status: 'CANCELLED' }),
      listedStatus: 'ASSIGNED',
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await expect(ana).toContainText('Aunque este turno figure como cancelado, el pago pendiente se registra igualmente');
    expect(server.log).toContain('GET /api/business/shifts/shift-resolution-1');
  });

  test('un turno que no está cancelado no muestra ese aviso', async ({ page, isMobile }) => {
    await installShiftAssignmentsApi(page, {
      shift: buildShift({ status: 'PUBLISHED' }),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await expect(ana).toContainText(CONFIRM_NO_CUSTODY);
    await expect(ana).not.toContainText('figure como cancelado');
  });
});

test.describe('errores del servidor', () => {
  test('un error 500 muestra un aviso amable, conserva la confirmación y permite reintentar', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    server.resolveResponses.push({ status: 500, json: { error: 'INTERNAL_ERROR' } });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true }).click();

    await expect(ana.getByRole('alert')).toContainText('No pudimos registrar el cierre');
    await expect(page.getByText('INTERNAL_ERROR')).toHaveCount(0);
    // Nada cambió: la asignación sigue pendiente y la confirmación abierta.
    await expect(ana.getByText('No se presentó a tiempo', { exact: true })).toBeVisible();
    await expect(ana.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true })).toBeEnabled();
    expect(server.payments).toEqual([]);

    await ana.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');
    expect(server.resolveCalls).toHaveLength(2);
    expect(server.payments).toHaveLength(1);
  });

  test('una asignación que ya no es resoluble muestra un aviso sin código crudo y refresca la lista', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    // Otra sesión la cerró entre la carga de la lista y el clic: el servidor ya
    // la tiene `CANCELLED` y responde 400 al intento.
    server.resolveResponses.push({ status: 400, json: { error: 'ASSIGNMENT_NOT_RESOLVABLE' } });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');
    await expect(ana.getByText('No se presentó a tiempo', { exact: true })).toBeVisible();
    server.applications[0].assignment!.status = 'CANCELLED';
    server.applications[0].nextAction = { actor: 'NONE', code: 'NONE', label: 'Proceso cerrado' };

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('ya no está pendiente de cierre');
    await expect(page.getByText('ASSIGNMENT_NOT_RESOLVABLE')).toHaveCount(0);
    await expect(ana.getByText('No se presentó a tiempo')).toHaveCount(0);
    await expect(ana.getByText('Proceso cerrado')).toBeVisible();
    await expect(ana.getByRole('button', { name: /sí trabajó|Cerrar sin pago|Volver/ })).toHaveCount(0);
    expect(server.payments).toEqual([]);
  });

  test('una asignación inexistente muestra un aviso sin código crudo', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    server.resolveResponses.push({ status: 404, json: { error: 'ASSIGNMENT_NOT_FOUND' } });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await ana.getByRole('button', { name: closeAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: 'Sí, cerrar sin pago', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('No encontramos esta asignación');
    await expect(page.getByText('ASSIGNMENT_NOT_FOUND')).toHaveCount(0);
  });
});

test.describe('asignaciones que no esperan cierre', () => {
  test('una asignación ASSIGNED, COMPLETED o CANCELLED no ofrece ninguna acción de cierre', async ({ page, isMobile }) => {
    await installShiftAssignmentsApi(page, {
      shift: buildShift({ requiredWorkers: 3, confirmedWorkers: 1 }),
      applications: [
        buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'ASSIGNED' }),
        buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'COMPLETED' }),
        buildApplication({ id: 'app-eva', workerName: 'Eva Ruiz', assignmentStatus: 'CANCELLED' }),
      ],
    });
    await openShifts(page, isMobile);

    await expect(page.locator('.application-row')).toHaveCount(3);
    await expect(row(page, 'Ana Pérez').getByText('Registra tu llegada en la sede')).toBeVisible();
    await expect(page.locator('.assignment-resolution')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);
    await expect(page.getByText('No se presentó a tiempo')).toHaveCount(0);
    await expect(page.getByText('Sin salida registrada')).toHaveCount(0);
  });

  test('en un turno de varios cupos solo la asignación varada ofrece el cierre y resolverla no toca a las demás', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift({ requiredWorkers: 3, confirmedWorkers: 1 }),
      applications: [
        buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'ASSIGNED' }),
        buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'NO_SHOW' }),
        buildApplication({ id: 'app-eva', workerName: 'Eva Ruiz', assignmentStatus: 'ABANDONED' }),
      ],
    });
    await openShifts(page, isMobile);

    await expect(page.locator('.assignment-resolution')).toHaveCount(2);
    await expect(row(page, 'Ana Pérez').locator('.assignment-resolution')).toHaveCount(0);

    // Abrir la confirmación de una fila no abre la de otra.
    await row(page, 'Luis Rojas').getByRole('button', { name: closeAction('Luis Rojas'), exact: true }).click();
    await expect(row(page, 'Luis Rojas').getByText('¿Cerrar la asignación de Luis Rojas sin pago?')).toBeVisible();
    await expect(row(page, 'Eva Ruiz').getByRole('button', { name: confirmAction('Eva Ruiz'), exact: true })).toBeVisible();
    await expect(row(page, 'Eva Ruiz').getByText(/¿Cerrar la asignación/)).toHaveCount(0);

    await row(page, 'Luis Rojas').getByRole('button', { name: 'Sí, cerrar sin pago', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Asignación de Luis Rojas cerrada sin pago');

    expect(server.resolveCalls.map((call) => call.assignmentId)).toEqual(['assignment-app-luis']);
    await expect(row(page, 'Luis Rojas').locator('.assignment-resolution')).toHaveCount(0);
    // Eva sigue pendiente y Ana no cambió.
    await expect(row(page, 'Eva Ruiz').getByText('Sin salida registrada', { exact: true })).toBeVisible();
    await expect(row(page, 'Ana Pérez').getByText('Registra tu llegada en la sede')).toBeVisible();
  });
});
