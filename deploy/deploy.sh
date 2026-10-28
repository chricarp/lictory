#!/usr/bin/env bash
# Deploys, inspects and rolls back one Lictory environment on this server.
# Installed as /srv/lictory/bin/deploy.sh; release automation calls it over SSH
# through deploy/bin/lictory-remote. See docs/operations/deployment.md.
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
# replicated it, then zero-cache, proxy (keeps old + new assets), API and
# worker, website. Schema is never rolled back; rollbacks switch images only,
# so every migration must stay compatible with the previous release.
set -euo pipefail

environment="${1:?Usage: deploy.sh <production|staging> <command> [args]}"
command="${2:?Usage: deploy.sh <production|staging> <command> [args]}"
shift 2
case "$environment" in production | staging) ;; *)
  echo "Unknown environment: $environment" >&2
  exit 64
  ;;
esac

root="${LICTORY_ROOT:-/srv/lictory}"
home="$root/$environment"
releases="$home/releases"
bin="$(cd "$(dirname "$0")" && pwd)"
history="$home/release-history.log"
mkdir -p "$releases"
exec 9>"$home/.deploy.lock"
if command -v flock >/dev/null; then
  flock -n 9 || {
    echo "Another deployment of $environment is running." >&2
    exit 75
  }
fi

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$home/deploy.log" >&2; }
die() {
  log "ERROR: $*"
  exit 1
}
env_value() { # env_value <file> <key>
  local line
  line=$(grep -E "^$2=" "$1" | tail -n 1 || true)
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}
setting() { env_value "$home/.env" "$1"; }
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
  mkdir -p "$home/postgres"
  # This code-only bind mount is read by PostgreSQL's unprivileged user.
  chmod 0755 "$home/postgres"
  rm -f "$home/postgres/10-lictory-roles.sh"
  cp "$dir/bundle/postgres/10-lictory-roles.sh" "$home/postgres/10-lictory-roles.sh"
  compose "$dir" config --quiet || die "Compose configuration for $version is invalid with $home/.env."
  compose "$dir" pull -q postgres zero-cache 2>/dev/null || true
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
  while :; do
    caught=$(psql_admin "$dir" "SELECT coalesce(bool_or(confirmed_flush_lsn >= '$lsn'::pg_lsn), false) FROM pg_replication_slots WHERE slot_type = 'logical' AND active" || echo f)
    [ "$caught" = t ] && break
    [ "$(date +%s)" -lt "$deadline" ] || die "zero-cache has not replicated the schema change after ${ZERO_REPLICATION_TIMEOUT:-600}s. Check: lictory-compose $environment logs zero-cache"
    sleep 3
  done
  compose "$dir" up -d --no-deps --wait --wait-timeout 900 zero-cache >/dev/null
  log "zero-cache replicated the schema change."
}

migrate() {
  local dir status lsn
  dir=$(release_dir "$1")
  compose "$dir" up -d --wait --wait-timeout 180 postgres >/dev/null
  status=$(compose "$dir" run --rm --no-deps -T migrate node migrate.mjs --status) ||
    die "Migration status failed: $status"
  printf '%s\n' "$status" >&2
  if ! printf '%s' "$status" | grep -q "Pending migrations"; then
    log "No pending migrations for $1."
    return 0
  fi
  if [ -n "$(current_version)" ] && [ "$(setting PRE_DEPLOY_BACKUP)" != false ]; then
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
  for service in zero-cache proxy api worker; do
    log "Rolling ${service}…"
    compose "$dir" up -d --no-deps --wait --wait-timeout "$([ "$service" = zero-cache ] && echo 900 || echo 180)" "$service" >&2 ||
      return 1
    # zero-cache creates its shard tables on first start; the API's role
    # needs them for Zero's mutation bookkeeping before serving pushes.
    if [ "$service" = zero-cache ]; then
      compose "$dir" exec -T postgres sh /docker-entrypoint-initdb.d/10-lictory-roles.sh >&2 ||
        return 1
    fi
  done
}

verify() { # verify <dir>
  local dir="$1" app public_app scheme insecure=()
  app=$(setting APP_HOST)
  public_app=$(setting PUBLIC_APP_HOST)
  public_app="${public_app:-$app}"
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
  # Zero answers WebSocket upgrades only: 101 proves proxy -> zero-cache routing.
  code=$(curl -s "${insecure[@]+"${insecure[@]}"}" --http1.1 -m 3 -o /dev/null -w '%{http_code}' \
    --resolve "$app:${port}:127.0.0.1" -H "Origin: https://$public_app" \
    -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: bGljdG9yeS1kZXBsb3khIQ==" \
    "$scheme://$app:$port/zero/sync/v1/connect" || true)
  [ "$code" = 101 ] || { log "Verification failed: Zero WebSocket upgrade returned $code"; return 1; }
  active_matches "$dir" || return 1
}

active_matches() { # every service runs exactly the release's image
  local dir="$1" service key expected running
  for service in api worker proxy; do
    case "$service" in api | worker) key=API_IMAGE ;; proxy) key=PROXY_IMAGE ;; esac
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
    roll "$home/current" && verify "$home/current" && log "$previous restored." ||
      log "Restoring $previous also failed; investigate immediately."
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
  for service in postgres zero-cache api worker proxy; do
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
