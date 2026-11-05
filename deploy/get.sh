#!/bin/sh
# Bootstraps the Lictory command on a Linux server from a published release:
#
#   curl -fsSL https://raw.githubusercontent.com/chricarp/lictory/main/deploy/get.sh | sudo sh
#   sudo lictory install
#
# It resolves a GitHub Release of chricarp/lictory (the newest stable one by
# default), downloads its release.env over HTTPS and checks it against the
# digest GitHub publishes for the asset, pulls the release's ops image by
# digest and installs the host tooling (deploy user, /srv/lictory, timers and
# the lictory command) from the deployment bundle inside that image. Nothing
# is started; `lictory install` asks for the settings and deploys.
# Safe to re-run. See docs/operations/self-hosting.md.
#
# Variables:
#   LICTORY_CHANNEL   stable (default) or nightly
#   LICTORY_VERSION   a release version such as 1.4.2 (instead of the newest)
#   LICTORY_ROOT      tooling and environment root (default /srv/lictory)
#   DEPLOY_USER       unprivileged user that runs releases (default deploy)
#   LICTORY_ENV       environment name prepared for `lictory install` (default production)
#   GITHUB_TOKEN      a token that can read the repository: needed when it is
#                     private (a fork), and raises GitHub's rate limit
set -eu

