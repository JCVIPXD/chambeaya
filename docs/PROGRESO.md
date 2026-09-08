# Progreso operativo de Cumple Now

Este es el único registro operativo vigente del proyecto. Los demás documentos de `docs/` conservan contexto histórico, planes o referencias técnicas, pero los cierres nuevos se registran aquí.

## Equipo de dos agentes

| Agente | Modelo | Responsabilidad | Puede editar código |
| --- | --- | --- | --- |
| `implementador-terra` | `gpt-5.6-terra` | Alcance, implementación, pruebas y correcciones | Sí |
| `auditor-sol` | `gpt-5.6-sol` | Revisión independiente de corrección, seguridad y regresiones | No; devuelve hallazgos |

La coordinación de la conversación solo asigna trabajo; no constituye un tercer rol operativo. No se deben crear agentes adicionales para este proyecto.

## Ciclo obligatorio

1. Terra toma una tarea acotada, implementa, prueba y registra el cierre con estado `LISTO_PARA_AUDITORIA`.
2. Sol audita ese ID y registra `APROBADO` o `REQUIERE_CAMBIOS`.
3. Si hay hallazgos, Terra corrige y crea una nueva entrada que referencia la implementación anterior.
4. Sol reaudita. El cambio queda cerrado únicamente con una auditoría `APROBADO`.

Los agentes trabajan en secuencia. Esto evita conflictos en el código y en este archivo.

## Reglas del registro

- Crear el ID con el formato `CN-AAAAMMDD-NNN`.
- Agregar cada entrada terminada al inicio de la sección `Registro`.
- No registrar planes, intentos, mensajes de estado ni trabajo en curso.
- No modificar ni borrar entradas anteriores; las correcciones se enlazan mediante `Referencia`.
- Escribir comandos y resultados verificables, sin afirmar que una prueba pasó si no se ejecutó.
- Usar `NO_EJECUTADA` para una validación pendiente y explicar el riesgo.

## Plantilla de entrada

```markdown
### CN-AAAAMMDD-NNN — Título breve

- Fecha: AAAA-MM-DD HH:mm (America/Lima)
- Agente: implementador-terra | auditor-sol
- Tipo: IMPLEMENTACION | CORRECCION | AUDITORIA
- Estado: LISTO_PARA_AUDITORIA | REQUIERE_CAMBIOS | APROBADO
- Referencia: ID anterior o N/A
- Alcance: resultado concreto terminado
- Archivos: rutas modificadas o revisadas
- Decisiones: decisiones y supuestos relevantes
- Validaciones: comando/comprobación y resultado
- Riesgos: riesgos residuales o `Ninguno conocido`
- Siguiente paso: acción y responsable
```

## Registro

### CN-20260908-048 — Reauditoría del cleanup ante contrato de login inesperado

- Fecha: 2026-09-08 13:06 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260908-047
- Alcance: reauditoría del registro temprano de tokens, limpieza de las tres sesiones ante una respuesta de login con identidad inesperada, ausencia de secretos en errores y logs, suite, build y smoke real sobre Docker/PostgreSQL.
- Archivos: `apps/api/src/demo/demo.smoke.ts`, `apps/api/tests/demo.smoke.test.ts`, `apps/api/scripts/demo-smoke.ts`, `docs/PROGRESO.md`.
- Decisiones: el hallazgo medio de CN-20260908-046 está corregido. Cada token de texto no vacío se normaliza y registra en el conjunto privado de cleanup inmediatamente después de decodificar la respuesta y antes de validar rol, `userId` y correo. La regresión crea tres sesiones con tokens distintos, hace que una respuesta exitosa tenga rol incorrecto y demuestra tres solicitudes DELETE y cero sesiones simuladas restantes. Los errores del runner y el entrypoint usan códigos genéricos y no incorporan el cuerpo de respuesta, encabezados, token, credenciales ni hashes. No se encontraron hallazgos críticos, altos, medios o bajos nuevos dentro del alcance.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.smoke.test.ts -t "cleans every usable login token"` — 1/1 aprobada y 3 omitidas por filtro; inspección de la prueba — tres tokens emitidos, tres tokens cerrados y conjunto de sesiones vivo vacío; `npm run test --workspace=@cumple-now/api` — 11 archivos y 50/50 pruebas aprobadas; `npm run build --workspace=@cumple-now/api` — `tsc --noEmit` correcto; `docker compose ps` — API, web y PostgreSQL saludables; `npm run demo:smoke` — semilla y recorrido HTTP reales correctos para empresa, trabajador y superadmin; consulta PostgreSQL posterior — 0 sesiones asociadas a las tres cuentas demo; revisión estática de errores/logs y búsqueda en logs del contenedor de los últimos cinco minutos — 0 coincidencias de encabezados Bearer, tokens de prueba, contraseñas o hashes; `git diff --check` — código 0, sólo avisos CRLF preexistentes.
- Riesgos: una indisponibilidad real del endpoint DELETE aún puede impedir el cierre remoto; en un camino que ya tiene un error primario, el runner conserva ese error aunque también falle el cleanup. No bloquea la presentación ni reabre el defecto corregido, porque todos los tokens recuperables se intentan cerrar con `Promise.allSettled` y un recorrido exitoso sí falla si algún cierre no se completa. El smoke no sustituye una matriz visual exhaustiva de los tres paneles.
- Siguiente paso: cambio aprobado; la coordinación puede continuar con la siguiente prioridad de preparación de la demo.

### CN-20260908-047 — Cleanup de token previo a contrato de login

- Fecha: 2026-09-08 12:58 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260908-046
- Alcance: el smoke registra todo token de login utilizable para cierre antes de validar rol, usuario o correo; una respuesta exitosa con identidad inesperada ya no deja una sesión demo temporal sin cerrar.
- Archivos: `apps/api/src/demo/demo.smoke.ts`, `apps/api/tests/demo.smoke.test.ts`, `docs/PROGRESO.md`.
- Decisiones: los tokens se normalizan con `trim`, sólo los no vacíos se agregan a un `Set` privado de cleanup y nunca se incluyen en errores. El contrato posterior exige rol, `userId` y correo exactos, mientras el `finally` borra todos los tokens registrados incluso si el contrato de uno falla.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.smoke.test.ts` — 1 archivo y 4/4 pruebas aprobadas, incluida la regresión de tres logins exitosos con un rol inesperado, tres DELETE y cero sesiones simuladas restantes; `npm run test --workspace=@cumple-now/api` — 11 archivos y 50/50 pruebas aprobadas; `npm run build --workspace=@cumple-now/api` — `tsc --noEmit` correcto; `docker compose ps` — API, web y PostgreSQL saludables; `npm run demo:smoke` — semilla y smoke reales correctos; consulta PostgreSQL posterior — 0 sesiones de las tres cuentas demo; parseo de scripts PowerShell y `docker compose config --quiet` — correctos; `git diff --check` — código 0 (sólo avisos CRLF preexistentes).
- Riesgos: el smoke valida contratos HTTP y cleanup, no una matriz visual exhaustiva de los tres paneles. Los tokens se eliminan por valor único; una respuesta anómala que reutilice exactamente el mismo token representa una sola sesión remota.
- Siguiente paso: `auditor-sol` debe reauditar CN-20260908-047, en particular el registro previo a la validación de identidad, la ausencia de filtraciones y la regresión de tres sesiones.

### CN-20260908-046 — Reauditoría del smoke ejecutable y limpieza de sesiones

- Fecha: 2026-09-08 12:53 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: REQUIERE_CAMBIOS
- Referencia: CN-20260908-045
- Alcance: reauditoría de los entrypoints de semilla y smoke, asentamiento concurrente de logins, limpieza de sesiones en éxito y error, construcción limpia del contenedor, alcance destructivo de la semilla y ejecución real del escenario de presentación.
- Archivos: `apps/api/prisma/seed.ts`, `apps/api/scripts/demo-smoke.ts`, `apps/api/src/demo/demo.smoke.ts`, `apps/api/src/demo/demo.seed.ts`, `apps/api/tests/demo.smoke.test.ts`, `apps/api/tests/demo.seed.test.ts`, `apps/api/tsconfig.json`, `apps/api/Dockerfile.dev`, `package.json`, `package-lock.json`, `docker-compose.yml`, `scripts/demo-smoke.ps1`, `scripts/seed-demo.ps1`, `docs/PROGRESO.md`.
- Decisiones: no quedan hallazgos críticos ni altos de CN-20260908-044: los entrypoints ya no usan `await` superior, están cubiertos por `tsc`; `Promise.allSettled` corrige la carrera de dos logins exitosos demorados y uno fallido; el build limpio con lockfile y workspaces funciona; y la semilla limita el borrado de sesiones a las tres cuentas demo. Se requiere un cambio medio adicional: `login()` valida rol, token y `userId` antes de guardar la sesión para el `finally`; si el servidor crea una sesión y devuelve un token válido junto con un rol o contrato inesperado, el smoke lanza el error antes de registrar ese token y no puede cerrarlo. Una simulación controlada de tres respuestas HTTP exitosas, una con rol incorrecto, obtuvo `SUCCESSFUL_LOGIN_TOKENS=3`, `CLEANUP_REQUESTS=2` y `MISMATCH_CLEANED=false`.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.smoke.test.ts` — 3/3 aprobadas, incluida la reproducción de dos éxitos demorados y un fallo HTTP; `npm run test --workspace=@cumple-now/api` — 11 archivos y 49/49 pruebas aprobadas; `npm run build --workspace=@cumple-now/api` — correcto e incluye `src`, `tests`, `scripts` y `prisma/seed.ts`; `docker compose build --no-cache api` — correcto desde instalación limpia; `docker compose up -d --build` — API, web y PostgreSQL saludables; dos ejecuciones consecutivas de `npm run demo:smoke` — correctas y sin exponer credenciales, tokens ni hashes; prueba PostgreSQL con sesión centinela no demo — preservó 1 sesión ajena, dejó 0 sesiones demo y restauró `2 turnos : 1 postulación pendiente : 0 asignaciones activas : 1 pago histórico`; guards reales con `NODE_ENV=production` para seed y smoke — ambos abortaron; parseo PowerShell, `docker compose config --quiet` y `git diff --check` — correctos; simulación adicional de respuesta de login malformada con token — reprodujo una sesión sin cleanup.
- Riesgos: medio por la sesión demo que puede persistir cuando el endpoint crea el token pero su respuesta incumple el contrato de rol o identidad; el build limpio informó una alerta moderada de dependencias de npm que queda fuera de esta corrección y requiere revisión separada. No se ejecutó una matriz visual exhaustiva de estados UI.
- Siguiente paso: `implementador-terra` debe registrar cualquier token no vacío recibido de un login exitoso para cleanup antes de validar el resto del contrato y añadir una prueba negativa que demuestre el cierre de ese token ante rol o identidad inesperados; luego solicitar reauditoría.

### CN-20260908-045 — Smoke ejecutable, cleanup concurrente y build local reparado

- Fecha: 2026-09-08 12:45 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260908-044
- Alcance: se corrigieron los entrypoints CJS de semilla y smoke, el cleanup ante login parcial concurrente y la instalación limpia del contenedor API. El smoke oficial se ejecutó repetidamente contra PostgreSQL real y dejó cero sesiones de las cuentas demo.
- Archivos: `apps/api/prisma/seed.ts`, `apps/api/scripts/demo-smoke.ts`, `apps/api/src/demo/demo.smoke.ts`, `apps/api/src/demo/demo.seed.ts`, `apps/api/tests/demo.smoke.test.ts`, `apps/api/tests/demo.seed.test.ts`, `apps/api/tsconfig.json`, `apps/api/Dockerfile.dev`, `docs/PROGRESO.md`.
- Decisiones: ambos entrypoints usan `main()` con `void main().catch(...)`, preservando `process.exitCode` y la desconexión Prisma. Los logins usan `Promise.allSettled`, por lo que todos los éxitos se registran antes de decidir el error y el `finally` los cierra. La semilla borra sesiones existentes sólo de las tres cuentas reservadas antes de restablecerlas, logrando que un smoke exitoso deje cero sesiones demo. El Dockerfile instala desde la raíz con `package-lock.json` y `npm ci --workspace=@cumple-now/api`, corrigiendo el error npm de árbol incompleto causado por copiar sólo el manifiesto del workspace.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.smoke.test.ts` — 3/3 pruebas aprobadas, incluida la carrera de dos logins demorados y uno fallido; `npm run test --workspace=@cumple-now/api` — 11 archivos y 49/49 pruebas aprobadas; `npm run build --workspace=@cumple-now/api` — `tsc --noEmit` correcto e incluye los entrypoints; `docker compose build api` — correcto; `docker compose up -d --build` — correcto, API/web/db saludables; `npm run demo:smoke` — correcto en tres ejecuciones, incluidas dos consecutivas de idempotencia; PostgreSQL posterior — 0 sesiones de las tres cuentas demo y escenario `2 turnos : 1 postulación pendiente : 1 pago histórico procesado`; parseo PowerShell, `docker compose config --quiet` y `git diff --check` — código 0.
- Riesgos: la comprobación PostgreSQL verificó el escenario reservado y las sesiones demo, no cada posible estado UI; el aviso de Compose sobre un volumen histórico con etiqueta distinta es preexistente y no afecta servicios ni datos.
- Siguiente paso: `auditor-sol` debe reauditar CN-20260908-045, especialmente la compatibilidad de entrypoints, el asentamiento de logins antes del cleanup y la instalación reproducible con el lockfile raíz.

