#!/usr/bin/env bash
# Instalador de producción de Chambeaya: primera instalación en un servidor
# Ubuntu con Docker, y reconfiguración idempotente de Nginx del host en
# ejecuciones posteriores. Un solo dominio con 3 rutas (CN-20260925-006):
# "/" es la app del trabajador, "/empresas" el panel y "/api" la API. Uso:
#
#   git clone <repo> chambeaya && cd chambeaya
#   sudo ./scripts/instalar-produccion.sh
#
# o en modo no interactivo:
#
#   sudo ./scripts/instalar-produccion.sh --domain tudominio.com --certbot
#
# Después de la primera vez, cada actualización es:
#
#   git pull && ./scripts/deploy-hosting.sh
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.production"
NGINX_TEMPLATE="$PROJECT_DIR/deploy/nginx/chambeaya.conf.template"
NGINX_SITE_NAME="chambeaya.conf"
NEXT_BASE_PATH_VALUE="/empresas"
PROJECT_NAME="chambeaya-production"

DOMAIN=""
CHANGE_DOMAIN_FLAG=0
CERTBOT_FLAG=0
YES_FLAG=0
FORCE_NGINX=0
ADMIN_EMAIL=""
GOOGLE_CLIENT_ID_ARG=""
GOOGLE_CLIENT_ID_ARG_SET=0
ENV_BACKUP=""

# Archivos temporales propios (copia de seguridad de .env.production,
# configuración de Nginx renderizada) que deben desaparecer siempre al
# terminar el script, se haya usado o no cada uno; un solo trap EXIT
# acumulado evita que una sección posterior pise el trap de una anterior.
TEMP_FILES=()
cleanup_temp_files() { rm -f "${TEMP_FILES[@]}" 2>/dev/null || true; }
trap cleanup_temp_files EXIT