# Everything runs from main, so a truncated download executes nothing.
main() {
  repository="${LICTORY_REPOSITORY:-chricarp/lictory}"
  api="${LICTORY_GITHUB_API:-https://api.github.com}"
  registry="${LICTORY_IMAGE_REGISTRY:-ghcr.io/chricarp}"
  channel="${LICTORY_CHANNEL:-stable}"
  version="${LICTORY_VERSION:-}"

  [ "$(uname -s)" = Linux ] || fail "Lictory servers run Linux; this is $(uname -s)."
  [ "$(id -u)" = 0 ] || fail "Run as root: curl -fsSL <url> | sudo sh"
  case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) fail "Lictory images exist for amd64 and arm64 only (this is $(uname -m))." ;;
  esac
  missing=""
  for tool in bash curl jq openssl flock; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  [ -z "$missing" ] || fail "Missing:$missing. Install them first, for example:
  Debian/Ubuntu:  apt-get install -y bash curl jq openssl util-linux
  RHEL/Fedora:    dnf install -y bash curl jq openssl util-linux"
  command -v docker >/dev/null 2>&1 ||
    fail "Docker Engine is required: https://docs.docker.com/engine/install/ (then re-run this command)."
  docker compose version >/dev/null 2>&1 ||
    fail "The Docker Compose v2 plugin is required (package docker-compose-plugin)."
  docker version >/dev/null 2>&1 || fail "Cannot reach the Docker daemon: start it (systemctl start docker)."
  case "$channel" in stable | nightly) ;; *) fail "LICTORY_CHANNEL must be stable or nightly." ;; esac
  printf '%s' "$repository" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || fail "Invalid LICTORY_REPOSITORY."
  printf '%s' "$registry" | grep -Eq '^[a-z0-9.-]+(:[0-9]+)?(/[a-z0-9._-]+)+$' || fail "Invalid LICTORY_IMAGE_REGISTRY."

  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  trap 'exit 130' INT TERM

  if [ -n "$version" ]; then
    printf '%s' "$version" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' ||
      fail "LICTORY_VERSION must be a release version such as 1.4.2."
    path="/releases/tags/v${version#v}"
  elif [ "$channel" = stable ]; then
    path=/releases/latest
  else
    path="/releases?per_page=50"
  fi
  # Never trace a token; headers in a private file keep it out of the
  # process list.
  { set +x; } 2>/dev/null
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    # curl before 7.58.0 forwards a custom Authorization header to the host a
    # redirect points to (CVE-2018-1000007): GitHub redirects assets to storage.
    curl_version=$(curl --version | head -n 1 | cut -d' ' -f2)
    # Sorted means 7.58.0 <= the installed version.
    printf '7.58.0\n%s\n' "${curl_version%%-*}" | sort -V -C ||
      fail "curl $curl_version may send GITHUB_TOKEN to the storage host GitHub redirects to (fixed in 7.58.0). Upgrade curl, then run this again."
  fi
  printf 'Accept: application/vnd.github+json\nX-GitHub-Api-Version: 2022-11-28\n' >"$work/headers"
  [ -z "${GITHUB_TOKEN:-}" ] || printf 'Authorization: Bearer %s\n' "$GITHUB_TOKEN" >>"$work/headers"
  status=$(curl -sSL --proto '=https' --proto-redir '=https' --tlsv1.2 -m 30 --retry 3 \
    -H "@$work/headers" -o "$work/release.json" -w '%{http_code}' "$api/repos/$repository$path" || echo 000)
  case "$status" in
    200) ;;
    404)
      private=""
      [ -n "${GITHUB_TOKEN:-}" ] || private=" If $repository is private, set GITHUB_TOKEN to a token that can read it."
      [ -n "$version" ] && fail "Release ${version#v} of $repository does not exist.$private"
      fail "No $channel release of $repository is published yet (try LICTORY_CHANNEL=nightly).$private" ;;
    403 | 429) fail "GitHub refused the request (HTTP $status, usually its rate limit); retry later." ;;
    *) fail "Could not reach GitHub Releases (HTTP $status); check outbound HTTPS from this server." ;;
  esac
  if [ -z "$version" ] && [ "$channel" = nightly ]; then
    jq '[.[] | select(.draft == false and .prerelease == true and
          (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+-nightly\\.[0-9]{8}\\.[0-9]+$")))]
        | sort_by(.published_at) | last // empty' "$work/release.json" >"$work/one.json"
    [ -s "$work/one.json" ] || fail "No nightly release of $repository is published yet."
    mv "$work/one.json" "$work/release.json"
  fi
  tag=$(jq -r '.tag_name // ""' "$work/release.json")
  kind=$(jq -r 'if .draft then "draft" elif .prerelease then "nightly" else "stable" end' "$work/release.json")
  if printf '%s' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
    [ "$kind" = stable ] || fail "$tag is not a published stable release."
  elif printf '%s' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]+$'; then
    [ "$kind" = nightly ] || fail "$tag is not a published nightly release."
  else
    fail "$tag is not a Lictory stable or nightly release."
  fi
  [ -n "$version" ] || [ "$kind" = "$channel" ] || fail "$tag is not a $channel release."
  release="${tag#v}"
  asset=$(jq -r '[.assets[]? | select(.name == "release.env")][0].browser_download_url // ""' "$work/release.json")
  digest=$(jq -r '[.assets[]? | select(.name == "release.env")][0].digest // ""' "$work/release.json")
  asset_api=$(jq -r '[.assets[]? | select(.name == "release.env")][0].url // ""' "$work/release.json")
  case "$asset" in https://*) ;; *) fail "Release $release has no release.env asset." ;; esac

  say "Lictory $release ($kind)"
  if [ -n "${GITHUB_TOKEN:-}" ] && case "$asset_api" in https://*) true ;; *) false ;; esac; then
    # Private repositories serve assets through the API, with the token
    # (curl does not forward it to the storage host it redirects to).
    printf 'Accept: application/octet-stream\nX-GitHub-Api-Version: 2022-11-28\nAuthorization: Bearer %s\n' "$GITHUB_TOKEN" >"$work/headers"
    curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 -m 60 --retry 3 \
      -H "@$work/headers" -o "$work/release.env" "$asset_api" ||
      fail "Could not download release.env of $release with GITHUB_TOKEN (does it grant read access to $repository?)."
  else
    curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 -m 60 --retry 3 \
      -o "$work/release.env" "$asset" || fail "Could not download release.env of $release."
  fi
  if [ -n "$digest" ]; then
    actual="sha256:$(openssl dgst -sha256 -r "$work/release.env" | cut -d' ' -f1 | tr -d '*')"
    [ "$actual" = "$digest" ] ||
      fail "release.env does not match the digest GitHub publishes ($digest, downloaded $actual). Nothing was installed."
    say "release.env matches GitHub's digest $digest"
  else
    say "Warning: GitHub publishes no digest for release.env; relying on HTTPS alone." >&2
  fi
  value() { grep -E "^$1=" "$work/release.env" | tail -n 1 | cut -d= -f2-; }
  [ "$(value LICTORY_VERSION)" = "$release" ] || fail "release.env names version $(value LICTORY_VERSION), not $release."
  [ "$(value LICTORY_CHANNEL)" = "$kind" ] || fail "release.env names channel $(value LICTORY_CHANNEL), not $kind."
  ops=$(value OPS_IMAGE)
  printf '%s' "$ops" | grep -Eq "^$(printf '%s' "$registry" | sed 's/[.]/\\./g')/lictory-ops@sha256:[0-9a-f]{64}\$" ||
    fail "The release's ops image is not a digest in $registry."

  if ! output=$(docker pull -q "$ops" 2>&1); then
    case "$output" in
      *denied* | *unauthorized* | *forbidden* | *"authentication required"*)
        fail "The registry refused to pull $ops.
The Lictory images may not be public yet. Log in with a GitHub token that can
read packages, then re-run:  docker login ${registry%%/*}" ;;
      *) fail "Could not pull $ops: $output" ;;
    esac
  fi
  container=$(docker create "$ops")
  docker cp -q "$container:/opt/lictory/deploy" "$work/bundle" || {
    docker rm "$container" >/dev/null 2>&1 || true
    fail "Could not copy the deployment bundle out of $ops."
  }
  docker rm "$container" >/dev/null
  [ -f "$work/bundle/bin/lictory" ] && [ -f "$work/bundle/provision/install.sh" ] ||
    fail "Release $release predates the lictory command; choose a newer one (LICTORY_VERSION)."
  # The child never reads this script's stdin (the piped script itself).
  # The repository and registry used here are recorded for install and upgrades.
  LICTORY_REPOSITORY="$repository" LICTORY_IMAGE_REGISTRY="$registry" \
    bash "$work/bundle/bin/lictory" bootstrap --bundle "$work/bundle" --release-file "$work/release.env" </dev/null
}

say() { printf '%s\n' "$*"; }
fail() {
  printf 'lictory get.sh: %s\n' "$*" >&2
  exit 1
}

main "$@"