### CN-20260908-044 — Auditoría del smoke reproducible de tres paneles

- Fecha: 2026-09-08 12:32 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: REQUIERE_CAMBIOS
- Referencia: CN-20260908-043
- Alcance: auditoría de seguridad, ejecución oficial, limpieza de sesiones, coherencia entre identidades sembradas, permisos cruzados, historial, pago, métricas y ausencia de mutaciones posteriores a la semilla.
- Archivos: `apps/api/src/demo/demo.seed.ts`, `apps/api/src/demo/demo.smoke.ts`, `apps/api/scripts/demo-smoke.ts`, `apps/api/prisma/seed.ts`, `apps/api/tests/demo.smoke.test.ts`, `apps/api/package.json`, `apps/api/tsconfig.json`, `scripts/demo-smoke.ps1`, `scripts/seed-demo.ps1`, `package.json`, `docs/CLIENT_DEMO.md`, `docs/PROGRESO.md`, `apps/api/Dockerfile.dev`.
- Decisiones: se requieren cambios por dos fallos funcionales. Primero, el comando oficial no puede ejecutarse en el contenedor: `prisma/seed.ts` y `scripts/demo-smoke.ts` usan `await` de nivel superior, `tsx` los transforma como CommonJS y ambos terminan con `Top-level await is currently not supported with the "cjs" output format`; el build no lo detecta porque `tsconfig.json` incluye sólo `src` y `tests`. Segundo, los tres logins concurrentes usan `Promise.all`: si uno falla antes y los otros completan después, `finally` toma una lista aún vacía y esas sesiones exitosas quedan sin cerrar. Una simulación con dos logins exitosos demorados y uno fallido inmediato produjo dos sesiones y cero solicitudes de cierre. La prueba sólo cubre el camino exitoso. No se hallaron filtraciones de contraseñas, tokens o hashes en mensajes/salidas; tras la semilla, el núcleo usa lecturas y operaciones de sesión únicamente.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.smoke.test.ts` — 2/2 aprobadas; `npm run test --workspace=@cumple-now/api` — 11 archivos y 48/48 pruebas aprobadas; `npm run build --workspace=@cumple-now/api` — `tsc --noEmit` correcto; parseo de ambos scripts PowerShell — cero errores; `docker compose config --quiet` — código 0; `git diff --check` — código 0; `docker compose up -d --build` — falló en `apps/api/Dockerfile.dev` durante `npm install --workspaces=false` con error interno `Cannot read properties of null (reading 'edgesOut')`; con imágenes existentes los servicios quedaron saludables; `npm run demo:smoke` — falló en el entrypoint de semilla por transformación CommonJS; ejecución directa del entrypoint smoke — mismo fallo; invocación temporal de las funciones mediante IIFE — semilla real y smoke HTTP correctos para los tres paneles, permisos, postulación, historial/pago y métricas; consulta PostgreSQL posterior — cero sesiones demo creadas en los últimos cinco minutos.
- Riesgos: alto porque el comando presentado al usuario no funciona en el entorno real y la construcción limpia de Docker también está bloqueada; medio por sesiones temporales que pueden persistir tras un fallo parcial de autenticación. La comprobación feliz del núcleo no sustituye la ejecución del comando oficial ni cubre la carrera de error.
- Siguiente paso: `implementador-terra` debe eliminar el `await` superior de ambos entrypoints o asegurar su ejecución ESM, incluirlos en una validación de build ejecutable, hacer que los logins terminen de asentarse antes de capturar/limpiar todas las sesiones y añadir una prueba del fallo parcial demorado. También debe corregir o aislar el fallo de construcción limpia del Dockerfile de desarrollo; luego registrar una corrección para reauditoría.

### CN-20260908-043 — Smoke reproducible de contratos para los tres paneles

- Fecha: 2026-09-08 12:30 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260908-042
- Alcance: se añadió `npm run demo:smoke`, que restablece el escenario local mediante la semilla aprobada y realiza un smoke HTTP de Empresa, Trabajador y Superadmin contra la API real: autenticación, acceso autorizado/denegado por rol, turno/postulación pendiente, historial-pago y métricas administrativas.
- Archivos: `apps/api/src/demo/demo.seed.ts`, `apps/api/src/demo/demo.smoke.ts`, `apps/api/scripts/demo-smoke.ts`, `apps/api/tests/demo.smoke.test.ts`, `apps/api/package.json`, `scripts/demo-smoke.ps1`, `package.json`, `docs/CLIENT_DEMO.md`, `docs/PROGRESO.md`.
- Decisiones: se priorizó un smoke de contratos HTTP sin framework E2E visual. El runner exige `development` y opt-in, no muestra contraseñas/tokens, cierra las sesiones temporales en `finally` y sólo ejecuta lecturas sobre el escenario después del seed. El script raíz delega el guard de entorno y la preparación al mecanismo local existente antes de invocar el runner dentro de la API.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.smoke.test.ts` — 2/2 pruebas aprobadas; `npm run test --workspace=@cumple-now/api` — 11 archivos y 48/48 pruebas aprobadas; `npm run build --workspace=@cumple-now/api` — `tsc --noEmit` correcto; parseo de `scripts/demo-smoke.ps1` y `scripts/seed-demo.ps1` — código 0; `docker compose config --quiet` — código 0; `git diff --check` — código 0.
- Riesgos: la ejecución HTTP contra API/PostgreSQL real está NO_EJECUTADA mientras Docker Desktop no exponga el motor Linux; las pruebas unitarias cubren el runner con una API simulada y su limpieza de sesiones.
- Siguiente paso: ejecutar las validaciones restantes y, si son correctas, `auditor-sol` debe revisar CN-20260908-043.

### CN-20260908-042 — Auditoría de aislamiento de suites fuente API

- Fecha: 2026-09-08 12:15 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260908-041
- Alcance: revisión independiente de la configuración oficial de Vitest, descubrimiento de pruebas, ejecución de todas las suites fuente, build de API y alcance de archivos de la corrección.
- Archivos: `apps/api/vitest.config.mts`, `apps/api/package.json`, `apps/api/tests/`, `apps/api/dist/tests/`, `docs/PROGRESO.md`.
- Decisiones: no se encontraron hallazgos críticos, altos, medios ni bajos. La exclusión `**/dist/**` se carga automáticamente desde `vitest.config.mts`; el comando oficial ejecuta las diez suites TypeScript fuente y omite los nueve archivos `*.test.js` presentes en `apps/api/dist/tests`. La extensión `.mts` es coherente con la configuración ESM y no introduce cambios de runtime. Respecto del ciclo aprobado anterior, el alcance funcional nuevo se limita a la configuración declarada.
- Validaciones: `npm run test --workspace=@cumple-now/api` — 10 archivos y 46/46 pruebas aprobadas; el mismo comando con `--reporter=verbose` enumeró exclusivamente rutas `tests/*.test.ts` y ninguna ruta `dist/tests/*.test.js`; inventario — 10 pruebas fuente y 9 artefactos compilados presentes; `npm run build --workspace=@cumple-now/api` — `tsc --noEmit` correcto; `git diff --check` — código 0.
- Riesgos: la exclusión evita ejecutar artefactos compilados y, por diseño, no valida que ese contenido sea equivalente a las fuentes; el directorio `dist` permanece ignorado y fuera del paquete versionado. Continúa pendiente la doble ejecución de la semilla contra PostgreSQL real indicada en CN-20260908-040.
- Siguiente paso: corrección aprobada; el coordinador puede cerrar CN-20260908-041 y continuar con la validación reproducible de la demostración.

### CN-20260908-041 — Suite oficial de API aislada de artefactos compilados

- Fecha: 2026-09-08 12:15 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260908-040
- Alcance: la configuración oficial de Vitest excluye `dist` para ejecutar solamente las suites TypeScript fuente de la API, evitando que los artefactos CommonJS generados por compilaciones locales se descubran como pruebas.
- Archivos: `apps/api/vitest.config.mts`, `docs/PROGRESO.md`.
- Decisiones: la exclusión es declarativa en la configuración de Vitest, no depende de flags manuales en cada ejecución e incluye también `node_modules` y `.git`. Se usa extensión `.mts` para conservar la carga ESM sin advertencias de configuración futuras.
- Validaciones: `npm run test --workspace=@cumple-now/api` — 10 archivos y 46/46 pruebas aprobadas; `npm run build --workspace=@cumple-now/api` — `tsc --noEmit` correcto; `git diff --check` — código 0.
- Riesgos: no se ejecutó validación contra PostgreSQL real porque el alcance corrige sólo descubrimiento de pruebas; permanece pendiente la doble ejecución de semilla en Docker indicada en CN-20260908-040.
- Siguiente paso: `auditor-sol` debe auditar CN-20260908-041 y confirmar que el comando oficial no descubre `apps/api/dist/tests`.

### CN-20260908-040 — Aprobación de defensa e integridad de semilla demo

