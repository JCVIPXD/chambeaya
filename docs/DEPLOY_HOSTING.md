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
