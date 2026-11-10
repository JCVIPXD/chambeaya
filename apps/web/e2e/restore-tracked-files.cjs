// Red de seguridad que no depende del globalTeardown (Playwright no lo ejecuta si un `webServer` falla al arrancar,
// p. ej. por vencer su `timeout` a mitad del build): se importa desde `playwright.config.ts`.
//  - Al cargar la configuración restaura las copias huérfanas de una corrida anterior muerta a la fuerza.
//  - Al salir el proceso (también tras un error de arranque) restaura las que hayan quedado sin dueño vivo.
// `recoverStale` no toca nada mientras haya un build en curso con dueño vivo.
const { recoverStale } = require('../scripts/tracked-files-guard.cjs');

recoverStale();
process.on('exit', () => {
  try {
    recoverStale();
  } catch {}
});
