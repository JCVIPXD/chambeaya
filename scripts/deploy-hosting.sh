#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.production.yml"
ENV_FILE="$PROJECT_DIR/.env.production"
PROJECT_NAME="cumplenow-production"
WAIT_SECONDS=180
NO_BUILD=0

usage() {
  cat <<'EOF'
Uso: ./scripts/deploy-hosting.sh [opciones]

  --env-file RUTA   usa otro archivo de variables (por defecto .env.production)
  --no-build        levanta las imágenes existentes sin reconstruirlas
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
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$PROJECT_DIR"
command -v docker >/dev/null 2>&1 || { echo "Docker no está instalado o no está en PATH." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 no está disponible." >&2; exit 1; }

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$PROJECT_DIR/.env.production.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "Se creó $ENV_FILE a partir de .env.production.example."
  echo "Edita las credenciales, dominio y puertos; vuelve a ejecutar el script."
  exit 1
fi

required_vars=(POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL NEXT_PUBLIC_API_URL CORS_ALLOWED_ORIGINS)
for variable in "${required_vars[@]}"; do
  if ! grep -Eq "^${variable}=[^[:space:]]+" "$ENV_FILE"; then
    echo "Falta una variable válida en $ENV_FILE: $variable" >&2
    exit 1
  fi
done

password="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ENV_FILE" | head -n 1)"
if [[ "$password" == "cumplenow_dev" || "$password" == "cambia-esta-clave-por-una-larga-y-aleatoria" || ${#password} -lt 16 ]]; then
  echo "POSTGRES_PASSWORD debe tener al menos 16 caracteres y no ser la de ejemplo." >&2
  exit 1
fi

public_api_url="$(sed -n 's/^NEXT_PUBLIC_API_URL=//p' "$ENV_FILE" | head -n 1)"
if [[ "$public_api_url" == *"tudominio.com"* || "$public_api_url" == *"localhost"* || "$public_api_url" == *"127.0.0.1"* ]]; then
  echo "NEXT_PUBLIC_API_URL debe apuntar a un dominio o IP público real." >&2
  exit 1
fi

cors_allowed_origins="$(sed -n 's/^CORS_ALLOWED_ORIGINS=//p' "$ENV_FILE" | head -n 1)"
if [[ "$cors_allowed_origins" == *"tudominio.com"* ]]; then
  echo "CORS_ALLOWED_ORIGINS debe apuntar a los dominios reales del panel (no al valor de ejemplo)." >&2
  exit 1
fi

api_port="$(sed -n 's/^API_HOST_PORT=//p' "$ENV_FILE" | head -n 1)"
web_port="$(sed -n 's/^WEB_HOST_PORT=//p' "$ENV_FILE" | head -n 1)"
api_port="${api_port:-4000}"
web_port="${web_port:-3000}"

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$COMPOSE_FILE")
echo "Validando configuración de producción..."
"${compose[@]}" config >/dev/null

echo "Construyendo y levantando Cumple Now..."
if [[ "$NO_BUILD" -eq 1 ]]; then
  "${compose[@]}" up -d
else
  "${compose[@]}" up -d --build
fi

echo "Esperando a que API y web estén saludables (máximo ${WAIT_SECONDS}s)..."
deadline=$((SECONDS + WAIT_SECONDS))
while (( SECONDS < deadline )); do
  api_status="$("${compose[@]}" ps -q api | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null || true)"
  web_status="$("${compose[@]}" ps -q web | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null || true)"
  if [[ "$api_status" == "healthy" && "$web_status" == "healthy" ]]; then
    echo
    echo "Despliegue listo."
    echo "Web: http://127.0.0.1:${web_port} (o el dominio configurado en tu proxy/DNS)"
    echo "API: http://127.0.0.1:${api_port}/api/health"
    echo "Proyecto Docker: $PROJECT_NAME"
    echo "Ver estado: ${compose[*]} ps"
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
