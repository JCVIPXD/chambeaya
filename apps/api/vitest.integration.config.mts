import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    // Cada archivo de `tests/integration/**` comparte una única base de datos
    // Postgres real y trunca sus propias tablas en `beforeAll`/`afterAll`
    // (ver `requireTestDatabase()` en cada archivo). Vitest ejecuta archivos
    // distintos en paralelo por defecto; con más de un archivo de integración
    // eso permite que el `afterAll` de uno trunque las filas que otro archivo
    // todavía está usando a mitad de su prueba (reproducido al añadir
    // `shift-capacity-race.integration.test.ts` junto al archivo existente:
    // sin esta opción, la suite existente fallaba con "shift not found" y
    // "401" de forma intermitente). Forzar ejecución secuencial de archivos
    // evita esa carrera entre suites; no afecta la prueba de concurrencia
    // real dentro de un mismo archivo, que sigue usando `Promise.all` contra
    // la misma base de datos.
    fileParallelism: false,
    // Las pruebas de carrera con varias rondas (p. ej. las 12 rondas de
    // `shift-cancel-resolve-race`) tardan ~4,3 s en una máquina en reposo, muy
    // cerca del límite predeterminado de 5 s: en 2 de 10 corridas completas de
    // CN-20260923-014 expiraron sin ningún fallo real. Un límite holgado evita
    // esa falla por tiempo; las pruebas con carga larga ya fijan el suyo.
    testTimeout: 60_000,
  },
});
