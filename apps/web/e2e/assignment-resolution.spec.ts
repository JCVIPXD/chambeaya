import type { Page } from '@playwright/test';
import { REQUEST_TIMEOUT_MS } from '../lib/business-api';
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
// Botones de la confirmación: también nombran al trabajador (BAJO-3 de CN-20260918-014).
function yesConfirmAction(worker: string) {
  return `Sí, confirmar trabajo de ${worker}`;
}
function yesCloseAction(worker: string) {
  return `Sí, cerrar sin pago la asignación de ${worker}`;
}
function backAction(worker: string) {
  return `Volver sin cerrar la asignación de ${worker}`;
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
    await ana.getByRole('button', { name: backAction('Ana Pérez'), exact: true }).click();
    await expect(ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true })).toBeVisible();
    expect(server.resolveCalls).toEqual([]);

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();

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
    // Turno sin cancelar: la confirmación no lleva el aviso del turno cancelado.
    await expect(ana).not.toContainText(CANCELLED_NOTICE);
    expect(server.resolveCalls).toEqual([]);

    await ana.getByLabel('Motivo (opcional)').fill('Nunca llegó y no avisó');
    await ana.getByRole('button', { name: yesCloseAction('Ana Pérez'), exact: true }).click();

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
    await ana.getByRole('button', { name: yesCloseAction('Ana Pérez'), exact: true }).click();

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
    await ana.getByRole('button', { name: yesCloseAction('Ana Pérez'), exact: true }).click();

    await expect(ana.getByRole('alert')).toContainText('al menos 3 caracteres');
    expect(server.resolveCalls).toEqual([]);
    // Sigue abierta y corregible.
    await ana.getByLabel('Motivo (opcional)').fill('No se presentó');
    await ana.getByRole('button', { name: yesCloseAction('Ana Pérez'), exact: true }).click();
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
    await luis.getByRole('button', { name: yesConfirmAction('Luis Rojas'), exact: true }).click();

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
    // BAJO-3 de CN-20260923-001: en un turno que figura cancelado, cerrar sin
    // pago también avisa que el turno puede pasar a completado (o seguir
    // cancelado si lo canceló la empresa), sin prometer el resultado.
    await expect(luis).toContainText('No se registrará ninguna obligación de pago');
    await expect(luis).toContainText(CANCELLED_NOTICE);
    for (const phrase of CLOSE_NOTICE_ALL_CASES) await expect(luis).toContainText(phrase);
    await expect(luis).not.toContainText('pago pendiente de');
    await luis.getByRole('button', { name: yesCloseAction('Luis Rojas'), exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Asignación de Luis Rojas cerrada sin pago');
    expect(server.resolveCalls[0].body.outcome).toBe('CANCELLED');
    expect(server.payments).toEqual([]);
    // En este fixture (un solo cupo, sin otro cupo completado) cerrar sin pago
    // no reabre nada: el turno cancelado sigue igual. En un multi-cupo con otro
    // cupo ya completado y ninguno pendiente sí lo reabriría a COMPLETED
    // (CN-20260922-013); eso lo cubre el caso de reapertura más abajo.
    expect(server.shift.status).toBe('CANCELLED');
    await expect(luis.getByText('Sin salida registrada')).toHaveCount(0);
  });
});

// El turno vencido sin asignaciones viables lo cierra la API como `CANCELLED`
// (ver docs/reference/api.md). Ese cierre automático se reabre al confirmar
// que sí se trabajó en cuanto ya no queda ningún cupo pendiente de decisión
// (ninguna asignación ASSIGNED/NO_SHOW/ABANDONED sin resolver) y al menos uno
// quedó confirmado como trabajado -los demás pueden haber cerrado sin pago,
// eso ya no bloquea la reapertura (CN-20260922-013)-; un turno que la propia
// empresa canceló no se reabre. El panel no puede distinguir estos casos, así
// que el aviso no promete el resultado y explica todos.
const CANCELLED_NOTICE = 'Este turno figura como cancelado';
const CANCELLED_NOTICE_ALL_CASES = [
  'Si se cerró automáticamente por vencer sin asistencia registrada, pasará a completado en cuanto ya no quede ningún cupo pendiente de tu decisión y al menos uno haya quedado confirmado como trabajado',
  'si lo cancelaste tú, seguirá cancelado',
  'En todos los casos el pago pendiente se registra',
];
// Aviso de "Cerrar sin pago" en un turno que figura cancelado (BAJO-3 de
// CN-20260923-001): cerrar sin pago puede completar el turno si otro cupo ya
// estaba confirmado y no queda ninguno pendiente.
const CLOSE_NOTICE_ALL_CASES = [
  'pasará a completado si al cerrar esta asignación ya no queda ningún cupo pendiente de tu decisión y otro cupo ya quedó confirmado como trabajado',
  'si lo cancelaste tú, seguirá cancelado',
];
// Textos anteriores: prometían que el turno seguiría cancelado o que "se
// actualizará al confirmar", algo que en multi-cupo no siempre ocurre.
const OLD_NOTICES = ['Aunque este turno figure como cancelado', 'se actualizará al confirmar'];

