# Pruebas de interfaz empresarial

Playwright abre Chromium y usa el panel Next.js real. La API se simula en el
navegador con cuentas ficticias, por lo que no necesitas Docker, PostgreSQL,
credenciales ni un servidor API. Estas pruebas verifican la interfaz y su contrato
HTTP; no prueban la autenticación ni la persistencia en una base de datos real.

## Primera ejecución

Desde la raíz del repositorio, con Node.js 22 y npm instalados:

```powershell
npm ci
npm run test:web:install
npm run test:web
```

Los primeros dos comandos preparan las dependencias y Chromium; después basta
con `npm run test:web`. El comando compila el panel para producción, arranca un
servidor temporal en `http://127.0.0.1:3100`, ejecuta las pruebas y lo cierra.
El puerto 3100 debe estar libre. Como se utiliza la carpeta `.next` habitual,
detén el servidor de desarrollo y no ejecutes otro build al mismo tiempo.
Next.js puede regenerar `next-env.d.ts` con rutas de tipos de producción.

## Casos cubiertos

Cada caso se ejecuta en escritorio y en una emulación de tamaño móvil (Pixel 7,
siempre con Chromium; no es una prueba en un teléfono físico):

1. Acceso correcto, carga de la empresa y restauración de sesión al recargar.
2. Credenciales incorrectas, mensaje de error, ausencia de sesión y corrección
   de la contraseña en el mismo formulario.
3. Cierre de sesión, solicitud de revocación, limpieza del almacenamiento y
   permanencia en el acceso tras recargar. En móvil también abre el menú lateral.
4. Paginación del directorio de talento: con “Ver más perfiles” todavía en vuelo
   se cambia el filtro de texto, y al llegar la respuesta obsoleta el botón
   vuelve a estar habilitado para el filtro vigente y los perfiles descartados
   no aparecen en la lista (`talent-load-more.spec.ts`).
5. Invitación de talento: el botón "Invitar" de una tarjeta llama de verdad a
   `POST /api/business/talent-invitations` y solo muestra éxito (botón
   "Invitación enviada", aviso y aparición en "Invitaciones enviadas") tras una
   respuesta `201` real; un duplicado activo (`409 INVITATION_ALREADY_ACTIVE`)
   muestra el mensaje de error explícito sin simular éxito; y una carga en vuelo
   del listado de invitaciones (`GET`, iniciada antes del clic) que resuelve
   *después* del `POST` con una foto anterior a la creación no revierte la
   invitación ya confirmada (`talent-invite.spec.ts`).
