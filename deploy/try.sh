#!/bin/sh
# Runs Lictory on this computer for evaluation, from a published release:
#
#   curl -fsSL https://raw.githubusercontent.com/chricarp/lictory/main/deploy/try.sh | sh
#
# Linux, macOS and Windows (in a WSL terminal) with Docker Desktop or Docker
# Engine; no root, systemd or DNS. It downloads the release's release.env
# (the image digests), copies the release's own compose file and database
# role script out of its ops image into ~/lictory-try, adds Mailpit for email,
# generates the secrets, starts everything on http://localhost and creates the
# first administrator. Running it again starts a stopped trial or moves it to
# the newest release; the data stays. NOT FOR PRODUCTION: plain HTTP,
# secrets in a local file, no backups. Servers use get.sh + `lictory install`.
# See docs/operations/self-hosting.md#try-lictory-on-a-laptop.
#
# Variables:
#   LICTORY_VERSION         a release such as 0.24.0 (default: the newest stable)
#   LICTORY_TRY_DIR         where the trial lives (default ~/lictory-try)
#   LICTORY_TRY_PORT        port of http://localhost (default 80, else 8080…)
#   LICTORY_TRY_MAIL_PORT   port of the Mailpit inbox (default 8025, else 8026…)
#   LICTORY_ADMIN_EMAIL     the first administrator (default admin@example.com)
#   LICTORY_ADMIN_PASSWORD  their password (default: generated and printed)
#   LICTORY_ORGANIZATION    the organization they own (default Evaluation)
#   LICTORY_REPOSITORY / LICTORY_IMAGE_REGISTRY  a fork's releases and images
set -eu

# Everything runs from main, so a truncated download executes nothing.
main() {
  repository="${LICTORY_REPOSITORY:-chricarp/lictory}"
  registry="${LICTORY_IMAGE_REGISTRY:-ghcr.io/chricarp}"
  version="${LICTORY_VERSION:-}"
  dir="${LICTORY_TRY_DIR:-$HOME/lictory-try}"
  admin_email="${LICTORY_ADMIN_EMAIL:-admin@example.com}"
  organization="${LICTORY_ORGANIZATION:-Evaluation}"
  [ "$#" -eq 0 ] || fail "try.sh takes no arguments; stop or remove the trial with the docker compose commands it prints."

  say "Lictory trial: for evaluation on this computer, not for production."
  check_docker
  printf '%s' "$repository" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || fail "Invalid LICTORY_REPOSITORY."
  printf '%s' "$registry" | grep -Eq '^[a-z0-9.-]+(:[0-9]+)?(/[a-z0-9._-]+)+$' || fail "Invalid LICTORY_IMAGE_REGISTRY."

  mkdir -p "$dir/postgres"
  dir=$(cd "$dir" && pwd)
  cd "$dir"
  log="$dir/try.log"
  : >"$log"

  fetch_release
  extract_bundle
  configure
  start_services
  create_administrator
  summary
}

check_docker() {
  command -v curl >/dev/null 2>&1 || fail "curl is required."
  command -v docker >/dev/null 2>&1 ||
    fail "Docker is required: Docker Desktop on macOS and Windows (https://docs.docker.com/desktop/), Docker Engine on Linux (https://docs.docker.com/engine/install/)."
  docker version >/dev/null 2>&1 ||
    fail "Cannot reach Docker. Start Docker Desktop (or the Docker service) and run this again. On Linux your user needs access to Docker (the docker group, or rootless Docker)."
  compose_version=$(docker compose version --short 2>/dev/null) ||
    fail "Docker Compose v2 is required (docker compose); update Docker Desktop, or install the docker-compose-plugin package."
  compose_version="${compose_version#v}"
  major="${compose_version%%.*}"
  minor="${compose_version#*.}"
  minor="${minor%%.*}"
  case "$major$minor" in *[!0-9]*) fail "Unrecognized Docker Compose version: $compose_version." ;; esac
  { [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 24 ]; }; } ||
    fail "Docker Compose 2.24 or newer is required (this is $compose_version); update Docker Desktop or the Compose plugin."
  memory=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
  case "$memory" in '' | *[!0-9]*) memory=0 ;; esac
  if [ "$memory" -gt 0 ] && [ "$memory" -lt 3000000000 ]; then
    say "Warning: Docker has $((memory / 1048576)) MB of memory; Lictory needs about 2 GB. Give Docker more in Docker Desktop's Settings > Resources if services restart."
  fi
}