test.describe('turno ya cerrado como cancelado', () => {
  test('una asignación NO_SHOW sigue pudiendo cobrarse, el aviso explica los dos casos y el turno cerrado por vencimiento deja de figurar cancelado', async ({ page, isMobile }) => {
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
    await expect(ana).toContainText(CANCELLED_NOTICE);
    for (const phrase of CANCELLED_NOTICE_ALL_CASES) await expect(ana).toContainText(phrase);
    // Los textos anteriores prometían un resultado que la API no siempre da.
    for (const old of OLD_NOTICES) await expect(ana).not.toContainText(old);
    // El aviso no debe insinuar que Chambeaya mueve dinero.
    await expect(ana).toContainText(CONFIRM_NO_CUSTODY);
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');
    expect(server.payments).toHaveLength(1);
    expect(server.shift.status).toBe('COMPLETED');
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
    await expect(ana).toContainText(CANCELLED_NOTICE);
    await expect(ana).toContainText('si lo cancelaste tú, seguirá cancelado');
    for (const old of OLD_NOTICES) await expect(ana).not.toContainText(old);
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
    await expect(ana).not.toContainText(CANCELLED_NOTICE);
    for (const old of OLD_NOTICES) await expect(ana).not.toContainText(old);
  });

  test('en un turno multi-cupo cerrado por vencimiento, el turno sigue cancelado mientras quede un cupo sin confirmar y pasa a completado al confirmar el último', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift({ status: 'CANCELLED', requiredWorkers: 2 }),
      applications: [
        buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' }),
        buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'NO_SHOW' }),
      ],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');
    const luis = row(page, 'Luis Rojas');

    // Mientras el turno figura cancelado, ambas confirmaciones lo avisan.
    await luis.getByRole('button', { name: confirmAction('Luis Rojas'), exact: true }).click();
    await expect(luis).toContainText(CANCELLED_NOTICE);
    await luis.getByRole('button', { name: backAction('Luis Rojas'), exact: true }).click();

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');

    // Queda un cupo sin cerrar: el turno NO se reabre (en `CHECKED_IN` quedaría
    // inalcanzable), pero el pago de Ana sí se registró y el aviso sigue
    // siendo veraz para la fila que queda.
    expect(server.shift.status).toBe('CANCELLED');
    expect(server.payments).toHaveLength(1);
    await luis.getByRole('button', { name: confirmAction('Luis Rojas'), exact: true }).click();
    await expect(luis.getByText('¿Confirmas que Luis Rojas sí trabajó este turno?')).toBeVisible();
    await expect(luis).toContainText(CANCELLED_NOTICE);
    await expect(luis).toContainText('pasará a completado en cuanto ya no quede ningún cupo pendiente de tu decisión');

    // Con el último cupo confirmado, todos los cupos quedan trabajados y el turno se completa.
    await luis.getByRole('button', { name: yesConfirmAction('Luis Rojas'), exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Trabajo de Luis Rojas confirmado');
    expect(server.shift.status).toBe('COMPLETED');
    expect(server.payments).toHaveLength(2);
  });

  // CN-20260922-013: un turno multi-cupo parcialmente cubierto (un cupo
  // completó, el otro se cierra sin pago) debe llegar a `COMPLETED`, no
  // quedarse `CANCELLED` para siempre. Cubre también el punto 2 del cierre:
  // la reapertura debe intentarse aunque ESTA llamada resuelva `CANCELLED`,
  // si otro cupo ya había completado antes (por eso se prueba en las dos
  // órdenes posibles).
  for (const order of ['completar primero', 'cerrar sin pago primero'] as const) {
    test(`en un turno multi-cupo cerrado por vencimiento, un cupo completado y el otro cerrado sin pago dejan el turno COMPLETED (orden: ${order})`, async ({ page, isMobile }) => {
      const server = await installShiftAssignmentsApi(page, {
        shift: buildShift({ status: 'CANCELLED', requiredWorkers: 2 }),
        applications: [
          buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' }),
          buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'ABANDONED' }),
        ],
      });
      await openShifts(page, isMobile);
      const ana = row(page, 'Ana Pérez');
      const luis = row(page, 'Luis Rojas');

      async function completeAna() {
        await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
        await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();
        await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');
      }
      async function closeLuisWithoutPay() {
        await luis.getByRole('button', { name: closeAction('Luis Rojas'), exact: true }).click();
        await luis.getByRole('button', { name: yesCloseAction('Luis Rojas'), exact: true }).click();
        await expect(page.locator('.toast')).toContainText('Asignación de Luis Rojas cerrada sin pago');
      }

      if (order === 'completar primero') {
        await completeAna();
        expect(server.shift.status).toBe('CANCELLED'); // Luis sigue pendiente: no se reabre todavía.
        await closeLuisWithoutPay();
      } else {
        await closeLuisWithoutPay();
        expect(server.shift.status).toBe('CANCELLED'); // Ana sigue pendiente: no se reabre todavía.
        await completeAna();
      }

      // Sin importar el orden, ya no queda ningún cupo pendiente y uno sí
      // completó: el turno pasa a COMPLETED con un solo pago (el de Ana).
      expect(server.shift.status).toBe('COMPLETED');
      expect(server.payments).toHaveLength(1);
    });
  }

  test('un turno que la empresa canceló sigue cancelado tras confirmar: el pago se registra y el aviso sigue vigente', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift({ status: 'CANCELLED', requiredWorkers: 2 }),
      cancelledByCompany: true,
      applications: [
        buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' }),
        buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'NO_SHOW' }),
      ],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');
    const luis = row(page, 'Luis Rojas');

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');

    expect(server.payments).toHaveLength(1);
    expect(server.shift.status).toBe('CANCELLED');
    await luis.getByRole('button', { name: confirmAction('Luis Rojas'), exact: true }).click();
    await expect(luis).toContainText(CANCELLED_NOTICE);
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
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();

    await expect(ana.getByRole('alert')).toContainText('No pudimos registrar el cierre');
    await expect(page.getByText('INTERNAL_ERROR')).toHaveCount(0);
    // Nada cambió: la asignación sigue pendiente y la confirmación abierta.
    await expect(ana.getByText('No se presentó a tiempo', { exact: true })).toBeVisible();
    await expect(ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true })).toBeEnabled();
    expect(server.payments).toEqual([]);

    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();
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
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();

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
    await ana.getByRole('button', { name: yesCloseAction('Ana Pérez'), exact: true }).click();

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

    await row(page, 'Luis Rojas').getByRole('button', { name: yesCloseAction('Luis Rojas'), exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Asignación de Luis Rojas cerrada sin pago');

    expect(server.resolveCalls.map((call) => call.assignmentId)).toEqual(['assignment-app-luis']);
    await expect(row(page, 'Luis Rojas').locator('.assignment-resolution')).toHaveCount(0);
    // Eva sigue pendiente y Ana no cambió.
    await expect(row(page, 'Eva Ruiz').getByText('Sin salida registrada', { exact: true })).toBeVisible();
    await expect(row(page, 'Ana Pérez').getByText('Registra tu llegada en la sede')).toBeVisible();
  });
});

