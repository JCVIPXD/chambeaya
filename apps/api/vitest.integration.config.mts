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
    // Límite global moderado: una prueba colgada (un bloqueo real, una pausa que
    // nunca se libera) tiene que fallar rápido en vez de retener CI un minuto por
    // prueba (BAJO-1 de CN-20260923-015; antes 60 s global). Duraciones medidas
    // en reposo: la inmensa mayoría de las pruebas dura menos de 4 s; las más
    // lentas (8 cancelaciones dobles simultáneas, ~10 s; las 12 rondas de
    // `shift-cancel-resolve-race`, ~4-6 s; las rondas de carga y la matriz
    // trabajador x empresa) fijan su PROPIO `timeout` en el archivo, mayor, porque
    // dependen del número de rondas y de la contención, no de este valor. Una
    // prueba nueva de carrera o carga con varias rondas debe fijar el suyo también.
    testTimeout: 20_000,
  },
});
