// Red de seguridad tras la suite: si un build quedó a medias (cierre forzado), devuelve `tsconfig.json` y
// `next-env.d.ts` a su estado original desde la copia en disco de `scripts/tracked-files-guard.cjs`.
import guard from '../scripts/tracked-files-guard.cjs';

const { forceRestore } = guard;

export default function globalTeardown() {
  if (forceRestore()) console.warn('Se restauraron tsconfig.json y next-env.d.ts desde la copia de un build interrumpido.');
}
