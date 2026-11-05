#!/usr/bin/env bash
# Lists the environment's stored backups (ops image; lictory backup list), newest
# first, as JSON: [{key, kind, name, bytes, modified, encrypted}]. key is what
# restore.sh (and lictory restore) accept; kind is the prefix: daily, weekly,
# monthly, manual or pre-deploy. Reads BACKUP_TARGET like backup.sh.
set -Eeuo pipefail

: "${LICTORY_ENVIRONMENT:?}"
# shellcheck source=deploy/backup/backup-target.sh
. "$(dirname "$0")/backup-target.sh"
[ "$backup_target" != none ] || {
  echo "Backups are disabled for ${LICTORY_ENVIRONMENT} (BACKUP_TARGET=none)." >&2
  exit 3
}
resolve_backup_target read || exit 64
remote="${backup_remote}/${LICTORY_ENVIRONMENT}"
flags=(--s3-no-check-bucket --retries 3 --low-level-retries 5 --contimeout 15s --timeout 2m --stats 0)

# No backup yet: a directory target has no environment directory.
if ! listing=$(rclone lsjson "${flags[@]}" -R --files-only --include '*.dump' --include '*.dump.age' "$remote" 2>&1); then
  case "$listing" in
    *"directory not found"*) listing="[]" ;;
    *)
      printf 'Could not list %s: %s\n' "$remote" "$listing" >&2
      exit 1
      ;;
  esac
fi
printf '%s' "$listing" | jq --arg env "$LICTORY_ENVIRONMENT" '
  [.[] | select(.Path | test("^[a-z-]+/lictory-[A-Za-z0-9_-]+\\.dump(\\.age)?$"))
   | {key: ($env + "/" + .Path), kind: (.Path | split("/")[0]), name: .Name,
      bytes: .Size, modified: .ModTime, encrypted: (.Name | endswith(".age"))}]
  | sort_by(.modified) | reverse'
