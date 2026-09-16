# Plan: Refuerzo del sistema hacia el Hito A (piloto honesto de talento)

- Fecha: 2026-09-15
- Origen: orden explícita del usuario — "arma el plan de siguientes pasos, qué es lo que falta reforzar en el sistema". No hay hallazgos de auditoría abiertos: el ciclo `CN-20260915-057` … `CN-20260915-063` está cerrado y `APROBADO`. Este plan define el trabajo siguiente, no reabre nada cerrado.
- Estado verificado antes de planificar:
  - `docs/PROGRESO.md`: última entrada `CN-20260915-063` (`AUDITORIA`, `APROBADO`). Sin hallazgos pendientes de corrección.
  - `docs/product/project-master-plan.md` (actualizado 2026-09-14): **Hito A — Piloto honesto de talento** sigue declarado como "el siguiente objetivo inmediato". El orden de bloques es vinculante.
  - Suite API actual: 15 archivos / 81 pruebas. `apps/web/e2e/` tiene un único spec (`business-auth.spec.ts`) con fixture `business-api.ts`; no hay fixture ADMIN.
  - `apps/api/src/app.ts:26` usa `cors()` sin configuración y no hay ningún rate limiting ni protección de fuerza bruta en el proyecto (búsqueda de `rateLimit`/`helmet` sin resultados).
  - `apps/api/src/modules/talent/talent.service.ts:138-159` (`searchTalent`) sólo filtra por `specialtyId`, `district` y `availableOnly`; no existe búsqueda por texto libre. El orden es `orderBy: { id: 'asc' }`.
  - `apps/web/app/page.tsx` (vista "Trabajadores") mezcla en un mismo panel la lista real de talento (`talent`) y los contactos de empresa (`filteredWorkers`), muestra el chip "Ordenado por compatibilidad" sin ninguna regla de orden real, y tiene dos acciones que sólo muestran un toast simulado ("Invitar por enlace" y "Habilidades").
  - No existe la entidad `TalentInvitation` en `apps/api/prisma/schema.prisma`.

## Criterio de priorización (justificación de la decisión pedida)

Se eligió **ambos, en este orden: primero refuerzo barato de seguridad y de verdad del producto, después el avance sustantivo del Bloque 1**, por tres razones:

1. **El único P0 del plan maestro marcado "continuo" es el endurecimiento de API (Bloque 4)**, y hoy es la brecha más seria y más barata de cerrar: con Google Sign-In y contraseña local ya operativos en el piloto, `POST /api/auth/login`, `/register`, `/google` y `/password` no tienen ningún límite de intentos, y `cors()` acepta cualquier origen. Eso no espera al Hito A: lo marca el propio plan maestro como transversal. Es lo primero que "falta reforzar" en sentido literal.
2. **Las simulaciones que quedan en la vista de talento contradicen directamente las reglas vinculantes del Bloque 0** ("ninguna pantalla mostrará ... una puntuación sin evidencia y regla de cálculo auditable") y la definición del Hito A ("No hay puntuaciones ni promesas ficticias"). Mientras el chip "Ordenado por compatibilidad" y los toasts falsos sigan ahí, el Hito A **no puede declararse cerrado aunque se implemente todo lo demás**. Son cambios pequeños y de alto valor: conviene hacerlos antes de construir encima.
3. **Los riesgos residuales del punto 2 del encargo no son homogéneos.** Los baratos (prueba del branch `INVALID_REGISTRATION`, `try/catch` de los botones de borrado, simetría de `overview.companies`) caben en un único alcance de higiene y se pagan en una sesión. En cambio, la infraestructura E2E Playwright con fixture ADMIN exige levantar API + base para el panel superadmin: es una inversión de infraestructura, no una corrección, y se ubica al final para no retrasar el hito. El doble `FakePrisma` que no reproduce `P2002` **no se corrige aquí a propósito**: su cierre correcto es una prueba de integración contra PostgreSQL real, que ya está listada en "Cobertura mínima de pruebas pendiente" del plan maestro; falsificar `P2002` en el doble daría una falsa sensación de cobertura.

