import type { Page } from '@playwright/test';
import { account, expect, test } from './fixtures/business-api';
import { buildApplication, buildShift, installShiftAssignmentsApi } from './fixtures/shift-assignments';

// Costo de render del panel de la empresa. El panel es un único componente
// grande: cada `setState` con un valor nuevo (aunque sea idéntico) lo vuelve a
// renderizar entero. Los sondeos de cada 4 s y el pulso de la campana no deben
// consumir hilo principal cuando no hay nada nuevo que mostrar.
// La API es simulada; no se necesita base de datos ni servidor API.

async function countReactCommits(page: Page) {
  // Gancho mínimo de React DevTools: React de producción llama a
  // `onCommitFiberRoot` en cada confirmación de render. Es solo un contador.
  await page.addInitScript(() => {
    const counter = { commits: 0 };
    (window as unknown as { __renderCounter: typeof counter }).__renderCounter = counter;
    (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => undefined,
      onCommitFiberUnmount: () => undefined,
      onPostCommitFiberRoot: () => undefined,
      onCommitFiberRoot: () => {
        counter.commits += 1;
      },
    };
  });
}

function commits(page: Page) {
  return page.evaluate(() => (window as unknown as { __renderCounter: { commits: number } }).__renderCounter.commits);
}

async function openShifts(page: Page, isMobile: boolean | undefined) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
  if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('button', { name: /^Turnos(?!\w)/ }).click();
  await expect(page.getByRole('heading', { name: /^Postulaciones · / })).toBeVisible();
}

function applicationReads(log: string[]) {
  return log.filter((entry) => entry === 'GET /api/business/shifts/shift-resolution-1/applications').length;
}

test.describe('costo de render del panel', () => {
  test('un sondeo que devuelve lo mismo no vuelve a renderizar el panel, pero un cambio real sí se muestra', async ({ page, isMobile }) => {
    await countReactCommits(page);
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    await expect(page.locator('.application-row').filter({ hasText: 'Ana Pérez' })).toBeVisible();

    // Espera a que la carga inicial termine y el estado quede quieto.
    const readsAtStart = applicationReads(server.log);
    await expect.poll(() => applicationReads(server.log), { timeout: 12_000 }).toBeGreaterThanOrEqual(readsAtStart + 1);
    await page.waitForTimeout(300);

    // Dos sondeos completos (cada 4 s) sin ningún dato nuevo: cero renders.
    const commitsBefore = await commits(page);
    const readsBefore = applicationReads(server.log);
    await expect.poll(() => applicationReads(server.log), { timeout: 15_000 }).toBeGreaterThanOrEqual(readsBefore + 2);
    await page.waitForTimeout(300);
    expect(await commits(page)).toBe(commitsBefore);

    // El guardia no debe esconder cambios reales: el siguiente sondeo los aplica.
    server.applications[0].worker.name = 'Ana Pérez Actualizada';
    await expect(page.locator('.application-row').filter({ hasText: 'Ana Pérez Actualizada' })).toBeVisible({ timeout: 12_000 });
    expect(await commits(page)).toBeGreaterThan(commitsBefore);
  });

  test('un sondeo con cambios reales no parpadea: nunca aparece "Cargando postulaciones…" ni se reemplaza el nodo de la fila', async ({ page, isMobile }) => {
    // Sondeo silencioso: el estado de carga (`applicationsLoading`) solo se
    // enciende al abrir el turno, nunca en cada sondeo de 4 s. Se observa el
    // DOM real entre sondeos (no solo el resultado final) y se marca el nodo de
    // la fila para comprobar que React lo conserva en lugar de desmontarlo.
    const server = await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    await openShifts(page, isMobile);
    const row = page.locator('.application-row').filter({ hasText: 'Ana Pérez' });
    await expect(row).toBeVisible();
    await expect(page.locator('.application-count')).toHaveText('1 postulación');

    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __flickerSeen: string[] }).__flickerSeen = seen;
      document.querySelector('.application-row')?.setAttribute('data-probe', 'original');
      const check = () => {
        const board = document.querySelector('.application-board');
        if (board?.textContent?.includes('Cargando postulaciones')) seen.push('tablero cargando');
        if (board?.getAttribute('aria-busy') === 'true') seen.push('aria-busy');
        if (document.querySelector('.application-count')?.textContent?.includes('Actualizando')) seen.push('contador actualizando');
        if (board && !board.querySelector('.application-row')) seen.push('lista vacía');
      };
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    });

    const readsBefore = applicationReads(server.log);
    server.applications[0].worker.name = 'Ana Pérez Actualizada';
    await expect(page.locator('.application-row').filter({ hasText: 'Ana Pérez Actualizada' })).toBeVisible({ timeout: 12_000 });
    // Un sondeo más después del cambio, ya sin novedades.
    await expect.poll(() => applicationReads(server.log), { timeout: 15_000 }).toBeGreaterThanOrEqual(readsBefore + 2);
    await page.waitForTimeout(300);

    const observed = await page.evaluate(() => ({
      seen: (window as unknown as { __flickerSeen: string[] }).__flickerSeen,
      probe: document.querySelector('.application-row')?.getAttribute('data-probe') ?? null,
    }));
    expect(observed.seen).toEqual([]);
    expect(observed.probe).toBe('original');
  });

  test('las animaciones que no terminan solo mueven transform y opacity (nada de repintar cada fotograma)', async ({ page, isMobile }) => {
    await installShiftAssignmentsApi(page, {
      shift: buildShift(),
      applications: [buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'NO_SHOW' })],
    });
    // Con postulaciones pendientes aparece el punto de notificaciones (pulso infinito).
    await page.route('**/api/business/applications/pending', (route) =>
      route.fulfill({ json: { count: 2, shiftIds: ['shift-resolution-1'] } }),
    );
    await openShifts(page, isMobile);
    await expect(page.locator('.notification-dot')).toHaveCount(1);

    const infinite = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity)
        .map((animation) => ({
          name: (animation as CSSAnimation).animationName,
          properties: [
            ...new Set(
              (animation.effect as KeyframeEffect)
                .getKeyframes()
                .flatMap((keyframe) => Object.keys(keyframe))
                .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)),
            ),
          ].sort(),
        })),
    );
    expect(infinite.map((animation) => animation.name)).toContain('cn-notification-pulse');
    for (const animation of infinite) {
      expect(
        animation.properties.filter((property) => property !== 'transform' && property !== 'opacity'),
        `la animación infinita ${animation.name} anima propiedades que repintan cada fotograma`,
      ).toEqual([]);
    }
  });
});