usage() {
  cat <<'EOF'
Uso: sudo ./scripts/instalar-produccion.sh [opciones]

  --domain DOMINIO   dominio público único (ej. tudominio.com); sirve la app
                      del trabajador en "/", el panel en "/empresas" y la API
                      en "/api"
  --change-domain    permite instalar sobre un .env.production existente con
                      un dominio DISTINTO al ya horneado en NEXT_PUBLIC_API_URL:
                      actualiza NEXT_PUBLIC_API_URL, API_BASE_URL y
                      CORS_ALLOWED_ORIGINS al nuevo dominio de forma coherente
                      y regenera Nginx. Sin este flag, un dominio distinto
                      aborta sin tocar nada (ver más abajo)
  --certbot          pide el certificado TLS con certbot sin preguntar
  -y, --yes          responde "sí" a las confirmaciones (certbot) y nunca
                      pregunta el correo del primer superadmin (falla en
                      silencio con un aviso si falta --admin-email)
  --force-nginx      reemplaza un chambeaya.conf ya instalado aunque tenga
                      bloques de Certbot (hace copia de seguridad antes; sin
                      este flag, si detecta Certbot y algo cambió, no lo toca)
  --admin-email CORREO  correo del primer superadmin (rol ADMIN); si no existe
                      ningún superadmin todavía, se crea con este correo al
                      final de la instalación, en modo no interactivo
  --google-client-id ID  Client ID de Google OAuth para "Ingresar con Google"
                      (termina en .apps.googleusercontent.com); en un
                      .env.production existente, actualiza esa única variable
                      (se reconstruye worker-app al terminar). Sin este flag
                      se pregunta en modo interactivo solo al crear un
                      .env.production nuevo; puede dejarse vacío para
                      desactivar el login con Google por ahora
  -h, --help         muestra esta ayuda

Sin el dominio por flag, el script lo pide de forma interactiva. Se acepta
con o sin "http(s)://" y barra final (se normaliza); debe ser un nombre de
host válido.
Si se pasa por flag, el script no hace ninguna pregunta sobre el dominio.

Es idempotente: si .env.production ya existe, reutiliza la contraseña de
PostgreSQL y los puertos ya elegidos (nunca los regenera) y solo actualiza la
configuración de Nginx del host con el dominio indicado. Tampoco crea un
segundo superadmin ni cambia la contraseña del que ya exista: --admin-email
solo tiene efecto si todavía no hay ninguno.

TODAS las validaciones (formato del dominio, choques de server_name con otro
sitio de Nginx, presencia de Nginx) se hacen antes de escribir nada en disco:
si algo falla, el script aborta dejando .env.production y la config de Nginx
exactamente como estaban.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) [[ $# -ge 2 ]] || { echo "Falta el valor de --domain" >&2; exit 2; }; DOMAIN="$2"; shift 2 ;;
    --change-domain) CHANGE_DOMAIN_FLAG=1; shift ;;
    --certbot) CERTBOT_FLAG=1; shift ;;
    -y|--yes) YES_FLAG=1; shift ;;
    --force-nginx) FORCE_NGINX=1; shift ;;
    --admin-email) [[ $# -ge 2 ]] || { echo "Falta el valor de --admin-email" >&2; exit 2; }; ADMIN_EMAIL="$2"; shift 2 ;;
    --google-client-id) [[ $# -ge 2 ]] || { echo "Falta el valor de --google-client-id" >&2; exit 2; }; GOOGLE_CLIENT_ID_ARG="$2"; GOOGLE_CLIENT_ID_ARG_SET=1; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf '\n[instalar-produccion] %s\n' "$1"; }
err() { printf '\n[instalar-produccion] ERROR: %s\n' "$1" >&2; }

is_interactive() { [[ -t 0 && -t 1 ]]; }

# --- 1. Docker y Compose v2 ---------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  err "Docker no está instalado. Instálalo antes de continuar, por ejemplo:"
  cat >&2 <<'EOF'
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"   # y vuelve a iniciar sesión
EOF
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "Docker Compose v2 no está disponible (se invoca como 'docker compose', no 'docker-compose')."
  echo "Instálalo con: sudo apt-get update && sudo apt-get install -y docker-compose-plugin" >&2
  exit 1
fi
log "Docker y Compose v2 disponibles: $(docker --version), $(docker compose version --short 2>/dev/null || echo 'v2')."

# --- 2. Dominio --------------------------------------------------------------
# Nombre de host razonable: etiquetas alfanuméricas (con guiones internos) de
# hasta 63 caracteres, separadas por puntos, terminando en un TLD de al menos
# 2 letras. No es RFC-completo, pero basta para descartar URLs completas,
# rutas o basura antes de escribir nada en disco o en la config de Nginx.
HOSTNAME_RE='^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'

normalize_domain() {
  # Admite que el usuario pegue "https://dominio.com/" por error: quita
  # esquema, cualquier ruta/consulta después del primer "/" y un punto final.
  local d="$1"
  d="${d#http://}"
  d="${d#https://}"
  d="${d%%/*}"
  d="${d%.}"
  printf '%s' "$d"
}

validate_domain_or_die() {
  local domain="$1"
  if [[ ! "$domain" =~ $HOSTNAME_RE ]]; then
    err "El dominio ('$domain') no es un nombre de host válido (ej. tudominio.com). No se escribió nada."
    exit 2
  fi
}

if [[ -n "$DOMAIN" ]]; then
  DOMAIN="$(normalize_domain "$DOMAIN")"
  validate_domain_or_die "$DOMAIN"
elif is_interactive; then
  value=""
  while :; do
    read -r -p "Dominio público de Chambeaya (ej. tudominio.com): " value
    value="$(normalize_domain "$value")"
    if [[ "$value" =~ $HOSTNAME_RE ]]; then
      break
    fi
    echo "  '$value' no parece un nombre de host válido; inténtalo de nuevo." >&2
    value=""
  done
  DOMAIN="$value"
else
  err "Falta el dominio. Pásalo con --domain o ejecuta el script en una terminal interactiva."
  exit 2
fi
log "Dominio: $DOMAIN (rutas: / -> app del trabajador, /empresas -> panel, /api -> API)"

# --- 2.5 Client ID de Google OAuth (opcional) -------------------------------
# Motivo (CN-20260925-alcance-A): sin este paso, una reinstalación regenera
# .env.production con GOOGLE_OAUTH_WEB_CLIENT_ID vacío y la app oculta el
# botón de Google sin ningún aviso (worker-app lo lee como ARG de build,
# apps/mobile_flutter/Dockerfile.production:30,36; la API lo lee en runtime,
# google_identity.ts). Cambiarlo exige reconstruir worker-app, lo que ya hace
# el paso 6 (deploy-hosting.sh, "up -d --build") con el valor que se escriba
# aquí en .env.production.
GOOGLE_CLIENT_ID_RE='^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$'

validate_google_client_id_or_die() {
  local value="$1"
  [[ -z "$value" ]] && return 0
  if [[ ! "$value" =~ $GOOGLE_CLIENT_ID_RE ]]; then
    err "El Client ID de Google ('$value') no tiene el formato esperado (algo como 123456789-abc123.apps.googleusercontent.com). No se escribió nada."
    exit 2
  fi
}

# Valor a escribir SOLO si se crea un .env.production nuevo en este mismo
# proceso (ver sección 4): con uno ya existente, actualizarlo silenciosamente
# aquí sería sorprendente si el operador solo quería reconfigurar Nginx; ese
# caso se resuelve más abajo, y únicamente cuando el flag es explícito.
GOOGLE_CLIENT_ID=""
if [[ "$GOOGLE_CLIENT_ID_ARG_SET" -eq 1 ]]; then
  validate_google_client_id_or_die "$GOOGLE_CLIENT_ID_ARG"
  GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID_ARG"
elif [[ ! -f "$ENV_FILE" ]] && is_interactive; then
  read -r -p "Client ID de Google OAuth para 'Ingresar con Google' (vacío para desactivarlo por ahora, ej. 123456789-abc.apps.googleusercontent.com): " GOOGLE_CLIENT_ID
  while [[ -n "$GOOGLE_CLIENT_ID" && ! "$GOOGLE_CLIENT_ID" =~ $GOOGLE_CLIENT_ID_RE ]]; do
    echo "  '$GOOGLE_CLIENT_ID' no tiene el formato esperado (...apps.googleusercontent.com); déjalo vacío o corrígelo." >&2
    read -r -p "Client ID de Google OAuth (vacío para desactivarlo): " GOOGLE_CLIENT_ID
  done
fi
# Este aviso solo aplica al crear un .env.production NUEVO: si ya existe uno,
# lo que importa es su valor YA guardado (que aquí todavía no se leyó), no
# esta variable de la corrida actual; ese caso se avisa más abajo, en la
# rama que sí lee el archivo existente.
if [[ ! -f "$ENV_FILE" && -z "$GOOGLE_CLIENT_ID" ]]; then
  log "AVISO: sin Client ID de Google (GOOGLE_OAUTH_WEB_CLIENT_ID), 'Ingresar con Google' quedará desactivado."
fi

# --- 3. Nginx: presencia y choques de dominio (ANTES de escribir nada) ------
# MEDIO-N1 de CN-20260925-004: esta detección y el chequeo de conflictos de
# `server_name` corrían después de crear/actualizar .env.production. Un
# dominio en conflicto abortaba el script, pero .env.production ya había
# quedado escrito con ese dominio. Ahora TODAS las validaciones (dominio,
# Nginx, conflictos) se hacen antes de tocar el disco, así que un aborto aquí
# deja .env.production exactamente como estaba (sin crear, en una instalación
# nueva).
if [[ ! -f "$NGINX_TEMPLATE" ]]; then
  err "No se encontró la plantilla $NGINX_TEMPLATE."
  exit 1
fi

# BAJO-3 de CN-20260925-002: detectar Nginx solo por directorios daba falsos
# positivos (p. ej. un paquete que dejó /etc/nginx/conf.d/ sin el binario
# instalado). Exigimos también el binario.
nginx_available_dir=""
nginx_enabled_dir=""
if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]; then
  nginx_available_dir="/etc/nginx/sites-available"
  nginx_enabled_dir="/etc/nginx/sites-enabled"
elif [[ -d /etc/nginx/conf.d ]]; then
  nginx_available_dir="/etc/nginx/conf.d"
fi

nginx_present=0
if command -v nginx >/dev/null 2>&1 && [[ -n "$nginx_available_dir" ]]; then
  nginx_present=1
fi

target_file=""
[[ -n "$nginx_available_dir" ]] && target_file="$nginx_available_dir/$NGINX_SITE_NAME"
own_enabled_link=""
[[ -n "$nginx_enabled_dir" ]] && own_enabled_link="$nginx_enabled_dir/$NGINX_SITE_NAME"

# ALTO-3 de CN-20260925-002: si el dominio ya es el server_name de OTRO sitio
# activo, `nginx -t` solo avisa ("conflicting server name ... ignored",
# código 0) y Chambeaya podría quedarse con el tráfico de ese otro proyecto
# según el orden alfabético. Se revisa `nginx -T` (la config ya combinada)
# ANTES de instalar nada, ignorando lo que venga de nuestro propio archivo
# (reinstalación con el mismo dominio no es un conflicto). `nginx -T`
# reporta la ruta tal como se incluyó: si el sitio se activa vía symlink en
# sites-enabled (el caso normal), reporta esa ruta, no la de sites-available;
# hay que excluir ambas.
check_server_name_conflict() {
  command -v nginx >/dev/null 2>&1 || return 0
  local dump
  dump="$(nginx -T 2>/dev/null)" || return 0
  local current_file="" line d conflict_found=0
  while IFS= read -r line; do
    case "$line" in
      "# configuration file "*:)
        current_file="${line#"# configuration file "}"
        current_file="${current_file%:}"
        continue
        ;;
    esac
    if [[ -n "$target_file" && "$current_file" == "$target_file" ]]; then
      continue
    fi
    if [[ -n "$own_enabled_link" && "$current_file" == "$own_enabled_link" ]]; then
      continue
    fi
    if [[ "$line" =~ server_name[[:space:]]+([^\;]+)\; ]]; then
      for d in ${BASH_REMATCH[1]}; do
        if [[ "$d" == "$DOMAIN" ]]; then
          err "El dominio '$DOMAIN' ya está en uso como server_name en $current_file."
          conflict_found=1
        fi
      done
    fi
  done <<<"$dump"
  if [[ "$conflict_found" -eq 1 ]]; then
    echo "Instalar Chambeaya ahí le robaría el tráfico a ese otro sitio. Elige otro dominio" >&2
    echo "o corrige/retira esa configuración antes de volver a ejecutar este instalador." >&2
    echo "No se escribió ni se cambió nada (ni .env.production ni Nginx)." >&2
    exit 1
  fi
}

if [[ "$nginx_present" -eq 1 ]]; then
  check_server_name_conflict
fi

# --- 4. .env.production ----------------------------------------------------
random_password() {
  # Solo alfanumérico: evita caracteres que rompan la URL de conexión de
  # Postgres (":", "@", "/", "?", "#", etc.) en DATABASE_URL.
  # `head -c 32` cierra la tubería en cuanto tiene sus bytes, así que `tr`
  # recibe SIGPIPE y termina con código distinto de cero; con `set -o
  # pipefail` eso abortaría el script aunque la contraseña ya se generó bien
  # (el contenido capturado por la sustitución de comandos es correcto,
  # SIGPIPE solo afecta el código de salida). El `|| true` evita ese aborto
  # espurio.
  tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 32 || true
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    # Evita "| grep -q .": grep cierra la tubería en cuanto encuentra una
    # coincidencia, 'ss' recibe SIGPIPE y termina con código distinto de
    # cero, y con "set -o pipefail" ese código (no el de grep) es el que
    # devolvería la tubería, dando un falso "puerto libre" para un puerto
    # que sí está ocupado. Capturar la salida evita ese problema.
    local listeners
    listeners="$(ss -H -ltn "sport = :${port}" 2>/dev/null)" || true
    [[ -n "$listeners" ]]
    return $?
  fi
  # Alternativa si 'ss' no está disponible (poco común en Ubuntu moderno).
  (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1
}

find_free_port() {
  local start="$1"
  shift
  local reserved=("$@")
  local port="$start"
  while :; do
    local busy=0
    for r in "${reserved[@]:-}"; do
      [[ "$port" == "$r" ]] && busy=1 && break
    done
    if [[ "$busy" -eq 0 ]] && ! port_in_use "$port"; then
      printf '%s' "$port"
      return
    fi
    port=$((port + 1))
  done
}

get_env_var() {
  local var_name="$1" file="$2"
  sed -n "s/^${var_name}=//p" "$file" | head -n 1
}

set_env_var_if_missing() {
  # Añade VAR=valor a .env.production solo si la variable no existe ya
  # (no la toca si ya está definida, aunque el valor sea distinto).
  local var_name="$1" value="$2" file="$3"
  if ! grep -Eq "^${var_name}=" "$file"; then
    printf '%s=%s\n' "$var_name" "$value" >>"$file"
    log "Añadida variable nueva a .env.production: $var_name=$value"
  fi
}

update_env_var() {
  # A diferencia de set_env_var_if_missing, SOBRESCRIBE un valor existente
  # (o lo añade si falta). Solo se usa cuando el operador pide el cambio de
  # forma explícita por flag (--change-domain, --google-client-id): nunca a
  # partir de una inferencia del script. Se usa awk en vez de "sed
  # s/.../.../ ": los valores reales (https://dominio/api) llevan "/", que
  # rompería un sed con "/" como delimitador; awk sustituye el campo entero
  # como texto literal, sin interpretarlo como patrón.
  #
  # BAJO-1 de CN-20260926-002: pasar el valor con "awk -v val=..." hace que
  # awk le aplique SUS PROPIOS escapes de estilo C (documentado en gawk):
  # "a\nb" queda como una salto de línea real dentro de .env.production
  # (dos líneas en vez de una) y "c\d" queda "cd" (la barra desaparece). Se
  # pasa el valor por el entorno del proceso (ENVIRON) en vez de "-v": los
  # valores de entorno no pasan por ese procesamiento de escapes, así que
  # llegan a awk byte a byte. Hoy ningún llamador pasa "\" (dominios y el
  # Client ID de Google están validados contra un patrón que no lo permite),
  # pero la función debe ser segura para cualquier valor futuro.
  local var_name="$1" value="$2" file="$3" tmp
  if grep -Eq "^${var_name}=" "$file"; then
    tmp="$(mktemp)"
    UPDATE_ENV_VAR_VALUE="$value" awk -v var="$var_name" -F'=' '
      { if ($1 == var) { print var "=" ENVIRON["UPDATE_ENV_VAR_VALUE"] } else { print } }
    ' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$var_name" "$value" >>"$file"
  fi
}

# Dominio horneado en NEXT_PUBLIC_API_URL de un .env.production dado (o
# cadena vacía si la variable no existe o está vacía). Se usa tanto para
# detectar un --domain distinto al ya guardado como, más abajo, para el
# chequeo final de coherencia contra el sitio de Nginx realmente instalado.
domain_from_next_public_api_url() {
  local file="$1" url
  url="$(get_env_var NEXT_PUBLIC_API_URL "$file")"
  url="${url#https://}"
  url="${url#http://}"
  url="${url%%/*}"
  printf '%s' "$url"
}

# MEDIO-1 de CN-20260926-004: restaura .env.production desde la copia de
# seguridad tomada al entrar a la sección 4 (solo existe si el archivo ya
# existía al empezar esta corrida). Se llama junto con
# restore_previous_nginx_state en los 3 puntos donde la sección de Nginx
# falla (el trap y los dos mensajes específicos de nginx -t/reload): así
# una corrida que cambió .env.production pero no pudo aplicar ese cambio en
# Nginx termina con AMBOS exactamente como estaban antes de ejecutar, no
# solo Nginx. Sin esto, un reintento posterior con el mismo --domain ya no
# vería ningún dominio distinto que revisar (el .env ya tendría el nuevo) y
# omitiría Nginx en silencio si el sitio sigue con certbot.
restore_env_backup() {
  if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
    cp -p "$ENV_BACKUP" "$ENV_FILE"
  fi
}

if [[ -f "$ENV_FILE" ]]; then
  # Copia de seguridad transaccional: TODA modificación de .env.production
  # en esta corrida (compatibilidad de variables nuevas, --change-domain,
  # --google-client-id) parte de este snapshot. Si más abajo falla la
  # sección de Nginx, restore_env_backup la restaura completa, no solo el
  # cambio de dominio.
  ENV_BACKUP="$(mktemp)"
  TEMP_FILES+=("$ENV_BACKUP")
  cp -p "$ENV_FILE" "$ENV_BACKUP"

  # .env corrupto por una ejecución antigua que no normalizaba los dominios
  # (p. ej. "https://https://..."). No lo intentamos reparar a ciegas: el
  # operador debe revisarlo, porque no hay forma segura de saber cuál era la
  # intención.
  if grep -Eq '^(NEXT_PUBLIC_API_URL|API_BASE_URL)=https?://https?://' "$ENV_FILE"; then
    err "$ENV_FILE tiene un esquema duplicado (https://https://...) en NEXT_PUBLIC_API_URL o API_BASE_URL."
    echo "Probablemente viene de una ejecución anterior sin validar dominios. Corrige esas" >&2
    echo "líneas a mano (deben terminar en /api sin esquema duplicado) y vuelve a ejecutar." >&2
    exit 1
  fi

  # CN-20260925-006: el esquema anterior (CN-20260925-001 a 005) usaba 3
  # subdominios (API_DOMAIN/PANEL_DOMAIN/APP_DOMAIN) y por lo tanto
  # CORS_ALLOWED_ORIGINS con 2+ orígenes separados por coma, sin
  # NEXT_BASE_PATH (esa variable no existía). Nadie llegó a desplegar así en
  # producción real, pero por si alguien lo probó: no se migra solo, porque
  # requiere decidir un único dominio nuevo y volver a pedir certificados.
  if ! grep -Eq '^NEXT_BASE_PATH=' "$ENV_FILE"; then
    existing_cors_check="$(get_env_var CORS_ALLOWED_ORIGINS "$ENV_FILE")"
    if [[ "$existing_cors_check" == *,* ]]; then
      err "$ENV_FILE parece del esquema anterior de 3 subdominios (sin NEXT_BASE_PATH y con más de un origen en CORS_ALLOWED_ORIGINS)."
      echo "Este instalador ya no genera esa configuración: ahora todo cuelga de un solo" >&2
      echo "dominio con rutas (/ app, /empresas panel, /api API). Migración manual:" >&2
      echo "  1. Detén los servicios (sin borrar volúmenes): ./scripts/deploy-hosting.sh" >&2
      echo "     no lo hace por sí solo; usa 'docker compose -p chambeaya-production ... down'." >&2
      echo "  2. En $ENV_FILE, deja un solo dominio real y reemplaza:" >&2
      echo "       NEXT_PUBLIC_API_URL=https://<dominio>/api" >&2
      echo "       API_BASE_URL=https://<dominio>/api" >&2
      echo "       CORS_ALLOWED_ORIGINS=https://<dominio>" >&2
      echo "     y añade:" >&2
      echo "       NEXT_BASE_PATH=/empresas" >&2
      echo "  3. Vuelve a ejecutar: sudo ./scripts/instalar-produccion.sh --domain <dominio>" >&2
      echo "  4. Actualiza el DNS a un solo registro apuntando a este servidor y, si usabas" >&2
      echo "     certbot con los 3 dominios viejos, pide un certificado nuevo para el único." >&2
      exit 1
    fi
  fi

  # BAJO-1 de CN-20260925-007: antes, un --domain distinto al ya horneado en
  # NEXT_PUBLIC_API_URL solo avisaba y el script seguía, dejando URLs
  # incoherentes (API_BASE_URL/CORS_ALLOWED_ORIGINS nuevos vs.
  # NEXT_PUBLIC_API_URL viejo) y el sitio anterior sin responder tras
  # regenerar Nginx con el dominio nuevo. Ahora aborta salvo --change-domain
  # explícito, que sí actualiza las 3 URLs derivadas del dominio de forma
  # coherente (se reconstruyen api/web/worker-app al llegar al paso 6).
  existing_domain="$(domain_from_next_public_api_url "$ENV_FILE")"
  if [[ -n "$existing_domain" && "$existing_domain" != "$DOMAIN" ]]; then
    if [[ "$CHANGE_DOMAIN_FLAG" -ne 1 ]]; then
      err "El dominio que pasaste ($DOMAIN) no coincide con el que ya tiene $ENV_FILE ($existing_domain, en NEXT_PUBLIC_API_URL)."
      echo "  No se cambió nada (ni .env.production ni Nginx). Si de verdad quieres mover" >&2
      echo "  Chambeaya a este dominio nuevo, repite con --change-domain: actualizará" >&2
      echo "  NEXT_PUBLIC_API_URL, API_BASE_URL y CORS_ALLOWED_ORIGINS de forma coherente," >&2
      echo "  regenerará la config de Nginx y reconstruirá los servicios." >&2
      echo "  Después tendrás que pedir un certificado TLS nuevo: sudo certbot --nginx -d $DOMAIN" >&2
      exit 1
    fi

    # MEDIO-1 de CN-20260926-002: en el caso real de producción, el sitio ya
    # instalado tiene bloques de Certbot (HTTPS). Sin --force-nginx, la
    # sección 5 (más abajo) detecta esos bloques y por diseño NO reemplaza
    # el archivo (para no perder el certificado): server_name se queda con
    # $existing_domain. Si dejáramos seguir a --change-domain de todos
    # modos, terminaría con código 0 habiendo actualizado .env.production y
    # reconstruido los servicios con $DOMAIN, pero Nginx seguiría sirviendo
    # (y certbot renovando) $existing_domain: la instalación quedaría caída
    # en silencio. Se detecta y aborta AQUÍ, antes de escribir nada, junto
    # con el resto de las validaciones previas (dominio, choques de
    # server_name).
    if [[ "$nginx_present" -eq 1 && -f "$target_file" ]] \
      && grep -q "managed by Certbot" "$target_file" 2>/dev/null \
      && [[ "$FORCE_NGINX" -ne 1 ]]; then
      err "--change-domain con un sitio de Nginx que ya tiene bloques de Certbot ($target_file) requiere --force-nginx."
      echo "  Sin --force-nginx, ese archivo no se reemplaza (para no perder el certificado" >&2
      echo "  ya emitido) y seguiría con server_name '$existing_domain', mientras que" >&2
      echo "  .env.production y los servicios reconstruidos apuntarían a '$DOMAIN': la" >&2
      echo "  instalación quedaría caída. No se cambió nada (ni .env.production ni Nginx)." >&2
      echo "  Repite con --change-domain --force-nginx (hace copia de seguridad del sitio" >&2
      echo "  actual antes de reemplazarlo) y luego pide un certificado nuevo:" >&2
      echo "    sudo certbot --nginx -d $DOMAIN" >&2
      exit 1
    fi

    log "AVISO: --change-domain actualiza $ENV_FILE de '$existing_domain' a '$DOMAIN' (antes -> ahora):"
    echo "  NEXT_PUBLIC_API_URL:   https://${existing_domain}/api -> https://${DOMAIN}/api" >&2
    echo "  API_BASE_URL:          $(get_env_var API_BASE_URL "$ENV_FILE") -> https://${DOMAIN}/api" >&2
    echo "  CORS_ALLOWED_ORIGINS:  $(get_env_var CORS_ALLOWED_ORIGINS "$ENV_FILE") -> https://${DOMAIN}" >&2
    update_env_var NEXT_PUBLIC_API_URL "https://${DOMAIN}/api" "$ENV_FILE"
    update_env_var API_BASE_URL "https://${DOMAIN}/api" "$ENV_FILE"
    update_env_var CORS_ALLOWED_ORIGINS "https://${DOMAIN}" "$ENV_FILE"
    log "Recuerda pedir un certificado TLS para el dominio nuevo: sudo certbot --nginx -d $DOMAIN"
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  log "No existe .env.production; generando uno nuevo con credenciales y puertos aleatorios."

  postgres_password="$(random_password)"
  if [[ -z "$postgres_password" || ${#postgres_password} -lt 24 ]]; then
    err "No se pudo generar una contraseña aleatoria de PostgreSQL."
    exit 1
  fi

  # Alcance E del plan de pagos: secreto del webhook (HMAC-SHA256 de
  # payments.service.ts), 64 caracteres aleatorios (bien por encima del
  # mínimo de 32 que exige assertPaymentConfig). Se genera siempre, aunque
  # PAYMENT_PROVIDER quede en "manual" (que no lo usa): así ya está listo el
  # día que se active un proveedor real, sin depender de que el operador
  # recuerde generarlo a mano.
  payment_webhook_secret="$(random_password)$(random_password)"
  if [[ -z "$payment_webhook_secret" || ${#payment_webhook_secret} -lt 32 ]]; then
    err "No se pudo generar el secreto aleatorio de PAYMENT_WEBHOOK_SECRET."
    exit 1
  fi

  api_port="$(find_free_port 4100)"
  web_port="$(find_free_port 3100 "$api_port")"
  app_port="$(find_free_port 8100 "$api_port" "$web_port")"

  postgres_user="chambeaya"
  postgres_db="chambeaya"
  database_url="postgresql://${postgres_user}:${postgres_password}@db:5432/${postgres_db}?schema=public"
  next_public_api_url="https://${DOMAIN}/api"
  api_base_url="https://${DOMAIN}/api"
  cors_allowed_origins="https://${DOMAIN}"

  cat >"$ENV_FILE" <<EOF
# Generado por scripts/instalar-produccion.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ).
# NUNCA regeneres POSTGRES_PASSWORD ni los puertos *_HOST_PORT a mano en una
# instancia con datos: PostgreSQL solo aplica POSTGRES_PASSWORD la primera vez
# que inicializa el volumen, así que un valor distinto en DATABASE_URL deja la
# API sin poder conectarse (Prisma P1000). scripts/instalar-produccion.sh es
# idempotente y nunca toca este archivo si ya existe.
POSTGRES_USER=${postgres_user}
POSTGRES_PASSWORD=${postgres_password}
POSTGRES_DB=${postgres_db}
DATABASE_URL=${database_url}

API_PORT=4000
API_HOST_PORT=${api_port}
WEB_HOST_PORT=${web_port}
APP_HOST_PORT=${app_port}

# Un solo dominio, tres rutas: "/" app del trabajador, "/empresas" panel,
# "/api" API (CN-20260925-006).
NEXT_PUBLIC_API_URL=${next_public_api_url}
API_BASE_URL=${api_base_url}
NEXT_BASE_PATH=${NEXT_BASE_PATH_VALUE}
CORS_ALLOWED_ORIGINS=${cors_allowed_origins}
# "1" = un salto de proxy (el Nginx del host de este instalador). NUNCA
# "true": eso haría que Express confiara en todo X-Forwarded-For, que
# controla el cliente, y cualquiera podría falsificar su IP con esa cabecera
# para saltarse el límite de intentos de /api/auth (CN-20260925-002, ALTO-1).
API_TRUST_PROXY=1

AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=20

GOOGLE_OAUTH_WEB_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_OAUTH_WEB_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_OAUTH_ANDROID_CLIENT_ID=
GOOGLE_OAUTH_IOS_CLIENT_ID=
DOCUMENT_STORAGE_DRIVER=
DOCUMENT_STORAGE_BUCKET=
DOCUMENT_STORAGE_ROOT=

# Alcance E del plan de pagos: capa de adaptadores + proveedor simulado, sin
# proveedor real contratado. "manual" es el único modo soportado en
# producción hoy (deploy-hosting.sh y assertPaymentConfig lo exigen salvo
# PAYMENT_SIMULATION_ALLOWED=true explícito). El secreto se generó aleatorio
# arriba y ya queda listo para cuando se active un proveedor real.
PAYMENT_PROVIDER=manual
PAYMENT_WEBHOOK_SECRET=${payment_webhook_secret}
PAYMENT_CHECKOUT_TTL_MINUTES=30
PAYMENT_SIMULATION_ALLOWED=
EOF
  log "Creado $ENV_FILE. Puertos elegidos: API=${api_port}, panel=${web_port}, app=${app_port}."
else
  log ".env.production ya existe: se reutiliza tal cual (contraseña y puertos NO se regeneran)."
  # Compatibilidad con instalaciones creadas antes de que existiera el
  # servicio worker-app: si faltan estas variables nuevas, se añaden con
  # valores derivados, sin tocar ninguna variable existente.
  if ! grep -Eq '^APP_HOST_PORT=' "$ENV_FILE"; then
    existing_api_port="$(get_env_var API_HOST_PORT "$ENV_FILE")"
    existing_web_port="$(get_env_var WEB_HOST_PORT "$ENV_FILE")"
    app_port="$(find_free_port 8100 "${existing_api_port:-4100}" "${existing_web_port:-3100}")"
    set_env_var_if_missing APP_HOST_PORT "$app_port" "$ENV_FILE"
  fi
  set_env_var_if_missing API_BASE_URL "https://${DOMAIN}/api" "$ENV_FILE"
  set_env_var_if_missing NEXT_BASE_PATH "$NEXT_BASE_PATH_VALUE" "$ENV_FILE"
  set_env_var_if_missing API_TRUST_PROXY "1" "$ENV_FILE"

  # Alcance E del plan de pagos: compatibilidad con un .env.production
  # creado antes de que existieran estas variables. "manual" y las otras dos
  # vacías/por defecto son un no-op en la API (mismo comportamiento que sin
  # ellas); el secreto se genera solo si falta, nunca se sobrescribe uno
  # existente (mismo patrón que POSTGRES_PASSWORD: es un secreto ligado a lo
  # que ya esté configurado, no algo que este instalador deba regenerar en
  # cada ejecución).
  set_env_var_if_missing PAYMENT_PROVIDER "manual" "$ENV_FILE"
  if ! grep -Eq '^PAYMENT_WEBHOOK_SECRET=[^[:space:]]+' "$ENV_FILE"; then
    generated_webhook_secret="$(random_password)$(random_password)"
    if [[ -z "$generated_webhook_secret" || ${#generated_webhook_secret} -lt 32 ]]; then
      err "No se pudo generar el secreto aleatorio de PAYMENT_WEBHOOK_SECRET."
      exit 1
    fi
    if grep -Eq '^PAYMENT_WEBHOOK_SECRET=' "$ENV_FILE"; then
      update_env_var PAYMENT_WEBHOOK_SECRET "$generated_webhook_secret" "$ENV_FILE"
    else
      set_env_var_if_missing PAYMENT_WEBHOOK_SECRET "$generated_webhook_secret" "$ENV_FILE"
    fi
    log "Generado PAYMENT_WEBHOOK_SECRET en $ENV_FILE (faltaba o estaba vacío)."
  fi
  set_env_var_if_missing PAYMENT_CHECKOUT_TTL_MINUTES "30" "$ENV_FILE"
  set_env_var_if_missing PAYMENT_SIMULATION_ALLOWED "" "$ENV_FILE"

  existing_trust_proxy="$(get_env_var API_TRUST_PROXY "$ENV_FILE")"
  if [[ "$existing_trust_proxy" == "true" ]]; then
    log "AVISO DE SEGURIDAD: API_TRUST_PROXY=true en $ENV_FILE permite falsificar la IP de origen"
    echo "  y saltarse el límite de intentos de /api/auth (CN-20260925-002, ALTO-1)." >&2
    echo "  Cámbialo a API_TRUST_PROXY=1 a mano (un salto: el Nginx del host) y vuelve a" >&2
    echo "  ejecutar ./scripts/deploy-hosting.sh. No se cambia automáticamente para no" >&2
    echo "  alterar en silencio una variable que ya configuraste." >&2
  fi

  # Client ID de Google: solo se actualiza un .env.production existente
  # cuando el operador lo pide de forma explícita con --google-client-id (a
  # diferencia de POSTGRES_PASSWORD o los puertos, es una credencial externa
  # reconfigurable en la consola de Google Cloud, no un secreto generado aquí
  # ligado a datos ya escritos). Sin el flag, nunca se toca a ciegas; solo se
  # avisa si sigue vacío, igual que el aviso de API_TRUST_PROXY de arriba.
  existing_google_client_id="$(get_env_var GOOGLE_OAUTH_WEB_CLIENT_ID "$ENV_FILE")"
  if [[ "$GOOGLE_CLIENT_ID_ARG_SET" -eq 1 ]]; then
    if [[ "$existing_google_client_id" == "$GOOGLE_CLIENT_ID_ARG" ]]; then
      log "GOOGLE_OAUTH_WEB_CLIENT_ID ya tenía ese valor en $ENV_FILE; sin cambios."
    else
      log "Actualizando GOOGLE_OAUTH_WEB_CLIENT_ID en $ENV_FILE (antes -> ahora):"
      echo "  antes: ${existing_google_client_id:-<vacío>}" >&2
      echo "  ahora: ${GOOGLE_CLIENT_ID_ARG:-<vacío>}" >&2
      update_env_var GOOGLE_OAUTH_WEB_CLIENT_ID "$GOOGLE_CLIENT_ID_ARG" "$ENV_FILE"
      log "Se reconstruirá worker-app con este valor al terminar (paso 6, deploy-hosting.sh)."
    fi
  elif [[ -z "$existing_google_client_id" ]]; then
    log "AVISO: GOOGLE_OAUTH_WEB_CLIENT_ID está vacío en $ENV_FILE; 'Ingresar con Google' seguirá desactivado."
    echo "  Pásalo con --google-client-id <id> o edítalo a mano en $ENV_FILE y ejecuta" >&2
    echo "  ./scripts/deploy-hosting.sh para reconstruir worker-app con el valor nuevo." >&2
  fi
fi

# MEDIO-1 de CN-20260925-002: corriendo con sudo, root crea/posee
# .env.production, y una actualización sin sudo ("./scripts/deploy-hosting.sh
# --pull", tal como lo documenta la meta de este instalador) fallaría al leer
# el archivo con un mensaje engañoso ("falta POSTGRES_USER"). La opción más
# simple para quien opera el servidor es que el archivo quede a nombre de la
# cuenta real (no root) desde el principio: así "sudo" solo hace falta la
# primera vez (para Nginx/systemd), y actualizar es un comando sin sudo, tal
# como promete la meta original ("en un par de comandos, sin rodeos"). La
# alternativa (exigir sudo también para actualizar) es más simple de
# implementar pero contradice esa meta y el propio README del flujo.
if [[ -n "${SUDO_USER:-}" && "$EUID" -eq 0 ]]; then
  sudo_group="$(id -gn "$SUDO_USER" 2>/dev/null || echo "$SUDO_USER")"
  if chown "$SUDO_USER:$sudo_group" "$ENV_FILE" 2>/dev/null; then
    log "Propietario de .env.production ajustado a $SUDO_USER (para actualizar sin sudo)."
  fi
fi
chmod 600 "$ENV_FILE"

api_port="$(get_env_var API_HOST_PORT "$ENV_FILE")"
web_port="$(get_env_var WEB_HOST_PORT "$ENV_FILE")"
app_port="$(get_env_var APP_HOST_PORT "$ENV_FILE")"
final_google_client_id="$(get_env_var GOOGLE_OAUTH_WEB_CLIENT_ID "$ENV_FILE")"
google_login_summary="DESACTIVADO (falta GOOGLE_OAUTH_WEB_CLIENT_ID)"
[[ -n "$final_google_client_id" ]] && google_login_summary="ACTIVO"

# --- 5. Instalar la configuración de Nginx del host -------------------------
rendered_conf="$(mktemp)"
TEMP_FILES+=("$rendered_conf")

sed \
  -e "s/__DOMAIN__/${DOMAIN}/g" \
  -e "s/__API_PORT__/${api_port}/g" \
  -e "s/__WEB_PORT__/${web_port}/g" \
  -e "s/__APP_PORT__/${app_port}/g" \
  "$NGINX_TEMPLATE" >"$rendered_conf"

if [[ "$nginx_present" -eq 0 ]]; then
  log "No se encontró Nginx en el host (falta el binario 'nginx' y/o sites-available|conf.d)."
  cp "$rendered_conf" "$PROJECT_DIR/deploy/nginx/chambeaya.conf.generado"
  log "Configuración generada en $PROJECT_DIR/deploy/nginx/chambeaya.conf.generado."
  echo "Instala Nginx (o el proxy inverso que uses) y copia ese archivo a su" >&2
  echo "carpeta de sitios, o adapta manualmente el bloque 'server' a tu proxy." >&2
elif [[ "$EUID" -ne 0 ]]; then
  cp "$rendered_conf" "$PROJECT_DIR/deploy/nginx/chambeaya.conf.generado"
  log "Se detectó Nginx en el host, pero este script no corre como root."
  echo "Vuelve a ejecutar con 'sudo' para instalar la configuración automáticamente, o" >&2
  echo "instálala a mano: copia $PROJECT_DIR/deploy/nginx/chambeaya.conf.generado a" >&2
  echo "$target_file y recarga Nginx tras 'nginx -t'." >&2
else
  # ALTO-2 de CN-20260925-002: volver a ejecutar el instalador NO debe (a)
  # sobrescribir sin respaldo un chambeaya.conf que Certbot ya modificó
  # (perdiendo HTTPS), ni (b) dejar, si algo falla, un symlink colgando en
  # sites-enabled que rompa `nginx -t`/`reload` para TODOS los proyectos del
  # servidor. Autocuración: un symlink roto que ya apuntara exactamente a
  # nuestro propio archivo (herencia de una versión anterior con el bug de
  # (b)) se trata como "no existía" y se recrea limpio más abajo.
  enabled_link=""
  [[ -n "$nginx_enabled_dir" ]] && enabled_link="$nginx_enabled_dir/$NGINX_SITE_NAME"
  if [[ -n "$enabled_link" && -L "$enabled_link" && ! -e "$enabled_link" ]]; then
    if [[ "$(readlink "$enabled_link")" == "$target_file" ]]; then
      log "Se encontró un symlink de Chambeaya en sites-enabled apuntando a un archivo que ya no existe; se limpia."
      rm -f "$enabled_link"
    fi
  fi

  had_file=0
  [[ -f "$target_file" ]] && had_file=1
  had_link=0
  [[ -n "$enabled_link" && -L "$enabled_link" ]] && had_link=1
  backup_file=""
  skip_install=0

  if [[ "$had_file" -eq 1 ]]; then
    if cmp -s "$target_file" "$rendered_conf"; then
      log "La configuración de Nginx ya instalada es idéntica a la generada; no se toca."
      skip_install=1
    elif grep -q "managed by Certbot" "$target_file" 2>/dev/null && [[ "$FORCE_NGINX" -ne 1 ]]; then
      cp "$rendered_conf" "$PROJECT_DIR/deploy/nginx/chambeaya.conf.generado"
      # BAJO-N2 de CN-20260925-004: no afirmar "algo cambió (dominios o
      # puertos)" — el archivo instalado siempre va a diferir del generado en
      # cuanto Certbot le agrega sus propios bloques 443/ssl, aunque el
      # dominio y los puertos sigan siendo exactamente los mismos.
      log "El $target_file instalado ya tiene bloques de Certbot (HTTPS) y es distinto al que se generaría ahora."
      echo "Puede ser solo por esos bloques de Certbot, o porque además cambiaron el dominio/puertos." >&2
      echo "No se sobrescribe para no perder esos certificados. Compáralo con el nuevo," >&2
      echo "guardado en $PROJECT_DIR/deploy/nginx/chambeaya.conf.generado, y si de verdad" >&2
      echo "quieres reemplazarlo (se hará copia de seguridad antes), repite con --force-nginx." >&2
      skip_install=1
    else
      backup_file="${target_file}.bak.$(date -u +%Y%m%d%H%M%S)"
      cp -p "$target_file" "$backup_file"
      log "Copia de seguridad del sitio anterior: $backup_file"
    fi
  fi

  if [[ "$skip_install" -eq 0 ]]; then
    # BAJO-N1 de CN-20260925-004: desde que se escribe target_file hasta que
    # termina de recargar con éxito, cualquier interrupción (Ctrl+C/SIGINT,
    # SIGTERM) debe dejar el sitio exactamente como estaba antes, igual que
    # el camino de fallo de `nginx -t` de más abajo. Se define una función
    # compartida y se arma el trap justo antes de la primera escritura.
    symlink_created=0
    restore_previous_nginx_state() {
      if [[ "$symlink_created" -eq 1 && -n "$enabled_link" ]]; then
        rm -f "$enabled_link"
      fi
      if [[ "$had_file" -eq 1 ]]; then
        cp -p "$backup_file" "$target_file" 2>/dev/null || true
      else
        rm -f "$target_file" 2>/dev/null || true
      fi
    }
    on_nginx_failure() {
      local exit_code=$?
      trap - INT TERM ERR
      restore_previous_nginx_state
      restore_env_backup
      if [[ "$exit_code" -eq 130 || "$exit_code" -eq 143 ]]; then
        err "Instalación de Nginx interrumpida; se restauró el estado anterior exacto (sin recargar)."
      else
        # BAJO-3 de CN-20260925-007: antes solo INT/TERM restauraban; un fallo
        # de comando (p. ej. "cp" con el disco lleno) escapaba sin restaurar
        # nada, dejando el sitio a medio escribir. El trap ERR (con "set -E"
        # ya activo desde el encabezado del script) cubre también ese caso.
        err "Falló la instalación de la configuración de Nginx (código $exit_code); se restauró el estado anterior exacto (sin recargar)."
      fi
      exit "$exit_code"
    }
    trap on_nginx_failure INT TERM ERR

    cp "$rendered_conf" "$target_file"

    if [[ -n "$enabled_link" && "$had_link" -eq 0 ]]; then
      ln -s "$target_file" "$enabled_link"
      symlink_created=1
    fi

    log "Validando configuración de Nginx (nginx -t)..."
    # `nginx -t` sale con código distinto de cero cuando la config no valida;
    # con "set -e" activo, "var=$(cmd)" fuera de una condicional aborta el
    # script EN ESE PUNTO en cuanto "cmd" falla, sin llegar nunca a la lógica
    # de restauración de abajo. Se desactiva "errexit" solo para esta línea
    # (y de igual manera para "systemctl reload" más abajo).
    #
    # BAJO-2 de CN-20260926-002: "set +e" desactiva errexit, pero NO desarma
    # el trap ERR (son independientes en bash): sin este "trap - ERR", el
    # fallo esperado de "nginx -t" disparaba igual on_nginx_failure, que
    # restauraba y salía con el mensaje GENÉRICO ("Falló la instalación...")
    # antes de llegar siquiera al "if" de abajo, tapando el mensaje
    # específico ("nginx -t falló..."). Se desarma ERR justo para este único
    # comando (INT/TERM siguen activos: un Ctrl+C aquí sigue restaurando) y
    # se vuelve a armar de inmediato para cualquier fallo inesperado
    # posterior.
    trap - ERR
    set +e
    nginx_test_output="$(nginx -t 2>&1)"
    nginx_test_status=$?
    set -e
    trap on_nginx_failure ERR
    echo "$nginx_test_output" >&2

    if [[ "$nginx_test_status" -eq 0 ]] && ! grep -qi "conflicting server name" <<<"$nginx_test_output"; then
      trap - ERR
      set +e
      systemctl reload nginx
      reload_status=$?
      set -e
      trap on_nginx_failure ERR
      if [[ "$reload_status" -ne 0 ]]; then
        err "systemctl reload nginx falló tras validar la config. Se restaura el estado anterior EXACTO."
        restore_previous_nginx_state
        restore_env_backup
        trap - INT TERM ERR
        exit 1
      fi
      trap - INT TERM ERR
      log "Nginx recargado con la configuración de Chambeaya en $target_file."
    else
      err "nginx -t falló (o reportó 'conflicting server name'). Se restaura el estado anterior EXACTO; no se recarga Nginx."
      # El symlink nunca queda colgando: si lo creamos en esta corrida, se
      # retira; si ya existía, se deja intacto (apuntará de nuevo a algo
      # válido en cuanto restauremos o borremos target_file más abajo, según
      # corresponda al estado previo).
      restore_previous_nginx_state
      restore_env_backup
      trap - INT TERM ERR
      if [[ "$had_file" -eq 1 ]]; then
        log "Restaurado $target_file desde $backup_file."
      fi
      exit 1
    fi
  fi

  if command -v certbot >/dev/null 2>&1; then
    run_certbot=0
    if [[ "$CERTBOT_FLAG" -eq 1 || "$YES_FLAG" -eq 1 ]]; then
      run_certbot=1
    elif is_interactive; then
      read -r -p "¿Pedir el certificado TLS con certbot para $DOMAIN ahora? [s/N] " answer
      [[ "$answer" =~ ^[sSyY] ]] && run_certbot=1
    fi
    if [[ "$run_certbot" -eq 1 ]]; then
      certbot --nginx -d "$DOMAIN"
    else
      log "certbot está disponible pero no se ejecutó. Hazlo cuando el DNS apunte al servidor:"
      echo "  sudo certbot --nginx -d ${DOMAIN}" >&2
    fi
  else
    log "certbot no está instalado; instálalo para HTTPS: sudo apt-get install -y certbot python3-certbot-nginx"
  fi
fi

# --- 5.5 Invariante final: .env y Nginx deben coincidir antes de desplegar --
# MEDIO-1 de CN-20260926-004 (segunda defensa, independiente de la copia de
# seguridad transaccional de arriba): si por CUALQUIER motivo
# .env.production y el sitio de Nginx REALMENTE instalado terminan en
# dominios distintos -- incluido cuando la sección de arriba decidió no
# tocar Nginx por los bloques de Certbot -- se aborta AQUÍ, antes de
# reconstruir y levantar los servicios con el dominio del .env. Sin este
# control, un reintento con --domain (sin --change-domain) no vería ningún
# dominio "distinto" que revisar en cuanto .env.production ya tuviera el
# dominio nuevo (por una corrida anterior, o por una edición manual), y
# --domain por sí solo nunca toca Nginx.
if [[ "$nginx_present" -eq 1 && -f "$target_file" ]]; then
  installed_domain="$(sed -n 's/^[[:space:]]*server_name[[:space:]]\+\([^;[:space:]]*\).*/\1/p' "$target_file" | head -n1)"
  final_env_domain="$(domain_from_next_public_api_url "$ENV_FILE")"
  if [[ -n "$installed_domain" && -n "$final_env_domain" && "$installed_domain" != "$final_env_domain" ]]; then
    err "$ENV_FILE apunta a '$final_env_domain', pero el sitio de Nginx instalado ($target_file) sigue con server_name '$installed_domain'."
    echo "  No se reconstruyen ni se levantan los servicios: quedarían compilados para" >&2
    echo "  '$final_env_domain' mientras Nginx sigue sirviendo '$installed_domain'. Para resolverlo:" >&2
    echo "    - si de verdad quieres mover Chambeaya a '$final_env_domain':" >&2
    echo "        sudo ./scripts/instalar-produccion.sh --domain $final_env_domain --change-domain --force-nginx" >&2
    echo "    - si '$final_env_domain' fue un error y quieres seguir en '$installed_domain':" >&2
    echo "        edita NEXT_PUBLIC_API_URL, API_BASE_URL y CORS_ALLOWED_ORIGINS en $ENV_FILE" >&2
    echo "        de vuelta a '$installed_domain' y vuelve a ejecutar este instalador." >&2
    exit 1
  fi
fi

# --- 6. Construir y levantar -------------------------------------------------
log "Construyendo y levantando los servicios con scripts/deploy-hosting.sh..."
"$PROJECT_DIR/scripts/deploy-hosting.sh"

# --- 7. Primer superadmin (solo si todavía no existe ninguno) --------------
# La base de datos arranca vacía: sin un superadmin (rol ADMIN), nadie puede
# crear empresas desde /empresas/admin (POST /api/admin/companies) y el
# registro público solo acepta trabajadores (BUSINESS_REGISTRATION_DISABLED).
# Este paso corre DESPUÉS de que deploy-hosting.sh confirmó que los 3
# servicios están sanos. Un fallo aquí NUNCA deshace el despliegue ya hecho
# ni toca Nginx: solo informa cómo reintentar con scripts/crear-superadmin.sh.
admin_compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$PROJECT_DIR/docker-compose.production.yml")
admin_summary=""

log "Comprobando si ya existe un superadmin..."
set +e
admin_status_output="$("${admin_compose[@]}" exec -T api node dist/src/cli/superadmin.js status 2>&1)"
admin_status_code=$?
set -e

if [[ "$admin_status_code" -eq 0 ]]; then
  log "Ya existe al menos un superadmin (rol ADMIN); no se crea ninguno nuevo."
elif [[ "$admin_status_code" -eq 1 ]]; then
  admin_email="$ADMIN_EMAIL"
  # BAJO-2 de CN-20260925-009: -y significa "no preguntes nada" (certbot ya
  # lo respeta); antes, en una terminal interactiva, -y seguía preguntando
  # este correo aunque no se pasara --admin-email. Con -y y sin
  # --admin-email se pasa directo al aviso de "no se pudo crear" de abajo.
  if [[ -z "$admin_email" ]] && is_interactive && [[ "$YES_FLAG" -ne 1 ]]; then
    read -r -p "Correo del primer superadmin (rol ADMIN, entra en https://${DOMAIN}/empresas/admin): " admin_email
  fi
  if [[ -z "$admin_email" ]]; then
    # Con -y (no interactivo) y sin --admin-email no hay ningún correo del que
    # partir. Adivinarlo o inventar uno sería inseguro y probablemente
    # incorrecto; lo seguro es NO crear nada y decirlo con claridad: los
    # servicios ya quedaron desplegados y correctos, y el operador puede
    # crear el superadmin en el momento que quiera, sin reinstalar nada.
    log "AVISO: no existe ningún superadmin y no se indicó --admin-email en modo no interactivo."
    echo "  El despliegue de los servicios terminó correctamente; esto NO lo afecta." >&2
    echo "  Crea el primer superadmin cuando quieras con:" >&2
    echo "    ./scripts/crear-superadmin.sh --email <correo>" >&2
  else
    set +e
    admin_create_output="$("${admin_compose[@]}" exec -T api node dist/src/cli/superadmin.js create --email "$admin_email" --if-none 2>&1)"
    admin_create_code=$?
    set -e
    if [[ "$admin_create_code" -eq 0 ]]; then
      log "Superadmin creado."
      admin_summary="$admin_create_output"
    else
      log "AVISO: no se pudo crear el superadmin automáticamente (código $admin_create_code)."
      echo "  El despliegue de los servicios terminó correctamente; esto NO lo afecta ni toca Nginx." >&2
      echo "  Detalle:" >&2
      while IFS= read -r admin_line; do echo "    $admin_line"; done <<<"$admin_create_output" >&2
      echo "  Reintenta con: ./scripts/crear-superadmin.sh --email <correo>" >&2
    fi
  fi
else
  log "AVISO: no se pudo comprobar si ya existe un superadmin (código $admin_status_code)."
  echo "  El despliegue de los servicios terminó correctamente; esto NO lo afecta." >&2
  echo "  Detalle:" >&2
  while IFS= read -r admin_line; do echo "    $admin_line"; done <<<"$admin_status_output" >&2
  echo "  Comprueba manualmente con: ./scripts/crear-superadmin.sh --email <correo>" >&2
fi

# --- 8. Resumen -------------------------------------------------------------
cat <<EOF

============================================================
 Chambeaya instalado
============================================================
 App trabajador:   https://${DOMAIN}/
 Panel web:        https://${DOMAIN}/empresas
 API:              https://${DOMAIN}/api/health

 Puertos locales (127.0.0.1): API=${api_port}, panel=${web_port}, app=${app_port}
 Login con Google: ${google_login_summary}

 Pendiente:
 - Crea 1 registro DNS tipo A hacia la IP pública de este servidor:
     ${DOMAIN}
 - Si usas Google Sign-In, autoriza el origen https://${DOMAIN} en la
   consola de Google Cloud.
 - Si aún no corriste certbot, hazlo en cuanto el DNS resuelva:
     sudo certbot --nginx -d ${DOMAIN}

 Actualizar en el futuro (sin sudo; ver docs/guides/deployment.md):
     git pull && ./scripts/deploy-hosting.sh
     ./scripts/deploy-hosting.sh --pull   # equivalente, en un solo comando
============================================================
EOF

if [[ -n "$admin_summary" ]]; then
  cat <<EOF

============================================================
 Primer superadmin
============================================================
$admin_summary
============================================================
EOF
fi