Los Alcances 4, 5 y 6 son el contenido real del Bloque 1 y llevan al Hito A. El Alcance 6 (perfil ampliado) va al final porque es el único que depende del SDK de Flutter, que sigue bloqueado en esta estación desde `CN-20260912-054`.

- Supuestos:
  - Se puede añadir una dependencia de rate limiting a `apps/api` (`express-rate-limit`, sin almacén externo, en memoria) para el piloto. Supuesto reversible: si el equipo prefiere no añadir dependencia, un limitador propio en memoria de ~40 líneas cumple el mismo criterio de aceptación; lo importante es que el límite sea inyectable/desactivable desde `createApp` para no romper la suite existente.
  - El almacén en memoria es aceptable para el piloto de una sola instancia. Un almacén compartido (Redis) pertenece al Bloque 8 y queda declarado como riesgo, no implementado aquí.
  - Los cambios de `apps/web/app/page.tsx` se pueden hacer sin rediseño visual mayor: el archivo tiene 3613 líneas y la vista "Trabajadores" está acotada aproximadamente entre las líneas 1630 y 1790.
  - El Alcance 6 puede quedar `NO_EJECUTADA` en validación Flutter si el SDK sigue bloqueado; en ese caso debe declararse como riesgo explícito y no presentarse como validado.
- Preguntas abiertas:
  - **(Alcance 5, materialmente relevante)** `toTalentCard` devuelve el `id` del **perfil** (`WorkerTalentProfile.id`), no el `userId` del trabajador (`talent.service.ts:378-393`). Para que una empresa pueda invitar a un perfil hay que decidir cuál de las dos opciones se adopta: (a) `TalentInvitation` referencia `workerTalentProfileId` y el servidor resuelve el `userId` internamente (no expone identidad de usuario al cliente, preferible por privacidad); o (b) la tarjeta pasa a exponer `userId`. **El plan asume (a)** y así lo describe el Alcance 5; si el usuario prefiere (b), cambia el contrato de la API y debe decidirse antes de ejecutar el Alcance 5.
  - **(Alcance 4)** El plan maestro pide "texto libre" en la búsqueda empresarial pero no define su alcance. El plan asume búsqueda `contains`/`insensitive` sobre `user.name`, `headline` y `district`, sin búsqueda full-text de PostgreSQL. Si se requiere `tsvector`/ranking, es otro alcance.
  - **(Alcance 1)** No está decidido el origen permitido de CORS para el piloto. El plan asume una lista de orígenes por variable de entorno con fallback permisivo **sólo** en `NODE_ENV !== 'production'`; si ya existe un dominio de piloto definido, indicarlo al implementador.

---

## Alcance 1 — Endurecer la superficie de autenticación de la API (rate limiting + CORS por entorno)

- Objetivo: cerrar la parte inmediata y acotada del P0 continuo "Endurecimiento de API" del Bloque 4. Hoy `apps/api/src/app.ts:26` monta `cors()` sin restricción de origen y ninguna ruta tiene límite de intentos, por lo que `POST /api/auth/login`, `/api/auth/register`, `/api/auth/google`, `/api/auth/google/complete` y `/api/auth/password` admiten fuerza bruta y enumeración sin coste. Este alcance **no** cubre CSRF, rotación de secretos ni permisos granulares: esos siguen pendientes en el plan maestro.
- Criterios de aceptación:
  - Existe un limitador de intentos aplicado al menos a `POST /api/auth/login`, `/api/auth/register`, `/api/auth/google`, `/api/auth/google/complete` y `/api/auth/password`, con una ventana y un máximo configurables por variable de entorno y valores por defecto documentados.
  - Al superar el límite, la API responde `429` con un cuerpo `{ error: '<CODIGO>' }` coherente con el resto del contrato de errores (el código concreto lo elige el implementador y se documenta en `docs/reference/api.md`). La respuesta **no** revela si el correo existe ni ningún otro dato de la cuenta.
  - El limitador es inyectable o desactivable desde `createApp` (por ejemplo una opción `rateLimit?: false | {...}`), y la suite existente de 81 pruebas sigue pasando **sin** relajar el límite globalmente en producción. No se acepta "desactivado si `NODE_ENV === 'test'`" como única salvaguarda si eso deja el código sin prueba.
  - Hay al menos una prueba nueva que agota el límite en una ruta de auth y verifica el `429`, y otra que confirma que una ruta no limitada (p. ej. `GET /api/health`) no se ve afectada.
  - `cors()` pasa a configurarse con una lista de orígenes permitidos leída de entorno (p. ej. `CORS_ALLOWED_ORIGINS`, separada por comas). Fuera de producción, si la variable no está definida, se conserva el comportamiento permisivo actual para no romper el desarrollo local ni Flutter; en producción, la ausencia de la variable debe fallar de forma visible o restringir, nunca abrir en silencio.
  - `.env.example` y `.env.production.example` documentan las variables nuevas, y `docs/reference/api.md` documenta el `429` y su condición.
  - Si se usa un limitador por IP, se evalúa y se declara explícitamente el comportamiento detrás de proxy (`app.set('trust proxy', ...)`); si no se configura, debe declararse como riesgo, no omitirse.
