import type { Page, Route } from '@playwright/test';
import { account, expect, session, test } from './fixtures/business-api';
import { buildApplication, buildShift, installShiftAssignmentsApi } from './fixtures/shift-assignments';

// "Ver CV" en la lista de postulantes de un turno. La API es simulada: aquí se
// prueba la interfaz y su contrato HTTP (petición con la sesión de la empresa,
// PDF abierto en una pestaña de solo lectura, estados de carga y error). Las
// reglas de quién puede ver un CV viven solo en la API y se prueban allí
// (`apps/api/tests/applicant_cv.routes.test.ts` y su prueba de integración);
// el panel solo dibuja el botón cuando la API dice `hasCv`.

const PDF_BYTES = '%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF';
const CV_PATH = '/api/business/shifts/shift-resolution-1/applications/app-ana/cv';

type FakeTab = { closed: boolean; opener: unknown; href: string };
type TabWindow = Window & { __cvTabs: FakeTab[]; __blockPopups: boolean };

// `window.open` se sustituye por una pestaña falsa para observar qué se abre sin
// depender de que Chromium sin cabeza muestre un visor de PDF.
async function stubWindowOpen(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as TabWindow;
    target.__cvTabs = [];
    target.__blockPopups = false;
    window.open = () => {
      if (target.__blockPopups) return null;
      const tab: FakeTab & { location: { href: string }; close: () => void } = {
        closed: false,
        opener: 'panel',
        href: '',
        location: {
          get href() {
            return tab.href;
          },
          set href(value: string) {
            tab.href = value;
          },
        },
        close() {
          tab.closed = true;
        },
      };
      target.__cvTabs.push(tab);
      return tab as unknown as Window;
    };
  });
}

function tabs(page: Page) {
  return page.evaluate(() => (window as unknown as TabWindow).__cvTabs.map(({ closed, opener, href }) => ({ closed, opener, href })));
}

type CvCall = { authorization: string | undefined };

// Responde `GET .../cv`; `respond` decide cada respuesta (por defecto, el PDF).
async function installCvRoute(page: Page, respond?: (route: Route, calls: CvCall[]) => Promise<void>) {
  const calls: CvCall[] = [];
  await page.route((url) => url.pathname === CV_PATH, async (route) => {
    calls.push({ authorization: route.request().headers()['authorization'] });
    if (respond) await respond(route, calls);
    else await route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF_BYTES });
  });
  return calls;
}

