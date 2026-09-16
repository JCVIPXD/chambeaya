import type { Page } from '@playwright/test';
import { account, expect, test } from './fixtures/business-api';

// Covers Alcance 5b (CN-20260915-079 → 5b): the "Invitar" button on a talent
// card must call the real POST route and reflect its actual response, never
// an optimistic success. Also covers the duplicate-invitation error path,
// which must not be shown as a success.

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
}

const talentCard = {
  id: 'talent-invite-a',
  name: 'Bruno Vega',
  headline: null,
  district: 'Miraflores',
  availabilityText: 'Disponible',
  isAvailable: true,
  specialties: [],
  completion: 80,
  reputation: { averageRating: null, reviewCount: 0 },
};

async function openTrabajadores(page: Page, isMobile: boolean | undefined) {
  await login(page);
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Trabajadores', exact: true }).click();
}

test('envía una invitación real y la refleja en "Invitaciones enviadas" solo tras la respuesta 2xx', async ({ page, isMobile }) => {
  await page.route((url) => url.pathname === '/api/specialties', (route) => route.fulfill({ json: [] }));
  await page.route(
    (url) => url.pathname === '/api/business/talent' && !new URL(url).searchParams.get('cursor'),
    (route) => route.fulfill({ json: { items: [talentCard], nextCursor: null } }),
  );

  let createCalled = false;
  await page.route((url) => url.pathname === '/api/business/talent-invitations', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: [] });
      return;
    }
    createCalled = true;
    expect(route.request().postDataJSON()).toEqual({ workerTalentProfileId: talentCard.id });
    await route.fulfill({
      status: 201,
      json: {
        id: 'invitation-1',
        status: 'PENDING',
        message: null,
        expiresAt: '2026-09-23T00:00:00.000Z',
        respondedAt: null,
        createdAt: '2026-09-16T00:00:00.000Z',
        shift: null,
        workerTalentProfileId: talentCard.id,
        workerName: talentCard.name,
      },
    });
  });

  await openTrabajadores(page, isMobile);

  const inviteButton = page.getByRole('button', { name: 'Invitar', exact: true });
  await expect(inviteButton).toBeVisible();
  await inviteButton.click();

  // Real 2xx round trip happened before any success is shown.
  await expect(page.getByRole('button', { name: 'Invitación enviada', exact: true })).toBeDisabled();
  await expect(page.getByText('Invitación enviada a Bruno Vega.')).toBeVisible();
  expect(createCalled).toBe(true);

  await expect(page.getByText('Aún no enviaste invitaciones')).toHaveCount(0);
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
});

// Regression test for CN-20260915-081 MEDIO-1: a still in-flight GET of the
// invitations list (started before the user clicked "Invitar") must not
// overwrite the invitation that the POST just confirmed with a 201. The stale
// GET response is a snapshot from before the create, so applying it as-is
// reverted "Invitación enviada" back to "Invitar" and showed "Aún no enviaste
// invitaciones" even though the invitation existed on the server.
test('una carga en vuelo del listado de invitaciones no revierte una invitación recién creada', async ({ page, isMobile }) => {
  await page.route((url) => url.pathname === '/api/specialties', (route) => route.fulfill({ json: [] }));
  await page.route(
    (url) => url.pathname === '/api/business/talent' && !new URL(url).searchParams.get('cursor'),
    (route) => route.fulfill({ json: { items: [talentCard], nextCursor: null } }),
  );

  let releaseStaleList: () => void = () => {};
  const staleListGate = new Promise<void>((resolve) => {
    releaseStaleList = resolve;
  });

  await page.route((url) => url.pathname === '/api/business/talent-invitations', async (route) => {
    if (route.request().method() !== 'POST') {
      // Simulate the GET fired on entering "Trabajadores" resolving late, with a
      // snapshot taken before the invitation below was created (empty list).
      await staleListGate;
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: 'invitation-race-1',
        status: 'PENDING',
        message: null,
        expiresAt: '2026-09-23T00:00:00.000Z',
        respondedAt: null,
        createdAt: '2026-09-16T00:00:00.000Z',
        shift: null,
        workerTalentProfileId: talentCard.id,
        workerName: talentCard.name,
      },
    });
  });

  await openTrabajadores(page, isMobile);

  const inviteButton = page.getByRole('button', { name: 'Invitar', exact: true });
  await expect(inviteButton).toBeVisible();
  await inviteButton.click();

  // Real 2xx round trip resolved (the POST is not gated) while the initial GET
  // of the invitations list is still pending.
  await expect(page.getByRole('button', { name: 'Invitación enviada', exact: true })).toBeDisabled();
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
  await expect(page.getByText('Aún no enviaste invitaciones')).toHaveCount(0);

  // Now let the stale GET (snapshot from before the create) resolve, and wait
  // for the response itself (not just the route release) before asserting, so
  // the check can't race the client's own handling of that response.
  const staleListResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/business/talent-invitations') &&
      response.request().method() === 'GET',
  );
  releaseStaleList();
  await staleListResponse;

  // Fix under test: the invitation created locally must survive the stale
  // response instead of being wiped out by it.
  await expect(page.getByRole('button', { name: 'Invitación enviada', exact: true })).toBeDisabled();
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
  await expect(page.getByText('Aún no enviaste invitaciones')).toHaveCount(0);
});

