// Agrupa ráfagas de avisos en una sola ejecución: espera `waitMs` sin avisos nuevos (debounce) y, para que una
// ráfaga continua no posponga la recarga para siempre, ejecuta como tarde `maxWaitMs` después del primer aviso.
export type Coalescer = { trigger: () => void; cancel: () => void };

export function createCoalescer(run: () => void, { waitMs, maxWaitMs }: { waitMs: number; maxWaitMs: number }): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt = 0;
  const fire = () => {
    timer = null;
    run();
  };
  return {
    trigger() {
      const now = Date.now();
      if (timer === null) firstAt = now;
      else clearTimeout(timer);
      timer = setTimeout(fire, Math.max(0, Math.min(waitMs, firstAt + maxWaitMs - now)));
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
