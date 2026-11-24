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
  return [
    `curl -fsSL ${RUNNER_RELEASES}/lictory-runner-install.sh | sh -s -- \\`,
    `  ${pinned ? `--version ${pinned} ` : ""}--url ${server} --token ${token} --service`,
  ].join("\n");
}