- Archivos/módulos probablemente afectados:
  - `apps/api/src/app.ts` (configuración de CORS y montaje del limitador).
  - `apps/api/src/modules/auth/auth.routes.ts` (si el limitador se aplica por ruta en vez de por router).
  - `apps/api/package.json` (dependencia nueva, si se adopta).
  - `apps/api/tests/app.test.ts` o un archivo nuevo `apps/api/tests/rate_limit.test.ts`.
  - `.env.example`, `.env.production.example`, `docs/reference/api.md`, `docs/guides/local-development.md` si cambia el arranque local.
- Validaciones requeridas:
  - `npm.cmd run build --workspace=@cumple-now/api` — exit 0.
  - `npm.cmd run test --workspace=@cumple-now/api` — todas aprobadas; declarar el nuevo total de archivos/pruebas.
  - `npm.cmd run build --workspace=@cumple-now/web` — exit 0 (verifica que el panel no se rompe si cambia el origen permitido).
  - Comprobación manual o automatizada de que el panel web local sigue pudiendo llamar a la API con la configuración por defecto de desarrollo.
- Riesgos o dependencias:
  - Riesgo principal: un CORS mal configurado rompe el panel web y la app Flutter en desarrollo. Mitigación: fallback permisivo explícito fuera de producción, declarado en el código y en la documentación.
  - Riesgo declarado, no resuelto aquí: el almacén en memoria no se comparte entre instancias ni sobrevive a un reinicio; con varias réplicas el límite efectivo se multiplica. Corresponde al Bloque 8.
  - Independiente de todos los demás alcances. Puede tomarse primero.

---

## Alcance 2 — Higiene de los riesgos residuales menores ya declarados

- Objetivo: cerrar en una sola entrada los tres residuales baratos que las auditorías `CN-20260915-060`, `CN-20260915-062` y `CN-20260915-063` declararon como aceptados pero pendientes, para que no se arrastren indefinidamente.
- Criterios de aceptación:
  - **(a)** Existe una prueba que cubre el branch `INVALID_REGISTRATION` de `startGoogleLogin` (identidad de Google con `subject` o `name` vacíos), en el estilo del `FakePrisma` ya presente en `apps/api/tests/google_auth.service.test.ts`. No se modifica código de producto para lograrlo.
  - **(b)** Los botones de borrado del panel superadmin (`Eliminar empresa` y `Eliminar trabajador`) envuelven su `await` en `try/catch` y muestran el error al usuario con el mecanismo de aviso que ya use esa página, en vez de dejar un rechazo no manejado. Se corrigen **ambos**, no sólo el nuevo, porque el patrón proviene de `deleteCompany`.
  - **(c)** Se resuelve la inconsistencia declarada en `CN-20260915-062`: tras borrar una empresa, `overview.companies` se decrementa igual que `overview.workers` tras borrar un trabajador. Ambos decrementos deben estar guardados contra valores ausentes o negativos.
  - No se altera ninguna ruta de API ni el contrato de `DELETE /api/admin/companies/:id` ni de `DELETE /api/admin/workers/:id`.
