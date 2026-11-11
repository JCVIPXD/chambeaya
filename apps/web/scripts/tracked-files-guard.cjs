// Copia en disco de `tsconfig.json` y `next-env.d.ts` mientras corre un `next build` que los reescribe.
//
// La copia vive en `node_modules/.cache/chambeaya-tracked-files` (ignorada por git) para sobrevivir a un cierre
// forzado del proceso (`taskkill /T /F` en Windows, SIGKILL en POSIX), donde ningún manejador de señales corre.
// Quien la deja huérfana es recuperado por la siguiente corrida del script o por el globalTeardown de Playwright.
//
// Varios builds pueden correr a la vez (los dos paneles de Playwright): la primera copia es la verdadera y se
// restaura solo cuando sale el último dueño vivo. Cada dueño se registra con un archivo `owners/<pid>`.
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const root = join(__dirname, '..');
const TRACKED = ['tsconfig.json', 'next-env.d.ts'];
const backupDir = join(root, 'node_modules', '.cache', 'chambeaya-tracked-files');
const ownersDir = join(backupDir, 'owners');
const readyFile = join(backupDir, 'ready');
const ownerFile = join(ownersDir, String(process.pid));

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Dueños vivos (descarta y borra los registros de procesos que ya no existen). */
function liveOwners() {
  if (!existsSync(ownersDir)) return [];
  const live = [];
  for (const name of readdirSync(ownersDir)) {
    const pid = Number(name);
    if (Number.isInteger(pid) && isAlive(pid)) live.push(pid);
    else rmSync(join(ownersDir, name), { force: true });
  }
  return live;
}

/** Devuelve los archivos versionados a la copia, solo los que difieren. Falso si no hay copia completa. */
function restoreFromBackup() {
  if (!existsSync(readyFile)) return false;
  for (const name of TRACKED) {
    const content = readFileSync(join(backupDir, name));
    const target = join(root, name);
    let same = false;
    try {
      same = readFileSync(target).equals(content);
    } catch {}
    if (!same) writeFileSync(target, content);
  }
  return true;
}

function clearBackup() {
  rmSync(backupDir, { recursive: true, force: true });
}

const lockDir = join(root, 'node_modules', '.cache', 'chambeaya-tracked-files.lock');
const LOCK_STALE_MS = 10_000;

/** Candado entre procesos (carpeta creada de forma atómica) para que comprobar dueños y borrar la copia sea un paso único. */
function withLock(fn) {
  mkdirSync(dirname(lockDir), { recursive: true });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        // El dueño del candado murió sin soltarlo (las secciones críticas duran milisegundos).
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) rmSync(lockDir, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error('No se pudo obtener el candado de la copia de tsconfig.json y next-env.d.ts.');
      sleep(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function forceRestoreLocked() {
  const restored = restoreFromBackup();
  if (restored) clearBackup();
  return restored;
}

/** Restaura sin condiciones lo que haya quedado en la copia. */
function forceRestore() {
  return withLock(forceRestoreLocked);
}

/** Si una corrida anterior murió a la fuerza (sin dueños vivos), restaura sus archivos. Seguro con builds en curso. */
function recoverStale() {
  return withLock(() => {
    if (!existsSync(backupDir)) return false;
    // Sin `ready` la copia quedó a medias: aún no se había tocado nada (el candado impide que otro la esté creando).
    if (!existsSync(readyFile)) {
      clearBackup();
      return false;
    }
    return liveOwners().length === 0 ? forceRestoreLocked() : false;
  });
}

/** Registra este proceso y garantiza que exista la copia original. Llamar antes de `next build`. */
function acquire() {
  withLock(() => {
    if (existsSync(backupDir) && !existsSync(readyFile)) clearBackup();
    if (existsSync(backupDir) && liveOwners().length === 0) forceRestoreLocked();
    if (!existsSync(backupDir)) {
      // La primera copia es la verdadera; los demás builds concurrentes solo se registran.
      mkdirSync(ownersDir, { recursive: true });
      for (const name of TRACKED) writeFileSync(join(backupDir, name), readFileSync(join(root, name)));
      writeFileSync(readyFile, '');
    }
    writeFileSync(ownerFile, '');
  });
}

let released = false;
/** Quita este proceso; el último dueño en salir restaura los archivos y borra la copia. */
function release() {
  if (released) return;
  released = true;
  withLock(() => {
    rmSync(ownerFile, { force: true });
    if (liveOwners().length === 0) forceRestoreLocked();
  });
}

module.exports = { root, acquire, release, forceRestore, recoverStale };
