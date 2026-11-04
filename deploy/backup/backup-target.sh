#!/usr/bin/env bash
# Sourced by backup.sh and restore.sh (ops image). Resolves BACKUP_TARGET into
# the rclone location that holds <environment>/{daily,weekly,monthly,…}:
#
#   s3      (default) any S3-compatible bucket: BACKUP_BUCKET plus BACKUP_S3_*
#           (provider, endpoint, region, keys) as rclone's "backup" remote
#   local   a directory mounted at /backup-target: BACKUP_LOCAL_PATH on the
#           host (a NAS or second disk), or the server's own backups volume
#   rclone  any rclone destination in BACKUP_RCLONE_REMOTE, for example an
#           on-the-fly connection string such as :sftp,host=nas,user=lictory:backups
#   none    backups are disabled
#
# resolve_backup_target [write] sets backup_remote, or prints why the
# configuration is unusable and returns 1.
# shellcheck disable=SC2034 # read by the scripts that source this file
backup_target="${BACKUP_TARGET:-s3}"
backup_remote=""
resolve_backup_target() {
  case "$backup_target" in
    s3)
      [ -n "${BACKUP_BUCKET:-}" ] || {
        echo "BACKUP_TARGET=s3 needs BACKUP_BUCKET and the BACKUP_S3_* settings (or choose local, rclone or none)." >&2
        return 1
      }
      backup_remote="backup:${BACKUP_BUCKET}"
      ;;
    local)
      if [ ! -d /backup-target ] || { [ "${1:-}" = write ] && [ ! -w /backup-target ]; }; then
        echo "BACKUP_TARGET=local needs a writable /backup-target: create BACKUP_LOCAL_PATH on the host, owned by uid 70 (the ops image's postgres user)." >&2
        return 1
      fi
      backup_remote=/backup-target
      ;;
    rclone)
      [ -n "${BACKUP_RCLONE_REMOTE:-}" ] || {
        echo "BACKUP_TARGET=rclone needs BACKUP_RCLONE_REMOTE (an rclone remote:path or connection string)." >&2
        return 1
      }
      backup_remote="${BACKUP_RCLONE_REMOTE%/}"
      ;;
    none) ;;
    *)
      echo "Unknown BACKUP_TARGET \"$backup_target\": use s3, local, rclone or none." >&2
      return 1
      ;;
  esac
}