# release.env of the chosen release: the image digests every service runs.
fetch_release() {
  base="https://github.com/$repository/releases"
  if [ -n "$version" ]; then
    printf '%s' "$version" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' ||
      fail "LICTORY_VERSION must be a release version such as 0.24.0."
    version="${version#v}"
    url="$base/download/v$version/release.env"
  else
    url="$base/latest/download/release.env"
  fi
  curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 -m 60 --retry 3 \
    -o "$dir/release.env.download" "$url" ||
    fail "Could not download $url. Check the version and this computer's internet access."
  # Only known keys with strictly formatted values; images pinned by digest.
  : >"$dir/release.env.checked"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      LICTORY_VERSION) pattern='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' ;;
      LICTORY_GIT_SHA) pattern='^[0-9a-f]{40}$' ;;
      LICTORY_CHANNEL) pattern='^(stable|nightly)$' ;;
      API_IMAGE | MARKETING_IMAGE | PROXY_IMAGE | MIGRATE_IMAGE | OPS_IMAGE)
        pattern="^$(printf '%s' "$registry" | sed 's/[.]/\\./g')/lictory-[a-z]+@sha256:[0-9a-f]{64}\$" ;;
      *) fail "The release file has an unexpected line ($key); nothing was started." ;;
    esac
    printf '%s' "$value" | grep -Eq "$pattern" || fail "The release file's $key is not valid; nothing was started."
    printf '%s=%s\n' "$key" "$value" >>"$dir/release.env.checked"
  done <"$dir/release.env.download"
  for key in LICTORY_VERSION LICTORY_CHANNEL API_IMAGE PROXY_IMAGE MIGRATE_IMAGE OPS_IMAGE; do
    [ -n "$(value_of "$dir/release.env.checked" "$key")" ] || fail "The release file has no $key."
  done
  release=$(value_of "$dir/release.env.checked" LICTORY_VERSION)
  [ -z "$version" ] || [ "$release" = "$version" ] || fail "The release file names version $release, not $version."
  mv "$dir/release.env.checked" "$dir/release.env"
  rm -f "$dir/release.env.download"
  say "Release $release ($(value_of "$dir/release.env" LICTORY_CHANNEL))"
}

# The release's own compose file and role script, from its ops image: the
# trial runs exactly what a server running this release runs.
extract_bundle() {
  ops=$(value_of "$dir/release.env" OPS_IMAGE)
  write_override
  # The files of this exact ops image are already here.
  if [ -f "$dir/compose.yaml" ] && [ -f "$dir/postgres/10-lictory-roles.sh" ] &&
    [ "$(cat "$dir/.bundle" 2>/dev/null || true)" = "$ops" ]; then
    return 0
  fi
  step "Downloading the release's deployment files"
  docker pull -q "$ops" >>"$log" 2>&1 || fail_with_log "Could not pull $ops."
  container=$(docker create "$ops") || fail "Could not read $ops."
  if docker cp "$container:/opt/lictory/deploy/compose.production.yaml" "$dir/compose.yaml.new" >>"$log" 2>&1 &&
    docker cp "$container:/opt/lictory/deploy/postgres/10-lictory-roles.sh" "$dir/postgres/10-lictory-roles.sh.new" >>"$log" 2>&1; then
    docker rm "$container" >/dev/null
  else
    docker rm "$container" >/dev/null 2>&1 || true
    fail_with_log "Could not copy the deployment files out of $ops."
  fi
  mv "$dir/compose.yaml.new" "$dir/compose.yaml"
  mv "$dir/postgres/10-lictory-roles.sh.new" "$dir/postgres/10-lictory-roles.sh"
  # Read by PostgreSQL's unprivileged user inside its container.
  chmod 0755 "$dir/postgres"
  chmod 0644 "$dir/postgres/10-lictory-roles.sh" "$dir/compose.yaml"
  printf '%s\n' "$ops" >"$dir/.bundle"
  # Only its files are needed (backups are not part of a trial); removing
  # the trial's images then leaves nothing behind.
  docker image rm "$ops" >>"$log" 2>&1 || true
  done_step
}

# The evaluation additions; the release's compose.yaml stays untouched.
write_override() {
  cat >"$dir/compose.override.yaml" <<'YAML'
# Written by try.sh on every run: what an evaluation adds to the release's
# compose.yaml. Every email Lictory sends lands in Mailpit's inbox.
name: lictory-try

services:
  mailpit:
    image: axllent/mailpit:v1.32@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    # internal: the API and worker deliver to mailpit:1025; edge: the inbox
    # is published on this computer only.
    networks: [internal, edge]
    ports:
      - "127.0.0.1:${LICTORY_TRY_MAIL_PORT:-8025}:8025"
    mem_limit: 128m
    environment:
      MP_MAX_MESSAGES: "1000"
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
YAML
}

