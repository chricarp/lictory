// The commands the add-runner dialog shows: the installer of the latest
// release (apps/runner/install.sh and install.ps1, published as
// lictory-runner-install.sh and .ps1) installs the runner of this server's
// own release, checks it against the release's SHA256SUMS, registers it and
// keeps it running. See docs/operations/releases.md#runner-and-desktop-app.

export const RUNNER_RELEASES =
  "https://github.com/chricarp/lictory/releases/latest/download";

export type RunnerSystem = "linux" | "macos" | "windows";

// Versions that have a GitHub release: stable and nightly.
const releaseVersion = /^\d+\.\d+\.\d+(-nightly\.\d{8}\.\d+)?$/;

/**
 * The install command for one system. `version` is the server's; without a
 * release version (an unknown build) the installer takes the latest stable
 * release.
 */
export function runnerInstallCommand(
  system: RunnerSystem,
  server: string,
  token: string,
  version: string | undefined,
): string {
  const pinned = version && releaseVersion.test(version) ? version : undefined;
  if (system === "windows")
    return [
      `& ([scriptblock]::Create((irm ${RUNNER_RELEASES}/lictory-runner-install.ps1))) \``,
      `  ${pinned ? `-Version ${pinned} ` : ""}-Url ${server} -Token ${token} -Service`,
    ].join("\n");
  // Downloaded, then run: `curl … | sh` reports success when the download
  // fails, because sh runs the empty script it receives.
  return [
    `curl -fsSLO ${RUNNER_RELEASES}/lictory-runner-install.sh &&`,
    `  sh lictory-runner-install.sh ${pinned ? `--version ${pinned} ` : ""}--url ${server} --token ${token} --service`,
  ].join("\n");
}

const sourceTarget: Record<RunnerSystem, { target: string; other: string }> = {
  linux: { target: "linux-x64", other: "linux-arm64 on arm64" },
  macos: { target: "darwin-arm64", other: "darwin-x64 on Intel" },
  windows: { target: "windows-x64", other: "windows-arm64 on arm64" },
};

/**
 * The same runner built from source, for a release that carries no runner
 * files (the installer's download then answers 404): the server's release
 * tag when it has one, otherwise the default branch, built with Bun, then
 * registered and kept running as the installer would.
 */
export function runnerFromSourceCommand(
  system: RunnerSystem,
  server: string,
  token: string,
  version: string | undefined,
): string {
  const pinned = version && releaseVersion.test(version) ? version : undefined;
  const { target, other } = sourceTarget[system];
  const clone = `git clone --depth 1 ${pinned ? `--branch v${pinned} ` : ""}https://github.com/chricarp/lictory.git`;
  if (system === "windows")
    return [
      `${clone}; cd lictory`,
      "bun install --frozen-lockfile",
      `bun run --cwd apps/runner build ${target}   # ${other}`,
      `.\\apps\\runner\\dist\\lictory-runner-${target}.exe register --url ${server} --token ${token}`,
      `.\\apps\\runner\\dist\\lictory-runner-${target}.exe install-service`,
    ].join("\n");
  return [
    `${clone} && cd lictory`,
    "bun install --frozen-lockfile",
    `bun run --cwd apps/runner build ${target}   # ${other}`,
    // BSD install (macOS) has no -D.
    `mkdir -p ~/.local/bin && cp apps/runner/dist/lictory-runner-${target} ~/.local/bin/lictory-runner`,
    `~/.local/bin/lictory-runner register --url ${server} --token ${token}`,
    "~/.local/bin/lictory-runner install-service --enable",
  ].join("\n");
}

// "in 60 minutes (at 14:32)": when a one-time token stops working.
export function expiresIn(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  const at = new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (minutes < 1) return `in less than a minute (at ${at})`;
  return `in ${minutes} minute${minutes === 1 ? "" : "s"} (at ${at})`;
}