async function openShifts(page: Page, isMobile: boolean | undefined) {
  await page.goto('/');
  await page.getByLabel('Correo empresarial', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión', exact: true })).toHaveCount(0);
  if (isMobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('button', { name: 'Turnos', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Postulaciones · / })).toBeVisible();
}

function row(page: Page, workerName: string) {
  return page.locator('.application-row').filter({ hasText: workerName });
}

async function setup(page: Page, isMobile: boolean | undefined) {
  await stubWindowOpen(page);
  const server = await installShiftAssignmentsApi(page, {
    shift: buildShift({ status: 'PUBLISHED' }),
    applications: [
      buildApplication({ id: 'app-ana', workerName: 'Ana Pérez', assignmentStatus: 'ASSIGNED', hasCv: true }),
      buildApplication({ id: 'app-luis', workerName: 'Luis Ríos', assignmentStatus: 'ASSIGNED', hasCv: false }),
    ],
  });
  await openShifts(page, isMobile);
  await expect(row(page, 'Ana Pérez')).toBeVisible();
  return server;
}

const viewCv = (page: Page) => row(page, 'Ana Pérez').getByRole('button', { name: 'Ver CV de Ana Pérez', exact: true });

test.describe('CV del postulante', () => {
  test('solo las postulaciones con CV muestran "Ver CV", y el copy no promete verificación', async ({ page, isMobile }) => {
    const server = await setup(page, isMobile);

    await expect(viewCv(page)).toBeVisible();
    await expect(row(page, 'Luis Ríos').getByRole('button', { name: /Ver CV/ })).toHaveCount(0);
    await expect(row(page, 'Luis Ríos')).not.toContainText('CV');

    const note = row(page, 'Ana Pérez').locator('.applicant-cv-note');
    await expect(note).toContainText('solo lectura');
    await expect(note).toContainText('Chambeaya no verifica su contenido');
    await expect(row(page, 'Ana Pérez')).not.toContainText(/verificad/i);

    // El listado no descarga ningún CV: solo pide el archivo al pulsar.
    expect(server.log.some((entry) => entry.includes('/cv'))).toBe(false);
  });

  test('pide el PDF con la sesión de la empresa y lo abre en una pestaña nueva sin opener', async ({ page, isMobile }) => {
    await setup(page, isMobile);
    const calls = await installCvRoute(page);
    expect(calls).toHaveLength(0);

    await viewCv(page).click();

    await expect.poll(async () => (await tabs(page))[0]?.href ?? '').toMatch(/^blob:/);
    expect(calls).toEqual([{ authorization: `Bearer ${session.token}` }]);
    const [tab] = await tabs(page);
    expect(tab.opener).toBeNull();
    expect(tab.closed).toBe(false);

    // Lo abierto es el PDF recibido, con tipo `application/pdf`.
    const opened = await page.evaluate(async (href) => {
      const blob = await (await fetch(href)).blob();
      return { type: blob.type, text: await blob.text() };
    }, tab.href);
    expect(opened).toEqual({ type: 'application/pdf', text: PDF_BYTES });

    // Terminó: el botón vuelve a estar listo, sin error.
    await expect(viewCv(page)).toHaveAttribute('aria-busy', 'false');
    await expect(row(page, 'Ana Pérez').getByRole('alert')).toHaveCount(0);
  });

  test('muestra el estado de carga, es accesible y no duplica la petición con clics repetidos', async ({ page, isMobile }) => {
    await setup(page, isMobile);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls = await installCvRoute(page, async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF_BYTES });
    });

    await viewCv(page).focus();
    await page.keyboard.press('Enter');
    await expect(viewCv(page)).toHaveAttribute('aria-busy', 'true');
    await expect(viewCv(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(row(page, 'Ana Pérez').getByRole('status')).toHaveText('Abriendo el CV…');
    // Sigue enfocable (no `disabled`): el foco no se pierde al cargar.
    await expect(viewCv(page)).toBeFocused();

    // `aria-disabled` (no `disabled`) mantiene el foco; Playwright no hace clic en
    // un botón así salvo con `force`, que es justo lo que hace un usuario impaciente.
    await viewCv(page).click({ force: true });
    await viewCv(page).click({ force: true });
    expect(calls).toHaveLength(1);

    release();
    await expect.poll(async () => (await tabs(page))[0]?.href ?? '').toMatch(/^blob:/);
    await expect(viewCv(page)).toHaveAttribute('aria-busy', 'false');
    await expect(row(page, 'Ana Pérez').getByRole('status')).toHaveCount(0);
    expect(calls).toHaveLength(1);
    expect(await tabs(page)).toHaveLength(1);
  });

  test('CV no disponible: avisa con un mensaje claro, cierra la pestaña vacía y permite reintentar', async ({ page, isMobile }) => {
    await setup(page, isMobile);
    let available = false;
    await installCvRoute(page, async (route) => {
      if (!available) await route.fulfill({ status: 404, json: { error: 'CV_NOT_AVAILABLE' } });
      else await route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF_BYTES });
    });

    await viewCv(page).click();

    const alert = row(page, 'Ana Pérez').getByRole('alert');
    await expect(alert).toHaveText('El CV ya no está disponible para esta postulación.');
    const [tab] = await tabs(page);
    expect(tab.closed).toBe(true);
    expect(tab.href).toBe('');
    await expect(viewCv(page)).toHaveAttribute('aria-busy', 'false');

    available = true;
    await viewCv(page).click();
    await expect.poll(async () => (await tabs(page))[1]?.href ?? '').toMatch(/^blob:/);
    await expect(row(page, 'Ana Pérez').getByRole('alert')).toHaveCount(0);
  });

  test('una sesión vencida o un fallo de red muestran su propio mensaje', async ({ page, isMobile }) => {
    await setup(page, isMobile);
    let mode: 401 | 'network' = 401;
    await installCvRoute(page, async (route) => {
      if (mode === 401) await route.fulfill({ status: 401, json: { error: 'INVALID_SESSION' } });
      else await route.abort('failed');
    });

    await viewCv(page).click();
    await expect(row(page, 'Ana Pérez').getByRole('alert')).toHaveText('Tu sesión venció. Vuelve a iniciar sesión para abrir el CV.');

    mode = 'network';
    await viewCv(page).click();
    await expect(row(page, 'Ana Pérez').getByRole('alert')).toHaveText('No pudimos abrir el CV. Inténtalo otra vez.');
    expect((await tabs(page)).every((tab) => tab.closed && tab.href === '')).toBe(true);
  });

  test('una respuesta que no es un PDF nunca se abre en el origen del panel', async ({ page, isMobile }) => {
    await setup(page, isMobile);
    await installCvRoute(page, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<script>window.name="hackeado"</script>' });
    });

    await viewCv(page).click();

    await expect(row(page, 'Ana Pérez').getByRole('alert')).toHaveText('No pudimos abrir el CV. Inténtalo otra vez.');
    const [tab] = await tabs(page);
    expect(tab.closed).toBe(true);
    expect(tab.href).toBe('');
  });

  test('con las ventanas emergentes bloqueadas descarga el PDF en lugar de fallar', async ({ page, isMobile }) => {
    await setup(page, isMobile);
    await installCvRoute(page);
    await page.evaluate(() => {
      (window as unknown as TabWindow).__blockPopups = true;
    });

    const downloadPromise = page.waitForEvent('download');
    await viewCv(page).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('CV de Ana Pérez.pdf');
    await expect(row(page, 'Ana Pérez').getByRole('alert')).toHaveCount(0);
  });

  test('con un CV en la lista, un sondeo sin cambios sigue sin renderizar el panel', async ({ page, isMobile }) => {
    // Mismo gancho que `render-cost.spec.ts`: cuenta confirmaciones de React.
    await page.addInitScript(() => {
      const counter = { commits: 0 };
      (window as unknown as { __renderCounter: typeof counter }).__renderCounter = counter;
      (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true, isDisabled: false, renderers: new Map(), inject: () => 1, checkDCE: () => undefined,
        onCommitFiberUnmount: () => undefined, onPostCommitFiberRoot: () => undefined,
        onCommitFiberRoot: () => { counter.commits += 1; },
      };
    });
    const server = await setup(page, isMobile);
    const reads = () => server.log.filter((entry) => entry === 'GET /api/business/shifts/shift-resolution-1/applications').length;
    const commits = () => page.evaluate(() => (window as unknown as { __renderCounter: { commits: number } }).__renderCounter.commits);

    const start = reads();
    await expect.poll(reads, { timeout: 12_000 }).toBeGreaterThanOrEqual(start + 1);
    await page.waitForTimeout(300);
    const before = await commits();
    const readsBefore = reads();
    await expect.poll(reads, { timeout: 15_000 }).toBeGreaterThanOrEqual(readsBefore + 2);
    await page.waitForTimeout(300);

    expect(await commits()).toBe(before);
    await expect(viewCv(page)).toBeVisible();
  });
});
