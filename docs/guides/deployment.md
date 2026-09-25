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

4. Si no existe `.env.production`, lo genera con una contraseña de
   PostgreSQL aleatoria de 32 caracteres alfanuméricos, `DATABASE_URL`
   derivada de ella, las tres URLs públicas sobre el mismo dominio
   (`NEXT_PUBLIC_API_URL`, `API_BASE_URL`, `NEXT_BASE_PATH=/empresas`),
   `CORS_ALLOWED_ORIGINS` con ese mismo dominio, `API_TRUST_PROXY=1` (un
   salto: el Nginx del host — **nunca** `true`, que dejaría falsificar la IP
   de origen con `X-Forwarded-For` y saltarse el límite de intentos de
   `/api/auth`), y elige automáticamente 3 puertos libres en `127.0.0.1`
   (empieza a buscar en 4100/3100/8100). Deja el archivo a nombre del
   usuario real (no de `root`, aunque se ejecute con `sudo`) con permisos
   `600`, para que actualizar después no necesite sudo (ver más abajo).

   **Si `.env.production` ya existe, el instalador nunca regenera la
   contraseña ni los puertos** (ver más abajo por qué), y tampoco cambia
   `API_TRUST_PROXY` si ya tiene un valor (solo avisa si sigue en `true`).
   Solo añade las variables nuevas que falten (por ejemplo, al actualizar una
   instalación anterior a que existiera `worker-app` o `NEXT_BASE_PATH`).
   Tampoco reescribe nunca `NEXT_PUBLIC_API_URL`/`API_BASE_URL` si ya
   existen: si el `--domain` de esta corrida no coincide con el que ya
   tienen, avisa (la API, el panel y la app ya están compilados con el
   dominio anterior; cambiarlo de verdad exige editar esas variables a mano
   y reconstruir con `./scripts/deploy-hosting.sh`). **Ojo: el aviso no
   detiene el script.** Si el sitio instalado no tiene bloques de Certbot,
   el instalador lo reemplaza por uno con el dominio nuevo y recarga Nginx,
   así que el dominio anterior deja de responder. Revisa el `--domain`
   antes de volver a ejecutarlo en una instalación existente.

   Si detecta un `.env.production` del esquema anterior de 3 subdominios
   (sin `NEXT_BASE_PATH` y con más de un origen en `CORS_ALLOWED_ORIGINS`),
   **no lo migra solo**: explica los pasos manuales (elegir el dominio
   único, editar las URLs, pedir un certificado nuevo) y se detiene. Nadie
   llegó a desplegar así en producción real, pero el instalador lo detecta
   por si alguien lo probó.

5. Genera la configuración de Nginx del host a partir de
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
6. Si hay `certbot` instalado, pide el certificado TLS del dominio único
   (con `--certbot` no pregunta; sin él, pregunta o, en modo no interactivo,
   deja el comando exacto para ejecutarlo después).
7. Llama a `scripts/deploy-hosting.sh` para construir y levantar los 4
   servicios, y muestra un resumen con las 3 URLs, los puertos elegidos y los
   pasos pendientes (DNS, Google Sign-In).

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

### El panel Next.js bajo `/empresas` (`NEXT_BASE_PATH`)

El panel se compila con `basePath` (`apps/web/next.config.ts`, controlado por
la variable de entorno `NEXT_BASE_PATH`) para servirse bajo `/empresas` en
vez de la raíz. Esto:

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
  exacto de antes si falla o si se interrumpe.** Si `nginx -t` falla (o
  reporta un `conflicting server name`), si `systemctl reload nginx` falla
  tras validar, o si la instalación se interrumpe (Ctrl+C/SIGINT/SIGTERM)
  después de escribir el archivo, lo restaura desde la copia de seguridad (o
  lo borra, si no existía antes) y aborta sin ejecutar `systemctl reload
  nginx`. El symlink de `sites-enabled` nunca queda apuntando a un archivo
  inexistente: solo se retira si el propio instalador lo creó en esa misma
  ejecución.
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
