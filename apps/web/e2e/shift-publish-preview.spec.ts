import type { Page } from '@playwright/test';
import { account, expect, test } from './fixtures/business-api';

// Vista previa en vivo de la comisión de Chambeaya en el formulario de
// publicación de un turno (Alcance C del plan de pagos): por persona y total
// por cupos, calculada con el ajuste global (`GET /business/payment-settings`)
// que instala el fixture de pruebas (10% de comisión + 18% de IGV).

async function openPublishModal(page: Page, isMobile: boolean | undefined) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Turnos', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo turno', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Crear publicación', exact: true })).toBeVisible();
}

test('muestra la comisión de Chambeaya por persona y el total por cupos, y se actualiza al cambiar el pago o los cupos', async ({ page, isMobile }) => {
  await openPublishModal(page, isMobile);

  const preview = page.locator('.commission-preview');
  // Valor por defecto del campo "Pago por persona y turno" (S/100) con el
  // ajuste global del fixture (10% de comisión + 18% de IGV sobre la
  // comisión): S/100 + S/10 + S/1.80 = S/111.80, para 1 cupo (por defecto).
  await expect(preview).toContainText('Pago al trabajador S/ 100.00');
  await expect(preview).toContainText('Comisión Chambeaya 10% S/ 10.00');
  await expect(preview).toContainText('IGV 18% S/ 1.80');
  await expect(preview).toContainText('S/ 111.80 por persona');
  await expect(preview).toContainText('Total por 1 cupo:');
  await expect(preview).toContainText('S/ 111.80');
  // Sin turno asociado (creando uno nuevo), no debe mostrar el aviso de
  // comisión ya congelada.
  await expect(preview).not.toContainText('ya está publicado');

  await page.locator('input[name="pay"]').fill('200');
  await page.locator('input[name="required"]').fill('3');

  await expect(preview).toContainText('Pago al trabajador S/ 200.00');
  await expect(preview).toContainText('Comisión Chambeaya 10% S/ 20.00');
  await expect(preview).toContainText('IGV 18% S/ 3.60');
  await expect(preview).toContainText('S/ 223.60 por persona');
  await expect(preview).toContainText('Total por 3 cupos:');
  await expect(preview).toContainText('S/ 670.80');
});

// MEDIO-1 de CN-20260926-014: "Rellenar ejemplo" asigna los valores del
// formulario con `control.value =` y dispara `input`/`change` a mano, un
// patrón que no siempre llega al `onChange` de React. La vista previa
// quedó una vez desincronizada de verdad (reproducido en producción): el
// formulario mostraba S/120 y 2 cupos, pero la vista previa seguía en
// S/100 y 1 cupo, mientras el turno real se publicaba a S/120 × 2 al 15%
// (S/282.48) — un error de dinero visible para la empresa. Esta prueba
// recorre "Rellenar ejemplo" y dos cambios manuales más, comprobando en
// cada paso que la vista previa coincide exactamente con lo que la API
// cobraría (mismo redondeo: 10% de comisión + 18% de IGV sobre la comisión).
test('la vista previa siempre coincide con el formulario: "Rellenar ejemplo" y cambios manuales posteriores', async ({ page, isMobile }) => {
  await openPublishModal(page, isMobile);
  const preview = page.locator('.commission-preview');

  // Antes de "Rellenar ejemplo": S/100, 1 cupo (valores por defecto).
  await expect(preview).toContainText('Pago al trabajador S/ 100.00');
  await expect(preview).toContainText('Total por 1 cupo:');

  await page.getByRole('button', { name: 'Rellenar ejemplo', exact: true }).click();

  // "Rellenar ejemplo" deja el formulario en S/120 y 2 cupos (ver el botón
  // en `PublishModal#fillExample`). S/120 + 10% (S/12) + 18% de IGV sobre
  // la comisión (S/2.16) = S/134.16 por persona; S/268.32 en total.
  await expect(page.locator('input[name="pay"]')).toHaveValue('120');
  await expect(page.locator('input[name="required"]')).toHaveValue('2');
  await expect(preview).toContainText('Pago al trabajador S/ 120.00');
  await expect(preview).toContainText('Comisión Chambeaya 10% S/ 12.00');
  await expect(preview).toContainText('IGV 18% S/ 2.16');
  await expect(preview).toContainText('S/ 134.16 por persona');
  await expect(preview).toContainText('Total por 2 cupos:');
  await expect(preview).toContainText('S/ 268.32');

  // Cambiar el monto y los cupos a mano después de "Rellenar ejemplo"
  // también debe reflejarse: S/300 + S/30 + S/5.40 = S/335.40 por persona,
  // S/1.341,60 en total para 4 cupos.
  await page.locator('input[name="pay"]').fill('300');
  await page.locator('input[name="required"]').fill('4');

  await expect(preview).toContainText('Pago al trabajador S/ 300.00');
  await expect(preview).toContainText('Comisión Chambeaya 10% S/ 30.00');
  await expect(preview).toContainText('IGV 18% S/ 5.40');
  await expect(preview).toContainText('S/ 335.40 por persona');
  await expect(preview).toContainText('Total por 4 cupos:');
  await expect(preview).toContainText('S/ 1,341.60');
});