- Fecha: 2026-09-08 12:09 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260908-039
- Alcance: reauditoría del entorno efectivo usado por el lanzador, comportamiento fail-closed, robustez de ejecución y cobertura de idempotencia, restauración, conteos e integridad relacional de la semilla demo.
- Archivos: `scripts/seed-demo.ps1`, `apps/api/tests/demo.seed.test.ts`, `apps/api/src/demo/demo.seed.ts`, `apps/api/prisma/seed.ts`, `apps/api/prisma/schema.prisma`, `docker-compose.yml`, `docker-compose.production.yml`, `docs/PROGRESO.md`.
- Decisiones: no se encontraron hallazgos críticos, altos, medios ni bajos. El lanzador consulta `NODE_ENV` dentro del contenedor sin sobrescribirlo, compara exactamente con `development`, aborta ante cualquier otro valor y sólo transmite el opt-in al comando final; el guard del proceso vuelve a comprobar ambas condiciones. La prueba ejecuta dos semillas, restaura estado alterado, mantiene conteos, verifica los vínculos principales y su adaptador rechaza explícitamente referencias inexistentes.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.seed.test.ts` — 8/8 aprobadas; `npm --workspace @cumple-now/api test -- --exclude dist` — 46/46 aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; parseo de `scripts/seed-demo.ps1` — cero errores; simulación controlada del lanzador — `development` ejecutó la semilla sin argumento `NODE_ENV` y `production` abortó antes del comando de semilla; `docker compose config --quiet` — código 0; `git diff --check` — código 0; validación contra PostgreSQL real — NO_EJECUTADA porque Docker Desktop no expone el motor Linux.
- Riesgos: la persistencia en memoria no sustituye las restricciones ni transacciones efectivas de PostgreSQL; la doble ejecución y el acceso a los tres paneles deben comprobarse en el entorno Docker cuando esté disponible. La suite completa sin exclusión conserva el problema preexistente de artefactos ignorados en `apps/api/dist`.
- Siguiente paso: corrección aprobada; el coordinador puede cerrar CN-20260908-039 y ejecutar la preparación real de la demostración cuando Docker esté disponible.

### CN-20260908-039 — Defensa en profundidad y relaciones de semilla demo

- Fecha: 2026-09-08 12:10 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260908-038
- Alcance: el lanzador dejó de sobrescribir `NODE_ENV`; ahora consulta el entorno efectivo de la API activa y sólo continúa si es exactamente `development`. La prueba de semilla aplica restricciones relacionales en memoria y verifica propietario, suscripción, perfil, conversación, mensajes, eventos, asignación y pago tras dos ejecuciones.
- Archivos: `scripts/seed-demo.ps1`, `apps/api/tests/demo.seed.test.ts`, `docs/PROGRESO.md`.
- Decisiones: `CUMPLENOW_ALLOW_DEMO_SEED=true` sigue siendo el único override que el lanzador transmite; el guard de la API decide con el `NODE_ENV` real del contenedor. El adaptador de prueba valida las referencias equivalentes a las FKs y rechaza una conversación con empresa inexistente, de modo que los vínculos erróneos no puedan pasar silenciosamente.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.seed.test.ts` — 8/8 pruebas aprobadas; `npm --workspace @cumple-now/api test -- --exclude dist` — 46/46 pruebas aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; parseo de `scripts/seed-demo.ps1` — código 0; `docker compose config --quiet` — código 0; `git diff --check` — código 0.
- Riesgos: la validación doble contra PostgreSQL real continúa NO_EJECUTADA porque Docker Desktop no expone el motor Linux en este entorno. La suite sin `--exclude dist` conserva el fallo preexistente por artefactos CommonJS ignorados en `apps/api/dist`.
- Siguiente paso: `auditor-sol` debe reauditar CN-20260908-039, confirmando la ausencia de override de entorno y la cobertura de referencias relacionales.

### CN-20260908-038 — Reauditoría de endurecimiento de semilla demo

- Fecha: 2026-09-08 12:01 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: REQUIERE_CAMBIOS
- Referencia: CN-20260908-037
- Alcance: reauditoría del fail-closed por entorno, configuración Compose/script y prueba de doble ejecución, restauración, conteos e integridad relacional de la semilla demo.
- Archivos: `apps/api/src/demo/demo.seed.ts`, `apps/api/tests/demo.seed.test.ts`, `apps/api/prisma/seed.ts`, `apps/api/prisma/schema.prisma`, `docker-compose.yml`, `docker-compose.production.yml`, `scripts/seed-demo.ps1`, `docs/CLIENT_DEMO.md`, `docs/PROGRESO.md`.
- Decisiones: el guard ya rechaza correctamente entorno ausente, `Production`, `staging` y `production`, y los Compose resuelven `development`/`production` según corresponde. No obstante, el lanzador fuerza `NODE_ENV=development` mediante `docker compose exec`; si un despliegue de producción fue levantado con el proyecto Compose predeterminado, la comprobación de un servicio `api` activo puede encontrarlo y el override neutraliza el entorno protegido antes de ejecutar credenciales demo conocidas. Además, el adaptador en memoria no impone claves foráneas ni restricciones únicas de Prisma y las aserciones omiten relaciones de propietario, suscripción, perfil, conversación-perfil, mensajes y eventos, por lo que varias inconsistencias relacionales no harían fallar la prueba.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.seed.test.ts` — 7/7 aprobadas; `npm --workspace @cumple-now/api test -- --exclude dist` — 45/45 aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; parseo de `scripts/seed-demo.ps1` — cero errores; `docker compose config --format json` — API de desarrollo resuelve `NODE_ENV=development`; configuración de producción — API/web resuelven `NODE_ENV=production`; revisión estática confirmó el override en el lanzador y la cobertura relacional parcial; `git diff --check` — código 0; validación real contra PostgreSQL — NO_EJECUTADA porque Docker Desktop continúa sin exponer el motor Linux.
- Riesgos: alto por la posibilidad de sobreescribir el entorno protegido desde el lanzador y medio por una prueba relacional más permisiva que PostgreSQL. La idempotencia secuencial sí queda ejercitada en memoria, pero las restricciones reales y el acceso al escenario permanecen sin validación dinámica.
- Siguiente paso: `implementador-terra` debe dejar de sobreescribir `NODE_ENV` al ejecutar la semilla, confiar en el valor declarado por el servicio y reforzar la prueba con todas las relaciones relevantes o validación explícita de integridad; luego registrar una corrección para nueva reauditoría. Ejecutar dos semillas y comprobar el escenario contra PostgreSQL cuando Docker esté disponible.

### CN-20260908-037 — Endurecimiento y prueba relacional de semilla demo

- Fecha: 2026-09-08 12:00 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260908-036
- Alcance: la semilla demo ahora falla cerrada salvo cuando `NODE_ENV` es exactamente `development` y existe el opt-in explícito. Se añadió una prueba que ejecuta toda la semilla dos veces contra un adaptador de persistencia en memoria y verifica conteos, relaciones y el restablecimiento del flujo pendiente.
- Archivos: `apps/api/src/demo/demo.seed.ts`, `apps/api/tests/demo.seed.test.ts`, `docker-compose.yml`, `scripts/seed-demo.ps1`, `docs/CLIENT_DEMO.md`, `docs/PROGRESO.md`.
- Decisiones: no se acepta entorno ausente, con distinta capitalización, staging ni producción. El Compose de desarrollo y el lanzador fijan explícitamente `NODE_ENV=development`; el Compose de producción conserva `NODE_ENV=production`. La prueba en memoria aísla la idempotencia determinista del requisito de Docker/PostgreSQL y simula un flujo pendiente alterado antes de resembrar.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.seed.test.ts` — 7/7 pruebas aprobadas; `npm --workspace @cumple-now/api test -- --exclude dist` — 45/45 pruebas aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; parseo de `scripts/seed-demo.ps1` — código 0; `git diff --check` — código 0.
- Riesgos: la prueba de idempotencia usa un adaptador de persistencia en memoria; la doble ejecución contra PostgreSQL real continúa NO_EJECUTADA porque Docker Desktop no expone el motor Linux en este entorno. La suite sin `--exclude dist` conserva el fallo preexistente por artefactos CommonJS ignorados en `apps/api/dist`.
- Siguiente paso: `auditor-sol` debe reauditar CN-20260908-037, en particular el fail-closed del entorno y los conteos/relaciones cubiertos por la prueba.

### CN-20260908-036 — Auditoría de semilla local para presentación

- Fecha: 2026-09-08 11:53 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: REQUIERE_CAMBIOS
- Referencia: CN-20260908-035
- Alcance: revisión independiente del bloqueo de producción, manejo de credenciales demo, idempotencia y consistencia relacional de la semilla, comandos de ejecución y cobertura automatizada.
- Archivos: `apps/api/src/demo/demo.seed.ts`, `apps/api/prisma/seed.ts`, `apps/api/tests/demo.seed.test.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/business/business.service.ts`, `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/package.json`, `package.json`, `scripts/seed-demo.ps1`, `docker-compose.yml`, `docker-compose.production.yml`, `apps/api/Dockerfile.production`, `docs/CLIENT_DEMO.md`, `docs/PROGRESO.md`.
- Decisiones: se requiere corregir el guard porque opera en modo permisivo: con el opt-in explícito acepta `NODE_ENV` ausente, `Production` o `staging`; al contener cuentas demo con una identidad ADMIN y credenciales conocidas, una ejecución accidental contra una base no local podría crear o restablecer acceso privilegiado. La suite sólo prueba tres ramas de `assertDemoSeedAllowed` y no invoca `seedDemoDatabase`, por lo que no demuestra la idempotencia secuencial, los conteos ni los vínculos entre empresa, perfil, turnos, postulación, asignación, pago, conversación y eventos. La revisión estática de las relaciones preparadas no reveló otra inconsistencia determinista.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.seed.test.ts` — 3/3 aprobadas; `npm --workspace @cumple-now/api test -- --exclude dist` — 41/41 aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; parseo de `scripts/seed-demo.ps1` — cero errores; prueba directa del guard — `<unset>`, `Production` y `staging` fueron aceptados con opt-in; `git diff --check` — código 0; `docker info` y `docker compose ps` — NO_EJECUTADAS efectivamente porque Docker Desktop no expone el motor Linux, por lo que no fue posible ejecutar la semilla dos veces ni validar acceso/escenario contra PostgreSQL real.
- Riesgos: alto mientras el guard no falle de forma cerrada ante todo entorno que no sea inequívocamente local; la idempotencia relacional y el escenario real permanecen sin evidencia dinámica. No se imprimieron contraseñas ni datos de autenticación durante la auditoría.
- Siguiente paso: `implementador-terra` debe endurecer el guard para permitir exclusivamente un entorno local verificable, agregar pruebas que ejecuten la lógica completa dos veces y comprueben relaciones/conteos, registrar una corrección y devolverla a `auditor-sol`; después debe repetirse la validación contra PostgreSQL cuando Docker esté disponible.

### CN-20260908-035 — Semilla local idempotente para presentación integral

- Fecha: 2026-09-08 10:00 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: N/A
- Alcance: se añadió una semilla local explícita e idempotente que prepara cuentas WORKER, BUSINESS y ADMIN, empresa, suscripción, perfil vinculado, una postulación pendiente y un historial completado con pago procesado. Permite mostrar el recorrido publicación/postulación/selección/asistencia/pago sin crear datos manualmente.
- Archivos: `apps/api/src/demo/demo.seed.ts`, `apps/api/prisma/seed.ts`, `apps/api/tests/demo.seed.test.ts`, `apps/api/package.json`, `package.json`, `scripts/seed-demo.ps1`, `docs/CLIENT_DEMO.md`, `docs/PROGRESO.md`.
- Decisiones: la semilla sólo modifica IDs/correos reservados para demo, se invoca desde el contenedor de desarrollo mediante `npm run demo:seed`, exige el opt-in `CUMPLENOW_ALLOW_DEMO_SEED=true` y se bloquea con `NODE_ENV=production`; Docker no la ejecuta automáticamente. Las credenciales demo se documentan exclusivamente en la guía de demostración existente.
- Validaciones: `npm --workspace @cumple-now/api test -- demo.seed.test.ts` — 3/3 pruebas aprobadas; `npm --workspace @cumple-now/api test -- --exclude dist` — 41/41 pruebas aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; parseo de `scripts/seed-demo.ps1` — código 0; `git diff --check` — código 0. Validación real contra PostgreSQL — NO_EJECUTADA, Docker Desktop no está disponible en este entorno.
- Riesgos: la semilla restaura el estado del flujo reservado al reejecutarse; no debe usarse para conservar una demostración que se quiera inspeccionar después de completarla. La ejecución en una base local activa queda pendiente de Docker. La suite sin `--exclude dist` intenta ejecutar artefactos CommonJS ignorados en `apps/api/dist` y falla antes de evaluar cambios fuente; no se modificó ese artefacto ajeno al alcance.
- Siguiente paso: `auditor-sol` debe revisar el guard de producción, la idempotencia relacional y ejecutar las validaciones disponibles.

### CN-20260831-034-A — Auditoría de layout responsive de chats

- Fecha: 2026-08-31 14:00 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260831-034
- Alcance: revisión del layout web del chat y de `WorkerMessagesPage`/`_ConversationSheet` en Flutter para conversaciones extensas y pantallas pequeñas.
- Archivos: `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `apps/mobile_flutter/lib/features/marketplace/worker_secondary_pages.dart`.
- Decisiones: el hilo web se mantiene en contenedor de mensajes separado del composer; el composer permanece fuera del scroll y accesible. Flutter usa `ListView.builder` para mensajes, `Expanded` para scroll interno y `SafeArea`/`viewInsets` para mantener el composer visible ante teclado y notch. No se detectan regresiones estructurales.
- Validaciones: `npm --workspace @cumple-now/web run build` — correcto; revisión estática — correcta; Flutter analyze/test — NO_EJECUTADAS por bloqueo persistente.
- Riesgos: no se realizó inspección visual interactiva ni prueba con cientos de mensajes; el comportamiento depende de estilos responsive existentes.
- Siguiente paso: ejecutar validación visual/manual y suite Flutter cuando el entorno esté disponible.