- Archivos/módulos probablemente afectados:
  - `apps/api/tests/google_auth.service.test.ts` (prueba nueva).
  - `apps/web/app/admin/page.tsx` (los dos botones y los dos decrementos).
  - Sólo lectura: `apps/api/src/modules/auth/auth.service.ts`, `apps/web/lib/admin-api.ts`.
- Validaciones requeridas:
  - `npm.cmd run build --workspace=@cumple-now/api` — exit 0.
  - `npm.cmd run test --workspace=@cumple-now/api` — todas aprobadas; declarar el nuevo total.
  - `npm.cmd run build --workspace=@cumple-now/web` — exit 0.
- Riesgos o dependencias:
  - Muy bajo. Ningún cambio de contrato. Independiente de los demás alcances; se coloca temprano por ser barato y cerrar deuda declarada.
  - **Fuera de alcance a propósito:** el doble `FakePrisma` seguirá sin reproducir `P2002`/constraints reales de PostgreSQL. Ese residual **no** se cierra con más dobles; se cierra con la prueba de integración sobre PostgreSQL que el plan maestro ya lista como cobertura pendiente. Debe seguir declarándose como riesgo hasta entonces.

---

## Alcance 3 — Verdad del directorio de talento en el panel web

- Objetivo: eliminar de la vista "Trabajadores" del panel empresarial las afirmaciones y acciones sin respaldo real, y separar visualmente el talento global de los contactos de empresa, como exige el Bloque 1 ("Separar visualmente 'Talento disponible' de 'Equipo/contactos'") y las reglas del Bloque 0. Es un prerrequisito declarativo del Hito A.
- Criterios de aceptación:
  - Se retira o se sustituye el chip "Ordenado por compatibilidad" (`apps/web/app/page.tsx`, cabecera del panel de directorio). El orden real del servidor es `orderBy: { id: 'asc' }`; la interfaz no debe afirmar un criterio de compatibilidad que no existe. Si se desea mantener un indicador, debe describir el orden real.
  - Se retira el botón "Habilidades" cuyo único efecto es `showToast("Filtros de habilidades disponibles.")`, o bien se conecta a un filtro real. No puede quedar un botón que simule una capacidad.
  - Se retira el botón "Invitar por enlace" cuyo único efecto es `showToast("Invitación privada lista para compartir.")`, o se deja explícitamente deshabilitado con una etiqueta que indique que aún no está disponible. **No se implementa la invitación en este alcance** (eso es el Alcance 5).
  - El campo "Buscar por nombre, rol o habilidad" (`workerSearch`) deja de ser engañoso: hoy está colocado sobre el directorio de talento pero sólo filtra `filteredWorkers` (los contactos de empresa), no la lista `talent` traída del servidor. Debe quedar asociado inequívocamente a la lista que sí filtra, o bien quedar deshabilitado para talento hasta el Alcance 4, que es el que añade búsqueda por texto en el servidor.
  - Las dos listas quedan separadas en secciones visualmente distintas y rotuladas: "Talento disponible" (perfiles globales, datos declarados por el trabajador) y "Equipo / contactos" (contactos operativos de la empresa). El usuario debe poder distinguir cuál es cuál sin leer el código.
  - El filtro "En turno" no se envía al servidor y hoy no tiene efecto sobre la lista de talento; debe quedar claro a qué lista aplica cada filtro, o retirarse de la lista a la que no aplica.
  - Ningún valor mostrado en la sección de talento proviene de un default optimista del cliente. Los vacíos se muestran como "sin datos" o equivalente.
- Archivos/módulos probablemente afectados:
  - `apps/web/app/page.tsx` (vista `activeNav === "Trabajadores"`, aprox. líneas 1630-1790, y los estados `workerSearch`/`workerFilter`/`filteredWorkers` definidos hacia las líneas 322 y 598).
  - `apps/web/app/globals.css` si la separación de secciones requiere estilos.
  - `docs/product/project-master-plan.md` sólo si se marca el sub-ítem como completado; esa actualización la hace el auditor, no el implementador.
