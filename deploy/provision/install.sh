#!/usr/bin/env bash
# Installs the Lictory server tooling on any Linux host with Docker Engine and
# the Compose v2 plugin: the deploy user, the directory layout, the host
# scripts and (where systemd exists) the backup and monitor timers. It changes
# nothing else about the host. provision.sh runs it after hardening Ubuntu;
# on other distributions run it directly as root from a copy of deploy/:
#
#   sudo LICTORY_ENVIRONMENTS="production qa" bash /tmp/lictory-deploy/provision/install.sh
#
# Safe to re-run: every step converges. See docs/operations/deployment.md.
#
# Variables:
#   LICTORY_ROOT          tooling and environment root (default /srv/lictory)
#   DEPLOY_USER           unprivileged user that owns it and runs releases (default deploy)
#   LICTORY_ENVIRONMENTS  space-separated environment names hosted here (default production)
#   INSTALL_TIMERS        install the systemd backup and monitor timers (default true when systemd runs)
#   LICTORY_CLI_PATH      where the lictory command is linked (default /usr/local/bin/lictory; none skips)
#   SHOW_NEXT_STEPS       print the manual next steps (default true; the lictory CLI sets false)
set -euo pipefail

root="${LICTORY_ROOT:-/srv/lictory}"
user="${DEPLOY_USER:-deploy}"
environments="${LICTORY_ENVIRONMENTS:-production}"
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
timers="${INSTALL_TIMERS:-$([ -d /run/systemd/system ] && echo true || echo false)}"
cli_path="${LICTORY_CLI_PATH:-/usr/local/bin/lictory}"

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
if ! [[ "$root" =~ ^/[A-Za-z0-9._/-]+$ ]] || [[ "$root" == *..* ]]; then
  echo "LICTORY_ROOT must be an absolute path without spaces or '..'." >&2
  exit 1
fi
root="${root%/}"
[[ "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "Invalid DEPLOY_USER: $user" >&2; exit 1; }
for environment in $environments; do
  if ! [[ "$environment" =~ ^[a-z][a-z0-9-]{0,31}$ ]] ||
    case "$environment" in local | test | preview) true ;; *) false ;; esac; then
    echo "Unknown environment $environment (lowercase letters, digits and hyphens; local, test and preview are reserved)" >&2
    exit 1
  fi
done
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with the Compose v2 plugin is required." >&2
  exit 1
fi
for tool in curl flock jq openssl; do
  command -v "$tool" >/dev/null || echo "Warning: $tool is missing; the deployment tooling needs it." >&2
done
step() { printf '\n== %s\n' "$*"; }

step "Deploy user and directory layout"
if ! id "$user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$user"
fi
group="$(id -gn "$user")"
user_home="$(getent passwd "$user" | cut -d: -f6)"
# Membership in the docker group is root-equivalent; the deploy user has no
# sudo and its CI key is restricted to deploy/bin/lictory-remote.
usermod -aG docker "$user"
install -d -m 0700 -o "$user" -g "$group" "$user_home/.ssh"
touch "$user_home/.ssh/authorized_keys"
chown "$user:$group" "$user_home/.ssh/authorized_keys"
chmod 0600 "$user_home/.ssh/authorized_keys"
install -d -m 0750 -o "$user" -g "$group" "$root" "$root/bin"
# A repository checkout has deploy.sh next to bin/; a release's bundle (the
# ops image's /opt/lictory/deploy) has it inside bin/.
for file in "$source_dir"/bin/* "$source_dir"/deploy.sh; do
  [ -f "$file" ] || continue
  install -m 0755 -o "$user" -g "$group" "$file" "$root/bin/$(basename "$file")"
done
# The operator command (docs/operations/self-hosting.md) runs the installed,
# release-managed copy in <root>/bin, which activations keep current.
if [ "$cli_path" != none ] && [ -f "$root/bin/lictory" ]; then
  printf '#!/bin/sh\nexec env LICTORY_ROOT="${LICTORY_ROOT:-%s}" %s/bin/lictory "$@"\n' "$root" "$root" >"$cli_path.new"
  chmod 0755 "$cli_path.new"
  mv -f "$cli_path.new" "$cli_path"
  # Tab completion for commands, options, environments and setting names.
  if [ -d /etc/bash_completion.d ]; then
    LICTORY_ROOT="$root" bash "$root/bin/lictory" completion bash >/etc/bash_completion.d/.lictory.new 2>/dev/null &&
      mv -f /etc/bash_completion.d/.lictory.new /etc/bash_completion.d/lictory ||
      rm -f /etc/bash_completion.d/.lictory.new
  fi
fi
for environment in $environments; do
  install -d -m 0750 -o "$user" -g "$group" "$root/$environment" "$root/$environment/releases" "$root/$environment/postgres"
  install -m 0555 -o "$user" -g "$group" "$source_dir/postgres/10-lictory-roles.sh" "$root/$environment/postgres/10-lictory-roles.sh"
done

if [ "$timers" = true ]; then
  step "Backup and monitoring timers"
  # The committed units name the defaults; render this host's root and user.
  for unit in "$source_dir"/provision/systemd/*; do
    sed -e "s#/srv/lictory#$root#g" -e "s#^User=deploy\$#User=$user#" -e "s#^Group=deploy\$#Group=$group#" \
      "$unit" >"/etc/systemd/system/.$(basename "$unit").new"
    chmod 0644 "/etc/systemd/system/.$(basename "$unit").new"
    mv -f "/etc/systemd/system/.$(basename "$unit").new" "/etc/systemd/system/$(basename "$unit")"
  done
  systemctl daemon-reload
  for environment in $environments; do
    systemctl enable "lictory-backup@$environment.timer" "lictory-monitor@$environment.timer"
    # Timers start once the environment has a .env and an active release.
    if [ -f "$root/$environment/.env" ] && [ -e "$root/$environment/current" ]; then
      systemctl start "lictory-backup@$environment.timer" "lictory-monitor@$environment.timer"
    fi
  done
else
  step "Timers skipped (no systemd); schedule $root/bin/lictory-backup <env> scheduled nightly and $root/bin/lictory-monitor <env> every five minutes"
fi

[ "${SHOW_NEXT_STEPS:-true}" = true ] || exit 0
forced="$root/bin/lictory-remote"
[ "$root" = /srv/lictory ] || forced="LICTORY_ROOT=$root $forced"
step "Done"
cat <<DONE
Next steps (docs/operations/deployment.md, "First launch"):
  1. sudo -u $user $( [ "$root" = /srv/lictory ] || printf 'env LICTORY_ROOT=%s ' "$root")$source_dir/provision/new-environment.sh <environment>   # secrets
  2. Optional, for your own release automation over SSH: add its key to
     $user_home/.ssh/authorized_keys with command="$forced",restrict
  3. When release images are private, log the deploy user in to their registry.
  4. Deploy the first release$([ "$timers" = true ] && printf ', then: systemctl start lictory-backup@<env>.timer lictory-monitor@<env>.timer').
DONE