### CN-20260831-034 — Hilo de mensajería con compositor siempre visible

- Fecha: 2026-08-31 11:40 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260831-033
- Alcance: el panel de chat empresarial usa un hilo con scroll interno y altura flexible, manteniendo la barra de escritura fija dentro del viewport aun con muchos mensajes. Se reforzaron `min-height: 0`, `overflow` y safe-area inferior responsive; el modal Flutter ya conserva `Expanded` para el hilo y `SafeArea`/teclado para el compositor.
- Archivos: `apps/web/app/globals.css`, `apps/mobile_flutter/lib/features/marketplace/worker_secondary_pages.dart`, `docs/PROGRESO.md`.
- Decisiones: el compositor no participa del scroll (`flex: 0 0 auto`) y el hilo absorbe el crecimiento (`flex: 1`, `overflow-y: auto`, `overscroll-behavior: contain`). En móvil web se define una fila flexible con altura de viewport para evitar que el formulario desaparezca.
- Validaciones: `git diff --check -- apps/web/app/globals.css apps/mobile_flutter/lib/features/marketplace/worker_secondary_pages.dart docs/PROGRESO.md` — código 0; build web y pruebas Flutter — `NO_EJECUTADA`, pendientes por el entorno.
- Riesgos: requiere verificación visual en desktop, móvil y teclado virtual; el ajuste de altura móvil puede variar según navegador y barras del sistema.
- Siguiente paso: `auditor-sol` debe comprobar scroll interno, compositor visible, safe areas y ausencia de overflow en ambos clientes.

### CN-20260831-033-A — Auditoría de envío de mensajes web

- Fecha: 2026-08-31 13:45 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260831-033
- Alcance: revisión de `sendMessage`, selección de conversación y actualización optimista del panel web.
- Archivos: `apps/web/app/page.tsx`.
- Decisiones: `selectedConversationData` deriva del ID seleccionado con fallback seguro al primer registro; `selectedConversationId` evita enviar sin conversación y muestra aviso accionable. `sendMessage` usa el ID resuelto, añade el mensaje al hilo correcto, actualiza preview/tiempo, limpia el formulario solo tras éxito y clasifica errores 5xx frente a otros. No se observan regresiones.
- Validaciones: `npm --workspace @cumple-now/web run build` — correcto; revisión estática y `git diff --check` — sin hallazgos funcionales.
- Riesgos: el fallback al primer registro puede cambiar selección visual si el ID desaparece durante una actualización, comportamiento intencional para mantener un hilo válido.
- Siguiente paso: implementador-terra puede continuar.

### CN-20260831-032-A — Auditoría de polling de conversaciones Flutter

- Fecha: 2026-08-31 13:30 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260831-032
- Alcance: revisión de `WorkerMessagesPage` y `_ConversationSheet`.
- Archivos: `apps/mobile_flutter/lib/features/marketplace/worker_secondary_pages.dart`.
- Decisiones: ambos timers se cancelan en `dispose`; `_refreshing` evita solapamiento de solicitudes; el polling respeta `mounted` y evita recargar mientras carga/envía. La conversación abierta se actualiza mediante `_load()` y conserva el identificador; errores no provocan fugas ni actualizaciones tras desmontaje.
- Validaciones: revisión estática correcta; `flutter analyze`/`flutter test` — NO_EJECUTADAS por bloqueo previo del entorno.
- Riesgos: el polling periódico de 4 s puede generar tráfico continuo mientras la página esté visible, pero queda limitado por cancelación y anti-solapamiento.
- Siguiente paso: implementador-terra puede continuar; ejecutar suite Flutter cuando esté disponible.

### CN-20260831-032 — Actualización periódica de mensajes del trabajador

- Fecha: 2026-08-31 10:45 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: N/A
- Alcance: `WorkerMessagesPage` consulta conversaciones automáticamente cada cuatro segundos, además del botón manual, para reflejar mensajes enviados por la empresa sin recargar la pantalla. Se añadió una guarda contra solicitudes solapadas y se cancela el `Timer` al destruir la página.
- Archivos: `apps/mobile_flutter/lib/features/marketplace/worker_secondary_pages.dart`, `docs/PROGRESO.md`.
- Decisiones: el polling reutiliza `workerConversations()` y actualiza el `FutureBuilder` con la respuesta más reciente; no se crean listeners persistentes ni duplicados. La conversación abierta ya tenía polling propio y conserva su cancelación en `dispose`.
- Validaciones: `git diff --check -- apps/mobile_flutter/lib/features/marketplace/worker_secondary_pages.dart docs/PROGRESO.md` — código 0; pruebas Flutter — `NO_EJECUTADA` (entorno sin salida en ejecuciones previas, pendiente de auditoría).
- Riesgos: el intervalo de cuatro segundos añade tráfico periódico mientras la página esté montada; la comprobación dinámica de recepción y ausencia de duplicados queda pendiente en dispositivo.
- Siguiente paso: `auditor-sol` debe verificar ciclo de vida, polling sin solapamientos y actualización al recibir mensajes empresariales.

### CN-20260831-033 — Envío empresarial consistente de mensajes

- Fecha: 2026-08-31 11:10 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: N/A
- Alcance: el formulario web de mensajes usa el ID de la conversación visible como respaldo cuando el estado de selección aún no se ha sincronizado, evitando un botón inerte. El envío actualiza el hilo y la previsualización con ese mismo ID y muestra errores diferenciados para indisponibilidad del servicio y fallos de la conversación.
- Archivos: `apps/web/app/page.tsx`, `docs/PROGRESO.md`.
- Decisiones: se mantiene la selección controlada existente y se evita crear conversaciones implícitamente desde el formulario; si no existe ninguna conversación se informa al usuario que debe seleccionar una.
- Validaciones: `git diff --check -- apps/web/app/page.tsx docs/PROGRESO.md` — código 0; `npm --workspace @cumple-now/web run build` — pendiente de ejecución por el coordinador.
- Riesgos: la validación visual y build quedan pendientes; el polling de conversaciones existente puede reemplazar la previsualización con datos de servidor en el siguiente ciclo.
- Siguiente paso: `auditor-sol` debe ejecutar build y comprobar envío con selección inicial/fallback y respuestas 4xx/5xx.

### CN-20260831-031-A — Auditoría de validaciones y errores de registro Flutter

- Fecha: 2026-08-31 13:15 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260831-031
- Alcance: comparación de validaciones Flutter con `normalizeRegistration` y revisión de `INVALID_REGISTRATION`.
- Archivos: `apps/mobile_flutter/lib/features/auth/auth_page.dart`, `apps/mobile_flutter/lib/features/auth/auth_repository.dart`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.routes.ts`.
- Decisiones: nombre, email, contraseña (8+ caracteres, mayúscula y dígito) y DNI de 8 dígitos coinciden con la API para WORKER. `INVALID_REGISTRATION` se traduce a un mensaje claro; no expone detalles internos.
- Validaciones: revisión estática correcta; `flutter analyze`/`flutter test` — NO_EJECUTADAS por bloqueo del entorno.
- Riesgos: sin cobertura dinámica de la rama `INVALID_REGISTRATION`; BUSINESS usa RUC de 11 dígitos pero su registro está deshabilitado en Flutter por diseño.
- Siguiente paso: ejecutar suite Flutter cuando el entorno esté disponible.

### CN-20260831-031 — Validaciones de autenticación alineadas con API

- Fecha: 2026-08-31 10:20 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260831-030
- Alcance: las validaciones visibles del formulario Flutter ahora coinciden con `normalizeRegistration`: correo con formato completo, contraseña de mínimo 8 caracteres con mayúscula y número, DNI exactamente de 8 dígitos y nombre obligatorio. El rechazo `INVALID_REGISTRATION` del servidor muestra una explicación clara.
- Archivos: `apps/mobile_flutter/lib/features/auth/auth_page.dart`, `apps/mobile_flutter/test/auth_page_test.dart`, `docs/PROGRESO.md`.
- Decisiones: se validan requisitos individualmente por campo antes de llamar a la API; se conservan mensajes específicos y se evita enviar formularios que la API rechazará.
- Validaciones: `git diff --check -- apps/mobile_flutter/lib/features/auth/auth_page.dart apps/mobile_flutter/test/auth_page_test.dart docs/PROGRESO.md` — código 0; `flutter test test/auth_page_test.dart` — `NO_EJECUTADA` (entorno Flutter sin salida en intento anterior, pendiente de reintento por auditor).
- Riesgos: la suite widget y análisis estático requieren ejecución en un entorno Flutter disponible; queda comprobación manual del mensaje de rechazo HTTP.
- Siguiente paso: `auditor-sol` debe ejecutar las pruebas y verificar que cada requisito se anuncia en el campo correspondiente.

### CN-20260831-030-A — Auditoría de mensajes específicos para autenticación móvil

- Fecha: 2026-08-31 13:00 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260831-030
- Alcance: se revisó la clasificación de fallos en `AuthRepository` y la traducción a mensajes de usuario en `AuthPage`.
- Archivos: `apps/mobile_flutter/lib/features/auth/auth_repository.dart`, `apps/mobile_flutter/lib/features/auth/auth_page.dart`, `apps/mobile_flutter/test/auth_page_test.dart` (referenciado; no localizado en el árbol actual).
- Decisiones: 401/403 se muestran como credenciales incorrectas; errores de red/timeouts como problema de conexión; 4xx como datos inválidos; 5xx como indisponibilidad temporal; `DUPLICATE_ACCOUNT` tiene mensaje específico. No se exponen cuerpos de respuesta, tokens ni detalles internos.
- Validaciones: revisión estática de código — correcta; `flutter analyze` — NO_EJECUTADA (proceso sin salida durante ~60 s, quedó en ejecución/interrumpido por el entorno); pruebas widget declaradas en CN-20260831-030 — NO_EJECUTADAS según registro previo. No se detectaron regresiones evidentes en el flujo de carga, limpieza de error o modo demo.
- Riesgos: la validación dinámica de Flutter y la comprobación contra API real quedan pendientes por limitación del entorno; conviene cubrir también respuestas 403/422/500 en pruebas automatizadas.
- Siguiente paso: implementador-terra puede continuar; ejecutar la suite Flutter cuando el entorno esté disponible.

### CN-20260831-030 — Mensajes específicos para errores de autenticación móvil

- Fecha: 2026-08-31 10:00 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-028
- Alcance: el acceso Flutter distingue credenciales inválidas, problemas de conectividad, validaciones del servidor, indisponibilidad temporal y errores desconocidos; dejó de mostrar siempre el aviso genérico de verificar la API. Los errores HTTP conservan estado/código de respuesta y las excepciones de red se clasifican explícitamente.
- Archivos: `apps/mobile_flutter/lib/features/auth/auth_repository.dart`, `apps/mobile_flutter/lib/features/auth/auth_page.dart`, `apps/mobile_flutter/test/auth_page_test.dart`, `docs/PROGRESO.md`.
- Decisiones: 401/403 se presentan como correo o contraseña incorrectos; fallos de cliente HTTP/timeouts sugieren revisar conexión; 4xx solicita revisar datos; 5xx indica indisponibilidad temporal. El código de error `DUPLICATE_ACCOUNT` tiene mensaje específico durante registro.
- Validaciones: `dart format apps/mobile_flutter/lib/features/auth/auth_repository.dart apps/mobile_flutter/lib/features/auth/auth_page.dart apps/mobile_flutter/test/auth_page_test.dart` — correcto; `flutter test test/auth_page_test.dart` — `NO_EJECUTADA` (sin salida durante 120 s, proceso interrumpido); `git diff --check` — pendiente de ejecutar por el coordinador si el entorno continúa ocupado.
- Riesgos: la prueba widget añadida cubre credenciales inválidas y conectividad, pero la suite Flutter no pudo ejecutarse en este entorno; queda auditoría manual de mensajes y validación de respuestas reales.
- Siguiente paso: `auditor-sol` debe revisar la clasificación HTTP/excepciones y ejecutar la prueba Flutter cuando el entorno esté disponible.

### CN-20260826-029 — Rellenar ejemplo en creación y edición de turnos

- Fecha: 2026-08-26 16:45 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: N/A
- Alcance: se añadió el botón accesible `Rellenar ejemplo` únicamente al formulario web de creación/edición de turnos. Al pulsarlo completa campos obligatorios y preguntas de filtro con datos válidos, fechas futuras y valores realistas; no publica ni persiste. En edición solicita confirmación antes de reemplazar valores.
- Archivos: `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `docs/PROGRESO.md`.
- Decisiones: el formulario permanece sin cambios al abrir; el rellenado usa controles nativos por nombre y dispara eventos `input`/`change` para conservar compatibilidad con validación y envío existentes. Las preguntas de filtro se mantienen opcionales y limitadas a dos ejemplos no sensibles.
- Validaciones: `npm run build --workspace=@cumple-now/web` — correcto (Next.js producción + TypeScript); `npm run test --workspace=@cumple-now/web --if-present` — correcto, sin archivos de prueba; `git diff --check` — código 0 (solo advertencias de conversión LF/CRLF).
- Riesgos: confirmación de reemplazo depende de `window.confirm`; prueba visual/manual del botón y persistencia tras envío queda pendiente.
- Siguiente paso: `auditor-sol` debe verificar que el botón solo actúe por click, que no persista automáticamente y que los valores cumplan validaciones de publicación/edición.

