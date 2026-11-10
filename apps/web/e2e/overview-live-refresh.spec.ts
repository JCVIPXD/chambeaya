import { expect, test } from './fixtures/business-api';
import { FLAG_OFF_URL, login } from './fixtures/fixed-jobs-ui';
import { installFixedJobsApi, samplePosting } from './fixtures/fixed-jobs-api';
import { createCoalescer } from '../features/jobs/coalesce';
import { DAY_MS, isoFromNow } from './fixtures/dates';

test.use({ baseURL: FLAG_OFF_URL });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('el agrupador junta una ráfaga en una sola ejecución, respeta el tope de espera y se cancela', async () => {
  let runs = 0;
  const burst = createCoalescer(() => { runs += 1; }, { waitMs: 60, maxWaitMs: 200 });
  for (let i = 0; i < 6; i += 1) { burst.trigger(); await sleep(5); }
  expect(runs).toBe(0);
  await sleep(150);
  expect(runs).toBe(1);

  // Una ráfaga que no se detiene no pospone la ejecución para siempre: sale como tarde a los 200 ms.
  runs = 0;
  const endless = createCoalescer(() => { runs += 1; }, { waitMs: 100, maxWaitMs: 200 });
  for (let i = 0; i < 14; i += 1) { endless.trigger(); await sleep(30); }
  expect(runs).toBeGreaterThanOrEqual(1);
  endless.cancel();
  await sleep(150);
  const after = runs;
  endless.trigger();
  endless.cancel();
  await sleep(150);
  expect(runs).toBe(after);
});

test('el Resumen sigue actualizándose con el aviso en vivo, y una ráfaga de avisos provoca una sola recarga', async ({ page }) => {
  const server = await installFixedJobsApi(page, { postings: [samplePosting({ id: 'p-1', title: 'Cajera', status: 'PUBLISHED', publishedAt: isoFromNow(-DAY_MS), vacancies: 1 })] });
  await login(page);
  const published = page.locator('.fx-stat').filter({ hasText: 'Puestos publicados' }).locator('strong');
  await expect(published).toHaveText('1');
  await expect.poll(() => server.sseConnections()).toBeGreaterThan(0);

  const listCalls = () => server.calls.filter((call) => call.method === 'GET' && call.path === '/business/job-postings').length;
  const before = listCalls();
  server.addPosting({ id: 'p-2', title: 'Mozo', status: 'PUBLISHED', publishedAt: isoFromNow(-DAY_MS), vacancies: 1 });
  // Ráfaga: cinco avisos en una sola entrega. Sin agrupador serían cinco recargas de la lista.
  server.pushEvents(Array.from({ length: 5 }, (_, index) => ({ type: 'APPLICATION_RECEIVED', applicationId: `a-${index}`, postingId: 'p-2', status: 'APPLIED' as const })));
  await expect(published).toHaveText('2');
  await page.waitForTimeout(1500);
  expect(listCalls() - before).toBe(1);
});