// Regression test for CN-20260915-083 MEDIO-1: logging out must clear
// invitation state (list, per-card errors, the "created locally" id set), not
// just company/shift/worker state. The root component never unmounts on
// logout (it only swaps in <BusinessAuth />, see page.tsx around the
// `if (!session) return <BusinessAuth ... />` branch), so anything logout()
// forgets to clear survives in memory for whoever signs in next on the same
// tab. Reproduced here by signing back in with no page reload/goto — a
// reload was already known to paper over the bug.
test('cerrar sesión limpia el listado de invitaciones y el estado del botón antes de que otra sesión empiece en la misma pestaña', async ({ page, isMobile }) => {
  await page.route((url) => url.pathname === '/api/specialties', (route) => route.fulfill({ json: [] }));
  await page.route(
    (url) => url.pathname === '/api/business/talent' && !new URL(url).searchParams.get('cursor'),
    (route) => route.fulfill({ json: { items: [talentCard], nextCursor: null } }),
  );
  await page.route((url) => url.pathname === '/api/business/talent-invitations', async (route) => {
    if (route.request().method() !== 'POST') {
      // Every session that asks gets a fresh, empty list from the server.
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: 'invitation-logout-1',
        status: 'PENDING',
        message: null,
        expiresAt: '2026-09-23T00:00:00.000Z',
        respondedAt: null,
        createdAt: '2026-09-16T00:00:00.000Z',
        shift: null,
        workerTalentProfileId: talentCard.id,
        workerName: talentCard.name,
      },
    });
  });

  await openTrabajadores(page, isMobile);
  await page.getByRole('button', { name: 'Invitar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invitación enviada', exact: true })).toBeDisabled();
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();

  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  }
  const loggedOut = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/session' && response.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await loggedOut;
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toBeVisible();

  // Sign back in on the exact same page (no page.goto), the same way a second
  // BUSINESS account would in the same browser tab.
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);

  // Nothing resets "Trabajadores" as the active section on logout, so its
  // fresh, empty response for this new session should be all that's on
  // screen: no leftover card, no stuck "Invitación enviada" button.
  await expect(page.getByText('Aún no enviaste invitaciones')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invitación enviada', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invitar', exact: true })).toBeEnabled();
  await expect(page.getByText('Pendiente', { exact: true })).toHaveCount(0);
});

test('un duplicado activo muestra el error explícito y no simula éxito', async ({ page, isMobile }) => {
  await page.route((url) => url.pathname === '/api/specialties', (route) => route.fulfill({ json: [] }));
  await page.route(
    (url) => url.pathname === '/api/business/talent' && !new URL(url).searchParams.get('cursor'),
    (route) => route.fulfill({ json: { items: [talentCard], nextCursor: null } }),
  );
  await page.route((url) => url.pathname === '/api/business/talent-invitations', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 409, json: { error: 'INVITATION_ALREADY_ACTIVE' } });
  });

  await openTrabajadores(page, isMobile);

  await page.getByRole('button', { name: 'Invitar', exact: true }).click();

  await expect(page.getByText('Ya existe una invitación activa para este perfil.')).toBeVisible();
  // No optimistic success: the button goes back to its original label, not "Invitación enviada".
  await expect(page.getByRole('button', { name: 'Invitar', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Invitación enviada', exact: true })).toHaveCount(0);
});