6. Aislamiento entre sesiones en la misma pestaña: tras invitar y cerrar sesión,
   al volver a iniciar sesión **sin recargar la página** el panel muestra el
   listado fresco del servidor (sin invitación heredada, sin botón "Invitación
   enviada" y sin estado "Pendiente" residual). Recargar la página ocultaría la
   regresión, por eso la prueba no lo hace (`talent-invite.spec.ts`).

7. Membresía: una empresa con periodo de prueba activo ve "Plan Piloto", su
   vigencia y la tarjeta Piloto marcada como "Actual"; una empresa **sin plan
   activado** (respuesta sintética `INACTIVE` de `GET /api/business/subscription`,
   que trae `plan: 'PILOT'` sin que exista ningún plan vigente) ve "Sin plan
   activado" y "Sin periodo vigente", y no ve ni "Periodo administrado por
   Chambeaya", ni "Piloto activo", ni ninguna tarjeta marcada como "Actual" o
   "Incluido en tu piloto" (`membership.spec.ts`). Tampoco aparece "Plan piloto"
   en la barra lateral (allí se lee "Sin plan activado"), y los botones "Quiero
   conocerlo" de las tres tarjetas avisan que los planes todavía no se activan
   desde el panel en vez de prometer una activación "cuando termine el piloto".
   Con el periodo de prueba activo la barra lateral conserva "Plan piloto" y el
   botón de Empresa Pro conserva el aviso previo; con un plan `PRO` activado la
   barra lateral dice "Empresa Pro" y esa tarjeta es la actual. La respuesta de
   suscripción se cambia por archivo o bloque con `test.use({ subscription: ...
   })` (`inactiveSubscription` y `proSubscription` viven en
   `fixtures/business-api.ts`); el valor por defecto es el periodo de prueba
   activo. No cubierto: el rótulo "Plan sin confirmar" (solo aparece antes de la
   primera respuesta o si la carga falla) y, en el caso `PRO`, el texto
   "Incluido en tu piloto" y el párrafo "El piloto no requiere tarjeta ni
   suscripción", que siguen apareciendo para un plan que no es el piloto
   (defecto de copy preexistente, registrado en `CN-20260918-012`).

8. Cierre manual de asignaciones `NO_SHOW` / `ABANDONED`
   (`assignment-resolution.spec.ts`, 20 casos): en `Turnos` → `Postulaciones` la
   asignación varada muestra "No se presentó a tiempo" o "Sin salida registrada" con
   "Confirmar que sí trabajó" y "Cerrar sin pago". Elegir una acción solo abre una
   confirmación (ninguna llamada a `POST .../resolve` hasta el "Sí, ..."; "Volver"
   tampoco llama). Confirmar el trabajo envía `{ outcome: 'COMPLETED' }`, el copy dice
   que el pago lo hace la empresa directo al trabajador y que Chambeaya no cobra, guarda
   ni transfiere dinero, y tras responder se releen turno, postulaciones y pagos sin
   recargar (el pago pendiente aparece en `Pagos`). Cerrar sin pago envía
   `{ outcome: 'CANCELLED', reason? }` (sin `reason` si no se escribió motivo; un motivo
   de 1-2 caracteres se rechaza en el panel sin llamar a la API) y no genera pago. Cubre
   `NO_SHOW` y `ABANDONED` con ambas acciones; un turno ya `CANCELLED` (aviso "Este turno figura como
   cancelado…" que no promete el resultado y explica los casos: cierre automático por
   vencimiento, que pasa a completado solo cuando todos sus cupos quedan confirmados como
   trabajados, y turno cancelado por la empresa o con algún cupo sin confirmar, que sigue
   cancelado; el pago pendiente se registra en todos; también cuando el listado cargado
   antes lo traía sin cancelar y hay que releerlo; el fixture simula la regla de la API:
   confirmar `COMPLETED` reabre el cierre por vencimiento a `COMPLETED` solo si todos los
   cupos quedan trabajados, y no toca (sigue `CANCELLED`) uno cancelado por la empresa, uno
   con algún cupo sin cerrar ni el cierre sin pago; en un turno de dos cupos el turno sigue
   cancelado y el aviso sigue en la segunda fila tras confirmar la primera, y pasa a
   completado al confirmar la segunda); errores 500 (aviso amable, la confirmación sigue abierta y
   se puede reintentar), 400 `ASSIGNMENT_NOT_RESOLVABLE` y 404 `ASSIGNMENT_NOT_FOUND` (aviso
   sin el código crudo; en el 400 además se refresca la lista); una asignación `ASSIGNED`/`COMPLETED`/
   `CANCELLED` **no** muestra acciones; y un turno de tres cupos donde solo las dos filas
   varadas ofrecen el cierre y resolver una no toca a las otras. Además cubre tres
   comportamientos del refresco: una lectura de postulaciones emitida antes del `POST` y
   entregada después del refresco posterior no repone las acciones ya resueltas (el sondeo
   se secuencia con `lib/request-sequence.ts`; el caso mide el estado sin reintentos
   automáticos porque el siguiente sondeo repararía la pantalla y ocultaría el fallo);
   entre el `POST` y el fin del refresco la confirmación se mantiene en "Guardando…" y
   no reaparecen las acciones de apertura (también en el 400 `ASSIGNMENT_NOT_RESOLVABLE`);
   y los botones de la confirmación ("Sí, confirmar trabajo de X", "Sí, cerrar sin pago la
   asignación de X", "Volver sin cerrar la asignación de X") llevan el nombre del
   trabajador, con el foco inicial en "Volver". Para provocar estas carreras la API con
   estado ofrece `server.holdNext('applications' | 'payments' | 'shift')`, que retiene la
   próxima lectura (con el cuerpo que el servidor leyó al llegar) hasta `release()`. La API con estado vive en
   `fixtures/shift-assignments.ts` (`installShiftAssignmentsApi`, `page.route` sobre el
   fixture base). La contraparte contra API y PostgreSQL reales está en `e2e-real/` (ver
   más abajo).

9. Costo de render del panel (`render-cost.spec.ts`, 3 casos): con la API
   devolviendo exactamente lo mismo, tras dos sondeos completos de postulaciones
   (4 s cada uno) el contador de confirmaciones de render de React no sube ni una
   vez —el panel es un solo componente grande, así que un `setState` con un valor
   nuevo pero idéntico lo volvía a renderizar entero—, y un cambio real en la
   respuesta (`worker.name`) sí aparece en el sondeo siguiente y sí sube el
   contador, de modo que el guardia de `lib/stable-state.ts` no puede esconder
   datos nuevos. El segundo caso vigila el DOM real durante los sondeos con un
   `MutationObserver`: mientras llega un sondeo con cambios y otro sin novedades
   nunca aparecen "Cargando postulaciones…", `aria-busy="true"` en
   `.application-board`, "Actualizando…" en `.application-count` ni una lista sin
   filas, y el nodo de la fila (marcado con `data-probe` antes del cambio) no se
   reemplaza: el estado de carga solo se enciende al abrir el turno, no en cada
   sondeo de 4 s. El tercer caso comprueba que, con el punto de notificaciones
   visible, toda animación de duración infinita del documento anima solo
   `transform` y `opacity` (las que no repintan en cada fotograma) y que
   `cn-notification-pulse` está entre ellas. El contador usa un
   `__REACT_DEVTOOLS_GLOBAL_HOOK__` mínimo instalado con `page.addInitScript`.
   **Los dos primeros casos esperan sondeos reales: tardan unos 18 s por
   proyecto cada uno**, bastante más que el resto. Lo que estos casos **no**
   cubren: un sondeo que *falla* con datos en pantalla sigue vaciando la lista y
   mostrando el error (`app/page.tsx`, `catch` de `refreshApplications`).

10. CV del postulante (`applicant-cv.spec.ts`, 8 casos): en `Turnos` →
    `Postulaciones`, solo la fila cuya API respondió `worker.hasCv: true` muestra
    "Ver CV de <nombre>"; la otra no menciona el CV. El listado no descarga ningún
    CV (ninguna petición a `/cv` antes de pulsar). Al pulsar, la petición lleva
    `Authorization: Bearer <token de la empresa>`, la pestaña nueva queda sin
    `opener` y recibe un `blob:` cuyo contenido y tipo (`application/pdf`) son los
    de la respuesta. Cubre el estado de carga (`aria-busy`/`aria-disabled`, texto
    `role="status"`, foco conservado y clics repetidos que no duplican la
    petición), los mensajes propios de `404 CV_NOT_AVAILABLE`, `401` y fallo de
    red (todos con la pestaña vacía cerrada y posibilidad de reintentar), una
    respuesta que no es PDF (nunca se abre en el origen del panel), el respaldo de
    descarga con las ventanas emergentes bloqueadas (`CV de <nombre>.pdf`), y que
    con un CV en la lista un sondeo sin cambios sigue sin confirmar renders (mismo
    gancho que `render-cost.spec.ts`; este caso también espera sondeos reales y
    tarda). Las reglas de **quién** puede ver un CV no se prueban aquí: viven solo
    en la API (`apps/api/tests/applicant_cv.routes.test.ts` y
    `apps/api/tests/integration/applicant-cv.integration.test.ts`).

Noventa ejecuciones en total (45 casos × escritorio y móvil). Cada una tiene su navegador aislado y su estado de
API propio. Una petición API no prevista, una petición externa o un error
JavaScript sin capturar hacen fallar la prueba. No se permiten reintentos que
oculten fallos.

## Ver las pruebas y entender los fallos

```powershell
# Ver el navegador realizar los pasos (escritorio):
npm run test:web -- --project=chromium-desktop --headed

# Explorador interactivo de pruebas:
npm run test:web:ui

# Abrir el informe HTML de la última ejecución:
npm run test:web:report
```

En el modo interactivo selecciona los proyectos que quieras ejecutar. El informe
identifica la comprobación fallida; si falla una prueba, se conservan captura,
vídeo y traza para inspeccionar las acciones y las solicitudes. Los resultados
quedan en `apps/web/playwright-report/` y `apps/web/test-results/`, ignorados por Git.

`business-auth.spec.ts` describe acciones y resultados con los nombres visibles
de campos y botones. `fixtures/business-api.ts` define las respuestas controladas.
Al agregar un caso, verifica el resultado para el usuario y añade explícitamente
las respuestas necesarias; evita esperas fijas o respuestas genéricas a cualquier
petición.

## Ejecución automática en GitHub

`.github/workflows/web-tests.yml` ejecuta estas pruebas en pushes y pull requests
que afectan al panel, paquetes compartidos o configuración de pruebas. También
permite ejecución manual. Instala Chromium y sus dependencias de Linux, usa el
mismo comando local y guarda el informe durante siete días.

El workflow empezará a ejecutarse cuando estos archivos se suban al repositorio
y GitHub Actions esté habilitado. La suite local general `npm test` también
incluye ahora las pruebas web después de las pruebas de API.

## Suite E2E real del panel (superadmin y empresa; opt-in, requiere PostgreSQL)

Las pruebas anteriores simulan la API en el navegador. La suite
`apps/web/e2e-real/` es distinta a propósito: arranca la **API real** de
Express, **PostgreSQL real** y el **panel Next.js real**, y Playwright
navega contra ese stack completo, sin ningún `page.route`. Cubre el
recorrido de `apps/web/e2e/README.md` que no puede probarse sin backend real:
autenticarse como `ADMIN`, ver la lista de trabajadores, abrir el detalle y
borrar con confirmación, verificando que la fila desaparece y que tanto el
contador de la lista como el del resumen se actualizan.

Un segundo archivo, `assignment-resolution.spec.ts`, cubre el cierre manual de
una asignación `NO_SHOW` desde el panel de la **empresa** (2 casos, solo
escritorio): confirmar que sí trabajó (queda un `Payment` `PENDING` de S/ 120, la
asignación `COMPLETED`, y el pago aparece en `Pagos`) y cerrar sin pago con motivo
(asignación `CANCELLED`, ningún pago, el motivo queda en el `ShiftEvent`, y un
segundo `resolve` responde `400 ASSIGNMENT_NOT_RESOLVABLE`). Como el registro público
rechaza el rol `BUSINESS`, `apps/api/scripts/e2e-serve.ts` siembra también una cuenta
empresa fija (`empresa.e2e@chambeaya.test`, mismos valores en
`e2e-real/fixtures/business-real.ts`). El turno de cada caso se arma por HTTP real:
empieza hace 90 minutos y termina 12 segundos después de crearse; el fixture registra un
trabajador, lo postula y lo acepta, y el caso espera a que el turno venza (con el reloj
real) antes de abrir el panel, de modo que la API detecta el `NO_SHOW` con el turno ya
vencido y lo cierra como `CANCELLED`. Por eso cada caso tarda unos 16 s. **Con ese
turno cerrado, confirmar el trabajo deja la asignación `COMPLETED` con su pago y el
turno `COMPLETED` (ya no `CANCELLED`), con un `ShiftEvent` `UPDATED` de la transición;
cerrar sin pago deja el turno `CANCELLED`.** (Este caso real es de un solo cupo, así que
la confirmación deja todos sus cupos trabajados.) El panel avisa del estado del turno con
el copy que explica todos los casos sin prometer el resultado. (Estas afirmaciones se
ajustaron en `CN-20260920-003` y `CN-20260920-005` y quedaron **verificadas contra el
stack real en `CN-20260920-007`**: `npm run test:web:admin-real` → `3 passed (45.7s)`
sobre la base desechable `chambeaya_test`. Sigue sin cubrirse aquí el turno multi-cupo,
`ABANDONED`, el turno que la empresa canceló con `cancelShift` y luego resuelve, y dos
sesiones simultáneas.)
Solo se cubre `NO_SHOW`: llegar a `ABANDONED` exige un check-in real y esperar 60 minutos
tras `endsAt`, y ningún endpoint permite crear un turno ya vencido ni adelantar el reloj.
Cada caso deja sus filas en la base `_test` (títulos y trabajadores con sufijo aleatorio,
sin colisiones); no limpia.

No es parte de `npm test` ni de `npm run test:web`: requiere una base
PostgreSQL real y accesible, así que queda **fuera** de la suite rápida y del
workflow `web-tests.yml` de este cierre. Se ejecuta a propósito, no por
casualidad: falla con un error explícito (`E2E_REAL_TESTS_REQUIRE_*`, ver
`apps/api/scripts/e2e-serve.ts`) si falta el opt-in o si `DATABASE_URL` no
termina en `_test`, el mismo guardarraíl que ya usa
`apps/api/tests/integration/vertical-marketplace-flow.integration.test.ts`.

### Qué necesita

- Una base PostgreSQL real, vacía o desechable, **con nombre terminado en
  `_test`** (por ejemplo `chambeaya_e2e_test`). Puede ser:
  - Un contenedor Docker (`docker run -e POSTGRES_PASSWORD=... -p 5433:5432 postgres:16-alpine`), si Docker está disponible, o
  - Un clúster PostgreSQL **efímero** creado con `initdb`/`pg_ctl` del propio
    motor nativo (sin Docker), como se hizo para validar esta suite: útil en
    estaciones donde Docker Desktop no tiene motor Linux disponible.
- Los puertos `4400` (API) y `3400` (web) libres, o sobreescribirlos con
  `CHAMBEAYA_E2E_API_PORT` / `CHAMBEAYA_E2E_WEB_PORT`.
- Node.js 22, `npm ci` ya ejecutado y Chromium instalado (`npm run
  test:web:install`).

### Cómo ejecutarla

Desde la raíz del repositorio, con la base `_test` ya creada y accesible:

```powershell
$env:CHAMBEAYA_E2E_DATABASE_URL = "postgresql://usuario:clave@127.0.0.1:PUERTO/chambeaya_e2e_test?schema=public"
npm run test:web:admin-real
```

El primer proyecto de `webServer` (`apps/web/playwright.admin-real.config.ts`)
ejecuta `prisma migrate deploy` contra esa base, siembra directamente por
Prisma dos cuentas fijas —una `ADMIN` (`admin.e2e@chambeaya.test`) y una
`BUSINESS` (`empresa.e2e@chambeaya.test`), ver `apps/api/scripts/e2e-serve.ts`;
el registro público rechaza ambos roles, así que no pueden crearse por HTTP— y
arranca la API real en el puerto
`4400`. El segundo compila el panel con `NEXT_PUBLIC_API_URL` apuntando a esa
API real (los valores `NEXT_PUBLIC_*` de Next.js quedan fijos en el build, por
lo que esta suite necesita su **propio** `next build`, distinto del de
`npm run test:web`) y lo arranca en el puerto `3400`. La propia prueba
registra el trabajador que va a borrar mediante `POST /api/auth/register`
real (rol `WORKER`, sí permitido por registro público); no depende de ningún
dato preexistente de la base y el borrado por la interfaz es, a la vez, la
limpieza de ese registro. `assignment-resolution.spec.ts`, en cambio, **sí deja
filas** (turno, trabajador, postulación y pago) en la base `_test`. Si la base
es un clúster efímero, apagarlo al terminar descarta también las dos cuentas
sembradas y esas filas.

### Estado de esta suite

`CN-20260916-094` documenta la primera ejecución real de esta suite completa
(clúster PostgreSQL 18 efímero por `initdb`, API y panel reales, Playwright
contra el stack real) con su resultado literal. Antes de esa entrada, este
residual (declarado en `CN-20260915-062`/`063`) sólo tenía infraestructura
sin ejecutar. Si vuelve a bloquearse en una estación futura, ver esa entrada
de `docs/PROGRESO.md` para el detalle exacto del bloqueo o del éxito.

## Siguiente cobertura

Publicar turnos y seleccionar postulantes requieren sus propios escenarios en
`apps/web/e2e/`. La suite real de arriba cubre un recorrido del panel
superadmin y el cierre manual de una asignación `NO_SHOW` desde el panel de la
empresa; el resto del panel (publicación de turnos, selección de postulantes,
pagos, y todo el lado trabajador) sigue sin esa cobertura de extremo a extremo
contra PostgreSQL real.
