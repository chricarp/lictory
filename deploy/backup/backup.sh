#!/usr/bin/env bash
# Logical backup of one environment's application database, encrypted unless
# BACKUP_AGE_RECIPIENTS=none.
# Runs in the ops image: lictory-compose run --rm ops backup.sh [scheduled|pre-deploy|manual]
#
#   1. pg_dump (custom format, zstd) inside a REPEATABLE READ snapshot that also
#      records exact row counts and the applied migrations (the manifest), so a
#      restore can be verified against the same instant.
#   2. Encrypt dump and manifest with age to BACKUP_AGE_RECIPIENTS (public keys
#      only; the private identity never lives on the server). `none` stores
#      them unencrypted, with a warning on every run.
#   3. Store them at BACKUP_TARGET (backup-target.sh: s3, local or rclone),
#      apply retention, record success. BACKUP_TARGET=none disables backups.
#
# Zero's schemas (zero, zero_*) are excluded: the replica, CVRs and change log
# are rebuilt from PostgreSQL (docs/operations/recovery.md).
set -Eeuo pipefail

label="${1:-scheduled}"
case "$label" in scheduled | pre-deploy | manual) ;; *)
  echo "Usage: backup.sh [scheduled|pre-deploy|manual]" >&2
  exit 64
  ;;
esac

: "${LICTORY_ENVIRONMENT:?}" "${PGDATABASE:?}"
# An external database (compose.external-database.yaml) is the provider's to
# back up; a deliberate request must not look like success.
if [ "${LICTORY_DATABASE:-bundled}" = external ]; then
  echo "${LICTORY_ENVIRONMENT} uses an external database: Lictory takes no backups. Use the provider's backups and point-in-time recovery (docs/operations/external-database.md#backups)." >&2
  [ "$label" != manual ] || exit 1
  exit 0
fi
# shellcheck source=deploy/backup/backup-target.sh
. "$(dirname "$0")/backup-target.sh"
if [ "$backup_target" = none ]; then
  echo "Backups are disabled for ${LICTORY_ENVIRONMENT} (BACKUP_TARGET=none); nothing was backed up." >&2
  # A deliberate request must not look like success.
  [ "$label" != manual ] || exit 1
  exit 0
fi
mkdir -p /backups/latest
umask 077
# One backup at a time per environment (scheduled, manual and pre-deploy
# runs share this volume): a second one waits, then gives up after an hour.
# (BusyBox flock has no -w: timeout bounds the wait; the lock belongs to fd 8,
# so it stays held after flock itself exits.) The name is taken once the lock
# is held, so a backup that waited gets its own name instead of overwriting
# the previous one's objects.
exec 8>/backups/.backup.lock
timeout 3600 flock 8 || { echo "Another backup of ${LICTORY_ENVIRONMENT} has been running for an hour; not starting a second one." >&2; exit 75; }
started=$(date -u +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
# A small database backs up within a second: never reuse the previous stamp.
while [ "$stamp" = "$(cat /backups/.last-stamp 2>/dev/null)" ]; do
  sleep 1
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
done
echo "$stamp" >/backups/.last-stamp
name="lictory-${LICTORY_ENVIRONMENT}-${stamp}-${label}"
work=$(mktemp -d "/backups/work-${stamp}.XXXXXX")

ping() { # ping <suffix> <message>
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 --data-raw "$2" "${BACKUP_PING_URL}$1" >/dev/null || true
}
fail() {
  local message="Backup ${name} failed: $1"
  echo "$message" >&2
  ping /fail "$message"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    jq -cn --arg m "[lictory ${LICTORY_ENVIRONMENT}] $message" '{text:$m,content:$m}' |
      curl -fsS -m 10 -H 'Content-Type: application/json' --data-binary @- "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}
cleanup() { rm -rf "$work"; }
# shellcheck disable=SC2154 # assigned inside the trap
trap 'status=$?; fail "step \"${BASH_COMMAND:0:160}\" (line $LINENO) exited with status $status"; cleanup' ERR
trap cleanup EXIT
ping /start "$name"

# Configuration errors alert like any other failure.
resolve_backup_target write 2>"$work/target-error" || { fail "$(cat "$work/target-error")"; exit 1; }
remote="${backup_remote}/${LICTORY_ENVIRONMENT}"
case "${BACKUP_AGE_RECIPIENTS:-}" in
  "")
    fail "BACKUP_AGE_RECIPIENTS is empty: set an age public key, or none to store unencrypted backups."
    exit 1
    ;;
  none)
    ext=""
    warning="WARNING: backup ${name} is NOT encrypted (BACKUP_AGE_RECIPIENTS=none). Anyone who can read ${backup_target} storage can read every organization's data. Set an age recipient: docs/operations/recovery.md."
    echo "$warning" >&2
    ;;
  *) ext=.age ;;
