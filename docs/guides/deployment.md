# Despliegue en hosting con Docker

El despliegue de producción usa `docker-compose.production.yml` y no modifica el
flujo de desarrollo. Está pensado para un servidor propio (Ubuntu) o un VPS
que permita Docker Engine y Docker Compose v2, incluyendo uno donde ya corre
un Nginx del sistema atendiendo otros proyectos en los puertos 80/443.

> **Requisito del `package-lock.json`.** La imagen de la API depende de que
> `prisma` y `@prisma/client` estén elevados a la raíz del monorepo
> (`node_modules/prisma` y `node_modules/@prisma/client` en el lockfile): la
> etapa `build` ejecuta `npx prisma generate` con `WORKDIR /workspace` y la
> etapa `runtime` copia únicamente `/workspace/node_modules`. Hasta
> `CN-20260923-004` el lockfile los tenía anidados bajo
> `apps/api/node_modules/…`, y la imagen no se construía (`sh: prisma: not
> found`, código 127); quedó corregido y verificado con un `docker build` real
> (ver esa entrada en [PROGRESO](../PROGRESO.md)). Si al regenerar el lockfile
> alguna vez reaparece `apps/api/node_modules/prisma`, revierte ese cambio:
> `grep -n '"apps/api/node_modules' package-lock.json` debe devolver vacío.

## Un solo dominio, tres rutas

Chambeaya se publica bajo **un único dominio** con tres rutas
(`CN-20260925-006`; antes eran 3 subdominios):

| Ruta pública | Servicio | Detalle |
| --- | --- | --- |
| `https://tudominio.com/` | `worker-app` | App del trabajador (Flutter web); se queda en la raíz, base href `/` sin cambios. |
| `https://tudominio.com/empresas` | `web` | Panel de empresas (Next.js) con `basePath=/empresas`; el superadmin queda en `/empresas/admin`. |
| `https://tudominio.com/api` | `api` | API (Express); ya cuelga de `/api` en `apps/api/src/app.ts`, así que el Nginx del host nunca recorta ese prefijo. |

`docker-compose.production.yml` levanta 4 servicios:

- `db` (PostgreSQL, volumen `chambeaya-production-db`). No publica ningún
  puerto: solo lo alcanzan los demás contenedores por la red interna de
  Compose.
- `api` (Express + Prisma, corre `prisma migrate deploy` al arrancar).
- `web` (panel de empresas en Next.js, compilado con `NEXT_BASE_PATH=/empresas`).
- `worker-app` (la app del trabajador Flutter, compilada como `flutter build
  web --release` y servida por un Nginx interno del propio contenedor; ver
  `apps/mobile_flutter/Dockerfile.production`).

`api`, `web` y `worker-app` publican sus puertos **solo en `127.0.0.1`**:
Docker publica puertos saltándose `ufw` (el firewall del host), así que sin
`127.0.0.1:` delante quedarían accesibles desde Internet sin TLS y sin pasar
por el proxy inverso. El Nginx del sistema (fuera de Docker) es la única
puerta de entrada pública y hace `proxy_pass` hacia esos tres puertos de
loopback, cada uno bajo su ruta.

No renombres los volúmenes `chambeaya-production-db` ni
`chambeaya-production-private-documents` en un despliegue con datos: un
nombre distinto crea un volumen vacío y deja el anterior huérfano con los
datos reales.

## Primera instalación

```bash
git clone <url-del-repositorio> chambeaya && cd chambeaya
sudo ./scripts/instalar-produccion.sh
```

El instalador es idempotente y hace todo esto en un solo paso:

1. Comprueba que Docker Engine y Docker Compose v2 estén instalados.
2. Pide el dominio público único — de forma interactiva o por flag:

   ```bash
   sudo ./scripts/instalar-produccion.sh --domain tudominio.com --certbot
   ```

   Se normaliza (acepta que lo pegues con `http(s)://` y barra final) y se
   valida como nombre de host antes de escribir nada; si es inválido, el
   instalador se detiene sin tocar el disco.

3. Antes de tocar Nginx, revisa `nginx -T` (la configuración ya combinada)
   en busca de otro sitio del servidor que ya use ese dominio como
   `server_name`; si lo encuentra, aborta con un mensaje claro **sin escribir
   nada, ni la config de Nginx ni `.env.production`, en ese orden**, porque
   `nginx -t` por sí solo solo avisa (`conflicting server name ... ignored`)
   y dejaría que Chambeaya le robe el tráfico a ese otro sitio.

