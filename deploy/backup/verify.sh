#!/usr/bin/env bash
# Verifies a restored database against the manifest captured with its backup:
# identical migration history, identical row count for every table, the Zero
# publication present, and application roles able to connect.
#
#   verify.sh [manifest.json]   (default /tmp/restored-manifest.json)
# Uses the same RESTORE_* connection variables as restore.sh.
set -Eeuo pipefail

manifest="${1:-${RESTORE_MANIFEST_OUT:-/tmp/restored-manifest.json}}"
: "${RESTORE_PGHOST:?}" "${RESTORE_PGUSER:?}" "${RESTORE_PGPASSWORD:?}" "${RESTORE_DATABASE:?}"
export PGHOST="$RESTORE_PGHOST" PGPORT="${RESTORE_PGPORT:-5432}" PGUSER="$RESTORE_PGUSER" \
  PGPASSWORD="$RESTORE_PGPASSWORD" PGDATABASE="$RESTORE_DATABASE" PGAPPNAME=lictory-verify

actual=$(psql -X -A -t -v ON_ERROR_STOP=1 <<'SQL'
SELECT json_build_object(
  'tables', (SELECT coalesce(json_object_agg(t.name, t.n ORDER BY t.name), '{}'::json) FROM (
    SELECT format('%I.%I', n.nspname, c.relname) AS name,
           (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint AS n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('public', 'drizzle')) t),
  'migrations', (SELECT coalesce(json_agg(json_build_object('hash', hash, 'created_at', created_at::text) ORDER BY created_at), '[]'::json)
                 FROM drizzle.__drizzle_migrations),
  'publication', EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'lictory_zero'),
  'app_can_read', has_table_privilege('lictory_app', 'public.sync_entity', 'SELECT,INSERT,UPDATE,DELETE')
);
SQL
)

failures=0
check() { # check <description> <jq expression over {expected, actual}>
  if jq -e -n --argjson expected "$(cat "$manifest")" --argjson actual "$actual" "$2" >/dev/null; then
    echo "ok    $1"
  else
    echo "FAIL  $1" >&2
    failures=$((failures + 1))
  fi
}
check "migration history ($(jq '.migrations | length' "$manifest") migrations)" '$expected.migrations == $actual.migrations'
check "row counts ($(jq '.tables | length' "$manifest") tables, $(jq '[.tables[]] | add' "$manifest") rows)" '$expected.tables == $actual.tables'
check "publication lictory_zero" '$actual.publication'
check "lictory_app privileges" '$actual.app_can_read'

if [ "$failures" -gt 0 ]; then
  jq -n --argjson expected "$(cat "$manifest")" --argjson actual "$actual" \
    '[$expected.tables | to_entries[] | select($actual.tables[.key] != .value) | {table:.key, expected:.value, actual:$actual.tables[.key]}]' >&2
  exit 1
fi
echo "Restore verified: $(jq -r .name "$manifest")"