test.describe('nombres accesibles de la confirmación', () => {
  test('los botones de la confirmación nombran al trabajador y "Volver" recibe el foco, no la acción terminal', async ({ page, isMobile }) => {
    await installShiftAssignmentsApi(page, {
      shift: buildShift({ requiredWorkers: 3, confirmedWorkers: 1 }),
      applications: [
        buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'NO_SHOW' }),
        buildApplication({ id: 'app-eva', workerName: 'Eva Ruiz', assignmentStatus: 'ABANDONED' }),
      ],
    });
    await openShifts(page, isMobile);
    const luis = row(page, 'Luis Rojas');

    await luis.getByRole('button', { name: confirmAction('Luis Rojas'), exact: true }).click();
    await expect(luis.getByRole('button', { name: yesConfirmAction('Luis Rojas'), exact: true })).toBeVisible();
    await expect(luis.getByRole('button', { name: backAction('Luis Rojas'), exact: true })).toBeVisible();
    await expect(luis.getByRole('button', { name: backAction('Luis Rojas'), exact: true })).toBeFocused();
    await expect(luis.getByRole('button', { name: yesConfirmAction('Luis Rojas'), exact: true })).not.toBeFocused();
    // Ya no hay botones con el nombre genérico que valga para cualquier fila.
    await expect(page.getByRole('button', { name: 'Sí, confirmar trabajo', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Volver', exact: true })).toHaveCount(0);

    await luis.getByRole('button', { name: backAction('Luis Rojas'), exact: true }).click();
    await luis.getByRole('button', { name: closeAction('Luis Rojas'), exact: true }).click();
    await expect(luis.getByRole('button', { name: yesCloseAction('Luis Rojas'), exact: true })).toBeVisible();
    await expect(luis.getByRole('button', { name: backAction('Luis Rojas'), exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Sí, cerrar sin pago', exact: true })).toHaveCount(0);

    // Con otra fila abierta, el nombre distingue a cada trabajador.
    await luis.getByRole('button', { name: backAction('Luis Rojas'), exact: true }).click();
    const eva = row(page, 'Eva Ruiz');
    await eva.getByRole('button', { name: confirmAction('Eva Ruiz'), exact: true }).click();
    await expect(eva.getByRole('button', { name: yesConfirmAction('Eva Ruiz'), exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: yesConfirmAction('Luis Rojas'), exact: true })).toHaveCount(0);
  });
});

test.describe('lecturas obsoletas y refresco tras el cierre', () => {
  test('una lectura de postulaciones emitida antes del cierre y entregada después del refresco no repone las acciones', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');
    await expect(ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true })).toBeVisible();

    // El sondeo (cada 4 s) emite una lectura de postulaciones cuando la
    // asignación aún está `NO_SHOW`; el servidor la "lee" ya, pero la respuesta
    // se retiene mientras la empresa cierra la asignación.
    const stale = server.holdNext('applications');
    await stale.reached;

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');
    await expect(ana.getByText('Turno finalizado; revisa el pago reportado')).toBeVisible();
    await expect(ana.locator('.assignment-resolution')).toHaveCount(0);
    expect(server.resolveCalls).toHaveLength(1);

    // Ahora llega la respuesta vieja, con la asignación todavía `NO_SHOW`.
    stale.release();
    await stale.delivered;
    await page.waitForTimeout(600);

    // Sin reintentos automáticos a propósito: `toHaveCount` reintenta hasta 5 s
    // y el siguiente sondeo (4 s) repondría el estado correcto, ocultando que la
    // respuesta vieja se aplicó. Se mira el estado de la pantalla tal cual está.
    expect(await ana.locator('.assignment-resolution').count()).toBe(0);
    expect(await ana.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ }).count()).toBe(0);
    expect(await ana.getByText('No se presentó a tiempo').count()).toBe(0);
    expect(await ana.getByText('Turno finalizado; revisa el pago reportado').count()).toBe(1);
    expect(server.resolveCalls).toHaveLength(1);
  });

  test('mientras se refresca tras confirmar, la fila mantiene "Guardando…" y no vuelve a mostrar las acciones de apertura', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');
    // Solo el refresco posterior al cierre lee los pagos: retenerlo deja la
    // pantalla justo entre el `POST` y el fin del refresco.
    const refresh = server.holdNext('payments');

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();
    await refresh.reached;
    expect(server.resolveCalls).toHaveLength(1);

    const openingActions = ana.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ });
    const saving = ana.getByRole('button', { name: 'Guardando el cierre de Ana Pérez', exact: true });
    await expect(saving).toBeVisible();
    await expect(saving).toBeDisabled();
    await expect(saving).toHaveText('Guardando…');
    // Región viva (`role="status"`): un lector de pantalla anuncia el estado,
    // no solo el cambio de nombre del botón (BAJO-3 de CN-20260920-002).
    const savingStatus = ana.getByRole('status');
    await expect(savingStatus).toHaveText('Guardando el cierre de Ana Pérez…');
    await expect(savingStatus).toHaveAttribute('aria-live', 'polite');
    await expect(ana.getByText('¿Confirmas que Ana Pérez sí trabajó este turno?')).toBeVisible();
    await expect(openingActions).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(openingActions).toHaveCount(0);
    await expect(saving).toBeVisible();

    refresh.release();
    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');
    await expect(ana.locator('.assignment-resolution')).toHaveCount(0);
    await expect(openingActions).toHaveCount(0);
  });

  test('si la asignación ya no era resoluble tampoco reaparecen las acciones mientras se refresca la lista', async ({ page, isMobile }) => {
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    server.resolveResponses.push({ status: 400, json: { error: 'ASSIGNMENT_NOT_RESOLVABLE' } });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');
    server.applications[0].assignment!.status = 'CANCELLED';
    server.applications[0].nextAction = { actor: 'NONE', code: 'NONE', label: 'Proceso cerrado' };
    const refresh = server.holdNext('payments');

    await ana.getByRole('button', { name: closeAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: yesCloseAction('Ana Pérez'), exact: true }).click();
    await refresh.reached;

    await expect(ana.getByRole('button', { name: 'Guardando el cierre de Ana Pérez', exact: true })).toBeDisabled();
    await expect(ana.getByRole('button', { name: /sí trabajó|Cerrar sin pago/ })).toHaveCount(0);

    refresh.release();
    await expect(ana.locator('.assignment-resolution')).toHaveCount(0);
    await expect(ana.getByText('Proceso cerrado')).toBeVisible();
  });
});