configure() {
  if [ ! -f "$dir/.env" ]; then
    step "Generating secrets"
    rootless=false
    docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless && rootless=true
    port=$(choose_port "${LICTORY_TRY_PORT:-}" "$([ "$rootless" = true ] || echo '80 ')8080 8081 8082 8088 8090" "Lictory")
    mail_port=$(choose_port "${LICTORY_TRY_MAIL_PORT:-}" "8025 8026 8027 18025" "Mailpit")
    # Compose reads .env from this directory; mode 0600, never shared.
    (
      umask 077
      cat >"$dir/.env" <<EOF
# Lictory trial written by try.sh: evaluation only, NOT FOR PRODUCTION.
# Plain HTTP on this computer, generated secrets, email caught by Mailpit.
# Edit settings here (docs/operations/configuration.md), then run try.sh again.
# The stack's migration target: released images accept production or staging.
LICTORY_ENVIRONMENT=production
APP_HOST=localhost
ACME_EMAIL=unused@example.invalid
PROXY_SCHEME=http
LICTORY_DB_NAME=lictory

POSTGRES_SUPERUSER_PASSWORD=$(secret)
LICTORY_OWNER_PASSWORD=$(secret)
LICTORY_APP_PASSWORD=$(secret)
ZERO_DB_PASSWORD=$(secret)
LICTORY_OPS_PASSWORD=$(secret)
BETTER_AUTH_SECRET=$(secret)
DELIVERY_CREDENTIALS_KEY=$(secret)
ZERO_API_KEY=$(secret)
ZERO_ADMIN_PASSWORD=$(secret)

SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_FROM='Lictory <lictory@example.com>'

LICTORY_SIGNUP_MODE=invite
LICTORY_ORGANIZATION_CREATION=administrators
BACKUP_TARGET=none

# Sized for a laptop.
POSTGRES_SHARED_BUFFERS=256MB
POSTGRES_EFFECTIVE_CACHE_SIZE=512MB
POSTGRES_MAX_SLOT_WAL_KEEP_SIZE=2GB
POSTGRES_MEM_LIMIT=1g
EOF
    )
    set_key HTTP_PORT "$port"
    set_key LICTORY_TRY_MAIL_PORT "$mail_port"
    done_step
  else
    say "Using the existing trial in $dir"
    [ -z "${LICTORY_TRY_PORT:-}" ] || set_key HTTP_PORT "$(check_port_value "$LICTORY_TRY_PORT")"
    [ -z "${LICTORY_TRY_MAIL_PORT:-}" ] || set_key LICTORY_TRY_MAIL_PORT "$(check_port_value "$LICTORY_TRY_MAIL_PORT")"
  fi
  port=$(value_of "$dir/.env" HTTP_PORT)
  mail_port=$(value_of "$dir/.env" LICTORY_TRY_MAIL_PORT)
  url="http://localhost"
  [ "$port" = 80 ] || url="$url:$port"
  set_key PLATFORM_URL "$url"
  set_key HTTP_BINDING "127.0.0.1:$port:80"
  # 443 stays unused: Docker picks a free local port.
  set_key HTTPS_BINDING "127.0.0.1::443"
  # The release's image digests replace the previous ones; the rest of .env
  # (secrets, your edits) is kept.
  while IFS= read -r line; do
    set_key "${line%%=*}" "${line#*=}"
  done <"$dir/release.env"
}

# The order of a server deployment (deploy/deploy.sh): database, migrations,
# zero-cache's initial sync, the grants on its tables, then the services.
start_services() {
  say "Downloading images (the first run needs about 3 GB of disk)…"
  docker compose pull --quiet >>"$log" 2>&1 || fail_with_log "Could not download the images."
  step "Starting PostgreSQL and Mailpit"
  docker compose up -d --wait --wait-timeout 180 postgres mailpit >>"$log" 2>&1 ||
    fail_with_log "PostgreSQL or Mailpit did not start."
  roles
  done_step
  step "Applying database migrations"
  docker compose run --rm --no-deps -T migrate >>"$log" 2>&1 || fail_with_log "The migrations failed."
  done_step
  step "Starting realtime sync (zero-cache)"
  docker compose up -d --no-deps --wait --wait-timeout 900 zero-cache >>"$log" 2>&1 ||
    fail_with_log "zero-cache did not become healthy."
  # zero-cache creates its tables on first start; the API's role needs them.
  roles
  done_step
  step "Starting Lictory on $url"
  if ! docker compose up -d --no-deps --wait --wait-timeout 300 api worker collaboration proxy >>"$log" 2>&1; then
    grep -qiE 'address already in use|port is already allocated|bind' "$log" &&
      fail_with_log "Port $port or $mail_port is taken by another program. Choose others: LICTORY_TRY_PORT=8080 LICTORY_TRY_MAIL_PORT=8026, then run this again."
    fail_with_log "The services did not start."
  fi
  ready=false
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null -m 5 "$url/readyz" 2>/dev/null; then
      ready=true
      break
    fi
    sleep 2
  done
  [ "$ready" = true ] || fail_with_log "$url/readyz did not answer. Logs: cd '$dir' && docker compose logs api proxy"
  done_step
}