- Validaciones requeridas:
  - `npm.cmd run build --workspace=@cumple-now/web` — exit 0.
  - Búsqueda verificable en el repositorio de que ya no quedan en la vista de talento toasts que simulen invitación o filtros (el implementador debe declarar el comando usado y su salida).
  - Si existe suite de pruebas de interfaz aplicable, ejecutarla; si no, declararlo, sin presentarlo como aprobado.
- Riesgos o dependencias:
  - Riesgo de regresión visual en un archivo muy grande (3613 líneas). Mantener el cambio acotado a la vista "Trabajadores".
  - Depende de nada; pero conviene hacerlo **antes** del Alcance 4 para no reconstruir la misma sección dos veces.

---

## Alcance 4 — Terminar la búsqueda empresarial de talento en el servidor

- Objetivo: completar el ítem P0 "Terminar la búsqueda empresarial" del Bloque 1. Hoy `searchTalent` sólo admite `specialtyId`, `district` y `availableOnly`, y la web sólo conecta especialidad y disponibilidad; no existe búsqueda por texto libre ni filtro de distrito en la interfaz. El filtrado debe ocurrir en el servidor, con paginación por cursor y orden estable, sin exponer datos privados.
- Criterios de aceptación:
  - `TalentSearchInput` y `searchSchema` admiten un parámetro de texto libre (p. ej. `query`), validado y acotado en longitud, aplicado en el servidor sobre `user.name`, `headline` y `district` con coincidencia parcial insensible a mayúsculas.
  - El filtro `district` se expone en la interfaz web y se envía al servidor (ya está soportado en la API y hoy no se usa desde la web).
  - La paginación por cursor sigue siendo correcta **con los filtros aplicados**: el orden se mantiene estable y `nextCursor` no salta ni repite elementos. Debe haber una prueba que pagine con filtro activo, no sólo sin filtro.
  - La respuesta sigue sin exponer datos privados: ni DNI, ni correo, ni teléfono, ni metadatos de CV o foto. Debe haber una prueba negativa que lo afirme explícitamente sobre el cuerpo devuelto por `GET /api/business/talent`.
  - Se mantiene el requisito de rol: una sesión `WORKER` o sin sesión no puede consultar el directorio (403 / 401 respectivamente, como ya ocurre).
  - Se revisa si los índices existentes de `WorkerTalentProfile` (`@@index([isVisible, isAvailable, district])`) cubren la consulta nueva. Si el texto libre requiere un índice adicional, se añade con su migración; si se decide no añadirlo, la decisión y su coste se declaran explícitamente.
  - `docs/reference/api.md` documenta los parámetros nuevos de `GET /api/business/talent`.
- Archivos/módulos probablemente afectados:
  - `apps/api/src/modules/talent/talent.service.ts` (`TalentSearchInput`, `searchTalent`).
  - `apps/api/src/modules/talent/talent.routes.ts` (`searchSchema`, handler de `/business/talent`).
  - `apps/api/prisma/schema.prisma` + migración nueva, sólo si se añade índice.
  - `apps/api/tests/talent.routes.test.ts` (pruebas nuevas de filtro, paginación con filtro y ausencia de datos privados).
  - `apps/web/lib/business-api.ts` (`talent.search`), `apps/web/app/page.tsx` (controles de distrito y texto).
  - `docs/reference/api.md`.
- Validaciones requeridas:
  - `npm.cmd run build --workspace=@cumple-now/api` — exit 0.
  - `npm.cmd run test --workspace=@cumple-now/api` — todas aprobadas; declarar el nuevo total.
  - `npm.cmd run build --workspace=@cumple-now/web` — exit 0.
  - Si se añade migración: declarar si se aplicó sobre PostgreSQL real o si queda `NO_EJECUTADA` con su riesgo.
