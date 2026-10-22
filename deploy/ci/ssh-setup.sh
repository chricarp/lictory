#!/usr/bin/env bash
# Writes the deploy key and the pinned host key for release automation.
# Inputs: DEPLOY_SSH_KEY (secret), DEPLOY_SSH_KNOWN_HOSTS (variable: the
# server's `ssh-keyscan -t ed25519` line, verified out of band).
set -euo pipefail
: "${DEPLOY_SSH_KEY:?Configure the DEPLOY_SSH_KEY environment secret.}"
: "${DEPLOY_SSH_KNOWN_HOSTS:?Configure the DEPLOY_SSH_KNOWN_HOSTS environment variable.}"
directory="${RUNNER_TEMP:?}/deploy-ssh"
install -d -m 700 "$directory"
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" >"$directory/key"
printf '%s\n' "$DEPLOY_SSH_KNOWN_HOSTS" >"$directory/known_hosts"
ssh-keygen -l -f "$directory/known_hosts" >/dev/null
{
  echo "DEPLOY_SSH_KEY_FILE=$directory/key"
  echo "DEPLOY_SSH_KNOWN_HOSTS_FILE=$directory/known_hosts"
} >>"$GITHUB_ENV"