roles() {
  docker compose exec -T postgres sh /docker-entrypoint-initdb.d/10-lictory-roles.sh >>"$log" 2>&1 ||
    fail_with_log "Could not apply the database roles."
}

create_administrator() {
  credentials="$dir/administrator.txt"
  password="${LICTORY_ADMIN_PASSWORD:-}"
  if [ -z "$password" ] && [ -f "$credentials" ]; then
    password=$(value_of "$credentials" PASSWORD)
  fi
  [ -n "$password" ] || password=$(secret | cut -c1-20)
  case "$password" in *[[:space:]]*) fail "LICTORY_ADMIN_PASSWORD can't contain spaces." ;; esac
  [ "${#password}" -ge 10 ] && [ "${#password}" -le 64 ] || fail "LICTORY_ADMIN_PASSWORD must have 10 to 64 characters."
  step "Creating the first administrator"
  status=0
  printf '%s\n' "$password" | docker compose exec -T api node apps/api/dist/admin.js setup \
    --organization "$organization" --name "Lictory Admin" --email "$admin_email" \
    --password-stdin --json >"$dir/.admin-output" 2>>"$log" || status=$?
  case "$status" in
    0)
      (
        umask 077
        printf 'EMAIL=%s\nPASSWORD=%s\n' "$admin_email" "$password" >"$credentials"
      )
      created=true
      ;;
    3) created=false ;;
    *)
      cat "$dir/.admin-output" >>"$log"
      rm -f "$dir/.admin-output"
      fail_with_log "The first administrator was not created."
      ;;
  esac
  rm -f "$dir/.admin-output"
  done_step
}

summary() {
  say ""
  say "Lictory $release is running: $url"
  say "Evaluation only, not for production: plain HTTP, local secrets, no backups."
  say ""
  if [ "$created" = true ] || [ -f "$credentials" ]; then
    say "  Sign in        $(value_of "$credentials" EMAIL)"
    say "  Password       $(value_of "$credentials" PASSWORD)   (saved in $credentials)"
  else
    say "  Sign in        with the administrator created earlier"
  fi
  say "  Email inbox    http://localhost:$mail_port   (Mailpit: invitations and every other email)"
  say "  Admin console  $url/admin"
  say ""
  say "  Stop           cd '$dir' && docker compose stop"
  say "  Start again    run this command again"
  say "  Remove         cd '$dir' && docker compose down --volumes --rmi all && cd .. && rm -rf '$dir'"
  say ""
  say "Run Lictory for your team on a server: https://docs.lictory.com/self-hosting/install"
}

# choose_port <requested> <candidates> <what>: the requested port, or the
# first candidate nothing answers on.
choose_port() {
  if [ -n "$1" ]; then
    check_port_value "$1" >/dev/null
    port_free "$1" || fail "Port $1 is taken by another program; choose another for $3."
    printf '%s' "$1"
    return 0
  fi
  for candidate in $2; do
    if port_free "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  fail "Ports $2 are all taken; choose a free one for $3 (LICTORY_TRY_PORT or LICTORY_TRY_MAIL_PORT)."
}
check_port_value() {
  case "$1" in '' | *[!0-9]*) fail "Ports are numbers (got $1)." ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ] || fail "Ports are 1 to 65535 (got $1)."
  printf '%s' "$1"
}
# Free when the connection is refused (curl exit 7); anything else answers.
port_free() {
  rc=0
  curl -s -o /dev/null -m 2 "http://127.0.0.1:$1/" 2>/dev/null || rc=$?
  [ "$rc" -eq 7 ]
}

# set_key <key> <value>: replaces or adds one line of .env.
set_key() {
  (
    umask 077
    awk -v key="$1" 'index($0, key "=") != 1' "$dir/.env" >"$dir/.env.next"
    printf '%s=%s\n' "$1" "$2" >>"$dir/.env.next"
    mv "$dir/.env.next" "$dir/.env"
  )
}
value_of() { grep -E "^$2=" "$1" 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }
secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }

say() { printf '%s\n' "$*"; }
step() { printf '  %s… ' "$*"; }
done_step() { printf 'done\n'; }
fail() {
  printf '\nlictory try: %s\n' "$*" >&2
  exit 1
}
fail_with_log() {
  printf '\nlictory try: %s\n' "$1" >&2
  if [ -n "${log:-}" ] && [ -s "$log" ]; then
    printf -- '--- last lines of %s ---\n' "$log" >&2
    tail -n 20 "$log" >&2
  fi
  exit 1
}

main "$@"
