#!/usr/bin/env bash
# Deploys, inspects and rolls back one Lictory environment on this server.
# Installed as <root>/bin/deploy.sh (root: LICTORY_ROOT, default /srv/lictory);
# release automation calls it over SSH through deploy/bin/lictory-remote.
# <env> is any configured environment (<root>/<env>/.env exists): production,
# staging, qa… See docs/operations/deployment.md.
#
#   deploy.sh <env> prepare < release.env   validate, store and pull a release
#   deploy.sh <env> migrate <version>       backup if needed, migrate, wait for Zero
#   deploy.sh <env> activate <version>      roll services, verify, make active
#   deploy.sh <env> release < release.env   prepare + migrate + activate
#   deploy.sh <env> rollback                re-activate the previous release's images
#   deploy.sh <env> backfill <version> <name>  run scripts/backfills/<name>.ts of a release
#   deploy.sh <env> status [--json]         active release and per-service state
#
# Order (Zero expand/contract): schema first, then wait until zero-cache has
# replicated it, then zero-cache, proxy (keeps old + new assets), API,
# worker and collaboration, website. Schema is never rolled back; rollbacks
# switch images only, so every migration must stay compatible with the
# previous release.
#
# LICTORY_DATABASE=external (docs/operations/external-database.md): no
# postgres container. Before migrating, the database's requirements are
# checked (database.mjs check) and grants are applied as the owning roles
# instead of the bundled superuser; no pre-deploy backup is taken (the
# provider's backups and point-in-time recovery cover the database). With
# DATABASE_ADMIN_URL in the environment (lictory install), the roles and
# databases are created first.
set -euo pipefail

environment="${1:?Usage: deploy.sh <environment> <command> [args]}"
command="${2:?Usage: deploy.sh <environment> <command> [args]}"
shift 2
# Environment names become paths, Compose project names and migration
# targets: lowercase letters, digits and hyphens. local, test and preview are
# reserved by the migration runner (packages/core/src/db/migration-safety.ts).
valid_environment() {
  [[ "$1" =~ ^[a-z][a-z0-9-]{0,31}$ ]] && case "$1" in local | test | preview) false ;; esac
}
valid_environment "$environment" || {
  echo "Unknown environment: $environment" >&2
  exit 64
}

root="${LICTORY_ROOT:-/srv/lictory}"
home="$root/$environment"
# A typo must not create a new environment: only configured ones are deployed.
[ -f "$home/.env" ] || {
  echo "Unknown environment: $environment ($home/.env does not exist; create it with new-environment.sh)." >&2
  exit 64
}
releases="$home/releases"
bin="$(cd "$(dirname "$0")" && pwd)"
history="$home/release-history.log"
mkdir -p "$releases"
# lictory restore holds this lock for its whole cutover and runs migrate and
# activate inside it (LICTORY_DEPLOY_LOCK_HELD=1).
if [ "${LICTORY_DEPLOY_LOCK_HELD:-}" != 1 ]; then
  exec 9>"$home/.deploy.lock"
  if command -v flock >/dev/null; then
    flock -n 9 || {
      echo "Another deployment of $environment is running." >&2
      exit 75
    }
  fi
