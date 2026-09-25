# Desarrollo local

Guía única para preparar y ejecutar Chambeaya en desarrollo: API,
PostgreSQL, panel web y aplicación Flutter.

## Requisitos previos

1. Node.js LTS (incluye npm).
2. Docker Desktop instalado y con el motor iniciado.
3. Flutter SDK disponible en `PATH` (solo para la app móvil). **Usa exactamente
   la versión 3.44.0** (stable) — la misma que fijan
   `.github/workflows/flutter-tests.yml` y
   `apps/mobile_flutter/Dockerfile.production`. Un Flutter local distinto
   puede desalinear `apps/mobile_flutter/pubspec.lock` al correr
   `flutter pub get` sin darte cuenta (empaqueta versiones distintas de
   `meta`/`vector_math`/`matcher`/`test_api`), y entonces CI y el build de
   producción fallan con `Unable to satisfy pubspec.yaml using pubspec.lock`.
   Si tu Flutter no es 3.44.0, usa siempre
   `flutter pub get --enforce-lockfile` en vez de `flutter pub get` a secas;
   ver el detalle y cómo instalar 3.44.0 en
   [`apps/mobile_flutter/README.md`](../../apps/mobile_flutter/README.md#versión-de-flutter-requerida-3440-stable).

## 1. Preparar el entorno (una sola vez)

Desde la raíz del repositorio:

```powershell
Copy-Item .env.example .env
npm install
```

## Arranque rápido

```powershell
docker compose up --build
```

Esto construye las imágenes de `api` y `web`, y deja los tres servicios
corriendo con reinicio automático mientras el comando siga activo:

- **API**: `http://127.0.0.1:4000/api` (healthcheck en `/api/health`)
- **Panel web**: `http://127.0.0.1:3000`
- **PostgreSQL**: puerto host `5433` (usuario/clave/base definidos en `.env`)

Prisma aplica las migraciones pendientes automáticamente al iniciar la API.

Si ya tenías el entorno levantado antes del renombrado a Chambeaya, tu `.env`
local sigue apuntando al usuario y la base `cumplenow`, y tus datos siguen en el
volumen `cumplenow-stable-postgres-data`, mientras que `docker-compose.yml`
ahora declara `chambeaya-stable-postgres-data`. El primer `docker compose up`
tras el cambio inicializa un volumen nuevo y vacío: no se pierde nada, pero la
base que verás estará en blanco. Para conservar los datos, respáldalos con
`pg_dump` desde el contenedor antiguo y restáuralos en el nuevo, o vuelve a
sembrar la demo. Alinear `POSTGRES_USER`/`POSTGRES_DB` con la marca nueva solo
funciona sobre un volumen recién creado; sobre uno ya inicializado con el
usuario antiguo provoca fallos de autenticación.

### CV privado y Google Sign-In

El CV se conserva en el volumen privado `chambeaya-private-documents`; no se
publica desde el servidor web ni debe copiarse al repositorio. En producción,
configura una ubicación persistente en `DOCUMENT_STORAGE_ROOT` o sustituye el
adaptador local por almacenamiento de objetos antes de abrir el servicio al
público.

"Privado" significa que el archivo nunca es un recurso estático y que toda
lectura exige una sesión, **no que solo lo vea el trabajador**: desde
`CN-20260921-005` la empresa dueña de un turno puede abrir el CV de quien se
postuló a ese turno, mientras la postulación siga `PENDING`/`ACCEPTED` y el
perfil esté visible (`GET /api/business/shifts/:id/applications/:applicationId/cv`;
la regla vive en `apps/api/src/modules/talent/cv_access.ts` y está descrita en
`docs/reference/api.md`). Para probarlo en local: sube un PDF desde `Perfil` en la
app Flutter del trabajador, postúlate a un turno de la empresa y abre
`Turnos` → `Postulaciones` en el panel web; el botón "Ver CV" solo aparece si la
API devolvió `worker.hasCv: true`. La demo sembrada (`npm run demo:seed`) no crea
ningún CV, así que ese botón no aparece hasta que subas uno. No hay bitácora de
accesos ni análisis antimalware del archivo.

Google permanece inactivo hasta completar `GOOGLE_OAUTH_WEB_CLIENT_ID` en
`.env` y registrar los dominios/redirect URI en Google Cloud. La API expone
`GET /api/auth/providers` para comprobar la activación. El primer ingreso con
Google valida primero nombre y correo verificados; solo para una cuenta nueva
solicita después el DNI y una contraseña exclusiva de Chambeaya, y abre el
perfil laboral para completar CV,
especialidades y disponibilidad.

Para la prueba local, registra ambos orígenes JavaScript:
`http://localhost` y `http://localhost:7357`. Este flujo no usa una URI de
redireccionamiento ni expone el secreto OAuth en Flutter.

Cuando cambie el flujo de Flutter (por ejemplo, se agregue un campo de
contraseña después de Google), detén la ejecución anterior y arráncala de nuevo
para que Chrome cargue el JavaScript actualizado:

```powershell
npm.cmd run dev:mobile -- -Device chrome
```

Un reinicio de la página no reemplaza necesariamente una compilación Flutter
que quedó en ejecución.

Para verificar que responden:

```powershell
curl http://127.0.0.1:4000/api/health
curl http://127.0.0.1:3000
```

### Trabajo diario en terminales separadas

Cuando necesites ver los logs de cada componente por separado, usa tres
terminales desde la raíz del repositorio:

```powershell
docker compose up --build db api
docker compose up --build web
npm run dev:mobile -- -Device chrome
```

La API queda disponible en `http://127.0.0.1:4000/api/health`; el panel de
empresa en `http://127.0.0.1:3000` y el de superadministración en
`http://127.0.0.1:3000/admin`. Las direcciones `172.x.x.x` que muestra Docker
son internas y no deben abrirse desde Windows.

## Cuentas locales y reinicio de credenciales

Levantar los contenedores no crea cuentas automaticamente. Las cuentas se
guardan en PostgreSQL; por eso una base nueva responde al healthcheck pero
rechaza cualquier inicio de sesion hasta que se preparen los datos de demo.

Con la API de Docker ya en ejecucion, ejecuta una vez:

```powershell
npm run demo:seed
```

El comando solo se permite en desarrollo y restablece las tres cuentas de
demo. Tambien invalida sus sesiones existentes y repone los turnos de la demo;
no debe usarse en produccion.

| Interfaz | URL | Correo | Contrasena |
|---|---|---|---|
| Superadmin | `http://127.0.0.1:3000/admin` | `superadmin@chambeaya.local` | `Admin2026!` |
| Empresa | `http://127.0.0.1:3000` | `empresa.demo@chambeaya.local` | `Demo2026!` |
| Trabajador | `http://127.0.0.1:7357` | `trabajador.demo@chambeaya.local` | `Demo2026!` |

La cuenta de empresa debe entrar en el panel web y la de trabajador en Flutter.
No son intercambiables: cada panel verifica el rol de la sesion.

El unico registro publico es el de trabajador. Para crear una empresa, primero
entra como superadmin y usa **Nueva empresa**; el endpoint publico devolvera
`BUSINESS_REGISTRATION_DISABLED` por diseno. Las cuentas superadmin se
provisionan mediante la semilla local, no desde la pantalla de registro.

Si se mantiene una sesion vencida en el navegador, cierra sesion o borra los
datos del sitio para `127.0.0.1:3000` antes de reintentar. Flutter valida la
sesion al abrirse y la descarta si ya no es valida.

Para detener los contenedores:

```powershell
docker compose down
```

### Alternativa sin Docker (solo API o solo web)

```powershell
$env:DATABASE_URL = 'postgresql://chambeaya:chambeaya_dev@127.0.0.1:5433/chambeaya?schema=public'
npm exec --workspace=@chambeaya/api -- prisma migrate deploy
npm run dev:api   # API en modo watch (tsx), requiere PostgreSQL accesible
npm run dev:web   # Next.js en modo desarrollo
```

Al ejecutar la API fuera de Docker, usa `127.0.0.1` para PostgreSQL: el host
`db` del archivo `.env` solo existe dentro de la red de Docker. Para preparar
las cuentas en este modo, con la API detenida o encendida, ejecuta:

```powershell
$env:NODE_ENV = 'development'
$env:CHAMBEAYA_ALLOW_DEMO_SEED = 'true'
npm run demo:seed --workspace=@chambeaya/api
```

## Aplicación Flutter (fuera de Docker)

La app Flutter siempre se ejecuta desde el equipo anfitrión, nunca dentro de
Docker.

Con la API local levantada en el paso 2:

```powershell
npm run dev:mobile
```

Para datos demo aislados en memoria (no requiere Docker ni API):

```powershell
npm run dev:mobile -- -Demo
```

Abre después `http://localhost:7357` y usa la cuenta de trabajador de la
tabla. La ejecución normal comprueba credenciales contra la API; usa `-Demo`
únicamente para una presentación aislada.

El lanzador usa `web-server` en el puerto `7357` para evitar ventanas de
Chrome en blanco. Abre `http://127.0.0.1:7357`. Para usar Chrome administrado
por Flutter en su lugar:

```powershell
npm run dev:mobile -- -Device chrome
```

### Variantes por dispositivo

- **Emulador Android**, la API corre en el host, así que se referencia con la
  IP especial del emulador:

  ```powershell
  flutter run -d <ID_DEL_EMULADOR> --dart-define=API_BASE_URL=http://10.0.2.2:4000/api
  ```

- **Teléfono físico** en la misma red Wi-Fi que la laptop, usando la IP local
  de esta:

  ```powershell
  flutter run -d <ID_DEL_TELEFONO> --dart-define=API_BASE_URL=http://192.168.X.X:4000/api
  ```

### Teléfono Android conectado por USB

Esta alternativa evita depender de la IP Wi-Fi. Activa **Opciones de
desarrollador** y **Depuración USB**, conecta el teléfono y acepta la huella
RSA. Luego:

```powershell
C:\flutter\bin\flutter.bat devices
adb reverse tcp:4000 tcp:4000
cd apps\mobile_flutter
C:\flutter\bin\flutter.bat run -d <ID_DEL_CELULAR> "--dart-define=API_BASE_URL=http://127.0.0.1:4000/api"
```

Reemplaza `<ID_DEL_CELULAR>` por el identificador de `flutter devices`. Gracias
a `adb reverse`, `127.0.0.1:4000` apunta a la API del equipo anfitrión.

## Resumen de puertos

| Servicio          | URL                              |
|-------------------|-----------------------------------|
| API               | http://127.0.0.1:4000/api        |
| Panel web         | http://127.0.0.1:3000            |
| PostgreSQL (host) | 127.0.0.1:5433                   |
| App Flutter (web) | http://localhost:7357            |

## Referencias

- [Índice de documentación](../README.md)
- Guía de presentación de la demo: [client-demo.md](client-demo.md)
- Despliegue en hosting/VPS: [deployment.md](deployment.md)
- Pruebas end-to-end del panel web: [../../apps/web/e2e/README.md](../../apps/web/e2e/README.md)
- README de la app Flutter: [../../apps/mobile_flutter/README.md](../../apps/mobile_flutter/README.md)
