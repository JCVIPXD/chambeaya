#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.production.yml"
ENV_FILE="$PROJECT_DIR/.env.production"
PROJECT_NAME="chambeaya-production"
WAIT_SECONDS=180
NO_BUILD=0
DO_PULL=0

usage() {
  cat <<'EOF'
Uso: ./scripts/deploy-hosting.sh [opciones]

  --env-file RUTA   usa otro archivo de variables (por defecto .env.production)
  --no-build        levanta las imágenes existentes sin reconstruirlas
  --pull            ejecuta 'git pull --ff-only' antes de construir
  -h, --help        muestra esta ayuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || { echo "Falta la ruta después de --env-file" >&2; exit 2; }
      ENV_FILE="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
      shift 2
      ;;
    --no-build) NO_BUILD=1; shift ;;
    --pull) DO_PULL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$PROJECT_DIR"

if [[ "$DO_PULL" -eq 1 ]]; then
  command -v git >/dev/null 2>&1 || { echo "git no está instalado; no se puede usar --pull." >&2; exit 1; }
  echo "Actualizando el repositorio (git pull --ff-only)..."
  git pull --ff-only
fi
command -v docker >/dev/null 2>&1 || { echo "Docker no está instalado o no está en PATH." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 no está disponible." >&2; exit 1; }

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$PROJECT_DIR/.env.production.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "Se creó $ENV_FILE a partir de .env.production.example."
  echo "Edita las credenciales, dominio y puertos; vuelve a ejecutar el script."
  exit 1
fi

required_vars=(POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL NEXT_PUBLIC_API_URL API_BASE_URL NEXT_BASE_PATH CORS_ALLOWED_ORIGINS)
for variable in "${required_vars[@]}"; do
  if ! grep -Eq "^${variable}=[^[:space:]]+" "$ENV_FILE"; then
    echo "Falta una variable válida en $ENV_FILE: $variable" >&2
    exit 1
  fi
done

password="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ENV_FILE" | head -n 1)"
if [[ "$password" == "chambeaya_dev" || "$password" == "cambia-esta-clave-por-una-larga-y-aleatoria" || ${#password} -lt 16 ]]; then
  echo "POSTGRES_PASSWORD debe tener al menos 16 caracteres y no ser la de ejemplo." >&2
  exit 1
fi

public_api_url="$(sed -n 's/^NEXT_PUBLIC_API_URL=//p' "$ENV_FILE" | head -n 1)"
if [[ "$public_api_url" == *"tudominio.com"* || "$public_api_url" == *"localhost"* || "$public_api_url" == *"127.0.0.1"* ]]; then
  echo "NEXT_PUBLIC_API_URL debe apuntar a un dominio o IP público real." >&2
  exit 1
fi

# API_BASE_URL se compila dentro del binario de la app del trabajador
# (worker-app); un valor de ejemplo dejaría la app apuntando a un dominio que
# no existe hasta la próxima reconstrucción de esa imagen.
api_base_url="$(sed -n 's/^API_BASE_URL=//p' "$ENV_FILE" | head -n 1)"
if [[ "$api_base_url" == *"tudominio.com"* || "$api_base_url" == *"localhost"* || "$api_base_url" == *"127.0.0.1"* ]]; then
  echo "API_BASE_URL debe apuntar a un dominio o IP público real (se compila en la app del trabajador)." >&2
  exit 1
fi

cors_allowed_origins="$(sed -n 's/^CORS_ALLOWED_ORIGINS=//p' "$ENV_FILE" | head -n 1)"
if [[ "$cors_allowed_origins" == *"tudominio.com"* ]]; then
  echo "CORS_ALLOWED_ORIGINS debe apuntar al dominio real (no al valor de ejemplo)." >&2
  exit 1
fi

# NEXT_BASE_PATH se compila dentro del panel Next.js (apps/web/Dockerfile.production).
# BAJO-2 de CN-20260925-007: antes se aceptaba cualquier valor con "/" al
# inicio y sin barra final, pero tanto la plantilla de Nginx
# (deploy/nginx/chambeaya.conf.template) como scripts/instalar-produccion.sh
# fijan "/empresas" a mano (NEXT_BASE_PATH_VALUE): otro valor deja el panel
# compilado para una ruta que Nginx nunca enruta hacia él.
next_base_path="$(sed -n 's/^NEXT_BASE_PATH=//p' "$ENV_FILE" | head -n 1)"
if [[ "$next_base_path" != "/empresas" ]]; then
  echo "NEXT_BASE_PATH debe ser exactamente '/empresas' (la plantilla de Nginx y el instalador no soportan otra ruta); tiene '${next_base_path}'." >&2
  exit 1
fi

# BAJO-N3 de CN-20260925-004: deploy-hosting.sh es el camino habitual de
# actualización (el que documenta la meta: "git pull && ./scripts/deploy-hosting.sh"),
# así que también debe avisar de este riesgo de seguridad, no solo
# instalar-produccion.sh la primera vez.
trust_proxy="$(sed -n 's/^API_TRUST_PROXY=//p' "$ENV_FILE" | head -n 1)"
if [[ "$trust_proxy" == "true" ]]; then
  echo >&2
  echo "AVISO DE SEGURIDAD: API_TRUST_PROXY=true en $ENV_FILE permite falsificar la IP de" >&2
  echo "origen con X-Forwarded-For y saltarse el límite de intentos de /api/auth" >&2
  echo "(CN-20260925-002, ALTO-1). Cámbialo a API_TRUST_PROXY=1 (un salto: el Nginx del" >&2
  echo "host) y vuelve a ejecutar este script." >&2
  echo >&2
fi

# Motivo (CN-20260925-alcance-A): sin este aviso, GOOGLE_OAUTH_WEB_CLIENT_ID
# vacío desactiva el botón "Ingresar con Google" en silencio (worker-app lo
# recibe como ARG de build, apps/mobile_flutter/Dockerfile.production:30,36;
# la API lo lee en runtime, google_identity.ts). Igual que el aviso de
# API_TRUST_PROXY de arriba, deploy-hosting.sh también debe avisarlo: es el
# camino habitual de actualización, no solo instalar-produccion.sh.
google_client_id="$(sed -n 's/^GOOGLE_OAUTH_WEB_CLIENT_ID=//p' "$ENV_FILE" | head -n 1)"
if [[ -z "$google_client_id" ]]; then
  echo >&2
  echo "AVISO: GOOGLE_OAUTH_WEB_CLIENT_ID está vacío en $ENV_FILE; 'Ingresar con Google'" >&2
  echo "queda desactivado (app y panel). Para activarlo: pon el valor en $ENV_FILE" >&2
  echo "(termina en .apps.googleusercontent.com) y vuelve a ejecutar" >&2
  echo "./scripts/deploy-hosting.sh (reconstruye worker-app con el valor nuevo); luego" >&2
  echo "autoriza el origen https de tu dominio en la consola de Google Cloud." >&2
  echo >&2
fi

api_port="$(sed -n 's/^API_HOST_PORT=//p' "$ENV_FILE" | head -n 1)"
web_port="$(sed -n 's/^WEB_HOST_PORT=//p' "$ENV_FILE" | head -n 1)"
app_port="$(sed -n 's/^APP_HOST_PORT=//p' "$ENV_FILE" | head -n 1)"
api_port="${api_port:-4000}"
web_port="${web_port:-3000}"
app_port="${app_port:-3100}"

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$COMPOSE_FILE")
echo "Validando configuración de producción..."
"${compose[@]}" config >/dev/null

echo "Construyendo y levantando Chambeaya..."
if [[ "$NO_BUILD" -eq 1 ]]; then
  "${compose[@]}" up -d
else
  "${compose[@]}" up -d --build
fi

echo "Esperando a que API, web y worker-app estén saludables (máximo ${WAIT_SECONDS}s)..."
deadline=$((SECONDS + WAIT_SECONDS))
while (( SECONDS < deadline )); do
  api_status="$("${compose[@]}" ps -q api | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null || true)"
  web_status="$("${compose[@]}" ps -q web | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null || true)"
  app_status="$("${compose[@]}" ps -q worker-app | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null || true)"
  if [[ "$api_status" == "healthy" && "$web_status" == "healthy" && "$app_status" == "healthy" ]]; then
    echo
    echo "Despliegue listo."
    echo "App trabajador: http://127.0.0.1:${app_port} (o https://<tu dominio>/)"
    echo "Panel web: http://127.0.0.1:${web_port}${next_base_path} (o https://<tu dominio>${next_base_path})"
    echo "API: http://127.0.0.1:${api_port}/api/health (o https://<tu dominio>/api/health)"
    echo "Proyecto Docker: $PROJECT_NAME"
    echo "Ver estado: ${compose[*]} ps"
    echo "Liberando imágenes de Docker sin usar de este proyecto..."
    # Solo las imágenes con la etiqueta de este proyecto de Compose: un
    # "docker image prune -f" sin filtrar borra TODAS las imágenes sin
    # etiqueta del host, incluidas las de otros proyectos que compartan este
    # mismo servidor (BAJO-1 de CN-20260925-002, auditoría de
    # CN-20260925-001).
    docker image prune -f --filter "label=com.docker.compose.project=${PROJECT_NAME}" >/dev/null || true
    exit 0
  fi
  printf '.'
  sleep 3
done

echo
echo "Los servicios no alcanzaron estado saludable. Estado actual:" >&2
"${compose[@]}" ps >&2 || true
echo "Revisa logs con: ${compose[*]} logs --tail=200" >&2
exit 1