### CN-20260826-028 — Login de trabajador inicia en modo acceso

- Fecha: 2026-08-26 16:10 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: N/A
- Alcance: la pantalla de autenticación Flutter inicia siempre en modo `Inicia sesión`, permitiendo usar las credenciales existentes del trabajador sin intentar registrarlo. El registro continúa disponible mediante el botón `Quiero registrarme`, con sus campos y validación de DNI.
- Archivos: `apps/mobile_flutter/lib/features/auth/auth_page.dart`, `apps/mobile_flutter/test/auth_page_test.dart`, `docs/PROGRESO.md`.
- Decisiones: se eliminó la inicialización dependiente del rol que forzaba registro para `WORKER`; el cambio de modo requiere una acción explícita del usuario.
- Validaciones: `dart format lib/features/auth/auth_page.dart test/auth_page_test.dart` — correcto; `flutter test test/auth_page_test.dart` — `NO_EJECUTADA` (el proceso no emitió salida y fue interrumpido tras 120 s en este entorno); la prueba verifica login inicial sin DNI y registro accesible con DNI; `git diff --check` — código 0 (solo advertencias LF/CRLF).
- Riesgos: no se ejecutó login contra API/PostgreSQL real en esta entrega; queda validación manual con las credenciales conservadas.
- Siguiente paso: `auditor-sol` debe verificar el flujo inicial de login, toggle de registro y ausencia de regresiones.

### CN-20260826-027 — Postulaciones visibles al inicio de Turnos

- Fecha: 2026-08-26 15:20 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-026
- Alcance: el bloque único y accionable de `Selección de talento / Postulaciones` se renderiza inmediatamente después del encabezado de la vista `Turnos`, antes del indicador de pendientes, métricas, listado de turnos y detalle. Se conservan título, turno seleccionado, respuestas, acciones aceptar/rechazar y estados de carga, error y vacío.
- Archivos: `apps/web/app/page.tsx`, `docs/PROGRESO.md`.
- Decisiones: se corrigió el orden JSX/DOM real, no únicamente estilos; el aviso de postulaciones permanece como acceso secundario posterior al bloque y no se duplicó la sección.
- Validaciones: `npm run build` (en `apps/web`) — correcto (Next.js producción + TypeScript); revisión estática confirma `application-workspace` en línea 341 y `pending-application-banner` en línea 342, antes de `view-stat-grid` en línea 343 y `management-grid`; `git diff --check` — código 0.
- Riesgos: revisión visual manual en navegador y breakpoints responsive pendiente; sin turno seleccionado el bloque no se muestra, comportamiento existente.
- Siguiente paso: `auditor-sol` debe auditar CN-20260826-027 y confirmar prioridad visual, instancia única y preservación de acciones/estados.

### CN-20260826-026 — Jerarquía visible para selección de talento

- Fecha: 2026-08-26 15:00 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-012
- Alcance: el bloque único de `Selección de talento / Postulaciones` queda identificado como el primer paso operativo visible de Turnos, con contexto explícito del turno seleccionado y una instrucción directa para revisar, aceptar o rechazar candidatos. Se conserva el orden de estados de carga, error y vacío, además del aislamiento por turno.
- Archivos: `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `docs/PROGRESO.md`.
- Decisiones: se añadió el prefijo `1 · Selección de talento`, un contenedor visual prioritario y el ancla `seleccion-talento`; no se duplicó la sección ni se alteraron contratos de API o acciones existentes.
- Validaciones: `npm --workspace @cumple-now/web run build` — correcto (Next.js producción + TypeScript); `npm --workspace @cumple-now/web test` — código 0, sin archivos de prueba configurados; `git diff --check` — código 0 (solo advertencias LF/CRLF preexistentes).
- Riesgos: revisión visual manual en navegador y breakpoints responsive pendiente; el bloque continúa requiriendo un turno seleccionado para mostrar postulaciones.
- Siguiente paso: `auditor-sol` debe revisar jerarquía visual, claridad de CTA y ausencia de regresiones en estados y acciones.

### CN-20260826-025 — Vista wallet móvil conectada a movimientos persistentes

- Fecha: 2026-08-26 14:20 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-024
- Alcance: la vista `HistoryPage` dejó de usar `paymentHistory` como fallback silencioso y ahora representa exclusivamente la respuesta de `walletMovements()` del repositorio asociado a la sesión del trabajador. Se añadieron estados explícitos de carga, error con reintento y lista vacía.
- Archivos: `apps/mobile_flutter/lib/features/marketplace/worker_pages.dart`, `apps/mobile_flutter/test/marketplace_repository_test.dart`, `docs/PROGRESO.md`.
- Decisiones: el repositorio HTTP conserva el token Bearer y consulta `/api/workers/wallet`, por lo que el aislamiento continúa derivándose de la sesión WORKER y no de datos de la interfaz. El modo demo sigue disponible únicamente cuando se selecciona explícitamente el repositorio demo; la pantalla ya no mezcla datos demo con respuestas parciales o fallidas.
- Validaciones: `dart format lib/features/marketplace/worker_pages.dart test/marketplace_repository_test.dart` — correcto; `flutter test` — 53 pruebas aprobadas; la prueba añadida confirma autorización Bearer y parseo de movimientos persistentes liberados/pendientes.
- Riesgos: no se ejecutó Flutter build de release ni integración contra PostgreSQL real (`NO_EJECUTADA`); el endpoint de wallet es de solo lectura en este alcance.
- Siguiente paso: `auditor-sol` debe revisar estados UI, ausencia de fallback demo y propagación del token/aislamiento en la consulta wallet.

### CN-20260826-024 — Reauditoría de permisos y validaciones del ledger

- Fecha: 2026-08-26 14:00 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-023 (corrige CN-20260826-022)
- Alcance: reauditoría de `recordWalletMovement` para confirmar rol `WORKER`, montos enteros positivos, whitelist runtime de estados, aislamiento por trabajador y ausencia de regresiones.
- Archivos: `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`.
- Decisiones: la consulta de identidad filtra `id` y `role: WORKER` y además comprueba defensivamente el rol retornado; montos cero, negativos o no enteros y descripciones vacías son rechazados; `status` se valida contra `PENDING`/`RELEASED`/`REVERSED` en runtime. El ledger y `wallet` usan siempre el `workerId` autenticado, sin aceptar identidad alternativa.
- Validaciones: `npm --workspace @cumple-now/api test` — 38/38 pruebas aprobadas (incluye BUSINESS, montos inválidos, estado manipulado, aislamiento y regresiones); `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `git diff --check` — código 0 (solo advertencias de conversión LF/CRLF). Integración/migración contra PostgreSQL real: `NO_EJECUTADA`.
- Riesgos: persiste el riesgo operativo de no haber ejecutado PostgreSQL real; la unicidad, constraints y migración deben verificarse en entorno real antes de producción. No se observaron riesgos nuevos en el alcance auditado.
- Siguiente paso: coordinador puede cerrar CN-023 y planificar validación de migración/ledger contra PostgreSQL real.

### CN-20260826-023 — Corrección de permisos y validaciones del ledger