fi

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$home/deploy.log" >&2; }
die() {
  log "ERROR: $*"
  exit 1
}
# env_value <file> <key>: the last assignment of <key>, decoded as Docker
# Compose reads .env files: an optional "export ", spaces around "=", a
# double-quoted value with \n \t \r \\ \" \$ escapes, a single-quoted value
# with \' escapes, or an unquoted value up to " # comment". Keep the copies
# in deploy/bin/lictory, deploy.sh, lictory-backup, lictory-monitor and
# lictory-restore-drill identical (packages/core/src/release/self-host.test.ts).
env_value() {
  local line value out="" char next quote i=0
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=" "$1" 2>/dev/null | tail -n 1) || true
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  case "$value" in
    \"* | \'*)
      quote="${value:0:1}"
      value="${value:1}"
      while [ "$i" -lt "${#value}" ]; do
        char="${value:i:1}"
        if [ "$char" = '\' ] && [ $((i + 1)) -lt "${#value}" ]; then
          next="${value:i+1:1}"
          if [ "$quote" = '"' ]; then
            case "$next" in
              n) out="$out"$'\n' ;;
              t) out="$out"$'\t' ;;
              r) out="$out"$'\r' ;;
              '"' | '\' | '$') out="$out$next" ;;
              *) out="$out\\$next" ;;
            esac
          elif [ "$next" = "'" ]; then
            out="$out'"
          else
            out="$out\\$next"
          fi
          i=$((i + 2))
          continue
        fi
        [ "$char" != "$quote" ] || break
        out="$out$char"
        i=$((i + 1))
      done
      ;;
    *) out=$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//') ;;
  esac
  printf '%s' "$out"
}
setting() { env_value "$home/.env" "$1"; }
external_database() { [ "$(setting LICTORY_DATABASE)" = external ]; }
compose() { # compose <release-dir> <args...>
  local dir="$1"
  shift
  LICTORY_ROOT="$root" LICTORY_RELEASE_DIR="$dir" "$bin/lictory-compose" "$environment" "$@"
}
current_version() {
  [ -L "$home/current" ] || [ -d "$home/current" ] || return 0
  env_value "$home/current/release.env" LICTORY_VERSION
}
release_dir() {
  local version="$1"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "Invalid version: $version"
  [ -f "$releases/$version/release.env" ] || die "Release $version is not prepared on this server."
  printf '%s' "$releases/$version"
}
psql_admin() { # psql_admin <release-dir> <sql>
  compose "$1" exec -T postgres psql -X -A -t -v ON_ERROR_STOP=1 -U postgres \
    -d "$(setting LICTORY_DB_NAME)" -c "$2"
}

