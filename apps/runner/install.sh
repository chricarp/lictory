#!/bin/sh
# Installs lictory-runner on Linux or macOS from a GitHub release of Lictory,
# published as the release asset `lictory-runner-install.sh`. Download it,
# then run it, so a failed download stops with an error (piping curl into sh
# runs an empty script and reports success when the download fails):
#
#   curl -fsSLO https://github.com/chricarp/lictory/releases/latest/download/lictory-runner-install.sh &&
#     sh lictory-runner-install.sh
#   sh lictory-runner-install.sh --version 0.27.0 \
#     --url https://lictory.example.com --token lrt_… --service
#
# It downloads the binary for this system, checks it against the release's
# SHA256SUMS, installs it (replacing an older one in place) and, given --url
# and --token, registers the runner; --service also installs and starts it as
# a service. Without them it prints the register command. It exits non-zero,
# having installed nothing, when any step fails.
#
# Options (or environment variables):
#   --version <v>   LICTORY_RUNNER_VERSION       release to install, default latest stable
#   --dir <path>    LICTORY_RUNNER_INSTALL_DIR   default /usr/local/bin when writable, else ~/.local/bin
#   --url, --token, --name, --service            register (and install the service) afterwards
#   LICTORY_RUNNER_DOWNLOAD_URL                  base URL of the release files (mirrors, tests)
#   LICTORY_RUNNER_SYSTEM_DIR                    the system directory tried first, default /usr/local/bin
#
# Later releases keep publishing this script under the same name and the
# binaries as lictory-runner-<linux|darwin>-<x64|arm64>, so the newest script
# installs any release. Windows: lictory-runner-install.ps1.
set -eu