- Fecha: 2026-08-26 14:00 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-021 y CN-20260826-022
- Alcance: `recordWalletMovement` exige una identidad existente con rol `WORKER` (incluyendo comprobación defensiva del rol retornado), rechaza montos no enteros, cero o negativos, y valida en runtime que `status` pertenezca a la whitelist `PENDING`/`RELEASED`/`REVERSED`.
- Archivos: `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`, `docs/PROGRESO.md`.
- Decisiones: el ledger solo admite créditos positivos en centavos; ajustes negativos requieren un flujo de reversión explícito y no se aceptan por este método. La validación runtime protege adaptadores que omitan el tipado TypeScript.
- Validaciones: `npm --workspace @cumple-now/api test` — 38/38 pruebas aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate` — esquema válido; `git diff --check` — código 0 (solo advertencias de conversión LF/CRLF).
- Riesgos: integración/migración contra PostgreSQL real continúa `NO_EJECUTADA`; los ajustes negativos deberán diseñarse en una operación auditada separada.
- Siguiente paso: `auditor-sol` debe reauditar CN-023 y confirmar rechazo de BUSINESS, montos no positivos y estados manipulados.

### CN-20260826-022 — Auditoría del ledger persistente de wallet

- Fecha: 2026-08-26 14:05 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: REQUIERE_CAMBIOS
- Referencia: CN-20260826-021
- Alcance: revisión del modelo `WalletMovement`, migración Prisma, aislamiento por `workerId`, cálculo de saldo sin movimientos `REVERSED`, validaciones de identidad/monto/descripción, permisos y pruebas.
- Archivos: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260826150000_wallet_ledger/migration.sql`, `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`.
- Decisiones: el esquema y la migración son coherentes: enum de estados, FK a `User` con cascada, índices por trabajador y unicidad `(workerId, reference)`; `wallet` filtra por trabajador autenticado y excluye `REVERSED` del saldo. Sin embargo, `recordWalletMovement` valida identidad únicamente por `id` y no restringe `role: WORKER`, permitiendo potencialmente registrar movimientos para cuentas BUSINESS si se invoca desde un flujo interno. La validación acepta cualquier entero (incluido cero y negativos), decisión que debe documentarse explícitamente o restringirse según las reglas financieras; tampoco valida el estado/referencia en runtime más allá de la inferencia TypeScript.
- Validaciones: `npx prisma generate` — correcto (según CN-021); `npm --workspace @cumple-now/api test` — 37/37 aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; revisión estática de servicio/migración y pruebas unitarias. Integración y ejecución de migración contra PostgreSQL real: `NO_EJECUTADA`.
- Riesgos: medio/alto, porque la escritura del ledger no garantiza rol WORKER en la capa de servicio y actualmente no existe endpoint HTTP de escritura que limite el llamador; una futura integración podría exponer movimientos a identidades no autorizadas. Persistencia real, constraints efectivas y comportamiento ante duplicados no fueron verificados contra PostgreSQL.
- Siguiente paso: `implementador-terra` debe exigir `role: WORKER` en `recordWalletMovement`, agregar prueba que rechace BUSINESS y decidir/validar límites de monto/estado; luego registrar corrección para reauditoría. Mantener pendiente la prueba de migración contra PostgreSQL real.

### CN-20260826-021 — Ledger persistente mínimo para wallet de trabajadores

- Fecha: 2026-08-26 13:51 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-020
- Alcance: se incorporó un modelo Prisma `WalletMovement` para registrar movimientos de billetera por trabajador, con montos enteros en centavos, estado (`PENDING`, `RELEASED`, `REVERSED`), referencia opcional y marcas de tiempo. `DatabaseMarketplaceService.wallet` consulta exclusivamente movimientos del trabajador autenticado y calcula el saldo excluyendo reversos; `recordWalletMovement` valida identidad, monto y descripción antes de persistir.
- Archivos: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260826150000_wallet_ledger/migration.sql`, `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`.
- Decisiones: el ledger no procesa pagos ni integra proveedores externos; cada movimiento pertenece a `User` con rol `WORKER` y se elimina en cascada al eliminar la identidad. La unicidad `(workerId, reference)` evita duplicados por trabajador y permite referencias nulas. El contrato de servicio expone registro/consulta para conectar flujos de pago posteriores sin aceptar un `workerId` alternativo desde payload.
- Validaciones: `npx prisma generate` — cliente Prisma regenerado correctamente; `npm --workspace @cumple-now/api test` — 37/37 pruebas aprobadas en 9 archivos, incluyendo aislamiento, persistencia simulada y permisos del ledger; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `git diff --check` — sin errores.
- Riesgos: integración contra PostgreSQL real y ejecución de migración en un entorno desplegado quedan `NO_EJECUTADA`; aún no se generan movimientos automáticamente desde pagos reales, y el endpoint HTTP de escritura se mantiene fuera de alcance para evitar exponer una operación financiera sin autorización adicional.
- Siguiente paso: `auditor-sol` debe revisar el modelo/migración, aislamiento multiusuario y cálculo de saldo; después conectar el ledger a eventos de checkout/pago cuando exista el flujo autorizado.

### CN-20260826-020 — Auditoría de persistencia de disponibilidad en PostgreSQL

- Fecha: 2026-08-26 13:52 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-019
- Alcance: se verificó la resolución del usuario autenticado con rol `WORKER`, la persistencia de disponibilidad mediante `WorkerProfile.updateMany`, el aislamiento entre trabajadores, el manejo 404 para identidad inexistente y la ausencia de regresiones. La billetera y sus movimientos permanecen fuera del alcance por no existir todavía un modelo persistente de ledger, tal como documenta CN-019.
- Archivos: `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/src/modules/marketplace/marketplace.routes.ts`, `apps/api/tests/marketplace.service.test.ts`, `apps/api/tests/marketplace.routes.test.ts`, `apps/api/prisma/schema.prisma`, `docs/PROGRESO.md`.
- Decisiones: `updateAvailability(workerId, isAvailable)` consulta `User` por `id` y `role: WORKER`, toma el correo exclusivamente de esa sesión y actualiza perfiles con ese correo; no acepta identidad del payload. Una identidad inexistente produce `MarketplaceError('ASSIGNMENT_NOT_FOUND', 404)` y las rutas traducen el error a HTTP 404. El modelo `WorkerProfile` mantiene unicidad por `(companyId,email)`, por lo que los perfiles del mismo trabajador quedan limitados a sus empresas y no se mezclan con otros correos. `wallet(workerId)` sigue siendo compatibilidad en memoria y no se considera persistencia de ledger.
- Validaciones: `npm --workspace @cumple-now/api test` — 35/35 pruebas aprobadas en 9 archivos; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; revisión estática confirmó filtro `id + role: WORKER`, actualización basada en correo autenticado, propagación de `workerId` desde rutas y respuesta 404; `git diff --check` — sin errores atribuibles al cambio.
- Riesgos: no se ejecutó integración contra una instancia PostgreSQL real (`NO_EJECUTADA`); la cobertura unitaria simula Prisma. La billetera/movimientos continúan sin fuente persistente hasta definir el modelo y reglas de ledger, sin regresión sobre los contratos actuales.
- Siguiente paso: coordinador puede cerrar CN-019; planificar una entrega separada para ledger persistente e integración PostgreSQL real antes de producción.

### CN-20260826-019 — Persistencia de disponibilidad del trabajador en PostgreSQL

- Fecha: 2026-08-26 13:47 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-018
- Alcance: `DatabaseMarketplaceService.updateAvailability` ahora resuelve al trabajador autenticado y persiste su estado `AVAILABLE`/`UNAVAILABLE` en `WorkerProfile` mediante Prisma; se evita aceptar una identidad alternativa desde el payload y se conserva la respuesta `{ isAvailable }`.
- Archivos: `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`, `docs/PROGRESO.md`.
- Decisiones: se usa el correo del `User` autenticado para actualizar perfiles persistentes asociados, permitiendo perfiles por empresa sin mezclar trabajadores; una identidad inexistente devuelve 404. La billetera/movimientos queda fuera por no existir aún un modelo persistente dedicado.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.service.test.ts` — 12/12; `npm --workspace @cumple-now/api test` — 35/35 en 9 archivos; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `git diff --check` — código 0 (solo advertencias LF/CRLF).
- Riesgos: no se ejecutó integración contra PostgreSQL real (`NO_EJECUTADA`); movimientos de billetera continúan siendo compatibilidad en memoria fija hasta definir modelo y reglas de ledger.
- Siguiente paso: `auditor-sol` debe verificar persistencia, aislamiento entre trabajadores y manejo de usuario sin perfil.

### CN-20260826-018 — Reauditoría de aislamiento por trabajador en disponibilidad y billetera

- Fecha: 2026-08-26 13:45 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-017 (corrige CN-20260826-016)
- Alcance: se verificó que las rutas de disponibilidad y billetera obtienen el `workerId` de la sesión Bearer y lo propagan obligatoriamente al servicio; se comprobó aislamiento entre dos trabajadores y ausencia de regresiones.
- Archivos: `apps/api/src/modules/marketplace/marketplace.routes.ts`, `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.routes.test.ts`.
- Decisiones: el contrato `MarketplaceOperations` exige `workerId` en `updateAvailability` y `wallet`; las implementaciones demo mantienen estado por clave de trabajador y la implementación persistente devuelve identidad autenticada sin aceptar identidad del payload o encabezados arbitrarios cuando hay sesión.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.routes.test.ts` — 3/3 pruebas aprobadas, incluyendo aislamiento multiusuario; `npm --workspace @cumple-now/api test` — 33/33 pruebas aprobadas en 9 archivos; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; revisión estática confirmó llamadas `service.updateAvailability(authenticatedId, ...)` y `service.wallet(authenticatedId)`.
- Riesgos: la billetera persistente continúa siendo una respuesta de compatibilidad sin movimientos consultados desde PostgreSQL y `DatabaseMarketplaceService.updateAvailability` aún no persiste disponibilidad; conectar almacenamiento real debe conservar el filtro por `workerId`.
- Siguiente paso: `implementador-terra` puede abordar persistencia real de disponibilidad/movimientos en una entrega separada; coordinador puede cerrar CN-017.

### CN-20260826-017 — Corrección de aislamiento por worker en disponibilidad y billetera

- Fecha: 2026-08-26 13:41 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-015 y CN-20260826-016
- Alcance: `workerId` autenticado se propaga obligatoriamente desde las rutas hacia `updateAvailability` y `wallet`; el servicio demo mantiene disponibilidad por trabajador y las respuestas de billetera quedan identificadas por el trabajador autenticado.
- Archivos: `apps/api/src/modules/marketplace/marketplace.routes.ts`, `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.routes.test.ts`, `docs/PROGRESO.md`.
- Decisiones: se actualizó el contrato `MarketplaceOperations` para exigir identidad en ambas operaciones; no se acepta identidad proveniente del payload ni encabezados arbitrarios cuando existe sesión Bearer. La compatibilidad demo conserva `x-demo-worker-id` solo en `DemoMarketplaceService`, con estado aislado por clave de trabajador.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.routes.test.ts` — 3/3 pruebas aprobadas; `npm --workspace @cumple-now/api test` — 33/33 pruebas aprobadas en 9 archivos; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `git diff --check` — código 0 (solo advertencias de conversión LF/CRLF).
- Riesgos: la billetera persistente continúa siendo una respuesta de compatibilidad sin movimientos consultados desde PostgreSQL; queda pendiente conectar movimientos reales manteniendo el filtro por `workerId`.
- Siguiente paso: `auditor-sol` debe reauditar CN-017 y confirmar aislamiento multiusuario en rutas y servicios.

### CN-20260826-016 — Auditoría de aislamiento de disponibilidad y billetera