# Resolve through Compose so defaults, quoting and multiline options match the
# real proxy. Keep configuration and Caddy diagnostics private: both may contain
# env values. No production networks, ports or volumes are used by validation.
validate_proxy() ( # validate_proxy <release-dir>
  local dir="$1" tmp image entry proxy_env=() platform
  # The API and the proxy's WebSocket origin check both use PLATFORM_URL
  # verbatim as the browser's Origin: lowercase, no path or trailing slash.
  platform=$(setting PLATFORM_URL)
  [ -z "$platform" ] || [[ "$platform" =~ ^https?://([a-z0-9.-]+|\[[0-9a-f:]+\])(:[0-9]+)?$ ]] ||
    die "PLATFORM_URL must be an origin such as https://lictory.example.com or http://10.0.0.5:8080 (lowercase, no path or trailing slash)."
  umask 077
  tmp=$(mktemp -d) || die "Could not create a private validation directory."
  trap 'rm -rf "$tmp"' EXIT
  compose "$dir" config --format json >"$tmp/compose.json" 2>/dev/null ||
    die "Compose configuration is invalid; check the environment's .env."
  image=$(jq -er '.services.proxy.image' "$tmp/compose.json" 2>/dev/null) ||
    die "Could not resolve the proxy image."
  jq -j '.services.proxy.environment | to_entries[] | .key, "=", .value, "\u0000"' \
    "$tmp/compose.json" >"$tmp/proxy.env" 2>/dev/null || die "Could not resolve the proxy environment."
  while IFS= read -r -d '' entry; do
    proxy_env+=(--env "$entry")
  done <"$tmp/proxy.env"
  docker run --rm --pull never --network none --log-driver none \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /data:mode=1777 --tmpfs /config:mode=1777 --tmpfs /tmp \
    "${proxy_env[@]}" --entrypoint sh "$image" -ec '
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
      exec caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile
    ' >"$tmp/caddy.json" 2>/dev/null ||
    die "Caddy configuration is invalid; check CADDY_TRUSTED_PROXIES and CADDY_GLOBAL_OPTIONS. Validation output is suppressed to protect env values."
  # A servers block in CADDY_GLOBAL_OPTIONS can silently replace our defaults.
  # Empty ranges intentionally trust nobody (standalone deployments); otherwise
  # the adapted ranges must be exactly the configured space-separated peers.
  jq -e --slurpfile config "$tmp/compose.json" '
    [$config[0].services.proxy.environment.CADDY_TRUSTED_PROXIES // "" | scan("\\S+")] as $peers |
    .apps.http.servers | length > 0 and all(.[];
      .trusted_proxies.source == "static" and
      (.trusted_proxies.ranges // []) == $peers and
      .trusted_proxies_strict == 1 and
      .protocols == ["h1", "h2"] and
      .read_header_timeout == 15000000000 and
      .idle_timeout == 300000000000
    )
  ' "$tmp/caddy.json" >/dev/null 2>&1 ||
    die "Caddy server safeguards were overridden; remove servers blocks from CADDY_GLOBAL_OPTIONS and use explicit IPs/CIDRs in CADDY_TRUSTED_PROXIES."
)

# --------------------------------------------------------------------- prepare
prepare() {
  local file version channel expected registry key value tmp dir
  tmp=$(mktemp)
  # Accept only known keys with strictly formatted values.
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      LICTORY_VERSION) [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] ;;
      LICTORY_GIT_SHA) [[ "$value" =~ ^[0-9a-f]{40}$|^local$ ]] ;;
      LICTORY_CHANNEL) [[ "$value" =~ ^(stable|nightly|local)$ ]] ;;
      API_IMAGE | MARKETING_IMAGE | PROXY_IMAGE | MIGRATE_IMAGE | OPS_IMAGE)
        [[ "$value" =~ ^[a-z0-9.-]+(:[0-9]+)?(/[a-z0-9._-]+)+(@sha256:[a-f0-9]{64}|:[A-Za-z0-9._-]+)$ ]] ;;
      *) false ;;
    esac || { rm -f "$tmp"; die "Rejected release line: $key"; }
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  done
  for key in LICTORY_VERSION LICTORY_GIT_SHA LICTORY_CHANNEL API_IMAGE MARKETING_IMAGE PROXY_IMAGE MIGRATE_IMAGE OPS_IMAGE; do
    [ -n "$(env_value "$tmp" "$key")" ] || { rm -f "$tmp"; die "Release is missing $key."; }
  done
  version=$(env_value "$tmp" LICTORY_VERSION)
  channel=$(env_value "$tmp" LICTORY_CHANNEL)
  expected=$(setting LICTORY_RELEASE_CHANNEL)
  [ "$channel" = "${expected:-stable}" ] || {
    rm -f "$tmp"
    die "This environment accepts ${expected:-stable} releases; $version is $channel."
  }
  if [ "$(setting LICTORY_ALLOW_LOCAL_IMAGES)" != true ]; then
    registry=$(setting LICTORY_IMAGE_REGISTRY)
    [ -n "$registry" ] || { rm -f "$tmp"; die "Set LICTORY_IMAGE_REGISTRY in $home/.env."; }
    for key in API_IMAGE MARKETING_IMAGE PROXY_IMAGE MIGRATE_IMAGE OPS_IMAGE; do
      value=$(env_value "$tmp" "$key")
      [[ "$value" == "$registry/"*"@sha256:"* ]] || { rm -f "$tmp"; die "$key must be a digest in $registry."; }
    done
  fi
  dir="$releases/$version"
  if [ -f "$dir/release.env" ]; then
    cmp -s "$tmp" "$dir/release.env" || { rm -f "$tmp"; die "Release $version already exists with different images."; }
    rm -f "$tmp"
  else
    mkdir -p "$dir"
    mv "$tmp" "$dir/release.env"
  fi
  chmod 0644 "$dir/release.env"

  if [ "$(setting LICTORY_ALLOW_LOCAL_IMAGES)" != true ]; then
    local pulls=() pull_pid pull_failed=false
    for key in API_IMAGE PROXY_IMAGE MIGRATE_IMAGE OPS_IMAGE; do
      docker pull -q "$(env_value "$dir/release.env" "$key")" >/dev/null &
      pulls+=("$!")
    done
    for pull_pid in "${pulls[@]}"; do
      wait "$pull_pid" || pull_failed=true
    done
    [ "$pull_failed" = false ] || die "Could not pull every release image; activation is blocked."
  fi
  # The deployment bundle (compose file, role script, these scripts) ships in
  # the ops image of the same release.
  local container
  container=$(docker create "$(env_value "$dir/release.env" OPS_IMAGE)")
  rm -rf "$dir/bundle"
  docker cp -q "$container:/opt/lictory/deploy" "$dir/bundle"
  docker rm "$container" >/dev/null
  cp "$dir/bundle/compose.production.yaml" "$dir/compose.production.yaml"
  rm -f "$dir/compose.external-database.yaml"
  [ ! -f "$dir/bundle/compose.external-database.yaml" ] ||
    cp "$dir/bundle/compose.external-database.yaml" "$dir/compose.external-database.yaml"
  validate_proxy "$dir" || die "Proxy validation failed; nothing was activated."
  mkdir -p "$home/postgres"
  # This code-only bind mount is read by PostgreSQL's unprivileged user.
  chmod 0755 "$home/postgres"
  rm -f "$home/postgres/10-lictory-roles.sh"
  cp "$dir/bundle/postgres/10-lictory-roles.sh" "$home/postgres/10-lictory-roles.sh"
  if external_database; then
    compose "$dir" pull -q zero-cache 2>/dev/null || true
  else
    compose "$dir" pull -q postgres zero-cache 2>/dev/null || true
  fi
  log "Prepared $version ($channel)."
  printf '%s\n' "$version"
}

