#!/usr/bin/env bash
# Creates /srv/lictory/<environment>/.env from the committed template, with
# freshly generated database passwords and application secrets. Refuses to
# overwrite an existing file. Run as the deploy user on the server:
#
#   /tmp/lictory-deploy/provision/new-environment.sh production
#
# Afterwards edit the file for hosts, provider credentials and the backup age
# recipient; never copy values between environments.
set -euo pipefail

environment="${1:?Usage: new-environment.sh <production|staging>}"
case "$environment" in production | staging) ;; *)
  echo "Unknown environment: $environment" >&2
  exit 64
  ;;
esac
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
home="${LICTORY_ROOT:-/srv/lictory}/$environment"
target="$home/.env"
[ ! -e "$target" ] || { echo "$target exists; edit it instead." >&2; exit 1; }
mkdir -p "$home"
umask 077
tmp=$(mktemp "$home/.env.XXXXXX")
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *=generate) printf '%s=%s\n' "${line%=generate}" "$(openssl rand -hex 32)" ;;
    *) printf '%s\n' "$line" ;;
  esac
done <"$source_dir/env/$environment.env.example" >"$tmp"
{
  echo
  echo "# Release policy for this server (deploy.sh)."
  echo "LICTORY_RELEASE_CHANNEL=$([ "$environment" = production ] && echo stable || echo nightly)"
  echo "LICTORY_IMAGE_REGISTRY=ghcr.io/replace-with-owner"
  echo "PRE_DEPLOY_BACKUP=true"
} >>"$tmp"
chmod 0600 "$tmp"
mv "$tmp" "$target"
echo "Created $target (mode 0600) with generated secrets."
echo "Edit it now: hosts, ACME_EMAIL, R2_*, RESEND_*, BACKUP_* (dedicated bucket and token),"
echo "BACKUP_AGE_RECIPIENTS (public key of an offline age identity), ALERT_WEBHOOK_URL,"
echo "MONITOR_PING_URL, BACKUP_PING_URL and LICTORY_IMAGE_REGISTRY."
if grep -q '=generate$' "$target"; then
  echo "Unreplaced placeholders remain in $target." >&2
  exit 1
fi
