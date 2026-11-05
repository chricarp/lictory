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
      case "$backup_remote" in :*) rclone_remote_from_string || return 1 ;; esac
      ;;
    none) ;;
    *)
      echo "Unknown BACKUP_TARGET \"$backup_target\": use s3, local, rclone or none." >&2
      return 1
      ;;
  esac
}

# A connection string (:sftp,host=nas,user=backup,pass=…:path) would put its
# credentials on rclone's command line, visible in the process list. Its
# backend and parameters become RCLONE_CONFIG_LICTORYTARGET_* variables
# instead (rclone's own config-from-environment), and backup_remote names
# that remote: lictorytarget:path. Values may be quoted with ' or ".
rclone_option() { # rclone_option <name> <value>
  [[ "$1" =~ ^[a-z0-9_-]+$ ]] || {
    echo "BACKUP_RCLONE_REMOTE has an invalid option name: $1" >&2
    return 1
  }
  export "RCLONE_CONFIG_LICTORYTARGET_$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')=$2"
}
rclone_remote_from_string() {
  local rest="${backup_remote#:}" backend="" name="" value="" char quote="" state=backend i
  for ((i = 0; i < ${#rest}; i++)); do
    char="${rest:i:1}"
    if [ -n "$quote" ]; then
      if [ "$char" = "$quote" ]; then quote=""; else value="$value$char"; fi
      continue
    fi
    case "$state:$char" in
      backend:,) state=name ;;
      backend::) break ;;
      backend:*) backend="$backend$char" ;;
      name:=) state=value ;;
      name:*) name="$name$char" ;;
      value:\" | value:\') quote="$char" ;;
      value:, | value::)
        rclone_option "$name" "$value" || return 1
        name="" value=""
        if [ "$char" = : ]; then break; fi
        state=name
        ;;
      value:*) value="$value$char" ;;
    esac
  done
  # The last option of a string without a path ends with the string.
  if [ "$i" -ge "${#rest}" ] && [ "$state" = value ]; then rclone_option "$name" "$value" || return 1; fi
  [ -z "$quote" ] && [ -n "$backend" ] && [[ "$backend" =~ ^[a-z0-9]+$ ]] || {
    echo "BACKUP_RCLONE_REMOTE is not a valid connection string (:backend,option=value:path)." >&2
    return 1
  }
  export RCLONE_CONFIG_LICTORYTARGET_TYPE="$backend"
  backup_remote="lictorytarget:${rest:i+1}"
}
