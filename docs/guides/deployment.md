# Despliegue en hosting con Docker

El despliegue de producción usa `docker-compose.production.yml` y no modifica el
flujo de desarrollo. Está pensado para un VPS o hosting que permita Docker
Engine y Docker Compose v2.

## Primera instalación

```bash
git clone <url-del-repositorio> cumplenow
cd cumplenow
cp .env.production.example .env.production
nano .env.production
chmod +x scripts/deploy-hosting.sh
./scripts/deploy-hosting.sh
```

En `.env.production` configura una contraseña de PostgreSQL de 16 caracteres o
más y la URL pública que verá el navegador en `NEXT_PUBLIC_API_URL`. Si usas un
proxy inverso, apunta el dominio web al puerto `WEB_HOST_PORT` y el dominio de
API al puerto `API_HOST_PORT` (la ruta de salud es `/api/health`).

El script valida variables, construye las imágenes, ejecuta las migraciones de
Prisma, deja los tres servicios reiniciándose automáticamente y espera sus
healthchecks. La base de datos queda en el volumen Docker
`cumplenow-production-db`; no se expone directamente a Internet.

### CORS, límite de intentos y proxy inverso

`docker-compose.production.yml` reenvía al contenedor `api` las variables que
declara `.env.production`: `CORS_ALLOWED_ORIGINS`, `API_TRUST_PROXY`,
`AUTH_RATE_LIMIT_WINDOW_MS` y `AUTH_RATE_LIMIT_MAX`. `--env-file` por sí solo
solo interpola el YAML; sin esta reexportación explícita en el bloque
`environment:` del servicio, esas variables nunca llegarían al proceso Node
aunque estén bien configuradas en `.env.production`.

- `CORS_ALLOWED_ORIGINS` (obligatoria en producción): lista de orígenes
  permitidos por CORS separados por comas, por ejemplo
  `https://tudominio.com,https://admin.tudominio.com`. `scripts/deploy-hosting.sh`
  rechaza el despliegue si falta o si conserva el valor de ejemplo
  (`tudominio.com`). Si en producción esta variable llega vacía al contenedor,
  la API bloquea todos los orígenes de navegador (`origin: false`) en lugar de
  abrir el acceso en silencio; el panel web y Flutter web dejan de funcionar
  hasta corregirla.
- `API_TRUST_PROXY`: configúrala cuando pongas Nginx, Caddy o un balanceador
  administrado delante de la API (obligatorio para TLS, ver más abajo). Sin
  esta variable, Express no confía en `X-Forwarded-For` y todas las
  solicitudes que pasan por el proxy comparten una sola IP a efectos del
  límite de intentos de `/api/auth`, lo que puede bloquear a todos los
  usuarios del piloto tras alcanzar el cupo. Usa `true` solo si controlas el
  proxy directo; si conoces la topología exacta (número de saltos), usa ese
  número en su lugar.
- `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX`: ventana y máximo de
  intentos por IP para `POST /api/auth/login`, `/register`, `/google`,
  `/google/complete` y `/password`. Por defecto 900000 ms (15 minutos) y 20
  intentos; ajústalos si el cupo por defecto resulta demasiado bajo para el
  tráfico agregado detrás del proxy.

Tras editar `.env.production`, aplica los cambios con
`./scripts/deploy-hosting.sh` (o `--no-build` si no cambiaste código) para que
Compose recree el contenedor `api` con las variables nuevas.

## Actualizar una versión

```bash
git pull
./scripts/deploy-hosting.sh
```

Para revisar el estado o los logs:

```bash
docker compose -p cumplenow-production -f docker-compose.production.yml ps
docker compose -p cumplenow-production -f docker-compose.production.yml logs --tail=200
```

Antes de actualizar una instancia con datos reales, respalda PostgreSQL. Para
detener la aplicación sin borrar el volumen:

```bash
docker compose -p cumplenow-production -f docker-compose.production.yml down
```

El script no incluye certificados TLS ni un proxy inverso: esa capa debe
configurarse en el proveedor (Caddy, Nginx o el balanceador administrado) y es
la que debe publicar los dominios con HTTPS.
