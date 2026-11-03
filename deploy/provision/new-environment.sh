#!/usr/bin/env bash
# Creates <root>/<environment>/.env (root: LICTORY_ROOT, default /srv/lictory)
# from the committed template, with freshly generated database passwords and
# application secrets. Refuses to overwrite an existing file. Run as the deploy
# user on the server:
#
#   /tmp/lictory-deploy/provision/new-environment.sh production
#
# Any name works (lowercase letters, digits and hyphens; not local, test or
# preview): production and staging have their own templates, other names (qa,
# eu-prod…) start from the staging template unless LICTORY_ENV_TEMPLATE names
# another file. Optional: LICTORY_IMAGE_REGISTRY (default a GHCR placeholder),
# LICTORY_RELEASE_CHANNEL (default stable for production, nightly otherwise).
#
# Afterwards edit the file for hosts, provider credentials and the backup age
# recipient; never copy values between environments.
set -euo pipefail

environment="${1:?Usage: new-environment.sh <environment>}"
if ! [[ "$environment" =~ ^[a-z][a-z0-9-]{0,31}$ ]] ||
  case "$environment" in local | test | preview) true ;; *) false ;; esac; then
  echo "Unknown environment: $environment (use lowercase letters, digits and hyphens; local, test and preview are reserved)" >&2
  exit 64
fi
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
home="${LICTORY_ROOT:-/srv/lictory}/$environment"
target="$home/.env"
template="${LICTORY_ENV_TEMPLATE:-}"
if [ -z "$template" ]; then
  template="$source_dir/env/$environment.env.example"
  [ -f "$template" ] || template="$source_dir/env/staging.env.example"
fi
[ -f "$template" ] || { echo "Template $template does not exist." >&2; exit 1; }
channel="${LICTORY_RELEASE_CHANNEL:-$([ "$environment" = production ] && echo stable || echo nightly)}"
case "$channel" in stable | nightly | local) ;; *) echo "Unknown release channel: $channel" >&2; exit 64 ;; esac
[ ! -e "$target" ] || { echo "$target exists; edit it instead." >&2; exit 1; }
mkdir -p "$home"
umask 077
tmp=$(mktemp "$home/.env.XXXXXX")
# The environment's own name and directory replace the template's.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *=generate) printf '%s=%s\n' "${line%=generate}" "$(openssl rand -hex 32)" ;;
    LICTORY_ENVIRONMENT=*) printf 'LICTORY_ENVIRONMENT=%s\n' "$environment" ;;
    LICTORY_HOME=*) printf 'LICTORY_HOME=%s\n' "$home" ;;
    *) printf '%s\n' "$line" ;;
  esac
done <"$template" >"$tmp"
{
  echo
  echo "# Release policy for this server (deploy.sh)."
  echo "LICTORY_RELEASE_CHANNEL=$channel"
  echo "LICTORY_IMAGE_REGISTRY=${LICTORY_IMAGE_REGISTRY:-ghcr.io/replace-with-owner}"
  echo "PRE_DEPLOY_BACKUP=true"
} >>"$tmp"
chmod 0600 "$tmp"
mv "$tmp" "$target"
echo "Created $target (mode 0600) with generated secrets."
echo "Edit it now: hosts, ACME_EMAIL, R2_* or S3_* (file storage), RESEND_*, BACKUP_* (dedicated bucket and token),"
echo "BACKUP_AGE_RECIPIENTS (public key of an offline age identity), ALERT_WEBHOOK_URL,"
echo "MONITOR_PING_URL, BACKUP_PING_URL and LICTORY_IMAGE_REGISTRY."
[ "$(basename "$template")" = "$environment.env.example" ] ||
  echo "It started from $(basename "$template"): replace its hosts, database name and bucket names for $environment."
if grep -q '=generate$' "$target"; then
  echo "Unreplaced placeholders remain in $target." >&2
  exit 1
fi