test.describe('sondeo de postulaciones que falla', () => {
  // El sondeo (4 s) corre con el reloj de la página; se adelanta en vez de esperar.
  const POLL_MS = 4500;

  test('con datos en pantalla, un sondeo fallido conserva la lista, avisa sin bloquearla y se recupera solo', async ({ page, isMobile }) => {
    await page.clock.install();
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift({ requiredWorkers: 2, confirmedWorkers: 1 }),
      applications: [
        buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' }),
        buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'ASSIGNED' }),
      ],
    });
    await openShifts(page, isMobile);
    await expect(page.locator('.application-row')).toHaveCount(2);
    await expect(page.locator('.application-count')).toHaveText('2 postulaciones');

    server.failApplications = Number.POSITIVE_INFINITY;
    await page.clock.fastForward(POLL_MS);
    const notice = page.locator('.application-stale-notice');
    await expect(notice).toContainText('No pudimos actualizar las postulaciones');
    await expect(notice).toHaveAttribute('role', 'alert');
    // La lista sigue ahí, con sus acciones, y no aparece el estado de error a pantalla completa.
    await expect(page.locator('.application-row')).toHaveCount(2);
    await expect(row(page, 'Ana Pérez').getByRole('button', { name: confirmAction('Ana Pérez'), exact: true })).toBeVisible();
    await expect(page.locator('.application-error')).toHaveCount(0);
    await expect(page.locator('.application-count')).toHaveText('2 postulaciones');

    // Otro sondeo fallido: la lista sigue sin parpadear.
    await page.clock.fastForward(POLL_MS);
    await expect(page.locator('.application-row')).toHaveCount(2);
    await expect(notice).toHaveCount(1);

    // Vuelve la red: el siguiente sondeo quita el aviso y conserva la lista.
    server.failApplications = 0;
    await page.clock.fastForward(POLL_MS);
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.application-row')).toHaveCount(2);
  });

  test('sin datos previos (primera carga) el fallo sigue mostrando el estado de error y el siguiente sondeo lo recupera', async ({ page, isMobile }) => {
    await page.clock.install();
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    server.failApplications = 1;
    await openShifts(page, isMobile);

    const errorState = page.locator('.application-error');
    await expect(errorState).toContainText('No pudimos cargar las postulaciones');
    await expect(errorState).toHaveAttribute('role', 'alert');
    await expect(page.locator('.application-count')).toHaveText('No disponibles');
    await expect(page.locator('.application-row')).toHaveCount(0);
    await expect(page.locator('.application-stale-notice')).toHaveCount(0);

    await page.clock.fastForward(POLL_MS);
    await expect(errorState).toHaveCount(0);
    await expect(row(page, 'Ana Pérez')).toBeVisible();
  });
});