- Riesgos o dependencias:
  - Depende del Alcance 3 (la interfaz de la sección de talento debe estar ya saneada y separada; si no, se toca la misma zona dos veces).
  - Riesgo de rendimiento: la coincidencia parcial insensible sobre varios campos no usa índice en PostgreSQL sin configuración adicional. Con el volumen del piloto es aceptable; debe declararse.
  - La búsqueda por `user.name` cruza una relación; verificar que el `where` anidado no rompe el `cursor`/`orderBy` existente.

---

## Alcance 5 — Persistir invitaciones y contacto (`TalentInvitation`)

- Objetivo: completar el ítem P0 "Persistir invitaciones y contacto" del Bloque 1, último elemento sustantivo del Hito A. Hoy no existe ninguna entidad de invitación y la única acción de contacto en la vista de talento es un toast simulado (retirado en el Alcance 3). Ningún botón debe simular éxito, y la apertura de conversación debe requerir una regla de consentimiento válida.
- Criterios de aceptación:
  - Existe el modelo `TalentInvitation` en `apps/api/prisma/schema.prisma` con, al menos: empresa, trabajador destinatario, turno opcional, estado (p. ej. `PENDING` / `ACCEPTED` / `DECLINED` / `EXPIRED` / `CANCELLED`), vencimiento, mensaje opcional, y campos de auditoría (`createdAt`, `updatedAt`, actor que la creó). Con su migración correspondiente.
  - Existe una restricción que impide invitaciones duplicadas activas para el mismo par empresa/trabajador (y turno, si aplica). El intento duplicado devuelve un error explícito, no un segundo registro.
  - La API permite: crear una invitación desde una sesión `BUSINESS`; listarla para la empresa emisora; listarla para el trabajador destinatario desde una sesión `WORKER`; y que el trabajador la acepte o la rechace. Una empresa no puede leer ni modificar invitaciones de otra empresa; un trabajador no puede leer las dirigidas a otro. Debe haber pruebas negativas para ambos aislamientos.
  - **Consentimiento:** una conversación entre empresa y trabajador sólo puede abrirse a partir de una invitación aceptada (o de una relación ya vigente, p. ej. una asignación). Crear una invitación no abre por sí sola la conversación. La regla exacta se documenta.
  - **No enumeración:** la API de invitación identifica al destinatario por el identificador ya expuesto en el directorio (ver "Preguntas abiertas": el plan asume `WorkerTalentProfile.id`, resuelto a `userId` en el servidor). Una invitación dirigida a un perfil inexistente o no visible responde con un error que no permite distinguir "no existe" de "no visible".
  - Una invitación vencida no puede aceptarse; el vencimiento se evalúa en el servidor, nunca en el cliente.
  - La interfaz web sustituye la acción simulada por la acción real, con estados de carga, vacío y error. Ningún botón muestra éxito sin respuesta `2xx` del servidor.
  - `docs/reference/api.md` documenta las rutas nuevas y su tabla de errores.
- Archivos/módulos probablemente afectados:
  - `apps/api/prisma/schema.prisma` + migración nueva.
  - `apps/api/src/modules/talent/talent.service.ts` y `talent.routes.ts`, o un módulo nuevo si el servicio de talento queda demasiado grande (a criterio del implementador, declarándolo).
  - `apps/api/tests/` — archivo de pruebas nuevo o ampliación de `talent.routes.test.ts`.
  - `apps/web/lib/business-api.ts`, `apps/web/app/page.tsx`.
  - App Flutter, para que el trabajador vea y responda invitaciones: `apps/mobile_flutter/lib/features/...`. **Si el SDK de Flutter sigue bloqueado, dividir este alcance en dos entradas** (servidor + web primero; Flutter después), en vez de entregar Flutter sin validar.
  - `docs/reference/api.md`.