esac
[ "$backup_target" != local ] || [ -n "${BACKUP_LOCAL_PATH:-}" ] ||
  echo "WARNING: BACKUP_TARGET=local without BACKUP_LOCAL_PATH keeps backups on this server's own disk; they do not survive losing it." >&2

# --- 1. snapshot, manifest and dump ------------------------------------------
coproc SNAPSHOT { psql -X -q -A -t -v ON_ERROR_STOP=1 2>&1; }
exec 3>&"${SNAPSHOT[1]}" 4<&"${SNAPSHOT[0]}"
snapshot_pid=$SNAPSHOT_PID
eval "exec ${SNAPSHOT[1]}>&- ${SNAPSHOT[0]}<&-"
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&3
read -r -t 30 snapshot <&4
[[ "$snapshot" =~ ^[0-9A-F-]+$ ]] || { echo "Could not export a snapshot: $snapshot" >&2; false; }

pg_dump --snapshot="$snapshot" --format=custom --compress=zstd:6 \
  --exclude-schema='zero' --exclude-schema='zero_*' \
  --file="$work/$name.dump"

cat >&3 <<'SQL'
SELECT json_build_object(
  'tables', (SELECT coalesce(json_object_agg(t.name, t.n ORDER BY t.name), '{}'::json) FROM (
    SELECT format('%I.%I', n.nspname, c.relname) AS name,
           (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint AS n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('public', 'drizzle')) t),
  'migrations', (SELECT coalesce(json_agg(json_build_object('hash', hash, 'created_at', created_at::text) ORDER BY created_at), '[]'::json)
                 FROM drizzle.__drizzle_migrations),
  'server_version', current_setting('server_version'),
  'snapshot_at', now()
);
COMMIT;
\q
SQL
read -r -t 600 facts <&4
exec 3>&- 4<&-
wait "$snapshot_pid" 2>/dev/null || true
echo "$facts" | jq -e '.tables and .migrations' >/dev/null

# The custom-format archive must be readable before it is trusted.
entries=$(pg_restore --list "$work/$name.dump" | grep -vc '^;')
dump_bytes=$(stat -c %s "$work/$name.dump")
dump_sha=$(sha256sum "$work/$name.dump" | cut -d' ' -f1)
jq -n --argjson facts "$facts" \
  --arg name "$name" --arg label "$label" --arg environment "$LICTORY_ENVIRONMENT" \
  --arg database "$PGDATABASE" --arg version "${LICTORY_VERSION:-}" \
  --arg pg_dump "$(pg_dump --version)" --arg sha256 "$dump_sha" \
  --argjson bytes "$dump_bytes" --argjson entries "$entries" \
  '{name:$name,label:$label,environment:$environment,database:$database,
    application_version:$version,pg_dump:$pg_dump,dump_sha256:$sha256,
    dump_bytes:$bytes,toc_entries:$entries} + $facts' >"$work/$name.manifest.json"