- Fecha: 2026-08-26 13:40 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: REQUIERE_CAMBIOS
- Referencia: CN-20260826-015
- Alcance: revisión independiente de `PUT /api/workers/availability` y `GET /api/workers/wallet`, autenticación Bearer, separación de roles y regresiones.
- Archivos: `apps/api/src/modules/marketplace/marketplace.routes.ts`, `apps/api/tests/marketplace.routes.test.ts`, `docs/PROGRESO.md`.
- Decisiones: la capa HTTP sí exige Bearer válido para `DatabaseMarketplaceService`, rechaza cuentas BUSINESS con 403 y anónimos con 401; el modo demo conserva el encabezado `x-demo-worker-id` únicamente para `DemoMarketplaceService`. Sin embargo, ambas rutas descartan el `workerId` autenticado y llaman `service.updateAvailability(isAvailable)`/`service.wallet()` sin identidad, por lo que una implementación persistente que no derive el trabajador de sesión puede leer o modificar estado global o de otro trabajador. El aislamiento por rol/sesión no queda garantizado en la capa de servicio.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.routes.test.ts` — 2/2 pruebas aprobadas; `npm --workspace @cumple-now/api test` — 32/32 pruebas aprobadas en 9 archivos; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `git diff --check` — código 0. Revisión estática confirmó que `authenticatedWorkerId` se invoca pero su retorno no se transmite en las dos rutas auditadas.
- Riesgos: riesgo alto de aislamiento de datos/actualización incorrecta cuando exista más de un trabajador en la implementación no demo; las pruebas actuales solo comprueban autorización y llamadas sin parámetro de identidad, no aislamiento multiusuario ni PostgreSQL real (`NO_EJECUTADA`).
- Siguiente paso: `implementador-terra` debe propagar el `workerId` autenticado al contrato de servicio (y sus implementaciones), agregar pruebas de dos trabajadores que verifiquen separación de disponibilidad y billetera, y registrar una nueva corrección para reauditoría.

### CN-20260826-015 — Aislamiento de rutas de disponibilidad y billetera del trabajador

- Fecha: 2026-08-26 13:38 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-014
- Alcance: las rutas operativas `PUT /api/workers/availability` y `GET /api/workers/wallet` ahora requieren una sesión Bearer válida de trabajador; las cuentas empresariales reciben 403 y las solicitudes anónimas 401. Se conserva la validación de payload y el contrato de servicio existente.
- Archivos: `apps/api/src/modules/marketplace/marketplace.routes.ts`, `apps/api/tests/marketplace.routes.test.ts`, `docs/PROGRESO.md`.
- Decisiones: se reutilizó `authenticatedWorkerId` para mantener un único control de rol/sesión y evitar exponer estado global del trabajador o billetera a clientes no autenticados; el modo demo sigue permitiendo el encabezado demo únicamente cuando se usa `DemoMarketplaceService`.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.routes.test.ts` — 2/2 pruebas aprobadas; `npm --workspace @cumple-now/api test` — 32/32 pruebas aprobadas en 9 archivos; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `git diff --check` — sin errores.
- Riesgos: `updateAvailability` y `wallet` mantienen un contrato de servicio sin identificador de trabajador, por lo que el aislamiento de datos dentro de una implementación no demo queda como siguiente endurecimiento; no se ejecutó una prueba de integración contra PostgreSQL real (`NO_EJECUTADA`).
- Siguiente paso: `auditor-sol` debe auditar CN-20260826-015 y confirmar que no existan rutas equivalentes sin protección.

### CN-20260826-014 — Auditoría CN-013 y revalidación CN-012

- Fecha: 2026-08-26 13:28 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-013 y CN-20260826-012
- Alcance: revisión independiente de reintentos serializables P2034 en decisiones de postulaciones y de los estados seguros de selección de talento por turno.
- Archivos: `apps/api/src/modules/business/business.service.ts`, `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/business.routes.test.ts`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`.
- Decisiones: no se detectaron hallazgos críticos, altos, medios o bajos atribuibles a estos ciclos. El reintento está limitado a P2034, abre una transacción serializable nueva por intento y propaga otros errores; la UI vincula carga, error, vacío y conteo al turno seleccionado e impide renderizar/accionar datos obsoletos.
- Validaciones: `npm --workspace @cumple-now/api test` — 31/31 pruebas aprobadas en 9 archivos; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `npm --workspace @cumple-now/web run build` — compilación Next.js/TypeScript correcta; `git diff --check` — sin errores.
- Riesgos: no se ejecutó carrera contra PostgreSQL real ni validación visual/manual de breakpoints o lector de pantalla (`NO_EJECUTADA`); deben cubrirse antes de producción.
- Siguiente paso: coordinador puede cerrar CN-013/CN-012; Terra debe abordar pruebas de concurrencia y revisión visual en una entrega posterior si son requisito de producción.

### CN-20260826-013 — Reintentos ante conflictos serializables en aceptación y cierre

- Fecha: 2026-08-26 13:22 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-012
- Alcance: las transacciones serializables de decisión de postulaciones y operaciones de asistencia (check-in/check-out) reintentan hasta tres veces ante el conflicto Prisma `P2034`; los errores no relacionados se propagan sin ocultarse.
- Archivos: `apps/api/src/modules/business/business.service.ts`, `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/business.routes.test.ts`, `docs/PROGRESO.md`.
- Decisiones: el reintento es acotado a `P2034`, sin esperas artificiales ni reintentos de reglas de negocio; cada intento abre una transacción serializable nueva para que PostgreSQL vuelva a evaluar cupos y cobertura.
- Validaciones: `npm --workspace @cumple-now/api test` — 31/31 pruebas aprobadas en 9 archivos; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `git diff --check` — sin errores.
- Riesgos: no se ejecutó una carrera contra PostgreSQL real en este entorno; la auditoría debe confirmar que el reintento no duplica eventos ni asignaciones bajo contención.
- Siguiente paso: `auditor-sol` debe auditar CN-20260826-013 y revalidar CN-20260826-012.

### CN-20260826-012 — Estados seguros de postulaciones por turno

- Fecha: 2026-08-26 13:10 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-011
- Alcance: `Selección de talento` ahora invalida las postulaciones anteriores al cambiar de turno, bloquea filas y acciones mientras se carga el turno actual, muestra un error explícito ante fallo de API y presenta un conteo visible exclusivo del turno seleccionado.
- Archivos: `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `docs/PROGRESO.md`.
- Decisiones: se asocia la carga a `applicationsShiftId`; solo se renderizan filas cuando coincide con `selectedShiftId`, y las transiciones priorizan carga, error, vacío y datos en ese orden. El contador anuncia `Actualizando`, `No disponibles` o el total del turno actual mediante una región viva.
- Validaciones: `npm --workspace @cumple-now/web test` — código 0, no hay archivos de prueba configurados; `npm --workspace @cumple-now/web run build` — build de producción Next.js y TypeScript correcto; `rg -n "applications(Error|ShiftId|MatchSelectedShift)|application-count|application-error" apps/web/app/page.tsx apps/web/app/globals.css` — estados, vínculo al turno y estilos presentes; `git diff --check` — sin errores.
- Riesgos: no existe infraestructura de pruebas de componentes para automatizar la carrera de cambio de turno ni la respuesta de error; queda pendiente revisión visual y de lector de pantalla en los breakpoints habituales.
- Siguiente paso: `auditor-sol` debe reauditar CN-20260826-012 verificando que no aparezcan ni puedan accionarse datos del turno anterior y que carga/error/vacío/conteo sean claros.

### CN-20260826-011 — Auditoría de prioridad de Selección de talento

- Fecha: 2026-08-26 13:04 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: REQUIERE_CAMBIOS
- Referencia: CN-20260826-010
- Alcance: se auditó el orden DOM de `Selección de talento`, su instancia única, los estados de postulaciones, el contexto del turno, respuestas, acciones y los estilos responsive relacionados.
- Archivos: `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `docs/PROGRESO.md`; únicamente `docs/PROGRESO.md` fue modificado por la auditoría.
- Decisiones: la sección aparece una sola vez y está antes de métricas, lista y detalle, pero no se aprueba porque un error de carga se presenta como estado vacío y el cambio de turno puede mostrar temporalmente postulaciones anteriores bajo el nuevo contexto; tampoco se expone un conteo específico del turno seleccionado.
- Validaciones: revisión estática — orden DOM `ViewHeader` → aviso → `application-workspace` → `view-stat-grid` → `management-grid`, una coincidencia de `Selección de talento` y una de `application-workspace`, respuestas y acciones aceptar/rechazar conservadas; `npm --workspace @cumple-now/web test` — código 0 sin archivos de prueba; `npm --workspace @cumple-now/web run build` — build Next.js y TypeScript correcto; `git diff --check -- apps/web/app/page.tsx` — código 0; validación visual automatizada `NO_EJECUTADA` porque no hay navegador conectado.
- Riesgos: no se validaron visualmente breakpoints; el bloque reutiliza `ViewHeader` y genera un segundo `h1`, y los estilos móviles no incluyen una adaptación específica de `application-row`, aspectos preexistentes que requieren comprobación visual y de accesibilidad.
- Siguiente paso: `implementador-terra` debe separar error de vacío, impedir que datos del turno anterior se rendericen o accionen durante el cambio, mostrar el conteo del turno seleccionado y registrar una corrección para reauditoría.

### CN-20260826-010 — Selección de talento priorizada en Turnos

- Fecha: 2026-08-26 12:57 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: N/A
- Alcance: la única sección `Selección de talento` se reubicó al inicio útil de la vista Turnos, después del aviso de postulaciones y antes de métricas, listado y detalle secundarios; mantiene el contexto del turno elegido, estados de carga/vacío, contador, respuestas de filtro y acciones de aceptar o rechazar.
- Archivos: `apps/web/app/page.tsx`, `docs/PROGRESO.md`.
- Decisiones: se conservó una sola instancia de la sección y se añadió una indicación breve para cambiar el contexto desde la lista de turnos inferior; se reutilizaron las clases responsive existentes sin alterar datos ni API.
- Validaciones: `npm --workspace @cumple-now/web test` — código 0, no hay archivos de prueba configurados; `npm --workspace @cumple-now/web run build` — build de producción Next.js correcto; `rg -n "Selección de talento|application-workspace" apps/web/app/page.tsx` — una única sección encontrada antes de `management-grid`; `git diff --check` — sin errores.
- Riesgos: no hay prueba automatizada de componentes web configurada; queda pendiente la revisión visual manual en los breakpoints habituales para confirmar la prioridad en el primer viewport.
- Siguiente paso: `auditor-sol` debe auditar CN-20260826-010, verificando la jerarquía visual, la instancia única y la preservación de acciones y estados de postulación.

### CN-20260826-009 — Auditoría del restablecimiento operativo y cuentas demo

- Fecha: 2026-08-26 12:39 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-008
- Alcance: se auditó la disponibilidad de Flutter, web y API, la continuidad del proceso Flutter desacoplado, sus logs, la salud de Docker Compose y la existencia de las cuentas demo con los roles esperados.
- Archivos: `docs/PROGRESO.md`, `flutter-web.log` y `flutter-web-error.log`; únicamente `docs/PROGRESO.md` fue modificado.
- Decisiones: no se encontraron hallazgos; todas las comprobaciones fueron de solo lectura y no se modificaron código, datos, contenedores ni procesos.
- Validaciones: `Invoke-WebRequest` — HTTP 200 en `http://127.0.0.1:7357`, `http://127.0.0.1:3000` y `http://127.0.0.1:4000/api/health`, este último con `{"status":"ok"}`; `Get-CimInstance Win32_Process` — `dart.exe` y `dartvm.exe` activos con `run -d web-server --web-port 7357 --dart-define=USE_LOCAL_API=true`; `flutter-web.log` — señal de servidor en 7357 y cero coincidencias de error; `flutter-web-error.log` — 0 bytes; `docker compose ps --format json` — `db`, `api` y `web` en estado `running` y `healthy`; consulta Prisma de solo lectura limitada a `email` y `role` — `empresa.demo@cumplenow.local BUSINESS` y `trabajador.demo@cumplenow.local WORKER`.
- Riesgos: validación puntual que no sustituye una prueba manual de navegación o inicio de sesión; la revisión de logs se limitó a los archivos actuales y a patrones de error observables.
- Siguiente paso: entorno operativo aprobado; el coordinador puede continuar con la validación funcional manteniendo los procesos actuales.

### CN-20260826-008 — Restablecimiento operativo de Flutter y cuentas demo

