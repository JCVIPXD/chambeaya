import { runDemoSmoke } from '../src/demo/demo.smoke.js';

async function main() {
  await runDemoSmoke();
  console.info('Smoke local de demostración completado para empresa, trabajador y superadmin.');
}

void main().catch((error) => {
  const code = error instanceof Error ? error.message : 'DEMO_SMOKE_FAILED';
  console.error(`El smoke de demostración no se completó: ${code}`);
  process.exitCode = 1;
});
