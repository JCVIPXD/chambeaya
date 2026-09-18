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

Veintiocho ejecuciones en total. Cada una tiene su navegador aislado y su estado de
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

## Suite E2E real del panel superadmin (opt-in, requiere PostgreSQL)

Las pruebas anteriores simulan la API en el navegador. La suite
`apps/web/e2e-real/` es distinta a propósito: arranca la **API real** de
Express, **PostgreSQL real** y el **panel Next.js real**, y Playwright
navega contra ese stack completo, sin ningún `page.route`. Cubre el
recorrido de `apps/web/e2e/README.md` que no puede probarse sin backend real:
autenticarse como `ADMIN`, ver la lista de trabajadores, abrir el detalle y
borrar con confirmación, verificando que la fila desaparece y que tanto el
contador de la lista como el del resumen se actualizan.

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
Prisma una única cuenta `ADMIN` fija (`admin.e2e@chambeaya.test`, ver
`apps/api/scripts/e2e-serve.ts`; el registro público rechaza el rol `ADMIN`,
así que no puede crearse por HTTP) y arranca la API real en el puerto
`4400`. El segundo compila el panel con `NEXT_PUBLIC_API_URL` apuntando a esa
API real (los valores `NEXT_PUBLIC_*` de Next.js quedan fijos en el build, por
lo que esta suite necesita su **propio** `next build`, distinto del de
`npm run test:web`) y lo arranca en el puerto `3400`. La propia prueba
registra el trabajador que va a borrar mediante `POST /api/auth/register`
real (rol `WORKER`, sí permitido por registro público); no depende de ningún
dato preexistente de la base y el borrado por la interfaz es, a la vez, la
limpieza de ese registro. Si la base es un clúster efímero, apagarlo al
terminar descarta también la cuenta `ADMIN` sembrada.

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
superadmin; el resto del panel (empresa, trabajador) sigue sin esa
cobertura de extremo a extremo contra PostgreSQL real.