// BAJO-1 de CN-20260926-014: si `GET /business/payment-settings` falla, el
// panel no debe inventar un 10%/18% ni dejar publicar; debe mostrar el
// error y un botón para reintentar, y ese reintento debe recuperar el
// formulario cuando la API vuelve a responder.
test('si el ajuste de comisión no carga, el panel no publica y ofrece reintentar', async ({ page, isMobile }) => {
  let paymentSettingsAttempts = 0;
  await page.route('**/api/business/payment-settings', async (route) => {
    paymentSettingsAttempts += 1;
    if (paymentSettingsAttempts === 1) {
      await route.fulfill({ status: 500, json: { error: 'INTERNAL_ERROR' } });
      return;
    }
    await route.fulfill({ json: { commissionBps: 1000, taxBps: 1800, currency: 'PEN', mode: 'manual' } });
  });

  await openPublishModal(page, isMobile);
  const preview = page.locator('.commission-preview');

  await expect(preview).toContainText('No pudimos cargar el ajuste de comisión vigente');
  await expect(page.getByRole('button', { name: 'Revisar y publicar', exact: true })).toBeDisabled();
  // Nunca un 10%/18% inventado mientras el ajuste real no cargó.
  await expect(preview).not.toContainText('Comisión Chambeaya');

  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();

  await expect(preview).toContainText('Pago al trabajador S/ 100.00');
  await expect(preview).toContainText('Comisión Chambeaya 10% S/ 10.00');
  await expect(page.getByRole('button', { name: 'Revisar y publicar', exact: true })).toBeEnabled();
  expect(paymentSettingsAttempts).toBe(2);
});

// BAJO-4 de CN-20260926-012: si el ajuste global cambió mientras la empresa
// completaba el formulario, la API rechaza con 409 `COMMISSION_CHANGED` (los
// bps que el panel envió ya no coinciden) y el panel debe refrescar la vista
// previa con el valor vigente y pedir que se confirme de nuevo, sin publicar
// nunca con un % que la empresa no vio.
test('un 409 COMMISSION_CHANGED refresca la vista previa y deja el formulario abierto para confirmar de nuevo', async ({ page, isMobile }) => {
  let createAttempts = 0;
  let paymentSettingsReads = 0;
  await page.route('**/api/business/shifts', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    createAttempts += 1;
    if (createAttempts === 1) {
      // El % vigente subió a 15% mientras la empresa completaba el formulario.
      await route.fulfill({ status: 409, json: { error: 'COMMISSION_CHANGED', commissionBps: 1500, taxBps: 1800 } });
      return;
    }
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        id: 'shift-nuevo', title: body.title, location: body.location,
        startsAt: body.startsAt, endsAt: body.endsAt, payCents: body.payCents,
        requiredWorkers: body.requiredWorkers, confirmedWorkers: 0,
        description: body.description, responsibilities: body.responsibilities, requirements: body.requirements,
        screeningQuestions: body.screeningQuestions ?? [], modality: body.modality, notes: body.notes,
        rescueActive: false, status: 'PUBLISHED', commissionBps: 1500, taxBps: 1800,
      },
    });
  });
  // Al publicar con éxito, el panel selecciona el turno nuevo y carga sus
  // postulaciones/eventos (vacíos: es un turno recién creado).
  await page.route('**/api/business/shifts/shift-nuevo/applications', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/business/shifts/shift-nuevo/events', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/business/payment-settings', async (route) => {
    paymentSettingsReads += 1;
    // La primera lectura (carga inicial del panel) trae el 10% original; el
    // refresco tras el 409 debe traer el 15% ya vigente.
    const commissionBps = paymentSettingsReads === 1 ? 1000 : 1500;
    await route.fulfill({ json: { commissionBps, taxBps: 1800, currency: 'PEN', mode: 'manual' } });
  });

  await openPublishModal(page, isMobile);
  await page.getByRole('button', { name: 'Rellenar ejemplo', exact: true }).click();

  const preview = page.locator('.commission-preview');
  await expect(preview).toContainText('Comisión Chambeaya 10%');

  await page.getByRole('button', { name: 'Revisar y publicar', exact: true }).click();

  await expect(page.getByText('La comisión de Chambeaya cambió mientras completabas el formulario', { exact: false })).toBeVisible();
  // El formulario sigue abierto (nunca se publicó con el 10% que ya no es
  // el vigente) y la vista previa ya muestra el 15% actual.
  await expect(page.getByRole('heading', { name: 'Crear publicación', exact: true })).toBeVisible();
  await expect(preview).toContainText('Comisión Chambeaya 15%');
  await expect(preview).not.toContainText('Comisión Chambeaya 10%');

  await page.getByRole('button', { name: 'Revisar y publicar', exact: true }).click();

  await expect(page.getByText('Turno publicado. Ya puedes asignar talento.', { exact: false })).toBeVisible();
  expect(createAttempts).toBe(2);
});
