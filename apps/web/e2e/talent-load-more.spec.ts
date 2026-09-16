import type { Page } from '@playwright/test';
import { account, expect, test } from './fixtures/business-api';

// Regression test for CN-20260915-075 MEDIO-1: changing a talent filter while
// "Ver más perfiles" is still in flight must not leave the button permanently
// disabled with "Cargando…". The loading flag belongs to the load-more call's
// own lifecycle and must reset in `finally` regardless of whether its data is
// later discarded as stale.

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
}

const talentCard = (id: string, name: string, district: string) => ({
  id,
  name,
  headline: null,
  district,
  availabilityText: 'Disponible',
  isAvailable: true,
  specialties: [],
  completion: 80,
  reputation: { averageRating: null, reviewCount: 0 },
});

test('reactiva "Ver más perfiles" si un filtro cambia mientras la página siguiente sigue en vuelo', async ({ page, isMobile }) => {
  const firstPage = {
    items: [talentCard('talent-a', 'Ana Torres', 'Miraflores'), talentCard('talent-b', 'Luis Paredes', 'Surco')],
    nextCursor: 'cursor-1',
  };
  const secondPage = { items: [talentCard('talent-c', 'Carla Ruiz', 'Lince')], nextCursor: null };
  const filteredPage = { items: [talentCard('talent-d', 'Andrea Salas', 'San Isidro')], nextCursor: 'cursor-2' };

  let releaseSecondPage: () => void = () => {};
  const secondPageGate = new Promise<void>((resolve) => {
    releaseSecondPage = resolve;
  });

  await page.route((url) => url.pathname === '/api/specialties', (route) => route.fulfill({ json: [] }));
  await page.route((url) => url.pathname === '/api/business/talent', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor')) {
      // Simulate a slow "load more" response so a filter change can race it.
      await secondPageGate;
      await route.fulfill({ json: secondPage });
      return;
    }
    if (url.searchParams.get('query') === 'andrea') {
      await route.fulfill({ json: filteredPage });
      return;
    }
    await route.fulfill({ json: firstPage });
  });

  await login(page);
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Trabajadores', exact: true }).click();

  const loadMoreButton = page.getByRole('button', { name: 'Ver más perfiles', exact: true });
  await expect(loadMoreButton).toBeVisible();
  await loadMoreButton.click();

  const loadingButton = page.getByRole('button', { name: 'Cargando…', exact: true });
  await expect(loadingButton).toBeDisabled();

  // Change a filter while the "load more" request above is still gated/in flight.
  await page.getByLabel('Buscar talento por nombre, presentación o distrito', { exact: true }).fill('andrea');
  await page.waitForTimeout(500); // covers the 300ms debounce plus the mocked fetch

  await expect(page.getByText('Andrea Salas', { exact: true })).toBeVisible();
  // The stale "load more" call has not resolved yet, so the flag is still up.
  await expect(loadingButton).toBeDisabled();

  releaseSecondPage();

  // Fix under test: once the stale response settles, the loading flag must
  // reset unconditionally, re-enabling pagination for the current filter.
  await expect(page.getByRole('button', { name: 'Ver más perfiles', exact: true })).toBeEnabled();

  // The discarded response must not leak its items into the current (filtered) list.
  await expect(page.getByText('Carla Ruiz', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Luis Paredes', { exact: true })).toHaveCount(0);
});