test.describe('peticiones colgadas', () => {
  test('una lectura del refresco que nunca responde vence por timeout y libera "Guardando…"', async ({ page, isMobile }) => {
    await page.clock.install();
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');
    // La lectura de pagos del refresco posterior al cierre no se entrega nunca.
    server.holdNext('payments');

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();
    await expect(ana.getByRole('button', { name: 'Guardando el cierre de Ana Pérez', exact: true })).toBeDisabled();
    expect(server.resolveCalls).toHaveLength(1);

    // Pasado el tope de `request()`, la lectura se aborta y la pantalla se libera.
    await page.clock.fastForward(REQUEST_TIMEOUT_MS + 1000);
    await expect(page.locator('.toast')).toContainText('El cierre quedó registrado, pero no pudimos actualizar toda la pantalla');
    await expect(ana.locator('.assignment-resolution')).toHaveCount(0);
    // El cierre sí llegó al servidor una sola vez.
    expect(server.resolveCalls).toHaveLength(1);
    expect(server.applications[0].assignment!.status).toBe('COMPLETED');
  });

  test('un cierre que nunca responde vence por timeout, muestra el error y permite reintentar', async ({ page, isMobile }) => {
    await page.clock.install();
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    server.resolveResponses.push({ hang: true });
    await openShifts(page, isMobile);
    const ana = row(page, 'Ana Pérez');

    await ana.getByRole('button', { name: confirmAction('Ana Pérez'), exact: true }).click();
    await ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true }).click();
    await expect(ana.getByRole('button', { name: 'Guardando el cierre de Ana Pérez', exact: true })).toBeDisabled();

    await page.clock.fastForward(REQUEST_TIMEOUT_MS + 1000);
    await expect(ana.getByRole('alert')).toContainText('No pudimos registrar el cierre');
    // Ya no está ocupado: la confirmación sigue abierta y se puede reintentar.
    const retry = ana.getByRole('button', { name: yesConfirmAction('Ana Pérez'), exact: true });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(page.locator('.toast')).toContainText('Trabajo de Ana Pérez confirmado');
    expect(server.resolveCalls).toHaveLength(2);
  });
});

