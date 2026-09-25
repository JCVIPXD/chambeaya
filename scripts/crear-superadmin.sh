#!/usr/bin/env bash
# Crea o restablece el primer superadmin (rol ADMIN) de una instalación de
# Chambeaya YA desplegada, ejecutando apps/api/src/cli/superadmin.ts (compilado
# a dist/src/cli/superadmin.js) dentro del contenedor "api" en marcha. Uso
# típico: otro superadmin además del que creó scripts/instalar-produccion.sh,
# o recuperar el acceso si se perdió la contraseña.
#
#   ./scripts/crear-superadmin.sh --email correo@dominio.com            # crea uno nuevo
#   ./scripts/crear-superadmin.sh --email correo@dominio.com --reset    # restablece su contraseña
#
# La contraseña se genera dentro del contenedor y se imprime una sola vez por
# stdout; este script nunca la ve, la pide ni la guarda.
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.production.yml"
ENV_FILE="$PROJECT_DIR/.env.production"
PROJECT_NAME="chambeaya-production"

EMAIL=""
RESET_FLAG=0

usage() {
  cat <<'EOF'
Uso: ./scripts/crear-superadmin.sh --email correo@dominio.com [--reset]

  --email CORREO   correo del superadmin a crear o restablecer (obligatorio)
  --reset          restablece la contraseña de un superadmin YA existente en
                    vez de crear uno nuevo (invalida todas sus sesiones
                    activas); falla si el correo no existe o no es ADMIN
  -h, --help       muestra esta ayuda

Sin --reset, crea un superadmin NUEVO: falla con un mensaje claro si ya existe
un usuario (de cualquier rol) con ese correo. Requiere que el contenedor "api"
del proyecto Docker "chambeaya-production" ya esté levantado
(scripts/instalar-produccion.sh o scripts/deploy-hosting.sh).
EOF
}

err() { printf '\n[crear-superadmin] ERROR: %s\n' "$1" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      [[ $# -ge 2 ]] || { err "Falta el valor de --email."; exit 2; }
      EMAIL="$2"
      shift 2
      ;;
    --reset) RESET_FLAG=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "Opción desconocida: $1"; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$EMAIL" ]]; then
  err "Falta --email."
  usage >&2
  exit 2
fi

command -v docker >/dev/null 2>&1 || { err "Docker no está instalado o no está en PATH."; exit 1; }
docker compose version >/dev/null 2>&1 || { err "Docker Compose v2 no está disponible (se invoca como 'docker compose')."; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { err "No se encontró $COMPOSE_FILE."; exit 1; }
if [[ ! -f "$ENV_FILE" ]]; then
  err "No se encontró $ENV_FILE. ¿Ya ejecutaste scripts/instalar-produccion.sh o scripts/deploy-hosting.sh?"
  exit 1
fi

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$COMPOSE_FILE")

api_container_id="$("${compose[@]}" ps -q api 2>/dev/null || true)"
if [[ -z "$api_container_id" ]]; then
  err "El contenedor 'api' del proyecto '$PROJECT_NAME' no está corriendo."
  echo "Levántalo primero con: ./scripts/deploy-hosting.sh" >&2
  exit 1
fi
api_running="$(docker inspect -f '{{.State.Running}}' "$api_container_id" 2>/dev/null || echo false)"
if [[ "$api_running" != "true" ]]; then
  err "El contenedor 'api' del proyecto '$PROJECT_NAME' existe pero no está en ejecución."
  echo "Levántalo primero con: ./scripts/deploy-hosting.sh" >&2
  exit 1
fi

mode="create"
[[ "$RESET_FLAG" -eq 1 ]] && mode="reset"

# "exec -T": sin pseudo-TTY. El comando nunca pide nada por stdin (la
# contraseña siempre se genera dentro del contenedor), así que no hace falta
# una TTY interactiva aquí.
"${compose[@]}" exec -T api node dist/src/cli/superadmin.js "$mode" --email "$EMAIL"
