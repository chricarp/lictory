#!/usr/bin/env bash
# Encrypted logical backup of one environment's application database.
# Runs in the ops image: lictory-compose run --rm ops backup.sh [scheduled|pre-deploy|manual]
#
#   1. pg_dump (custom format, zstd) inside a REPEATABLE READ snapshot that also
#      records exact row counts and the applied migrations (the manifest), so a
#      restore can be verified against the same instant.
#   2. Encrypt dump and manifest with age to BACKUP_AGE_RECIPIENTS (public keys
#      only; the private identity never lives on the server).
#   3. Upload to the dedicated backup bucket, apply retention, record success.
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

: "${LICTORY_ENVIRONMENT:?}" "${PGDATABASE:?}" "${BACKUP_BUCKET:?}" "${BACKUP_AGE_RECIPIENTS:?}"
started=$(date -u +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="lictory-${LICTORY_ENVIRONMENT}-${stamp}-${label}"
remote="backup:${BACKUP_BUCKET}/${LICTORY_ENVIRONMENT}"
work="/backups/work-${stamp}"
mkdir -p "$work" /backups/latest
umask 077

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
trap 'fail "line $LINENO exited with status $?"; cleanup' ERR
trap cleanup EXIT
ping /start "$name"

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
recipients=()
for key in ${BACKUP_AGE_RECIPIENTS//,/ }; do recipients+=(-r "$key"); done
age "${recipients[@]}" -o "$work/$name.dump.age" "$work/$name.dump"
age "${recipients[@]}" -o "$work/$name.manifest.json.age" "$work/$name.manifest.json"
encrypted_sha=$(sha256sum "$work/$name.dump.age" | cut -d' ' -f1)
encrypted_bytes=$(stat -c %s "$work/$name.dump.age")
rm -f "$work/$name.dump"

# --- 3. upload and retention -------------------------------------------------
prefix=daily
[ "$label" = scheduled ] || prefix="$label"
rclone_flags=(--s3-no-check-bucket --retries 5 --low-level-retries 10 --contimeout 15s --timeout 5m --stats 0)
for file in "$name.dump.age" "$name.manifest.json.age"; do
  rclone copyto "${rclone_flags[@]}" "$work/$file" "$remote/$prefix/$file"
done
# Integrity of the stored object, not just of the local file.
remote_sha=$(rclone hashsum "${rclone_flags[@]}" sha256 --download "$remote/$prefix/$name.dump.age" | cut -d' ' -f1)
[ "$remote_sha" = "$encrypted_sha" ] || { echo "Uploaded object checksum mismatch" >&2; false; }

promote() { # promote <prefix>: server-side copy of today's backup
  for file in "$name.dump.age" "$name.manifest.json.age"; do
    rclone copyto "${rclone_flags[@]}" "$remote/daily/$file" "$remote/$1/$file"
  done
}
prune() { # prune <prefix> <keep>
  local keep=$2 old
  mapfile -t old < <(rclone lsf "${rclone_flags[@]}" --files-only --include '*.dump.age' "$remote/$1/" |
    sort -r | tail -n +"$((keep + 1))")
  for file in "${old[@]}"; do
    rclone deletefile "${rclone_flags[@]}" "$remote/$1/$file"
    rclone deletefile "${rclone_flags[@]}" "$remote/$1/${file%.dump.age}.manifest.json.age" || true
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
record=$(jq -cn --arg name "$name" --arg key "$LICTORY_ENVIRONMENT/$prefix/$name.dump.age" \
  --arg sha256 "$encrypted_sha" --argjson bytes "$encrypted_bytes" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson seconds "$((finished - started))" \
  '{name:$name,key:$key,encrypted_sha256:$sha256,encrypted_bytes:$bytes,completed_at:$at,seconds:$seconds}')
echo "$record" >"$work/latest.json"
rclone copyto "${rclone_flags[@]}" "$work/latest.json" "$remote/latest.json"

# Keep the newest encrypted copy locally for a fast restore on the same host.
rm -f /backups/latest/*
mv "$work/$name.dump.age" "$work/$name.manifest.json.age" /backups/latest/
echo "$record" >/backups/last-success.json
ping "" "$record"
echo "Backup complete: $record"