# --- 2. encryption -----------------------------------------------------------
dump_file="$name.dump$ext"
manifest_file="$name.manifest.json$ext"
if [ -n "$ext" ]; then
  recipients=()
  for key in ${BACKUP_AGE_RECIPIENTS//,/ }; do recipients+=(-r "$key"); done
  age "${recipients[@]}" -o "$work/$dump_file" "$work/$name.dump"
  age "${recipients[@]}" -o "$work/$manifest_file" "$work/$name.manifest.json"
  rm -f "$work/$name.dump"
fi
encrypted_sha=$(sha256sum "$work/$dump_file" | cut -d' ' -f1)
encrypted_bytes=$(stat -c %s "$work/$dump_file")

# --- 3. upload and retention -------------------------------------------------
prefix=daily
[ "$label" = scheduled ] || prefix="$label"
rclone_flags=(--s3-no-check-bucket --retries 5 --low-level-retries 10 --contimeout 15s --timeout 5m --stats 0)
for file in "$dump_file" "$manifest_file"; do
  rclone copyto "${rclone_flags[@]}" "$work/$file" "$remote/$prefix/$file"
done
# Integrity of the stored object, not just of the local file.
remote_sha=$(rclone hashsum "${rclone_flags[@]}" sha256 --download "$remote/$prefix/$dump_file" | cut -d' ' -f1)
[ "$remote_sha" = "$encrypted_sha" ] || { echo "Uploaded object checksum mismatch" >&2; false; }

promote() { # promote <prefix>: server-side copy of today's backup
  for file in "$dump_file" "$manifest_file"; do
    rclone copyto "${rclone_flags[@]}" "$remote/daily/$file" "$remote/$1/$file"
  done
}
prune() { # prune <prefix> <keep>: encrypted and unencrypted backups alike
  local keep=$2 listing old manifest
  # Directory backends (local, SFTP…) have no empty prefixes; S3 needs none.
  [ "$backup_target" = s3 ] || rclone mkdir -q "${rclone_flags[@]}" "$remote/$1"
  # A failed listing fails the backup (not hidden in a process substitution).
  listing=$(rclone lsf "${rclone_flags[@]}" --files-only --include '*.dump.age' --include '*.dump' "$remote/$1/")
  mapfile -t old <<<"$(printf '%s\n' "$listing" | sed '/^$/d' | sort -r | tail -n +"$((keep + 1))")"
  for file in "${old[@]}"; do
    [ -n "$file" ] || continue
    rclone deletefile "${rclone_flags[@]}" "$remote/$1/$file"
    manifest="${file%.dump.age}"
    manifest="${manifest%.dump}.manifest.json"
    [ "$file" = "${file%.age}" ] || manifest="$manifest.age"
    rclone deletefile "${rclone_flags[@]}" "$remote/$1/$manifest" || true
  done
}
if [ "$prefix" = daily ]; then
  [ "$(date -u +%u)" = 7 ] && promote weekly
  [ "$(date -u +%d)" = 01 ] && promote monthly
  prune daily "${BACKUP_KEEP_DAILY:-7}"
  prune weekly "${BACKUP_KEEP_WEEKLY:-4}"
  prune monthly "${BACKUP_KEEP_MONTHLY:-6}"
else
  prune "$prefix" "${BACKUP_KEEP_OTHER:-10}"
fi

finished=$(date -u +%s)
# encrypted_sha256/bytes describe the stored file (kept for older restore tools).
record=$(jq -cn --arg name "$name" --arg key "$LICTORY_ENVIRONMENT/$prefix/$dump_file" \
  --arg sha256 "$encrypted_sha" --argjson bytes "$encrypted_bytes" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson seconds "$((finished - started))" \
  --arg target "$backup_target" --argjson encrypted "$([ -n "$ext" ] && echo true || echo false)" \
  '{name:$name,key:$key,encrypted_sha256:$sha256,encrypted_bytes:$bytes,completed_at:$at,seconds:$seconds,target:$target,encrypted:$encrypted}')
echo "$record" >"$work/latest.json"
rclone copyto "${rclone_flags[@]}" "$work/latest.json" "$remote/latest.json"

# Keep the newest encrypted copy locally for a fast restore on the same host.
rm -f /backups/latest/*
mv "$work/$dump_file" "$work/$manifest_file" /backups/latest/
echo "$record" >/backups/last-success.json
ping "" "$record"
echo "Backup complete: $record"
[ -n "$ext" ] || echo "$warning" >&2
