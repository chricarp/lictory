#!/usr/bin/env bash
# Restores a backup into an EMPTY database. Never overwrites data.
# Runs in the ops image (see lictory-restore-drill for the isolated drill):
#
#   restore.sh <latest | <environment>/<prefix>/<name>.dump[.age] | /path/to/file.dump[.age]>
#
# Required environment:
#   AGE_IDENTITY_FILE   private age identity (mounted read-only for the restore
#                       only); not needed for unencrypted (.dump) backups
#   RESTORE_PGHOST, RESTORE_PGPORT (5432), RESTORE_PGUSER (superuser),
#   RESTORE_PGPASSWORD, RESTORE_DATABASE (created when missing)
#   RESTORE_CHECK_ONLY=1 fetches, decrypts and verifies the backup against its
#   manifest and pg_restore's table of contents, then stops: no database is
#   needed or touched (lictory restore runs it before stopping anything).
# Remote keys and latest are read from BACKUP_TARGET (backup-target.sh).
#
# The target cluster must already have the Lictory roles
# (deploy/postgres/10-lictory-roles.sh). Zero's event triggers and internal
# publications are skipped: zero-cache recreates them on its first start.
set -Eeuo pipefail

source="${1:?Usage: restore.sh <latest|key|file>}"
check_only="${RESTORE_CHECK_ONLY:-}"
if [ -z "$check_only" ]; then
  : "${RESTORE_PGHOST:?}" "${RESTORE_PGUSER:?}" "${RESTORE_PGPASSWORD:?}" "${RESTORE_DATABASE:?}"
  export PGHOST="$RESTORE_PGHOST" PGPORT="${RESTORE_PGPORT:-5432}" PGUSER="$RESTORE_PGUSER" \
    PGPASSWORD="$RESTORE_PGPASSWORD" PGAPPNAME=lictory-restore
fi
unset PGDATABASE
started=$(date -u +%s)
work=$(mktemp -d /tmp/restore.XXXXXX)
umask 077
trap 'rm -rf "$work"' EXIT
rclone_flags=(--s3-no-check-bucket --retries 5 --low-level-retries 10 --contimeout 15s --timeout 5m --stats 0)

# shellcheck source=deploy/backup/backup-target.sh
. "$(dirname "$0")/backup-target.sh"
manifest_name() { # <dump name> -> its manifest, encrypted alike
  case "$1" in
    *.dump.age) printf '%s.manifest.json.age' "${1%.dump.age}" ;;
    *.dump) printf '%s.manifest.json' "${1%.dump}" ;;
    *) return 1 ;;
  esac
}
if [ -f "$source" ]; then
  stored="$source"
  manifest_stored=$(manifest_name "$source") || { echo "Not a backup file: $source" >&2; exit 64; }
else
  [ "$backup_target" != none ] || { echo "BACKUP_TARGET=none: pass a backup file instead." >&2; exit 64; }
  resolve_backup_target read || exit 64
  remote="$backup_remote"
  expected_sha=""
  if [ "$source" = latest ]; then
    : "${LICTORY_ENVIRONMENT:?}"
    rclone cat "${rclone_flags[@]}" "$remote/$LICTORY_ENVIRONMENT/latest.json" >"$work/latest.json"
    source=$(jq -r .key "$work/latest.json")
    expected_sha=$(jq -r .encrypted_sha256 "$work/latest.json")
  fi
  [[ "$source" =~ ^[a-z0-9_-]+/[a-z-]+/lictory-[A-Za-z0-9_-]+\.dump(\.age)?$ ]] || {
    echo "Not a backup key: $source" >&2
    exit 64
  }
  stored="$work/$(basename "$source")"
  manifest_stored="$work/$(manifest_name "$(basename "$source")")"
  rclone copyto "${rclone_flags[@]}" "$remote/$source" "$stored"
  rclone copyto "${rclone_flags[@]}" "$remote/$(manifest_name "$source")" "$manifest_stored"
  if [ -n "$expected_sha" ]; then
    actual=$(sha256sum "$stored" | cut -d' ' -f1)
    [ "$actual" = "$expected_sha" ] || { echo "Downloaded backup checksum mismatch" >&2; exit 1; }
  fi
fi
fetched=$(date -u +%s)

case "$stored" in
  *.age)
    : "${AGE_IDENTITY_FILE:?This backup is encrypted: set AGE_IDENTITY_FILE to the private age identity.}"
    age -d -i "$AGE_IDENTITY_FILE" -o "$work/backup.dump" "$stored"
    age -d -i "$AGE_IDENTITY_FILE" -o "$work/manifest.json" "$manifest_stored"
    ;;
  *)
    echo "Restoring an unencrypted backup." >&2
    cp "$stored" "$work/backup.dump"
    cp "$manifest_stored" "$work/manifest.json"
    ;;
esac
[ "$(sha256sum "$work/backup.dump" | cut -d' ' -f1)" = "$(jq -r .dump_sha256 "$work/manifest.json")" ] || {
  echo "Decrypted dump does not match its manifest" >&2
  exit 1
}
if [ -n "$check_only" ]; then
  pg_restore --list "$work/backup.dump" >/dev/null || { echo "pg_restore cannot read the dump" >&2; exit 1; }
  jq -c '{checked:.name, application_version, dump_bytes}' "$work/manifest.json"
  exit 0
fi

exists=$(psql -X -A -t -d postgres -v db="$RESTORE_DATABASE" <<'SQL'
SELECT count(*) FROM pg_database WHERE datname = :'db';
SQL
)
if [ "$exists" = 0 ]; then
  createdb --owner=lictory_owner --template=template0 "$RESTORE_DATABASE"
else
  tables=$(psql -X -A -t -d "$RESTORE_DATABASE" -c \
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')")
  [ "$tables" = 0 ] || {
    echo "Refusing to restore into $RESTORE_DATABASE: it already contains $tables tables." >&2
    exit 1
  }
fi

# Skip objects owned by zero-cache's own lifecycle.
pg_restore --list "$work/backup.dump" |
  grep -v -E ' EVENT TRIGGER | PUBLICATION (- )?_zero|PUBLICATION TABLE (- )?_zero' >"$work/restore.list"
pg_restore --exit-on-error --single-transaction --no-password \
  --use-list="$work/restore.list" --dbname="$RESTORE_DATABASE" "$work/backup.dump"
psql -X -q -d "$RESTORE_DATABASE" -c "ANALYZE"

manifest_out="${RESTORE_MANIFEST_OUT:-/tmp/restored-manifest.json}"
cp "$work/manifest.json" "$manifest_out"
finished=$(date -u +%s)
jq -c --argjson fetch "$((fetched - started))" --argjson restore "$((finished - fetched))" \
  '{restored:.name, application_version, dump_bytes, seconds:{download:$fetch, decrypt_and_restore:$restore}}' \
  "$work/manifest.json"
