// Compila el panel (`next build`) y, pase lo que pase, deja `tsconfig.json` y `next-env.d.ts` byte a byte como estaban.
//
// Al compilar con otro `distDir` (NEXT_DIST_DIR, p. ej. el segundo panel de Playwright con la bandera de turnos
// apagada) Next.js reescribe esos dos archivos versionados para apuntar a su carpeta de tipos.
//  - La copia original se guarda también en disco (`tracked-files-guard.cjs`, en una ruta ignorada por git).
//    Si este proceso muere por la fuerza (`taskkill /T /F`, SIGKILL) nadie restaura en el momento, pero la siguiente
//    corrida de este script, o el globalTeardown de Playwright (`e2e/global-teardown.mjs`), los restaura.
//  - Ante SIGINT/SIGTERM se reenvía la señal al hijo y se restaura solo cuando el hijo ya terminó.
//  - En POSIX NO se separa el grupo de procesos (`detached`): Playwright detiene su `webServer` con
//    `process.kill(-pid, 'SIGKILL')` sobre el grupo del shell, y el build debe morir con él (sin huérfanos que
//    reescriban los archivos después de restaurarlos).
//  - El código de salida es el del build: un build fallido sigue fallando.
import { spawn, spawnSync } from 'node:child_process';

import guard from './tracked-files-guard.cjs';

const { acquire, release, root } = guard;

acquire();
process.on('exit', release);

const posix = process.platform !== 'win32';
const child = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true, env: process.env });

function killTree(signal) {
  try {
    if (posix) child.kill(signal);
    else spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {}
}

let exitCode = null;
function finish(code) {
  release();
  process.exit(code);
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    if (exitCode === null) exitCode = code;
    killTree(signal);
    // Se restaura en el `exit` del hijo; si no llega a tiempo, se fuerza su cierre y se termina igualmente.
    setTimeout(() => {
      killTree('SIGKILL');
      finish(exitCode);
    }, 15_000).unref();
  });
}
child.on('error', (error) => {
  console.error(error);
  finish(1);
});
child.on('exit', (code) => finish(exitCode ?? code ?? 1));