- Validaciones requeridas:
  - `npm.cmd run build --workspace=@cumple-now/api` — exit 0.
  - `npm.cmd run test --workspace=@cumple-now/api` — todas aprobadas, incluidas las pruebas de aislamiento por empresa y por trabajador, de duplicado y de vencimiento.
  - `npm.cmd run build --workspace=@cumple-now/web` — exit 0.
  - Aplicación de la migración sobre PostgreSQL: declarar si se ejecutó o queda `NO_EJECUTADA` con su riesgo.
  - `flutter test` / `flutter analyze` si se toca Flutter; si el SDK sigue bloqueado, declarar `NO_EJECUTADA` con el riesgo, sin presentarlo como aprobado.
- Riesgos o dependencias:
  - Depende del Alcance 4 (el directorio debe permitir localizar al trabajador que se va a invitar) y del Alcance 3 (la acción simulada debe estar retirada).
  - **Depende de la pregunta abierta sobre el identificador del destinatario.** Resolverla antes de empezar; cambia el contrato público de la API.
  - Es el alcance más grande del plan. Si excede una entrada auditable, dividirlo: (5a) modelo + migración + API + pruebas; (5b) interfaz web; (5c) interfaz Flutter.

---

## Alcance 6 — Completar el perfil personalizable del trabajador

- Objetivo: cerrar el ítem P0 "Completar el perfil personalizable" del Bloque 1: experiencia laboral, certificaciones como metadatos, idiomas, preferencia de turnos y radio/distritos de trabajo, con reglas de visibilidad. Hoy `WorkerTalentProfile` sólo tiene `headline`, `bio`, `district`, `availabilityText`, `availabilityDays`, `availabilityPeriods`, `isAvailable`, `isVisible` y especialidades.
- Criterios de aceptación:
  - El esquema admite los campos/entidades nuevos con su migración. Experiencia laboral y certificaciones deben modelarse como registros relacionados (varias entradas por perfil), no como texto plano.
  - **Certificaciones como metadatos, no como verificación:** una certificación declarada por el trabajador no puede mostrarse como "verificada" en ninguna interfaz. La verificación es un ítem distinto del Bloque 4.
  - El trabajador puede crear, editar, ocultar y recuperar cada sección desde Flutter. Las reglas de visibilidad permiten ocultar secciones concretas, no sólo el perfil entero.
  - DNI, correo, teléfono y notas internas siguen fuera de cualquier resultado público, incluida la tarjeta del directorio. Prueba negativa explícita.
  - La métrica `completion` de `talent.service.ts:300-310` (hoy fija sobre 9 elementos) se actualiza de forma coherente con los campos nuevos, o se declara por qué no cambia. No debe quedar un porcentaje cuya fórmula no corresponda a lo que se muestra.
  - `docs/reference/api.md` y `docs/product/talent-profile-rollout.md` reflejan el contrato nuevo.
- Archivos/módulos probablemente afectados:
  - `apps/api/prisma/schema.prisma` + migración nueva.
  - `apps/api/src/modules/talent/talent.service.ts` (tipos, `toOwnProfile`, `toTalentCard`, `completion`), `talent.routes.ts` (`profileSchema`).
  - `apps/api/tests/talent.routes.test.ts`.
  - `apps/mobile_flutter/lib/features/profile/profile_home_page.dart` (1285 líneas; contiene ya el editor con `district`, días y periodos) y su repositorio de talento.
  - `apps/mobile_flutter/test/`.
  - `docs/reference/api.md`, `docs/product/talent-profile-rollout.md`.
- Validaciones requeridas:
  - `npm.cmd run build --workspace=@cumple-now/api` — exit 0.
  - `npm.cmd run test --workspace=@cumple-now/api` — todas aprobadas.
  - `flutter test` y `flutter analyze` — **requeridas**. Si el SDK local sigue bloqueado (ver `CN-20260912-054`/`055`), este alcance debe apoyarse en el workflow `.github/workflows/flutter-tests.yml` y **no puede declararse cerrado sólo con validación de API**; la falta de validación Flutter se declara como riesgo bloqueante de este alcance en particular, no como riesgo aceptado.
  - Aplicación de la migración sobre PostgreSQL: declarar resultado o `NO_EJECUTADA` con riesgo.
