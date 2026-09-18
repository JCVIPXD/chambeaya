import type { Page } from '@playwright/test';
import { account, expect, inactiveSubscription, proSubscription, test } from './fixtures/business-api';

// Regresión de CN-20260918-006 (BAJO-1/BAJO-2) y de CN-20260918-010
// (MEDIO-1/MEDIO-2/BAJO-3): una empresa que no activó ningún plan recibe de la
// API una respuesta sintética `INACTIVE` con `plan: 'PILOT'`. Ninguna parte del
// panel (sección de membresías, barra lateral, avisos de las tarjetas) debe
// afirmar un piloto vigente ni marcar ninguna tarjeta como "Actual".

const ACTIVATION_WHEN_PILOT_ENDS =
  'La activación se habilitará cuando termine el piloto y validemos el beneficio.';
const NO_PLAN_ACTIVATION_NOTICE =
  'Por ahora los planes no se activan desde el panel. Puedes seguir publicando, seleccionando y reportando pagos sin ningún plan.';

async function openMembership(page: Page, isMobile: boolean) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Membresía', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Membresías', exact: true })).toBeVisible();
}

// Rótulo del plan bajo el nombre de la empresa en la barra lateral. En móvil el
// menú se cierra tras navegar; `toHaveText` no exige visibilidad.
function sidebarPlan(page: Page) {
  return page.locator('.company-card .company-copy > span');
}

function planCard(page: Page, name: string) {
  return page
    .locator('.membership-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

test.describe('empresa con periodo de prueba activo', () => {
  test('muestra el piloto vigente y marca su tarjeta como actual', async ({ page, isMobile }) => {
    await openMembership(page, isMobile);

    const current = page.locator('.membership-current');
    await expect(current.getByRole('heading', { name: 'Plan Piloto', exact: true })).toBeVisible();
    await expect(current.getByText('Piloto activo').first()).toBeVisible();
    await expect(current.getByText(/Vigente hasta/)).toBeVisible();
    await expect(page.locator('.membership-card.current')).toHaveCount(1);
    await expect(page.getByText('Incluido en tu piloto', { exact: true })).toBeVisible();
  });

  test('conserva el rótulo de la barra lateral y el aviso de activación futura', async ({ page, isMobile }) => {
    await openMembership(page, isMobile);

    await expect(sidebarPlan(page)).toHaveText('Plan piloto');

    await planCard(page, 'Empresa Pro').getByRole('button', { name: 'Quiero conocerlo', exact: true }).click();
    await expect(page.locator('.toast')).toContainText(ACTIVATION_WHEN_PILOT_ENDS);
  });
});

test.describe('empresa sin plan activado', () => {
  test.use({ subscription: inactiveSubscription });

  test('no afirma un piloto vigente ni marca ninguna tarjeta como actual', async ({ page, isMobile }) => {
    await openMembership(page, isMobile);

    const current = page.locator('.membership-current');
    await expect(current.getByRole('heading', { name: 'Sin plan activado', exact: true })).toBeVisible();
    await expect(current.getByText('Sin plan activo').first()).toBeVisible();
    await expect(current.getByText('Sin periodo vigente', { exact: true })).toBeVisible();
    await expect(current.getByText(/Periodo administrado por Chambeaya/)).toHaveCount(0);
    await expect(current.getByText(/Vigente hasta/)).toHaveCount(0);
    await expect(current.getByText('Piloto activo')).toHaveCount(0);
    await expect(current.getByRole('heading', { name: /^Plan / })).toHaveCount(0);

    await expect(page.locator('.membership-card.current')).toHaveCount(0);
    await expect(page.getByText('Actual', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Incluido en tu piloto', { exact: true })).toHaveCount(0);
  });

  test('la barra lateral no rotula "Plan piloto" sin plan activado', async ({ page, isMobile }) => {
    await openMembership(page, isMobile);

    await expect(sidebarPlan(page)).toHaveText('Sin plan activado');
    await expect(page.getByText('Plan piloto', { exact: true })).toHaveCount(0);
  });

  test('los botones de las tarjetas no prometen una activación tras el piloto', async ({ page, isMobile }) => {
    await openMembership(page, isMobile);

    // Con `INACTIVE` la tarjeta Piloto ya no es la actual: cae en la rama del
    // botón, igual que Empresa Pro y Custom.
    for (const name of ['Piloto', 'Empresa Pro', 'Custom']) {
      await planCard(page, name).getByRole('button', { name: 'Quiero conocerlo', exact: true }).click();
      const toast = page.locator('.toast');
      await expect(toast).toContainText(NO_PLAN_ACTIVATION_NOTICE);
      await expect(toast).not.toContainText(/cuando termine el piloto/);
      await page.getByRole('button', { name: 'Cerrar aviso', exact: true }).click();
      await expect(toast).toHaveCount(0);
    }
  });
});

test.describe('empresa con plan Pro activado', () => {
  test.use({ subscription: proSubscription });

  test('rotula la barra lateral como Empresa Pro y marca la tarjeta Pro como actual', async ({ page, isMobile }) => {
    await openMembership(page, isMobile);

    await expect(sidebarPlan(page)).toHaveText('Empresa Pro');
    await expect(page.getByText('Plan piloto', { exact: true })).toHaveCount(0);
    await expect(page.locator('.membership-current').getByRole('heading', { name: 'Plan Empresa Pro', exact: true })).toBeVisible();
    await expect(page.locator('.membership-card.current')).toHaveCount(1);
    await expect(planCard(page, 'Empresa Pro')).toHaveClass(/current/);
  });
});