# --------------------------------------------------------------------- migrate
wait_for_zero() { # wait_for_zero <dir> <lsn>
  local dir="$1" lsn="$2" deadline caught
  deadline=$(($(date +%s) + ${ZERO_REPLICATION_TIMEOUT:-600}))
  if [ -z "$(compose "$dir" ps -q zero-cache 2>/dev/null)" ]; then
    log "zero-cache is not running yet; it replicates the schema on start."
    return 0
  fi
  log "Waiting for zero-cache to replicate through ${lsn}…"
  if external_database; then
    # No local superuser: the migration role polls Zero's slots.
    compose "$dir" run --rm --no-deps -T database wait-replicated "$lsn" "${ZERO_REPLICATION_TIMEOUT:-600}" >&2 ||
      die "zero-cache has not replicated the schema change after ${ZERO_REPLICATION_TIMEOUT:-600}s. Check: lictory-compose $environment logs zero-cache"
  else
    while :; do
      caught=$(psql_admin "$dir" "SELECT coalesce(bool_or(confirmed_flush_lsn >= '$lsn'::pg_lsn), false) FROM pg_replication_slots WHERE slot_type = 'logical' AND active" || echo f)
      [ "$caught" = t ] && break
      [ "$(date +%s)" -lt "$deadline" ] || die "zero-cache has not replicated the schema change after ${ZERO_REPLICATION_TIMEOUT:-600}s. Check: lictory-compose $environment logs zero-cache"
      sleep 3
    done
  fi
  compose "$dir" up -d --no-deps --wait --wait-timeout 900 zero-cache >/dev/null
  log "zero-cache replicated the schema change."
}