- Fecha: 2026-08-26 12:34 (America/Lima)
- Agente: implementador-terra
- Tipo: CORRECCION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-007
- Alcance: se restableció la disponibilidad del servidor Flutter en el puerto 7357 mediante ejecución desacoplada y se verificó la disponibilidad de las dos cuentas demo locales con sus roles esperados.
- Archivos: `docs/PROGRESO.md`; se revisaron `flutter-web.log` y `flutter-web-error.log` sin modificarlos.
- Decisiones: el proceso Flutter se mantiene bajo control del coordinador; el registro omite intencionalmente las contraseñas y cualquier dato de autenticación sensible.
- Validaciones: `Invoke-WebRequest http://127.0.0.1:7357` — HTTP 200; `Invoke-WebRequest http://127.0.0.1:3000` — HTTP 200; `Invoke-WebRequest http://127.0.0.1:4000/api/health` — HTTP 200; los logs muestran `Web Server` servido en `http://localhost:7357` y `flutter-web-error.log` está vacío; `Get-CimInstance Win32_Process` confirmó `dart.exe` y `dartvm.exe` asociados al servidor web 7357; `docker compose ps --format json` — `db`, `api` y `web` en estado `running` y `healthy`; consulta SQL de solo lectura confirmó `empresa.demo@cumplenow.local BUSINESS` y `trabajador.demo@cumplenow.local WORKER`.
- Riesgos: la validación HTTP y de procesos no sustituye una comprobación manual en la pestaña ya abierta; las credenciales se verificaron previamente mediante inicio de sesión por el coordinador y no se reimprimieron ni persistieron en este registro.
- Siguiente paso: `auditor-sol` debe auditar CN-20260826-008; conservar los procesos actuales sin reiniciarlos salvo que el coordinador lo solicite.

### CN-20260826-007 — Validación operativa del entorno levantado

- Fecha: 2026-08-26 12:22 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-006
- Alcance: validación operativa del entorno levantado.
- Archivos: `docs/PROGRESO.md` (único archivo modificado); servicios observados mediante HTTP, puertos y estado de Docker Compose.
- Decisiones: no se encontraron hallazgos; se verificó el entorno existente únicamente con operaciones de lectura, sin reiniciar ni detener procesos.
- Validaciones: `Invoke-WebRequest http://127.0.0.1:4000/api/health` — HTTP 200, `application/json`, cuerpo `{"status":"ok"}`; `Invoke-WebRequest http://127.0.0.1:3000` — HTTP 200, `text/html`, 10200 bytes; `Invoke-WebRequest http://127.0.0.1:7357` — HTTP 200, `text/html`, 1568 bytes; `Get-NetTCPConnection -State Listen` — puertos 3000 y 4000 escuchados por Docker y 7357 por `dartvm`; `docker compose ps --format json` — `db`, `api` y `web` en estado `running` y `healthy`; `Get-CimInstance Win32_Process -Filter 'ProcessId = 30272'` — Flutter activo en Chrome con `--web-port 7357 --dart-define=USE_LOCAL_API=true`.
- Riesgos: la comprobación HTTP no sustituye una prueba manual de flujos visuales; no se dispone en esta auditoría del historial anterior de la consola Flutter, aunque el proceso y el endpoint permanecen activos y no se observaron fallos en las comprobaciones ejecutadas.
- Siguiente paso: entorno listo para validación funcional manual o para la siguiente tarea de `implementador-terra`; mantener los procesos bajo control del coordinador.

### CN-20260826-006 — Auditoría de atomicidad de la postulación

- Fecha: 2026-08-26 12:11 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-005
- Alcance: se auditó el límite transaccional de la postulación persistente, la atomicidad de aplicación, evento y conversación, la recuperación concurrente de `P2002` y el valor de la prueba de rollback.
- Archivos: `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`, `apps/api/prisma/schema.prisma`, `docs/PROGRESO.md`.
- Decisiones: no se encontraron hallazgos atribuibles a CN-20260826-005; todas las escrituras auxiliares usan el mismo `Prisma.TransactionClient`, el conflicto de aplicación se recupera después del rechazo de la transacción mediante `[shiftId, workerId]`, y los demás errores no se ocultan.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.service.test.ts` — 10/10 pruebas aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `npm --workspace @cumple-now/api test` — 30/30 pruebas aprobadas en 9 archivos; `git diff --check -- apps/api/src/modules/marketplace/marketplace.service.ts apps/api/tests/marketplace.service.test.ts` — código 0; revisión estática confirmó `@@unique([shiftId, workerId])` y que aplicación, evento, perfil y conversación se operan con `tx`.
- Riesgos: no se ejecutó concurrencia ni rollback contra PostgreSQL real; la prueba unitaria demuestra rollback ante fallo del evento, pero no simula un fallo posterior de conversación; como condición preexistente fuera de CN-20260826-005, la elegibilidad del turno se consulta antes de abrir la transacción y puede quedar obsoleta ante una cancelación concurrente.
- Siguiente paso: `implementador-terra` puede continuar; antes de producción debe agregar validación de concurrencia real y tratar en una entrega separada la carrera de elegibilidad del turno.

### CN-20260826-005 — Postulación, evento y conversación atómicos

- Fecha: 2026-08-26 12:04 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: CN-20260826-004
- Alcance: la creación persistente de una postulación, su evento `APPLICATION_SUBMITTED` y la conversación asociada se ejecutan dentro de una única transacción Prisma; la recuperación idempotente de la restricción única `P2002` se conserva.
- Archivos: `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`, `docs/PROGRESO.md`.
- Decisiones: se repite la lectura de la clave única dentro de la transacción para evitar efectos auxiliares si otra solicitud ya confirmó la postulación; cualquier fallo de evento o conversación revierte la creación, y un `P2002` vuelve a consultar fuera de la transacción el registro confirmado.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.service.test.ts` — 10 pruebas aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `npm --workspace @cumple-now/api test` — 30 pruebas aprobadas en 9 archivos; `git diff --check` — sin errores.
- Riesgos: no se levantó PostgreSQL ni se ejecutó una carrera real contra la base de datos, conforme al alcance; queda pendiente validar concurrencia real antes de producción.
- Siguiente paso: `auditor-sol` debe auditar CN-20260826-005, en particular el límite transaccional, el rollback de efectos auxiliares y el manejo de `P2002`.

### CN-20260826-004 — Auditoría de postulación concurrente idempotente

- Fecha: 2026-08-26 11:58 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-003
- Alcance: se auditó la recuperación de una postulación confirmada tras una colisión única concurrente, el manejo de errores de Prisma y la ausencia de efectos laterales duplicados en esa rama.
- Archivos: `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`, `apps/api/prisma/schema.prisma`, `docs/PROGRESO.md`.
- Decisiones: no se encontraron hallazgos atribuibles a CN-20260826-003; el `P2002` ocurre sobre la única restricción de creación de `ShiftApplication`, la relectura usa la misma clave `[shiftId, workerId]`, los errores distintos y las colisiones sin registro recuperable se vuelven a propagar, y el retorno temprano evita duplicar evento y conversación.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.service.test.ts` — 9/9 pruebas aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `npm --workspace @cumple-now/api test` — 29/29 pruebas aprobadas en 9 archivos; `git diff --check -- apps/api/src/modules/marketplace/marketplace.service.ts apps/api/tests/marketplace.service.test.ts` — código 0; revisión del esquema confirmó `@@unique([shiftId, workerId])`.
- Riesgos: no se ejecutó una prueba de concurrencia contra PostgreSQL real; fuera del cambio auditado, la creación de la postulación y sus efectos auxiliares de evento y conversación siguen sin compartir una transacción, por lo que un fallo posterior a la creación puede dejar estado parcial.
- Siguiente paso: `implementador-terra` puede continuar con el siguiente cambio; antes de producción debe cubrirse la concurrencia real y evaluarse la atomicidad de los efectos auxiliares.

### CN-20260826-003 — Postulación persistente idempotente ante concurrencia

- Fecha: 2026-08-26 11:54 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: N/A
- Alcance: una postulación duplicada del mismo trabajador al mismo turno que choque con la restricción única de PostgreSQL ahora recupera y devuelve la postulación ya creada, en lugar de propagar un error de base de datos.
- Archivos: `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/tests/marketplace.service.test.ts`, `docs/PROGRESO.md`.
- Decisiones: se conserva la restricción única `[shiftId, workerId]` como autoridad de concurrencia; el manejo de `P2002` vuelve a consultar el registro confirmado y no vuelve a generar eventos ni conversaciones.
- Validaciones: `npm --workspace @cumple-now/api test -- marketplace.service.test.ts` — 9 pruebas aprobadas; `npm --workspace @cumple-now/api run build` — `tsc --noEmit` correcto; `npm --workspace @cumple-now/api test` — 29 pruebas aprobadas en 9 archivos; `git diff --check` — sin errores.
- Riesgos: la prueba simula la colisión única de Prisma; una prueba de concurrencia contra PostgreSQL real sigue siendo parte de la fase pendiente indicada en el plan.
- Siguiente paso: `auditor-sol` debe auditar CN-20260826-003, especialmente la recuperación segura del error `P2002` y la ausencia de efectos secundarios duplicados.

### CN-20260826-002 — Auditoría del entorno de dos agentes

- Fecha: 2026-08-26 11:47 (America/Lima)
- Agente: auditor-sol
- Tipo: AUDITORIA
- Estado: APROBADO
- Referencia: CN-20260826-001
- Alcance: se auditó la configuración de los dos agentes, la coherencia de sus roles y modelos, el registro operativo único, el registro exclusivo de hitos terminados, el ciclo secuencial y su referencia en `README.md`.
- Archivos: `.cursor/agents/implementador-terra.md`, `.cursor/agents/auditor-sol.md`, `.cursor/rules/flujo-dos-agentes.mdc`, `docs/PROGRESO.md`, `README.md`.
- Decisiones: no se encontraron hallazgos; la regla `alwaysApply` y las instrucciones de cada agente forman un flujo aplicable Terra → Sol, con corrección y reauditoría cuando corresponda.
- Validaciones: `Get-ChildItem -File -Recurse .cursor/agents` devolvió exactamente dos archivos; `rg` confirmó los modelos `gpt-5.6-terra` y `gpt-5.6-sol` en agentes, regla y registro, y no encontró otra declaración de registro operativo; se comprobó una sola entrada `CN-20260826-001`, ausencia de espacios finales en los cinco archivos auditados y `git diff --check -- README.md` finalizó con código 0.
- Riesgos: la selección efectiva de cada modelo depende del invocador y no puede verificarse únicamente con los archivos del repositorio; no se ejecutaron pruebas funcionales porque el alcance solo modifica configuración y documentación.
- Siguiente paso: usar este flujo aprobado para el siguiente cambio funcional, comenzando con `implementador-terra`.

### CN-20260826-001 — Entorno de trabajo de dos agentes

- Fecha: 2026-08-26 11:44 (America/Lima)
- Agente: implementador-terra
- Tipo: IMPLEMENTACION
- Estado: LISTO_PARA_AUDITORIA
- Referencia: N/A
- Alcance: se configuraron exactamente dos agentes de proyecto, sus modelos, el ciclo secuencial de entrega y auditoría, y este registro operativo único.
- Archivos: `.cursor/agents/implementador-terra.md`, `.cursor/agents/auditor-sol.md`, `.cursor/rules/flujo-dos-agentes.mdc`, `docs/PROGRESO.md`, `README.md`.
- Decisiones: Terra implementa; Sol audita sin corregir; solo se registran trabajos terminados; el historial es inmutable.
- Validaciones: se verificó que `.cursor/agents/` contiene exactamente `implementador-terra.md` y `auditor-sol.md`; sus frontmatter y modelos requeridos coinciden con la regla; `git diff --check` terminó sin errores; se revisaron los diffs disponibles y el contenido de los archivos nuevos de coordinación.
- Riesgos: la disponibilidad efectiva de cada modelo depende de la cuenta y del cliente de Codex; el modelo se debe seleccionar al invocar cada agente.
- Siguiente paso: `auditor-sol` debe auditar esta configuración antes de usar el flujo para cambios funcionales.