test.describe('decidir una postulación y cambiar de turno', () => {
  test('la respuesta de la decisión no repone la lista de otro turno si se cambió de turno mientras se guardaba', async ({ page, isMobile }) => {
    // Preexistente: en pantallas angostas `.row-action` es `display: none`
    // (globals.css, media query móvil), así que el panel no ofrece aceptar ni
    // rechazar desde el móvil; el caso solo es alcanzable en escritorio.
    test.skip(Boolean(isMobile), 'aceptar/rechazar no se muestra en el panel móvil');
    const otherShift = buildShift({ id: 'shift-resolution-2', title: 'Cocinero de apoyo' });
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift({ status: 'PUBLISHED' }),
      applications: [
        buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'ASSIGNED', applicationStatus: 'PENDING' }),
      ],
      otherShifts: [
        {
          shift: otherShift,
          applications: [
            buildApplication({ id: 'app-luis', workerName: 'Luis Rojas', assignmentStatus: 'ASSIGNED', shiftId: otherShift.id }),
          ],
        },
      ],
    });
    await openShifts(page, isMobile);
    await expect(row(page, 'Ana Pérez')).toBeVisible();
    const decision = server.holdNext('decide');

    await page.getByRole('button', { name: 'Aceptar a Ana Pérez', exact: true }).click();
    await decision.reached;

    // Mientras la decisión se guarda, la empresa abre el otro turno.
    await page.locator('.managed-shift').filter({ hasText: 'Cocinero de apoyo' }).click();
    await expect(row(page, 'Luis Rojas')).toBeVisible();
    await expect(row(page, 'Ana Pérez')).toHaveCount(0);

    decision.release();
    await decision.delivered;
    await expect(page.locator('.toast')).toContainText('Postulación aceptada');
    await page.waitForTimeout(600);

    // Sin reintentos automáticos: el siguiente sondeo (4 s) repararía la lista
    // y ocultaría que la respuesta del turno anterior se aplicó.
    expect(server.decideCalls).toHaveLength(1);
    expect(await row(page, 'Luis Rojas').count()).toBe(1);
    expect(await row(page, 'Ana Pérez').count()).toBe(0);
    expect(await page.locator('.application-row').count()).toBe(1);
  });
});