# An external database: requirements first (every failed one is named with its
# fix), then the migration through the same steps as the bundled one.
migrate_external() { # migrate_external <dir> <version>
  local dir="$1" status lsn
  [ -f "$dir/compose.external-database.yaml" ] ||
    die "Release $2 does not support an external database (LICTORY_DATABASE=external)."
  if [ -n "${DATABASE_ADMIN_URL:-}" ]; then
    log "Creating Lictory's database roles with the administrator connection…"
    compose "$dir" run --rm --no-deps -T -e DATABASE_ADMIN_URL database setup >&2 ||
      die "Could not create the database roles; see the messages above."
  fi
  log "Checking the external database's requirements…"
  compose "$dir" run --rm --no-deps -T database check >&2 ||
    die "The database does not meet Lictory's requirements (listed above); nothing was migrated. Fix them, or create the roles with: sudo lictory database setup"
  status=$(compose "$dir" run --rm --no-deps -T migrate node migrate.mjs --status) ||
    die "Migration status failed: $status"
  printf '%s\n' "$status" >&2
  compose "$dir" run --rm --no-deps -T database grants >&2 ||
    die "Could not apply database grants."
  if ! printf '%s' "$status" | grep -q "Pending migrations"; then
    log "No pending migrations for $2."
    return 0
  fi
  if [ -n "$(current_version)" ] && [ "$(setting PRE_DEPLOY_BACKUP)" != false ]; then
    log "No pre-deploy backup: the database is external; its provider's backups and point-in-time recovery cover this migration."
  fi
  log "Applying migrations for $2…"
  compose "$dir" run --rm --no-deps -T migrate >&2 || die "Migration failed; the previous release keeps serving."
  lsn=$(compose "$dir" run --rm --no-deps -T database lsn) || die "Could not read the database's WAL position."
  wait_for_zero "$dir" "$lsn"
}

migrate() {
  local dir status lsn
  dir=$(release_dir "$1")
  validate_proxy "$dir" || die "Proxy validation failed; nothing was migrated."
  if external_database; then
    migrate_external "$dir" "$1"
    return
  fi
  compose "$dir" up -d --wait --wait-timeout 180 postgres >/dev/null
  status=$(compose "$dir" run --rm --no-deps -T migrate node migrate.mjs --status) ||
    die "Migration status failed: $status"
  printf '%s\n' "$status" >&2
  if ! printf '%s' "$status" | grep -q "Pending migrations"; then
    log "No pending migrations for $1."
    return 0
  fi
  if [ -n "$(current_version)" ] && [ "$(setting PRE_DEPLOY_BACKUP)" != false ] &&
    [ "$(setting BACKUP_TARGET)" = none ]; then
    log "WARNING: no pre-deploy backup: backups are disabled (BACKUP_TARGET=none)."
  elif [ -n "$(current_version)" ] && [ "$(setting PRE_DEPLOY_BACKUP)" != false ]; then
    log "Pre-deploy backup…"
    compose "$dir" run --rm --no-deps -T ops backup.sh pre-deploy >&2 ||
      die "Pre-deploy backup failed; nothing was migrated."
  fi
  # Roles, grants and the migration role's access to Zero's DDL triggers.
  compose "$dir" exec -T postgres sh /docker-entrypoint-initdb.d/10-lictory-roles.sh >&2 ||
    die "Could not apply database roles and grants."
  log "Applying migrations for $1…"
  compose "$dir" run --rm --no-deps -T migrate >&2 || die "Migration failed; the previous release keeps serving."
  lsn=$(psql_admin "$dir" "SELECT pg_current_wal_lsn()")
  wait_for_zero "$dir" "$lsn"
}

# -------------------------------------------------------------------- activate
roll() { # roll <dir>
  local dir="$1" service
  # zero-cache first (rolling-update order), proxy before the API so assets of
  # both releases exist when new documents are served.
  for service in zero-cache proxy api worker collaboration; do
    log "Rolling ${service}…"
    compose "$dir" up -d --no-deps --wait --wait-timeout "$([ "$service" = zero-cache ] && echo 900 || echo 180)" "$service" >&2 ||
      return 1
    # zero-cache creates its shard tables on first start; the API's role
    # needs them for Zero's mutation bookkeeping before serving pushes.
    if [ "$service" = zero-cache ] && external_database; then
      compose "$dir" run --rm --no-deps -T database grants >&2 || return 1
    elif [ "$service" = zero-cache ]; then
      compose "$dir" exec -T postgres sh /docker-entrypoint-initdb.d/10-lictory-roles.sh >&2 ||
        return 1
    fi
  done
}

