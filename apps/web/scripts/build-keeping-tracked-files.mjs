// Compila el panel (`next build`) y, pase lo que pase, deja `tsconfig.json` y `next-env.d.ts` byte a byte como estaban.
//
// Al compilar con otro `distDir` (NEXT_DIST_DIR, p. ej. el segundo panel de Playwright con la bandera de turnos
// apagada) Next.js reescribe esos dos archivos versionados para apuntar a su carpeta de tipos. Antes había que
// restaurarlos a mano tras la suite (BAJO-1 de CN-20261013-052); ahora este script los restaura al terminar el
// build, incluso si falla o si lo interrumpen.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = ['tsconfig.json', 'next-env.d.ts'].map((name) => join(root, name));
const snapshots = tracked.map((file) => ({ file, content: readFileSync(file) }));

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  for (const { file, content } of snapshots) {
    try {
      if (!readFileSync(file).equals(content)) writeFileSync(file, content);
    } catch {
      writeFileSync(file, content);
    }
  }
}

const child = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true, env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
    restore();
    process.exit(1);
  });
}
child.on('error', (error) => {
  restore();
  console.error(error);
  process.exit(1);
});
child.on('exit', (code) => {
  restore();
  process.exit(code ?? 1);
});