# Everything runs from main, called on the last line: a download cut short
# defines nothing and runs nothing.
main() {
  repository=https://github.com/chricarp/lictory
  version=${LICTORY_RUNNER_VERSION:-latest}
  dir=${LICTORY_RUNNER_INSTALL_DIR:-}
  base=${LICTORY_RUNNER_DOWNLOAD_URL:-}
  url=
  token=
  name=
  service=false

  fail() {
    printf 'lictory-runner install: %s\n' "$*" >&2
    exit 1
  }

  while [ $# -gt 0 ]; do
    case "$1" in
      --version | --dir | --url | --token | --name)
        [ $# -ge 2 ] || fail "$1 needs a value."
        case "$1" in
          --version) version=$2 ;;
          --dir) dir=$2 ;;
          --url) url=$2 ;;
          --token) token=$2 ;;
          --name) name=$2 ;;
        esac
        shift 2
        ;;
      --service)
        service=true
        shift
        ;;
      -h | --help)
        echo "Usage: lictory-runner-install.sh [--version <version>|latest] [--dir <directory>]"
        echo "         [--url <server> --token <registration token> [--name <name>] [--service]]"
        exit 0
        ;;
      *) fail "unknown option $1 (see --help)." ;;
    esac
  done
  if { [ -n "$url" ] && [ -z "$token" ]; } || { [ -z "$url" ] && [ -n "$token" ]; }; then
    fail "--url and --token go together."
  fi
  [ "$service" = false ] || [ -n "$url" ] ||
    fail "--service needs --url and --token (or run: lictory-runner install-service --enable)."

  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW* | MSYS* | CYGWIN*) fail "on Windows, use lictory-runner-install.ps1 in PowerShell." ;;
    *) fail "$(uname -s) is not supported: lictory-runner is built for Linux, macOS and Windows." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) fail "$(uname -m) is not supported: lictory-runner is built for x64 and arm64." ;;
  esac
  # A shell under Rosetta reports x86_64 on Apple silicon; install the native one.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] &&
    [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  asset=lictory-runner-$os-$arch

  version=${version#v}
  if [ -z "$base" ]; then
    if [ "$version" = latest ]; then
      base=$repository/releases/latest/download
    else
      base=$repository/releases/download/v$version
    fi
  fi

  if command -v curl >/dev/null 2>&1; then
    download() { curl -fsSL --retry 3 -o "$2" "$1"; }
  elif command -v wget >/dev/null 2>&1; then
    download() { wget -q -O "$2" "$1"; }
  else
    fail "install curl or wget first."
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
  elif command -v shasum >/dev/null 2>&1; then
    sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
  else
    fail "install sha256sum (coreutils) or shasum first."
  fi

  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT INT TERM

  label=v$version
  if [ "$version" = latest ]; then
    label="the latest release"
    # The release names itself in release-manifest.json (mirrors may not
    # carry it; the label then stays generic).
    if download "$base/release-manifest.json" "$work/release-manifest.json" 2>/dev/null; then
      tag=$(grep -o '"tag":"v[^"]*"' "$work/release-manifest.json" | head -n 1 | cut -d '"' -f 4)
      [ -z "$tag" ] || label="$tag, the latest release"
    fi
  fi
  if ! download "$base/SHA256SUMS" "$work/SHA256SUMS"; then
    if [ "$version" = latest ]; then
      fail "could not download $base/SHA256SUMS: $label publishes no lictory-runner files, or this machine cannot reach it. Nothing was installed. See $repository/releases for a release with lictory-runner files and pass its version with --version."
    fi
    fail "release v$version has no lictory-runner files at $base (nightlies are kept for 14 days; a development server has no release). Install the latest stable release instead: rerun without --version, or with --version latest."
  fi
  expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$work/SHA256SUMS")
  [ -n "$expected" ] || fail "$label has no $asset in its SHA256SUMS. Nothing was installed."
  printf 'Downloading %s (%s)…\n' "$asset" "$label"
  download "$base/$asset" "$work/lictory-runner" || fail "could not download $base/$asset. Nothing was installed."
  actual=$(sha256 "$work/lictory-runner")
  [ "$actual" = "$expected" ] ||
    fail "$asset does not match the release's SHA256SUMS (expected $expected, got $actual). Nothing was installed."
  chmod 755 "$work/lictory-runner"

  if [ -z "$dir" ]; then
    system_dir=${LICTORY_RUNNER_SYSTEM_DIR:-/usr/local/bin}
    if [ -w "$system_dir" ] || { [ "$(id -u)" = 0 ] && mkdir -p "$system_dir"; }; then
      dir=$system_dir
    else
      dir=$HOME/.local/bin
    fi
  fi
  mkdir -p "$dir" || fail "could not create $dir; choose another with --dir."
  dir=$(cd "$dir" && pwd)
  [ -w "$dir" ] || fail "$dir is not writable; rerun with sudo or choose another with --dir."
  upgrade=false
  [ ! -e "$dir/lictory-runner" ] || upgrade=true
  # Copied next to the target and renamed over it, so a running runner keeps its
  # old file and a failure never leaves half a binary.
  cp "$work/lictory-runner" "$dir/.lictory-runner.$$"
  mv -f "$dir/.lictory-runner.$$" "$dir/lictory-runner"
  binary=$dir/lictory-runner
  installed=$("$binary" --version) || fail "$binary does not run on this system."
  printf 'Installed lictory-runner %s at %s.\n' "$installed" "$binary"

  command=lictory-runner
  case ":$PATH:" in
    *":$dir:"*) [ "$(command -v lictory-runner)" = "$binary" ] || command=$binary ;;
    *)
      command=$binary
      # shellcheck disable=SC2016 # $PATH is printed for the person to type
      printf '%s is not on your PATH; add it, for example: export PATH="%s:$PATH"\n' "$dir" "$dir"
      ;;
  esac

  if [ -n "$url" ]; then
    set -- register --url "$url" --token "$token"
    [ -z "$name" ] || set -- "$@" --name "$name"
    "$binary" "$@"
    if [ "$service" = true ]; then
      "$binary" install-service --enable
    fi
  elif [ "$upgrade" = true ]; then
    printf '\nA runner service keeps the old version until it restarts:\n'
    if [ "$os" = darwin ]; then
      printf '  launchctl kickstart -k gui/%s/com.lictory.runner\n' "$(id -u)"
    else
      printf '  systemctl --user restart lictory-runner (or sudo systemctl restart lictory-runner)\n'
    fi
  else
    printf '\nNext, in this order:\n'
    printf '  1. Register it with a token from Factory → Runners → Add runner:\n'
    printf '     %s register --url <server> --token <token>\n' "$command"
    printf '  2. Keep it running as a service (or run %s start):\n' "$command"
    printf '     %s install-service --enable\n' "$command"
  fi
}

main "$@"
