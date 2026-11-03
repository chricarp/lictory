#!/usr/bin/env bash
# Optional, idempotent hardening of a fresh Ubuntu 24.04 LTS server for
# Lictory: packages, Docker from Docker's repository, automatic security
# updates, firewall, SSH, fail2ban, swap and journald, then install.sh (deploy
# user, layout, tools, timers). Any other Linux host with Docker Engine and
# Compose v2 only needs install.sh. Run as root from a copy of deploy/:
#
#   scp -r deploy admin@server:/tmp/lictory-deploy
#   ssh admin@server sudo ADMIN_USER=admin LICTORY_ENVIRONMENTS=production \
#     bash /tmp/lictory-deploy/provision/provision.sh
#
# Safe to re-run: every step converges. See docs/operations/deployment.md.
#
# Variables:
#   ADMIN_USER            existing sudo user that keeps SSH access (required)
#   LICTORY_ENVIRONMENTS  space-separated environment names hosted here (default production)
#   LICTORY_ROOT          tooling and environment root (default /srv/lictory)
#   DEPLOY_USER           unprivileged user that runs releases (default deploy)
#   SWAP_SIZE             swap file size when none exists (default 4G)
#   AUTO_REBOOT           reboot at 04:00 UTC when security updates need it (default true)
set -euo pipefail

: "${ADMIN_USER:?Set ADMIN_USER to the sudo user that keeps SSH access.}"
swap_size="${SWAP_SIZE:-4G}"
auto_reboot="${AUTO_REBOOT:-true}"
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
deploy_user="${DEPLOY_USER:-deploy}"

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || echo "Warning: tested on Ubuntu 24.04, found $PRETTY_NAME." >&2
id "$ADMIN_USER" >/dev/null 2>&1 || { echo "User $ADMIN_USER does not exist." >&2; exit 1; }
[ -s "$(getent passwd "$ADMIN_USER" | cut -d: -f6)/.ssh/authorized_keys" ] ||
  { echo "$ADMIN_USER has no SSH key; refusing to harden SSH." >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

step "Base packages, UTC and time synchronisation"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get install -y -q ca-certificates curl gnupg jq openssl ufw fail2ban \
  unattended-upgrades apt-listchanges chrony util-linux
timedatectl set-timezone UTC
systemctl enable --now chrony

step "Docker Engine and Compose plugin from Docker's repository"
install -m 0755 -d /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" \
  >/etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
install -d -m 0755 /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true,
  "userland-proxy": false,
  "no-new-privileges": true
}
JSON
systemctl enable docker
systemctl restart docker

step "Automatic security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat >/etc/apt/apt.conf.d/52lictory-unattended-upgrades <<CONF
Unattended-Upgrade::Allowed-Origins {
  "\${distro_id}:\${distro_codename}-security";
  "\${distro_id}ESMApps:\${distro_codename}-apps-security";
  "\${distro_id}ESM:\${distro_codename}-infra-security";
};
// Docker Engine is upgraded deliberately (it restarts containers' runtime).
Unattended-Upgrade::Package-Blacklist { "docker-ce"; "docker-ce-cli"; "containerd.io"; };
Unattended-Upgrade::Automatic-Reboot "${auto_reboot}";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF

step "Firewall: SSH (rate limited), HTTP and HTTPS only"
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment ssh
ufw allow 80/tcp comment http
ufw allow 443/tcp comment https
ufw --force enable
# Docker publishes only the proxy's 80/443; PostgreSQL and zero-cache have no
# published ports, so Docker's own iptables rules expose nothing else.

step "SSH hardening and fail2ban"
cat >/etc/ssh/sshd_config.d/10-lictory.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowUsers ${ADMIN_USER} ${deploy_user}
CONF
sshd -t
systemctl reload ssh
cat >/etc/fail2ban/jail.d/lictory.local <<'CONF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

step "Swap and kernel settings"
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l "$swap_size" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
cat >/etc/sysctl.d/90-lictory.conf <<'CONF'
vm.swappiness = 10
vm.overcommit_memory = 0
fs.inotify.max_user_watches = 524288
CONF
sysctl --system >/dev/null

step "journald limits"
install -d /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/lictory.conf <<'CONF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=1month
CONF
systemctl restart systemd-journald

# Deploy user, directory layout, host tools and timers (any distribution).
DEPLOY_USER="$deploy_user" bash "$source_dir/provision/install.sh"
