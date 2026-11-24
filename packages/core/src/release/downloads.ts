// The names under which every release publishes its client downloads, and
// the links that always serve the newest stable release. Pure data with no
// Node imports: the release checks (clients.ts) and lictory.com/download
// share it, so the website never links to a name a release does not carry.
//
// GitHub resolves `releases/latest/download/<name>` to the asset of that
// name in the newest stable release (nightlies are prereleases, never
// "latest"). Names without a version therefore keep working for every
// future release; they are a contract. See docs/operations/releases.md.

export const repositoryReleasesUrl =
  "https://github.com/chricarp/lictory/releases";

/** The newest stable release's page: its notes and every file. */
export const latestReleaseUrl = `${repositoryReleasesUrl}/latest`;

/** A file of the newest stable release, by its version-free name. */
export const latestDownloadUrl = (name: string) =>
  `${repositoryReleasesUrl}/latest/download/${name}`;

export const runnerTargets = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
] as const;
export type RunnerTarget = (typeof runnerTargets)[number];

export const runnerAsset = (target: RunnerTarget) =>
  `lictory-runner-${target}${target.startsWith("windows") ? ".exe" : ""}`;

/** apps/runner/install.sh and install.ps1 as release assets. */
export const runnerInstallers = {
  "lictory-runner-install.sh": "apps/runner/install.sh",
  "lictory-runner-install.ps1": "apps/runner/install.ps1",
} as const;

export const checksumsName = "SHA256SUMS";
/** The keyless cosign signature of SHA256SUMS (a Sigstore bundle). */
export const checksumsSignatureName = "SHA256SUMS.sigstore.json";

/**
 * Version-free copies of each release's desktop installers, beside the
 * versioned files that latest*.yml names for electron-updater. Each maps to
 * the versioned installer it is a byte-for-byte copy of.
 */
export const latestDesktopInstallers = {
  "Lictory-mac-universal.dmg": (version: string) =>
    `Lictory-${version}-mac-universal.dmg`,
  "Lictory-windows-setup.exe": (version: string) =>
    `Lictory-${version}-windows-setup.exe`,
  "Lictory-linux-x64.AppImage": (version: string) =>
    `Lictory-${version}-linux-x86_64.AppImage`,
  "Lictory-linux-arm64.AppImage": (version: string) =>
    `Lictory-${version}-linux-arm64.AppImage`,
  "lictory_amd64.deb": (version: string) => `lictory_${version}_amd64.deb`,
  "lictory_arm64.deb": (version: string) => `lictory_${version}_arm64.deb`,
} as const;
export type LatestDesktopInstaller = keyof typeof latestDesktopInstallers;