verify() { # verify <dir>
  local dir="$1" app public_app origin scheme insecure=()
  app=$(setting APP_HOST)
  public_app=$(setting PUBLIC_APP_HOST)
  public_app="${public_app:-$app}"
  origin=$(setting PLATFORM_URL)
  origin="${origin:-https://$public_app}"
  scheme=$(setting PROXY_SCHEME)
  scheme="${scheme:-https}"
  case "$scheme" in http | https) ;; *) die "Unsupported PROXY_SCHEME." ;; esac
  [ -n "$(setting CADDY_GLOBAL_OPTIONS)" ] && insecure=(-k)
  local url port code
  if [ "$scheme" = http ]; then port=$(setting HTTP_PORT); port="${port:-80}";
  else port=$(setting HTTPS_PORT); port="${port:-443}"; fi
  for url in "$scheme://$app/healthz"; do
    local host="${url#*://}"
    host="${host%%/*}"
    curl -fsS "${insecure[@]+"${insecure[@]}"}" -m 15 --retry 5 --retry-delay 2 --retry-all-errors \
      --resolve "$host:${port}:127.0.0.1" -o /dev/null "${url/$host/$host:$port}" ||
      { log "Verification failed: $url"; return 1; }
  done
  # A fixed, public handshake key (base64 of "lictory-deploy!!"), not a
  # credential: the probes only check that each upgrade is routed.
  local ws_key
  ws_key=$(printf '%s' 'lictory-deploy!!' | base64)
  # Zero answers WebSocket upgrades only: 101 proves proxy -> zero-cache routing.
  code=$(curl -s "${insecure[@]+"${insecure[@]}"}" --http1.1 -m 3 -o /dev/null -w '%{http_code}' \
    --resolve "$app:${port}:127.0.0.1" -H "Origin: $origin" \
    -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: $ws_key" \
    "$scheme://$app:$port/zero/sync/v1/connect" || true)
  [ "$code" = 101 ] || { log "Verification failed: Zero WebSocket upgrade returned $code"; return 1; }
  # The collaboration service upgrades any request with the platform Origin:
  # 101 proves proxy -> collaboration routing (live draft editing).
  code=$(curl -s "${insecure[@]+"${insecure[@]}"}" --http1.1 -m 3 -o /dev/null -w '%{http_code}' \
    --resolve "$app:${port}:127.0.0.1" -H "Origin: $origin" \
    -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: $ws_key" \
    "$scheme://$app:$port/collaboration" || true)
  [ "$code" = 101 ] || { log "Verification failed: collaboration WebSocket upgrade returned $code"; return 1; }
  active_matches "$dir" || return 1
}

active_matches() { # every service runs exactly the release's image
  local dir="$1" service key expected running
  for service in api worker collaboration proxy; do
    case "$service" in api | worker | collaboration) key=API_IMAGE ;; proxy) key=PROXY_IMAGE ;; esac
    expected=$(docker image inspect --format '{{.Id}}' "$(env_value "$dir/release.env" "$key")" 2>/dev/null || true)
    running=$(docker inspect --format '{{.Image}}' "$(compose "$dir" ps -q "$service")" 2>/dev/null || true)
    [ -n "$expected" ] && [ "$expected" = "$running" ] || {
      log "$service is not running the image of $(env_value "$dir/release.env" LICTORY_VERSION)."
      return 1
    }
  done
}

activate() {
  local version="$1" dir previous
  dir=$(release_dir "$version")
  validate_proxy "$dir" || die "Proxy validation failed; the running stack is unchanged."
  previous=$(current_version)
  log "Activating $version (active: ${previous:-none})…"
  if roll "$dir" && verify "$dir"; then
    # Tools follow new releases only; a rollback keeps the newer tools.
    local first=true
    grep -q " activated $version\$" "$history" 2>/dev/null && first=false
    ln -sfn "releases/$version" "$home/current"
    printf '%s activated %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$version" >>"$history"
    [ "$first" = true ] && install_tools "$dir"
    log "$version is active."
    return 0
  fi
  if [ -n "$previous" ] && [ "$previous" != "$version" ]; then
    log "Activation failed; restoring $previous images (schema unchanged)."
    if validate_proxy "$home/current" && roll "$home/current" && verify "$home/current"; then
      log "$previous restored."
    else
      log "Restoring $previous also failed; investigate immediately."
    fi
  fi
  die "Activation of $version failed."
}