- Riesgos o dependencias:
  - Es el alcance con mayor superficie de migración y el único que depende críticamente del SDK de Flutter. Por eso va al final: si se bloquea, no detiene el resto del Hito A.
  - Debe dividirse casi con seguridad en varias entradas (p. ej. una por bloque de datos: experiencia, certificaciones/idiomas, radio/distritos y visibilidad granular). Preferir cuatro cierres pequeños auditables a uno grande.

---

## Alcance 7 — Infraestructura E2E Playwright para el panel superadmin (diferible)

- Objetivo: cerrar el riesgo residual declarado en `CN-20260915-062`/`063`: no existe fixture de sesión `ADMIN` en `apps/web/e2e/` ni cobertura E2E del panel superadmin, ni para empresas ni para trabajadores. Hoy el único spec es `business-auth.spec.ts` con el fixture `business-api.ts`.
- Criterios de aceptación:
  - Existe un fixture de sesión `ADMIN` equivalente al de `business-api.ts`, reutilizable por varios specs.
  - Existe al menos un spec que cubra el recorrido del panel superadmin: autenticarse como admin, ver la lista de trabajadores, abrir el detalle y ejecutar el borrado con confirmación, verificando que la fila desaparece y que el contador se actualiza.
  - La prueba no depende de datos preexistentes de la estación: crea lo que necesita y lo limpia, siguiendo el guardarraíl ya usado por la suite de integración (opt-in explícito y base con sufijo `_test`, ver `CN-20260912-053`).
  - `apps/web/e2e/README.md` documenta cómo ejecutarlo y qué requiere.
- Archivos/módulos probablemente afectados:
  - `apps/web/e2e/fixtures/` (fixture nuevo), `apps/web/e2e/` (spec nuevo), `apps/web/playwright.config.ts`, `apps/web/e2e/README.md`.
  - Posiblemente `.github/workflows/web-tests.yml` si se integra en CI.
- Validaciones requeridas:
  - Ejecución real del spec nuevo, con su comando y resultado. Si no puede ejecutarse en esta estación (Docker/base no disponibles, como en cierres anteriores), **este alcance no debe cerrarse**: una infraestructura de prueba que nunca se ejecutó no reduce riesgo y no puede declararse como cobertura.
- Riesgos o dependencias:
  - Es infraestructura, no corrección; se difiere a propósito para no retrasar el Hito A.
  - Requiere API y base de datos levantadas, lo que ha sido `NO_EJECUTADA` de forma recurrente en esta estación. Si esa limitación persiste, este alcance debería ejecutarse contra CI y no localmente.

---

## Orden recomendado

1. **Alcance 1** — Endurecimiento de auth (rate limiting + CORS). Es el único P0 continuo del plan maestro y la brecha de seguridad más barata de cerrar. Independiente; primero.
2. **Alcance 2** — Higiene de residuales menores. Barato, cierra deuda declarada en tres auditorías; se hace temprano para que no se arrastre.
3. **Alcance 3** — Verdad del directorio de talento en web. Prerrequisito declarativo del Hito A y de los Alcances 4 y 5; evita tocar la misma sección dos veces.
4. **Alcance 4** — Búsqueda empresarial en el servidor (texto libre + distrito). P0 del Bloque 1.
5. **Alcance 5** — `TalentInvitation` con consentimiento. P0 del Bloque 1 y último elemento sustantivo del Hito A. Dividir en 5a/5b/5c si excede una entrada auditable.
6. **Alcance 6** — Perfil personalizable ampliado. P0 del Bloque 1, el más grande; va al final por su dependencia del SDK de Flutter. Dividir por bloque de datos.
7. **Alcance 7** — E2E Playwright del panel superadmin. Diferible; sólo se cierra si el spec se ejecuta realmente.

Cada alcance (y cada subdivisión de los Alcances 5 y 6) debe registrarse como una entrada `IMPLEMENTACION` independiente en `docs/PROGRESO.md` y auditarse por separado. Los Alcances 1, 2 y 3 son mutuamente independientes y pueden reordenarse entre sí; los Alcances 4 y 5 sí tienen dependencia de orden.