4. Pide el Client ID de Google OAuth (`GOOGLE_OAUTH_WEB_CLIENT_ID`, termina en
   `.apps.googleusercontent.com`) — de forma interactiva (solo si va a crear
   un `.env.production` nuevo) o por flag:

   ```bash
   sudo ./scripts/instalar-produccion.sh --domain tudominio.com --google-client-id 123456789-abc.apps.googleusercontent.com
   ```

   Puede dejarse vacío: sin él, "Ingresar con Google" queda desactivado (sin
   fallar) tanto en la app del trabajador como en el panel, y el resumen
   final del instalador lo dice explícitamente ("Login con Google:
   ACTIVO"/"DESACTIVADO"). Ver [DNS y Google
   Sign-In](#dns-y-google-sign-in) más abajo para el detalle de por qué
   cambiarlo exige reconstruir.

5. Si no existe `.env.production`, lo genera con una contraseña de
   PostgreSQL aleatoria de 32 caracteres alfanuméricos, `DATABASE_URL`
   derivada de ella, las tres URLs públicas sobre el mismo dominio
   (`NEXT_PUBLIC_API_URL`, `API_BASE_URL`, `NEXT_BASE_PATH=/empresas`),
   `CORS_ALLOWED_ORIGINS` con ese mismo dominio, `API_TRUST_PROXY=1` (un
   salto: el Nginx del host — **nunca** `true`, que dejaría falsificar la IP
   de origen con `X-Forwarded-For` y saltarse el límite de intentos de
   `/api/auth`), `GOOGLE_OAUTH_WEB_CLIENT_ID` con lo que se haya resuelto en
   el paso anterior, y elige automáticamente 3 puertos libres en
   `127.0.0.1` (empieza a buscar en 4100/3100/8100). Deja el archivo a
   nombre del usuario real (no de `root`, aunque se ejecute con `sudo`) con
   permisos `600`, para que actualizar después no necesite sudo (ver más
   abajo).

   **Si `.env.production` ya existe, el instalador nunca regenera la
   contraseña ni los puertos** (ver más abajo por qué), y tampoco cambia
   `API_TRUST_PROXY` si ya tiene un valor (solo avisa si sigue en `true`).
   Solo añade las variables nuevas que falten (por ejemplo, al actualizar una
   instalación anterior a que existiera `worker-app` o `NEXT_BASE_PATH`).
   Tampoco reescribe nunca `NEXT_PUBLIC_API_URL`/`API_BASE_URL`/
   `CORS_ALLOWED_ORIGINS` si el `--domain` de esta corrida no coincide con
   el que ya tienen: **aborta sin tocar nada** (ni `.env.production` ni
   Nginx), porque la API, el panel y la app ya están compilados con el
   dominio anterior y regenerar Nginx con el nuevo dejaría el sitio
   anterior sin responder. Para mover Chambeaya a un dominio nuevo de
   verdad, repite con `--change-domain`: actualiza esas 3 variables de
   forma coherente, regenera Nginx y reconstruye los servicios (falta
   pedir un certificado TLS nuevo para el dominio nuevo). Si el sitio de
   Nginx ya tiene bloques de Certbot (el caso normal en producción),
   `--change-domain` **exige además `--force-nginx`**: sin él, el script
   aborta antes de tocar nada (junto con el resto de las validaciones
   previas, como el propio dominio o los choques de `server_name`), porque
   sin `--force-nginx` el paso 6 de abajo no reemplazaría ese sitio (para no
   perder el certificado) y Nginx seguiría sirviendo el dominio anterior
   mientras `.env.production` y los servicios reconstruidos ya apuntarían al
   nuevo. Para mover de verdad un dominio con Certbot ya instalado:
   `--change-domain --force-nginx` (hace copia de seguridad del sitio
   anterior) y después `sudo certbot --nginx -d <dominio nuevo>`.
   Ningún camino de `--change-domain` termina con `.env.production` y
   Nginx apuntando a dominios distintos: dos defensas independientes lo
   garantizan (`CN-20260926-004`).
   - **Transaccional:** antes de tocar `.env.production` (si ya existía),
     el instalador guarda una copia de seguridad en un archivo temporal. Si
     después falla la sección de Nginx —`nginx -t`, el `reload`, la propia
     escritura del sitio (disco lleno) o una interrupción— se restaura esa
     copia además del sitio de Nginx: la corrida entera queda exactamente
     como estaba antes de ejecutarla, no solo Nginx. Un reintento después
     de un fallo así ve otra vez el dominio anterior en ambos lados, como
     si nada hubiera pasado.
   - **Invariante final, justo antes de construir y levantar los
     servicios:** si el instalador gestiona un sitio de Nginx del host
     (existe `chambeaya.conf` instalado, por él o por una corrida
     anterior), compara su `server_name` con el dominio que quedó en
     `.env.production` — también cuando la sección de arriba decidió NO
     tocar Nginx por los bloques de Certbot. Si no coinciden, aborta ahí
     mismo, sin reconstruir ni levantar nada, con un mensaje que nombra
     ambos dominios y cómo resolverlo: repetir con
     `--change-domain --force-nginx` para mover Nginx al dominio del
     `.env`, o editar `NEXT_PUBLIC_API_URL`/`API_BASE_URL`/
     `CORS_ALLOWED_ORIGINS` de vuelta al dominio que Nginx todavía sirve.
     Esta segunda defensa cubre cualquier desalineación entre
     `.env.production` y Nginx que llegue al instalador, sea por la causa
     que sea (incluida una edición manual), no solo la que arregla la copia
     de seguridad transaccional.
   - **Límites conocidos (`CN-20260926-006`, BAJO-1 y BAJO-2):**
     - Hay casos en que `.env.production` queda con el dominio nuevo sin
       restaurarse: si `--change-domain` se ejecuta **sin `sudo`** en un
       servidor con Nginx, o si falla la copia de seguridad del sitio (por
       ejemplo, disco lleno). El invariante aborta el instalador, pero
       `./scripts/deploy-hosting.sh` **no** hace esa comprobación y
       desplegaría igual. Ante ese mensaje de error, corrige primero el
       `.env` o repite con `sudo ... --change-domain --force-nginx`; no
       ejecutes `deploy-hosting.sh` mientras tanto.
     - El invariante compara solo el **primer** nombre de `server_name`.
       Si añades a mano otros nombres, deja el dominio de Chambeaya en
       primer lugar (`server_name tudominio.com www.tudominio.com;`).
     - Escribe siempre `--domain` en minúsculas: se compara tal cual con el
       dominio del `.env`.

   `GOOGLE_OAUTH_WEB_CLIENT_ID` sigue una regla distinta: es una credencial
   externa reconfigurable (no un secreto generado aquí), así que si pasas
   `--google-client-id` sobre un `.env.production` existente, **sí** se
   actualiza esa única variable (mostrando el valor anterior y el nuevo), y
   el paso 8 de abajo reconstruye `worker-app` con el valor nuevo. Sin el
   flag, un valor vacío solo se avisa, nunca se toca a ciegas.

   Si detecta un `.env.production` del esquema anterior de 3 subdominios
   (sin `NEXT_BASE_PATH` y con más de un origen en `CORS_ALLOWED_ORIGINS`),
   **no lo migra solo**: explica los pasos manuales (elegir el dominio
   único, editar las URLs, pedir un certificado nuevo) y se detiene. Nadie
   llegó a desplegar así en producción real, pero el instalador lo detecta
   por si alguien lo probó.

6. Genera la configuración de Nginx del host a partir de
   `deploy/nginx/chambeaya.conf.template` (un solo bloque `server` con
   `server_name <dominio>` y las 3 rutas de la tabla de arriba). El bloque
   raíz incluye `client_max_body_size 8m` (la app sube CV en PDF hasta 5 MB y
   foto de perfil hasta 3 MB; el default de Nginx, 1 MB, rompería esas
   subidas), cabeceras `Host`/`X-Real-IP`/`X-Forwarded-For`/`X-Forwarded-Proto`
   comunes a las 3 rutas, y una ubicación específica para
   `GET /api/shifts/events` (`proxy_buffering off`, `proxy_read_timeout 1h`)
   porque ese endpoint mantiene abierta una conexión de eventos en tiempo
   real (Server-Sent Events) que Nginx cortaría o retendría en búfer con la
   configuración por defecto. `/api` sin barra final redirige a `/api/`;
   `/empresas` sin barra va directo al panel (y `/empresas/` lo redirige el
   propio Next.js a `/empresas`). Una ruta que solo
   empiece igual (`/empresasX`) nunca cae por error en el panel: sigue de
   largo hasta la app del trabajador, el fallback de `/`.

   Si detecta Nginx en el host (el binario y `sites-available`/`conf.d`) y
   corre como root:
   - Si el sitio instalado ya es idéntico al que generaría ahora, no lo toca.
   - Si el archivo instalado ya tiene bloques de Certbot (HTTPS) y es
     distinto al que generaría ahora, **no lo sobrescribe** por defecto
     (perdería esos certificados); deja la versión nueva en
     `deploy/nginx/chambeaya.conf.generado` para comparar y solo la instala
     si repites con `--force-nginx` (haciendo antes una copia de seguridad
     con marca de tiempo, `chambeaya.conf.bak.<fecha>`).
   - En cualquier otro caso, hace la copia de seguridad, instala el archivo,
     valida con `nginx -t` y solo si pasa recarga con `systemctl reload
     nginx`. Si `nginx -t` falla, o el `reload` falla, o la instalación se
     interrumpe (Ctrl+C), **restaura exactamente el archivo y el symlink al
     estado anterior** y no recarga Nginx: los demás proyectos que ese Nginx
     atiende no se ven afectados, y nunca queda un symlink apuntando a nada
     en `sites-enabled`.

   Si no corre como root, deja el archivo generado en
   `deploy/nginx/chambeaya.conf.generado` y explica cómo instalarlo a mano.
7. Si hay `certbot` instalado, pide el certificado TLS del dominio único
   (con `--certbot` no pregunta; sin él, pregunta o, en modo no interactivo,
   deja el comando exacto para ejecutarlo después).
8. Llama a `scripts/deploy-hosting.sh` para construir y levantar los 4
   servicios (esto reconstruye `worker-app` si `GOOGLE_OAUTH_WEB_CLIENT_ID`
   cambió en el paso 5), y muestra un resumen con las 3 URLs, los puertos
   elegidos, el estado del login con Google y los pasos pendientes (DNS,
   autorizar el origen en Google Cloud).
9. Con los 3 servicios ya sanos, comprueba si existe algún superadmin (rol
   `ADMIN`). Si no existe ninguno, crea el primero: pide el correo (de forma
   interactiva, o por `--admin-email` en modo no interactivo; con `-y` nunca
   pregunta, ni siquiera en una terminal interactiva) y muestra su
   contraseña generada **una sola vez** por stdout (ver
   [Primer acceso](#primer-acceso) más abajo). Si ya existe un superadmin, lo
   informa y no toca nada — ni en esta ejecución ni en ninguna posterior. Un
   fallo en este paso (por ejemplo, sin `--admin-email` en modo no
   interactivo, o con `-y` y sin `--admin-email`) **nunca** deshace el
   despliegue de los servicios ni toca Nginx: solo explica cómo reintentar
   con `scripts/crear-superadmin.sh`.

## Primer acceso

La base de datos arranca **vacía**. Sin un superadmin no hay forma de crear
empresas, porque:

- El registro público (`POST /api/auth/register`) solo acepta `role: "WORKER"`;
  cualquier otro rol responde `403 BUSINESS_REGISTRATION_DISABLED`
  (`apps/api/src/modules/auth/auth.routes.ts`).
- Las empresas las crea el propio superadmin desde el panel
  (`POST /api/admin/companies`, `apps/api/src/modules/admin/admin.routes.ts`),
  al que solo puede entrar una cuenta con rol `ADMIN`.
- El seed de demostración (`apps/api/src/demo/demo.seed.ts`) sigue bloqueado
  fuera de `NODE_ENV=development` y exige además
  `CHAMBEAYA_ALLOW_DEMO_SEED=true`: nunca se ejecuta en producción, ni por
  accidente.

El orden real de una instancia nueva es:

1. **El instalador crea el primer superadmin** al final de
   `scripts/instalar-produccion.sh` (paso 8 de la lista de arriba), o tú lo
   creas después con:

   ```bash
   ./scripts/crear-superadmin.sh --email tucorreo@empresa.com
   ```

   En ambos casos, la contraseña se genera dentro del contenedor `api`
   (`apps/api/src/cli/superadmin.ts`, compilado a
   `dist/src/cli/superadmin.js`) y se imprime **una sola vez** por stdout: no
   queda escrita en ningún archivo ni log, y el comando nunca la acepta como
   argumento de línea de comandos ni la pide por stdin. Cópiala de la
   terminal en ese momento; si la pierdes, no hay forma de recuperarla, solo
   de generar una nueva (ver más abajo).

2. **El superadmin entra a `https://<tu dominio>/empresas/admin`** con ese
   correo y esa contraseña, y desde ahí crea cada empresa (nombre, RUC,
   correo y contraseña de la empresa). **Recomendado: cambia esa contraseña
   generada justo después de este primer ingreso**, con el botón "Cambiar
   contraseña" de la barra superior del panel (`POST /api/auth/password/change`,
   ver [la referencia de la API](../reference/api.md#cambiar-contraseña));
   al guardar se cierran además todas las demás sesiones abiertas con ese
   superadmin. Si en vez de cambiarla necesitas una nueva porque la
   perdiste, usa el modo `--reset` de abajo.
3. **Cada empresa entra a `https://<tu dominio>/empresas`** (sin `/admin`)
   con el correo y la contraseña que el superadmin eligió al crearla, y
   publica sus turnos. Puede cambiar esa contraseña de la misma forma, con
   "Cambiar contraseña" junto a "Cerrar sesión" en la barra lateral.
4. **Los trabajadores se registran solos** en `https://<tu dominio>/` (la app
   Flutter), con su nombre, correo, DNI y contraseña — o con Google, si está
   configurado. No necesitan que nadie los invite ni los cree.

### Crear otro superadmin, o recuperar el acceso

`scripts/crear-superadmin.sh` requiere que el contenedor `api` del proyecto
`chambeaya-production` ya esté levantado (`scripts/deploy-hosting.sh`):

```bash
# Crear un superadmin adicional (falla si ese correo ya existe).
./scripts/crear-superadmin.sh --email otro-correo@empresa.com

# Olvidaste la contraseña de un superadmin existente: genera una nueva e
# invalida todas sus sesiones activas. Falla si el correo no existe o no
# pertenece a una cuenta ADMIN (nunca convierte a otra en superadmin).
./scripts/crear-superadmin.sh --email tucorreo@empresa.com --reset
```

Por debajo, ambos invocan el mismo comando dentro del contenedor:

```bash
docker compose -p chambeaya-production -f docker-compose.production.yml \
  exec -T api node dist/src/cli/superadmin.js create --email <correo>
docker compose -p chambeaya-production -f docker-compose.production.yml \
  exec -T api node dist/src/cli/superadmin.js reset --email <correo>
```

(El instalador usa además `... create --email <correo> --if-none` y
`... status`, para no crear un segundo superadmin ni cambiar la contraseña
del que ya exista en ejecuciones posteriores. `--if-none` comprueba y crea
en dos pasos separados, sin bloqueo: si dos ejecuciones corren **a la vez**,
por ejemplo el instalador en dos sesiones SSH, cada una puede crear su propio
superadmin. Cada contraseña se muestra solo en la terminal que la generó.
No ejecutes el instalador ni `crear-superadmin.sh` en paralelo.)

### Por qué nunca se regenera `POSTGRES_PASSWORD` ni los puertos

PostgreSQL solo aplica `POSTGRES_PASSWORD` la primera vez que inicializa el
volumen de datos; una ejecución posterior con una contraseña distinta en
`DATABASE_URL` deja la API sin poder conectarse (Prisma `P1000`) aunque el
contenedor de `db` esté sano. Por eso, si `.env.production` ya existe, el
instalador lo reutiliza tal cual y solo añade variables nuevas que falten,
nunca reemplaza las existentes.

### DNS y Google Sign-In

Antes de que el dominio responda, crea **un solo** registro DNS tipo A hacia
la IP pública del servidor. Si usas Google Sign-In en la app del trabajador o
en el panel, autoriza el origen `https://<tu dominio>` en la consola de
Google Cloud (un solo origen: panel, app y API comparten dominio); sin esa
autorización, el botón de Google fallará aunque `GOOGLE_OAUTH_WEB_CLIENT_ID`
esté configurado.

`GOOGLE_OAUTH_WEB_CLIENT_ID` es a la vez un build-arg de `worker-app`
(`docker-compose.production.yml`, `apps/mobile_flutter/Dockerfile.production`)
y una variable de entorno que lee la API en runtime (`google_identity.ts`):
**cambiarlo siempre exige reconstruir** `worker-app`. Antes de esta guardia,
una reinstalación con `.env.production` regenerado sin ese valor apagaba el
botón de Google en silencio; ahora:

- `scripts/instalar-produccion.sh` lo pide de forma interactiva al crear un
  `.env.production` nuevo, o lo toma de `--google-client-id`; puede quedar
  vacío (login con Google desactivado, sin fallar) y el resumen final del
  instalador siempre muestra "Login con Google: ACTIVO" o "DESACTIVADO
  (falta GOOGLE_OAUTH_WEB_CLIENT_ID)". Sobre un `.env.production` ya
  existente, solo se actualiza si repites con `--google-client-id`
  explícito (nunca a partir de lo que hayas tecleado sin ese flag); sin él,
  si sigue vacío, solo avisa.
- `scripts/deploy-hosting.sh` (el camino habitual de actualización) también
  avisa, en cada ejecución, si `GOOGLE_OAUTH_WEB_CLIENT_ID` sigue vacío en
  `.env.production`.
- Para activarlo o cambiarlo en una instalación ya hecha: edita
  `GOOGLE_OAUTH_WEB_CLIENT_ID` en `.env.production` (o pásalo con
  `--google-client-id` al reinstalador) y ejecuta
  `./scripts/deploy-hosting.sh` para reconstruir `worker-app`; luego
  autoriza el origen en Google Cloud como se explicó arriba.

### El panel Next.js bajo `/empresas` (`NEXT_BASE_PATH`)

El panel se compila con `basePath` (`apps/web/next.config.ts`, controlado por
la variable de entorno `NEXT_BASE_PATH`) para servirse bajo `/empresas` en
vez de la raíz. Esto:

- En producción debe ser exactamente `/empresas`: la plantilla de Nginx y el
  instalador solo enrutan esa ruta, y `scripts/deploy-hosting.sh` rechaza
  cualquier otro valor.
- Se fija **en compilación**: cambiar `NEXT_BASE_PATH` exige reconstruir la
  imagen `web` (`./scripts/deploy-hosting.sh` ya lo hace en cada ejecución
  sin `--no-build`), y también debe llegar como variable de entorno al
  contenedor en tiempo de ejecución, porque `next start` vuelve a leer
  `next.config.ts` al arrancar.
- No afecta al desarrollo local: `npm run dev`, `docker-compose.yml` (dev) y
  las suites de Playwright (`apps/web/e2e`, `apps/web/e2e-real`) nunca
  definen `NEXT_BASE_PATH`, así que el panel sigue en la raíz exactamente
  como antes.
- El panel no tiene enlaces absolutos, `window.location`, imágenes ni
  archivos en `public/` que basePath no corrija automáticamente (se revisó
  el código completo de `apps/web/app`, `apps/web/lib`, `apps/web/components`
  y `apps/web/features`): las llamadas a la API usan
  `NEXT_PUBLIC_API_URL`, una URL absoluta con su propio dominio, ajena al
  basePath del panel.
- El superadmin queda automáticamente en `/empresas/admin` (la ruta interna
  sigue siendo `app/admin/page.tsx`; Next antepone el basePath solo).

### CORS, límite de intentos y proxy inverso

`docker-compose.production.yml` reenvía al contenedor `api` las variables que
declara `.env.production`: `CORS_ALLOWED_ORIGINS`, `API_TRUST_PROXY`,
`AUTH_RATE_LIMIT_WINDOW_MS` y `AUTH_RATE_LIMIT_MAX`. `--env-file` por sí solo
solo interpola el YAML; sin esta reexportación explícita en el bloque
`environment:` del servicio, esas variables nunca llegarían al proceso Node
aunque estén bien configuradas en `.env.production`.

- `CORS_ALLOWED_ORIGINS` (obligatoria para `scripts/deploy-hosting.sh`): con
  panel, app y API bajo el mismo dominio, es un solo origen
  (`https://tudominio.com`). Como el panel y la app llaman a la API desde su
  mismo origen, el navegador no aplica CORS a esas llamadas; la variable
  controla qué **otros** orígenes podrían llamar a la API desde un
  navegador. Si llegara vacía al contenedor, la API no autorizaría ningún
  origen externo (`origin: false`), pero el panel y la app en el mismo
  dominio seguirían funcionando. `scripts/deploy-hosting.sh` rechaza el
  despliegue si falta o si conserva el valor de ejemplo (`tudominio.com`).
- `API_TRUST_PROXY`: el instalador la deja en `1` (un salto de proxy: el
  Nginx del host de este flujo). Sin ella, Express no confía en
  `X-Forwarded-For` y todas las solicitudes que pasan por el proxy comparten
  una sola IP a efectos del límite de intentos de `/api/auth`, lo que puede
  bloquear a todos los usuarios del piloto tras alcanzar el cupo. **Nunca
  uses `API_TRUST_PROXY=true`**: eso hace que Express confíe en todo el
  contenido de `X-Forwarded-For`, que controla el propio cliente, así que
  cualquiera podría falsificar su IP con esa cabecera para saltarse el
  límite de intentos de login por completo. Tanto `instalar-produccion.sh`
  como `deploy-hosting.sh` avisan (sin cambiarla) si encuentran
  `API_TRUST_PROXY=true` en `.env.production`, para que este riesgo se note
  también en cada actualización, no solo en la instalación inicial.
- `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX`: ventana y máximo de
  intentos por IP para `POST /api/auth/login`, `/register`, `/google`,
  `/google/complete` y `/password`. Por defecto 900000 ms (15 minutos) y 20
  intentos; ajústalos si el cupo por defecto resulta demasiado bajo para el
  tráfico agregado detrás del proxy.
- `API_BASE_URL`: la URL pública de la API, pero compilada **dentro** del
  binario de `worker-app` (build-arg de `apps/mobile_flutter/Dockerfile.production`,
  no una variable que la app lea en tiempo de ejecución). Debe coincidir con
  `NEXT_PUBLIC_API_URL`. Cambiarla exige reconstruir esa imagen;
  `scripts/deploy-hosting.sh` ya lo hace en cada ejecución sin `--no-build`.

### Pagos: variables y cómo cambiar de proveedor (Alcance E del plan de pagos)

Sin proveedor real contratado todavía. `docker-compose.production.yml`
reenvía al contenedor `api` cuatro variables nuevas
(`PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_CHECKOUT_TTL_MINUTES`,
`PAYMENT_SIMULATION_ALLOWED`) y `PANEL_PUBLIC_URL`; sin reenviarlas la API
simplemente arranca con los valores por defecto (`manual`, sin secreto, 30
minutos), que son los correctos para producción hoy.

- `PAYMENT_PROVIDER` (`manual` por defecto y el **único** modo soportado en
  producción hoy): elige el adaptador de `apps/api/src/modules/payments/`
  (`manual.provider.ts`/`simulated.provider.ts`), igual que
  `GOOGLE_OAUTH_WEB_CLIENT_ID` habilita el login con Google o
  `DOCUMENT_STORAGE_ROOT` elige dónde viven los documentos. `manual`: la
  empresa marca el pago como hecho fuera de la app (`mark-paid`); Chambeaya
  factura la comisión aparte (ver [API y reglas operativas](../reference/api.md)).
  `simulated`: recorre el flujo completo checkout → webhook firmado →
  pagado **sin mover dinero real**, pensado para desarrollo o una demo
  controlada, nunca para cobrar de verdad.
- `PAYMENT_WEBHOOK_SECRET`: `scripts/instalar-produccion.sh` lo genera solo
  (64 caracteres aleatorios) en una instalación nueva, y lo añade a un
  `.env.production` existente que no lo tuviera, sin tocar ninguna otra
  variable — igual trato que le da a `POSTGRES_PASSWORD`. Solo importa si
  `PAYMENT_PROVIDER` no es `manual`: firma (`HMAC-SHA256`) el webhook de
  pagos. **Nunca lo compartas ni lo reutilices entre entornos.**
- `PAYMENT_CHECKOUT_TTL_MINUTES` (`30` por defecto): minutos que un checkout
  queda vigente antes de expirar perezosamente (sin cron) y devolver el
  pago a `PENDING`.
- `PAYMENT_SIMULATION_ALLOWED`: debe quedar **vacío** en producción real. La
  API se niega a arrancar con `PAYMENT_PROVIDER=simulated` en
  `NODE_ENV=production` a menos que esta variable sea exactamente `true`
  (`server.ts#assertPaymentConfig`); `scripts/deploy-hosting.sh` valida lo
  mismo antes de levantar contenedores y avisa del modo activo en cada
  ejecución.
- `PANEL_PUBLIC_URL`: la URL pública del panel (`https://tudominio.com/empresas`
  en este esquema de un solo dominio), usada por el adaptador `simulated`
  para construir el `redirectUrl` del checkout (`.../pago-simulado/<id>`,
  la página del Alcance F). Sin ella, se deriva de `NEXT_PUBLIC_API_URL` y
  `NEXT_BASE_PATH`; en producción con `PAYMENT_PROVIDER=manual` no hace
  ninguna falta.

> **Al volver de `simulated` a `manual`** (por ejemplo, al terminar una demo),
> un pago `simulated` que siga `PENDING` ya muestra **"Marcar como pagado"**
> en el panel y `POST /business/payments/:id/mark-paid` lo resuelve de forma
> atómica. También sirve si el checkout quedó `SCHEDULED`: expira ese intento
> abierto con motivo `PROVIDER_DEACTIVATED` y procesa el pago en la misma
> operación. Es una salida para un proveedor que ya no está activo; un pago
> cuyo proveedor siga activo conserva su flujo propio y no se puede marcar a
> mano.

**Cuando se elija un proveedor real** (Mercado Pago, Culqi, Niubiz o
Izipay): se agrega un nuevo `*.provider.ts` que implemente la interfaz
`PaymentProvider` (`apps/api/src/modules/payments/provider.ts`), se suma su
nombre a los valores válidos de `PAYMENT_PROVIDER`
(`payments.service.ts#KNOWN_PAYMENT_PROVIDERS`) y se cambia esa variable en
`.env.production`, sin tocar ningún otro adaptador ni el resto de la API. El
webhook de ese proveedor seguirá su propio esquema de firma (documentado por
el proveedor), verificado dentro de su propio `verifyWebhook`; el resto del
flujo (`checkoutPayment`/`processProviderEvent`) no cambia. Con un proveedor
real se usará pago dividido (split): el proveedor paga al trabajador y
entrega la comisión de Chambeaya en la misma operación, así que Chambeaya
nunca custodia la paga del trabajador — el destino de pago del trabajador
queda por definir junto con esa integración.

### Turnos temporales pausados y moneda virtual (M0/M1)

Desde `CN-20261001-032` una instalación nueva o actualizada arranca con los
turnos temporales apagados: publicar un turno y postular responden `503
TEMPORARY_SHIFTS_DISABLED` y el panel oculta esos botones. Es el
comportamiento buscado en producción: déjalas vacías en `.env.production`.
`docker-compose.production.yml` reenvía `TEMPORARY_SHIFTS_ENABLED` y
`VIRTUAL_CURRENCY_NAME` a la API (en tiempo de ejecución) y
`NEXT_PUBLIC_TEMPORARY_SHIFTS_ENABLED` como argumento de compilación del panel
(`apps/web/Dockerfile.production`; se incrusta en el bundle, así que cambiarla
exige reconstruir la imagen `web`). Vacías equivalen a "apagado" y a
`Chambitas`. Las migraciones `20261001100000_virtual_currency_ledger` y
`20261005100000_currency_ledger_cleanup` (quita un índice duplicado) solo
tocan tablas e índices nuevos y las aplica `prisma migrate deploy` al
actualizar. Tras ellas, `DELETE /api/admin/workers/:id` y
`DELETE /api/admin/companies/:id` responden `409 CURRENCY_LEDGER_RETAINED` si
el titular tiene movimientos de moneda (el libro es inmutable; no se borra
nada, ni filas ni archivos). Ver [API y reglas operativas](../reference/api.md#moneda-virtual-m1).

La migración `20261005120000_currency_catalog` (M2, `CN-20261005-037`) solo
agrega el tipo `CurrencyCatalogKind`, las tablas `CurrencyCatalogEntry` y
`CurrencyCatalogChange`, y siembra 16 entradas con valores **provisionales**
(`isProvisional = true`). Usa `gen_random_uuid()`, que exige PostgreSQL 13 o
posterior; las imágenes de compose usan `postgres:16`. En M2 ninguna acción
real cobra ni premia con el catálogo. Aun así, el dueño del producto debe
revisar y ajustar los valores con `PATCH /api/admin/currency/catalog/:entryId`
antes de conectar acciones (M4). Ver
[Catálogo de costos y premios](../reference/api.md#catálogo-de-costos-y-premios-m2).

La migración `20261006100000_job_postings` (M3, `CN-20261006-039`) solo agrega
enums, las tablas `JobPosting`, `JobApplication`, `JobOffer`, `JobOfferUpload` y
`JobApplicationEvent`, restricciones `CHECK`, un índice único parcial y un
trigger que impide modificar una oferta aceptada. No toca tablas existentes y
no necesita variables nuevas. Los PDF de las ofertas se guardan en el mismo
almacenamiento privado de documentos (`DOCUMENT_STORAGE_ROOT`): el volumen debe
ser persistente y entrar en la copia de respaldo. Ver
[Puestos fijos y embudo de selección](../reference/api.md#puestos-fijos-y-embudo-de-selección-m3).

La migración `20261007100000_currency_actions` (M4, `CN-20261007-043`) agrega
tablas, columnas y valores de enum, siembra tres ajustes provisionales (tope de
gasto diario y duración del destacado), rellena `autoClosedReason` en las
postulaciones que M3 ya había cerrado y cambia a `RESTRICT` las FK de
`JobPosting.companyId`, `JobApplication.postingId` y `JobApplication.workerId`.
No borra filas; la aplica `prisma migrate deploy`. Desde M4 la API cobra
monedas al publicar más allá de la cuota, postular más allá de la cuota,
destacar, invitar y desbloquear contacto, y otorga el bono de bienvenida al
registrar un trabajador o crear una empresa.

- **Devolución automática.** Cada proceso de la API ejecuta una tarea en
  segundo plano que devuelve los cobros vencidos sin respuesta. La variable
  `CURRENCY_REFUND_INTERVAL_MS` fija el intervalo en milisegundos (por defecto
  `300000`, 5 min; mínimo `1000`; `0`, `off` o `false` la desactivan). Es segura
  con varias instancias (`FOR UPDATE SKIP LOCKED`). `POST
  /api/admin/currency/refunds/run` ejecuta una pasada a mano. Cada devolución se
  procesa en una transacción `Serializable` con reintento, de modo que un cobro
  simultáneo sobre la misma cuenta no produce `500`. `docker-compose.yml` y
  `docker-compose.production.yml` reenvían la variable al contenedor `api`
  (vacía = valor por defecto) y figura en `.env.example` y
  `.env.production.example` (`CN-20261007-045`).
- **Cuentas anteriores a M4.** No reciben el bono automáticamente. Tras
  actualizar, un administrador puede ejecutar `POST
  /api/admin/currency/welcome-bonus/backfill` (idempotente). Una cuenta que ya tiene el
  movimiento del bono se cuenta como «ya lo tenía» aunque el monto de
  `WELCOME_BONUS` se haya editado después, y la pasada continúa con las demás
  (`CN-20261007-045`).
- **Borrado de cuentas.** El bono de bienvenida por sí solo no retiene el borrado:
  `DELETE /api/admin/workers/:id` y `DELETE /api/admin/companies/:id` responden
  `204` si el único movimiento de la cuenta es el `WELCOME_BONUS`, y el bono
  desaparece con la cuenta. La migración `20261007120000_welcome_bonus_deletable`
  (solo reemplaza la función del trigger del libro; no toca filas) permite
  borrar un movimiento `REWARD`/`WELCOME_BONUS` únicamente dentro de una
  transacción que declara la cuenta con
  `set_config('chambeaya.welcome_bonus_delete_account', <id>, true)` y solo si la
  cuenta no tiene ningún otro movimiento; cualquier otro `DELETE` o `UPDATE` del
  libro sigue fallando con `CURRENCY_MOVEMENT_APPEND_ONLY`. Con cualquier otro
  movimiento (gasto, devolución, ajuste, otro premio) la respuesta sigue siendo
  `409 CURRENCY_LEDGER_RETAINED`.
  Una cuenta con una oferta de puesto fijo aceptada responde
  `409 CONTRACT_RECORDS_RETAINED`.

Ver [Acciones conectadas a la moneda virtual](../reference/api.md#acciones-conectadas-a-la-moneda-virtual-m4).

La migración `20261012100000_currency_rewards` (M6, `CN-20261012-047`) solo
agrega: las tablas `CurrencyRewardGrant` y `WorkerReferral`, las columnas
`User.referralCode`, `WorkerDocument.verifiedAt/verifiedById`,
`Company.verifiedAt/verifiedById` y `WorkerTalentProfile.highlightedAt/highlightedUntil`,
dos `CHECK` y ocho ajustes provisionales (`ON CONFLICT DO NOTHING`, así un ajuste
ya editado conserva su valor). No modifica ni borra filas y no necesita variables
de entorno nuevas; la aplica `prisma migrate deploy`. Efectos operativos:

- Desde M6 la API otorga premios automáticos (perfil completo, documentos y
  empresa verificados por el admin, invitación respondida, referidos, respuesta a
  tiempo y contratación). Cualquiera de ellos deja un movimiento distinto del bono,
  así que esa cuenta pasa a responder `409 CURRENCY_LEDGER_RETAINED` al borrado.
- El `nextCursor` de `GET /api/business/talent` pasa a ser opaco; los cursores
  antiguos (un `id`) se siguen aceptando, así que no hace falta coordinar el
  despliegue de la web.
- Las cuentas anteriores a M6 no reciben premios retroactivos: el de perfil
  completo se evalúa la próxima vez que el trabajador guarde el perfil o suba el
  CV o la foto.

Ver [Ganar monedas: premios automáticos](../reference/api.md#ganar-monedas-premios-automáticos-m6).

## Actualizar una versión

```bash
git pull
./scripts/deploy-hosting.sh
```

O en un solo comando, con `--pull`:

```bash
./scripts/deploy-hosting.sh --pull
```

Para ejecutarlo sin `sudo`, tu usuario (el mismo que clonó el repositorio y
que el instalador dejó como dueño de `.env.production`) debe poder usar
Docker. Si `docker ps` responde `permission denied ... docker.sock`, añádelo
al grupo `docker` una sola vez y vuelve a iniciar sesión:

```bash
sudo usermod -aG docker "$USER"
```

Pertenecer al grupo `docker` equivale en la práctica a tener acceso de
`root` en el servidor; concédelo solo a quien ya administra la máquina. Si
clonaste el repositorio como `root` (por ejemplo con `sudo git clone` en
`/opt`), ejecuta también las actualizaciones con `sudo`.

`deploy-hosting.sh` valida las variables obligatorias de `.env.production`
(incluidas `API_BASE_URL` y `NEXT_BASE_PATH`), reconstruye las 4 imágenes,
espera los healthchecks de `api`, `web` y `worker-app`, y al final ejecuta
`docker image prune -f` filtrado por la etiqueta de este proyecto de Compose
(`com.docker.compose.project=chambeaya-production`) para no llenar el disco
con imágenes viejas sin etiquetar de Chambeaya, sin tocar las imágenes de
otros proyectos que compartan el mismo servidor.

Para revisar el estado o los logs:

```bash
docker compose -p chambeaya-production -f docker-compose.production.yml ps
docker compose -p chambeaya-production -f docker-compose.production.yml logs --tail=200
```

### Respaldo antes de actualizar

Antes de actualizar una instancia con datos reales, respalda PostgreSQL. Las
comillas simples son intencionales: `$POSTGRES_USER` y `$POSTGRES_DB` se
expanden **dentro** del contenedor `db` (donde sí existen), no en la shell del
servidor, donde normalmente están vacías:

```bash
docker compose -p chambeaya-production -f docker-compose.production.yml \
  exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > respaldo-$(date +%Y%m%d-%H%M).sql
```

Comprueba que el archivo no esté vacío (`ls -lh respaldo-*.sql`) y guárdalo
fuera del servidor. Los documentos privados (CV y fotos) viven en el volumen
`chambeaya-production-private-documents`, que `pg_dump` no incluye; para
copiarlos:

```bash
docker run --rm \
  -v chambeaya-production_chambeaya-production-private-documents:/datos:ro \
  -v "$PWD":/respaldo alpine \
  tar czf /respaldo/documentos-$(date +%Y%m%d-%H%M).tar.gz -C /datos .
```

(El nombre real del volumen lleva el prefijo del proyecto de Compose,
`chambeaya-production_`; confírmalo con `docker volume ls`.)

### Restaurar un respaldo

Restaurar reemplaza los datos actuales. Hazlo con la API detenida para que
nadie escriba mientras tanto, sobre una base vacía:

```bash
C="docker compose -p chambeaya-production -f docker-compose.production.yml"
$C stop api web worker-app
$C exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
$C exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"' < respaldo-AAAAMMDD-HHMM.sql
$C start api web worker-app
```

Para los documentos, extrae el `.tar.gz` en el mismo volumen con un
contenedor `alpine` equivalente al del respaldo (`tar xzf ... -C /datos`, con
el volumen montado sin `:ro`).

### Nunca uses `down -v` en producción

`down -v` borra los volúmenes de Docker, incluida la base de datos completa
(`chambeaya-production-db`) y los documentos privados
(`chambeaya-production-private-documents`). Para detener la aplicación sin
borrar nada:

```bash
docker compose -p chambeaya-production -f docker-compose.production.yml down
```

Un `down -v` (o `docker volume rm` sobre esos dos volúmenes) es irreversible
sin el respaldo de `pg_dump` anterior. Si necesitas liberar espacio de
imágenes sin usar, usa el mismo filtro por proyecto que ya aplica
`deploy-hosting.sh` tras cada despliegue exitoso (`docker image prune -f
--filter "label=com.docker.compose.project=chambeaya-production"`) en vez de
un `docker image prune -f` sin filtrar, que borraría imágenes sin etiqueta de
cualquier otro proyecto que comparta el servidor. Nunca uses `down -v` para
esto.

### Instancias creadas antes del renombrado a Chambeaya

Una instancia desplegada cuando el proyecto se llamaba Cumple Now usa el nombre
de proyecto de Compose `cumplenow-production` y los volúmenes
`cumplenow-production-db` y `cumplenow-production-private-documents`. El
renombrado cambió los tres nombres, así que un `git pull` seguido de
`./scripts/deploy-hosting.sh` **no actualiza esa instancia**: crea una pila
nueva con volúmenes vacíos y deja la anterior en marcha con los datos. No se
borra nada, pero la aplicación nueva arrancaría sin base de datos y los puertos
publicados entrarían en conflicto.

Antes de actualizar una instancia así, respalda PostgreSQL y elige una vía:

```bash
# 1. Comprobar qué hay desplegado y con qué volúmenes.
docker compose -p cumplenow-production -f docker-compose.production.yml ps
docker volume ls | grep -i cumplenow

# 2. Respaldo obligatorio antes de tocar nada.
docker compose -p cumplenow-production -f docker-compose.production.yml \
  exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > respaldo-previo.sql

# 3. Detener la pila antigua (sin borrar sus volúmenes).
docker compose -p cumplenow-production -f docker-compose.production.yml down
```

Después, o bien restauras `respaldo-previo.sql` sobre la pila nueva ya
levantada con `./scripts/deploy-hosting.sh`, o bien copias el contenido del
volumen antiguo al nuevo antes de levantarla. Si además cambias `POSTGRES_USER`
o `POSTGRES_DB` en `.env.production` para alinearlos con la marca nueva, hazlo
en el mismo paso que la restauración: cambiarlos sobre un volumen ya
inicializado con el usuario antiguo provoca fallos de autenticación.

### Instancias creadas con el esquema anterior de 3 subdominios

`CN-20260925-001` a `CN-20260925-005` usaban 3 subdominios (API, panel, app)
en vez del dominio único con rutas de esta guía. Nadie llegó a desplegar así
en producción real, pero si probaste ese esquema, `instalar-produccion.sh`
detecta un `.env.production` sin `NEXT_BASE_PATH` y con más de un origen en
`CORS_ALLOWED_ORIGINS`, y explica los pasos manuales de migración (elegir el
dominio único, editar `NEXT_PUBLIC_API_URL`/`API_BASE_URL`/`CORS_ALLOWED_ORIGINS`,
añadir `NEXT_BASE_PATH=/empresas`, volver a ejecutar el instalador y pedir un
certificado nuevo) en vez de migrarlo solo.

## Qué hace y qué no hace `scripts/instalar-produccion.sh` con Nginx

- **Solo toca `chambeaya.conf`.** Instala un único archivo
  (`/etc/nginx/sites-available/chambeaya.conf` o
  `/etc/nginx/conf.d/chambeaya.conf`) y su symlink en `sites-enabled` si esa
  estructura existe. Nunca edita `nginx.conf` ni los archivos de otros
  proyectos que ese mismo Nginx atienda.
- **Detecta choques de dominio antes de instalar, y antes de crear
  `.env.production`.** Revisa `nginx -T` (la configuración ya combinada,
  excluyendo su propio archivo) en busca de un `server_name` que ya use el
  dominio en otro sitio; si lo encuentra, aborta con un mensaje claro sin
  escribir nada — ni la config de Nginx ni `.env.production`, en ese orden,
  así que una instalación nueva que choca no deja un `.env.production` a
  medio escribir con el dominio equivocado que luego un reintento no
  limpiaría. `nginx -t` por sí solo solo avisa
  (`conflicting server name ... ignored`, código de salida 0) y dejaría que
  Chambeaya le robe el tráfico a ese otro proyecto según el orden alfabético
  de los archivos.
- **No pisa un sitio idéntico ni uno con TLS de Certbot sin permiso.** Si el
  `chambeaya.conf` ya instalado es igual al que generaría, no lo toca. Si es
  distinto pero tiene bloques de Certbot (busca el comentario
  `managed by Certbot`), no lo sobrescribe por defecto — perderías esos
  certificados —; guarda la versión nueva en
  `deploy/nginx/chambeaya.conf.generado` para que la compares, y solo la
  instala si repites con `--force-nginx` (haciendo antes una copia de
  seguridad `chambeaya.conf.bak.<fecha-hora>` en la misma carpeta).
- **Nunca recarga Nginx si la configuración no valida, y restaura el estado
  exacto de antes si falla o si se interrumpe — Nginx Y `.env.production`.**
  Si `nginx -t` falla (o reporta un `conflicting server name`), si
  `systemctl reload nginx` falla tras validar, si falla la propia escritura
  del archivo (por ejemplo, disco lleno) o si la instalación se interrumpe
  (Ctrl+C/SIGINT/SIGTERM) después de escribir el archivo, restaura el sitio
  desde la copia de seguridad (o lo borra, si no existía antes) y aborta sin
  ejecutar `systemctl reload nginx`. El symlink de `sites-enabled` nunca
  queda apuntando a un archivo inexistente: solo se retira si el propio
  instalador lo creó en esa misma ejecución. Si además `.env.production` ya
  existía y esta corrida lo había modificado (`--change-domain`,
  `--google-client-id`, o solo las variables nuevas de compatibilidad), ese
  mismo fallo también lo restaura a como estaba antes de ejecutar: un fallo
  de Nginx nunca deja `.env.production` en un dominio distinto al que
  Nginx sigue sirviendo (`CN-20260926-004`, ver más arriba).
- **Sin Nginx en el host**, deja el archivo generado en
  `deploy/nginx/chambeaya.conf.generado` para instalarlo a mano en el proxy
  inverso que uses. En un Ubuntu sin ningún proxy, lo más simple es instalar
  Nginx del sistema y volver a ejecutar el instalador:

  ```bash
  sudo apt-get update && sudo apt-get install -y nginx certbot python3-certbot-nginx
  sudo ufw allow 'Nginx Full'   # solo si ufw está activo
  sudo ./scripts/instalar-produccion.sh --domain tudominio.com
  ```

  Si el servidor ya usa otro proxy (Caddy, Traefik, Apache), no instales
  Nginx: los puertos 80/443 ya están ocupados. Traduce el bloque `server` del
  archivo generado a ese proxy, respetando el límite de subida de 8 MB en la
  API, el tratamiento sin búfer de `/api/shifts/events`, y que `/empresas`
  reenvíe el prefijo sin recortarlo (el panel lo espera por su `basePath`).
- **TLS**: si hay `certbot`, el instalador puede pedir el certificado con
  `--nginx` (flag `--certbot` o confirmación interactiva). Sin `certbot`,
  deja las URLs en `http://` hasta que lo instales y ejecutes
  `sudo certbot --nginx -d <tu dominio>` una vez que el DNS resuelva.