# A newly activated release's host scripts become the server's tools.
install_tools() {
  local dir="$1" file
  [ -d "$dir/bundle/bin" ] && [ -w "$root/bin" ] || return 0
  for file in "$dir/bundle/bin/"*; do
    cp "$file" "$root/bin/.$(basename "$file").new"
    chmod 0755 "$root/bin/.$(basename "$file").new"
    mv -f "$root/bin/.$(basename "$file").new" "$root/bin/$(basename "$file")"
  done
}

rollback() {
  local current previous
  current=$(current_version)
  [ -n "$current" ] || die "Nothing is active."
  previous=$(awk '$2 == "activated" { print $3 }' "$history" | grep -vx "$current" | tail -n 1 || true)
  [ -n "$previous" ] || die "No previous release recorded in $history."
  log "Rolling back from $current to $previous (application images only)."
  activate "$previous"
}

status() {
  local json="${1:-}" dir version service state ok=true lines=""
  dir="$home/current"
  version=$(current_version)
  if [ -z "$version" ]; then
    [ "$json" = --json ] && printf '{"environment":"%s","version":null}\n' "$environment" || echo "No active release."
    return 0
  fi
  local services="postgres zero-cache api worker collaboration proxy"
  # An external database has no container on this server.
  external_database && services="zero-cache api worker collaboration proxy"
  for service in $services; do
    state=$(docker inspect --format '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' \
      "$(compose "$dir" ps -q "$service" 2>/dev/null)" 2>/dev/null || echo missing)
    case "$state" in running | running/healthy) ;; *) ok=false ;; esac
    lines="$lines\"$service\":\"$state\","
  done
  active_matches "$dir" 2>/dev/null || ok=false
  if [ "$json" = --json ]; then
    printf '{"environment":"%s","version":"%s","sha":"%s","channel":"%s","images":{"api":"%s","marketing":"%s","proxy":"%s","migrate":"%s","ops":"%s"},"services":{%s},"healthy":%s}\n' \
      "$environment" "$version" "$(env_value "$dir/release.env" LICTORY_GIT_SHA)" \
      "$(env_value "$dir/release.env" LICTORY_CHANNEL)" \
      "$(env_value "$dir/release.env" API_IMAGE)" "$(env_value "$dir/release.env" MARKETING_IMAGE)" \
      "$(env_value "$dir/release.env" PROXY_IMAGE)" "$(env_value "$dir/release.env" MIGRATE_IMAGE)" \
      "$(env_value "$dir/release.env" OPS_IMAGE)" "${lines%,}" "$ok"
  else
    echo "$environment: $version ($(env_value "$dir/release.env" LICTORY_GIT_SHA)) healthy=$ok"
    printf '%s\n' "${lines%,}" | tr ',' '\n' | tr -d '"' | sed 's/:/: /'
  fi
}

backfill() {
  local dir
  dir=$(release_dir "$1")
  [[ "$2" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "Invalid backfill name: $2"
  log "Backfill $2 with $1…"
  compose "$dir" run --rm --no-deps -T migrate sh -c 'test -f "backfills/$1.mjs" || { echo "Release does not contain backfill $1." >&2; exit 1; }; exec node "backfills/$1.mjs"' backfill "$2" >&2 ||
    die "Backfill $2 failed; it is resumable, fix and re-run."
  log "Backfill $2 finished."
}

case "$command" in
  prepare) prepare ;;
  migrate) migrate "${1:?version}" ;;
  activate) activate "${1:?version}" ;;
  release)
    version=$(prepare)
    migrate "$version"
    activate "$version"
    ;;
  rollback) rollback ;;
  backfill) backfill "${1:?version}" "${2:?backfill name}" ;;
  status) status "${1:-}" ;;
  *)
    echo "Unknown command: $command" >&2
    exit 64
    ;;
esac
