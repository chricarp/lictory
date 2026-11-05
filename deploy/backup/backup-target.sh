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
      # A connection string: on the fly (:backend,…:path) or options on a
      # named remote (name,…:path); a plain name:path is left as it is.
      case "$backup_remote" in
        :*) rclone_remote_from_string || return 1 ;;
        *) case "${backup_remote%%:*}" in *,*) rclone_remote_from_string || return 1 ;; esac ;;
      esac
      ;;
    none) ;;
    *)
      echo "Unknown BACKUP_TARGET \"$backup_target\": use s3, local, rclone or none." >&2
      return 1
      ;;
  esac
}

# A connection string (:sftp,host=nas,user=backup,pass=…:path, or a named
# remote with options: nas,pass=…:path) would put its credentials on rclone's
# command line, visible in the process list. Its options become rclone's
# config-from-environment variables instead (RCLONE_CONFIG_LICTORYTARGET_*
# with the backend as TYPE, or RCLONE_CONFIG_<NAME>_* for a named remote),
# and backup_remote names the remote without options. Parsed as rclone
# parses it: an option without "=" is true; a value may be quoted with ' or
# " from its first character, a doubled quote inside being a literal one.
rclone_prefix=""
rclone_option() { # rclone_option <name> <value>
  [[ "$1" =~ ^[a-z0-9_-]+$ ]] || {
    echo "BACKUP_RCLONE_REMOTE has an invalid option name: $1" >&2
    return 1
  }
  export "RCLONE_CONFIG_${rclone_prefix}_$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')=$2"
}
rclone_remote_from_string() {
  local rest="$backup_remote" head name="" value="" char quote="" state=name i ended=false
  case "$rest" in
    :*)
      rest="${rest#:}"
      head="${rest%%[,:]*}"
      [[ "$head" =~ ^[a-z0-9]+$ ]] || {
        echo "BACKUP_RCLONE_REMOTE is not a valid connection string (:backend,option=value:path)." >&2
        return 1
      }
      rclone_prefix=LICTORYTARGET
      ;;
    *)
      head="${rest%%[,:]*}"
      [[ "$head" =~ ^[A-Za-z0-9_]+$ ]] || {
        echo "BACKUP_RCLONE_REMOTE: options on a named remote need a name of letters, digits and underscores." >&2
        return 1
      }
      rclone_prefix=$(printf '%s' "$head" | tr '[:lower:]' '[:upper:]')
      ;;
  esac
  rest="${rest#"$head"}"
  # No options: the remote is just head:path.
  if [ "${rest:0:1}" = , ]; then
    for ((i = 1; i < ${#rest}; i++)); do
      char="${rest:i:1}"
      case "$state" in
        name)
          case "$char" in
            =) state=value value="" ;;
            , | :)
              [ -z "$name" ] || rclone_option "$name" true || return 1
              name=""
              if [ "$char" = : ]; then ended=true && break; fi
              ;;
            *) name="$name$char" ;;
          esac
          ;;
        value)
          # A quote opens a quoted value only as its first character.
          if [ -z "$value" ] && [ "${rest:i-1:1}" = = ] && { [ "$char" = '"' ] || [ "$char" = "'" ]; }; then
            quote="$char" state=quoted
            continue
          fi
          case "$char" in
            , | :)
              rclone_option "$name" "$value" || return 1
              name="" value="" state=name
              if [ "$char" = : ]; then ended=true && break; fi
              ;;
            *) value="$value$char" ;;
          esac
          ;;
        quoted)
          if [ "$char" != "$quote" ]; then
            value="$value$char"
          elif [ "${rest:i+1:1}" = "$quote" ]; then
            value="$value$char" # a doubled quote is a literal one
            i=$((i + 1))
          else
            case "${rest:i+1:1}" in "," | ":" | "") ;; *)
              echo "BACKUP_RCLONE_REMOTE: only \",\" or \":\" may follow the closing quote of $name." >&2
              return 1
              ;;
            esac
            state=value quote=""
          fi
          ;;
      esac
    done
    if [ "$ended" = false ]; then
      case "$state" in
        quoted)
          echo "BACKUP_RCLONE_REMOTE has an unterminated quote." >&2
          return 1
          ;;
        value) rclone_option "$name" "$value" || return 1 ;;
        name) [ -z "$name" ] || rclone_option "$name" true || return 1 ;;
      esac
    fi
    rest="${rest:i}"
  fi
  # rest is now ":path" or empty.
  if [ "$rclone_prefix" = LICTORYTARGET ]; then
    export RCLONE_CONFIG_LICTORYTARGET_TYPE="$head"
    backup_remote="lictorytarget:${rest#:}"
  else
    backup_remote="$head:${rest#:}"
  fi
}
