import {
  checksumsName,
  checksumsSignatureName,
  latestDownloadUrl,
  runnerAsset,
  type LatestDesktopInstaller,
  type RunnerTarget,
} from "@lictory/core/release/downloads";
import type {
  DesktopOs,
  DetectedSystem,
} from "@lictory/marketing/lib/download-platform";

// Everything lictory.com/download offers. Every link is the newest stable
// release's file under its version-free name (`releases/latest/download/`),
// and the page never asks GitHub anything from the visitor's browser.
//
// The deploy workflow passes the files that release actually carries
// (NEXT_PUBLIC_RELEASE_ASSETS, comma-separated; the site is rebuilt with
// every release). A file the release lacks gets no link, which would 404:
// the page says it is not in that release and how to build it from source.
// Without the list (local builds, the browser suite) every file is offered
// and the page links the release so a visitor can check what it carries.

/** Which contract files the release has; `null`: not known, offer all. */
export function releaseFiles(list: string | undefined) {
  const names = (list ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length ? new Set(names) : null;
}

const publishedFiles = releaseFiles(process.env.NEXT_PUBLIC_RELEASE_ASSETS);
/** Whether the build knows the release's files. */
export const releaseFilesKnown = publishedFiles !== null;
/** The version the site was built for, when the deploy named one. */
const builtVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
export const releaseVersion = builtVersion?.length ? builtVersion : null;

export const isPublished = (file: string, published = publishedFiles) =>
  !published || published.has(file);

/** "Lictory 0.26.0" or "the newest release", for "is not in …". */
export const releaseName = releaseVersion
  ? `Lictory ${releaseVersion}`
  : "the newest release";

export type DesktopDownload = {
  id: string;
  os: DesktopOs;
  /** The button: "Download for macOS". */
  system: string;
  /** The row in the list of every download. */
  label: string;
  detail: string;
  file: LatestDesktopInstaller;
  href: string;
  /** The release carries the file. */
  available: boolean;
};

const desktop = (
  download: Omit<DesktopDownload, "href" | "available">,
): DesktopDownload => ({
  ...download,
  href: latestDownloadUrl(download.file),
  available: isPublished(download.file),
});

export const desktopDownloads = [
  desktop({
    id: "macos",
    os: "macos",
    system: "macOS",
    label: "macOS disk image (.dmg)",
    detail:
      "One app for Apple silicon and Intel. Open it and drag Lictory to Applications.",
    file: "Lictory-mac-universal.dmg",
  }),
  desktop({
    id: "windows",
    os: "windows",
    system: "Windows",
    label: "Windows installer (.exe)",
    detail:
      "One installer for x64 and arm64. Installs for your account, without administrator rights.",
    file: "Lictory-windows-setup.exe",
  }),
  desktop({
    id: "linux-x64-appimage",
    os: "linux",
    system: "Linux",
    label: "Linux x64, AppImage",
    detail:
      "Make it executable and run it. Needs no installation and updates itself.",
    file: "Lictory-linux-x64.AppImage",
  }),
  desktop({
    id: "linux-arm64-appimage",
    os: "linux",
    system: "Linux (arm64)",
    label: "Linux arm64, AppImage",
    detail:
      "Make it executable and run it. Needs no installation and updates itself.",
    file: "Lictory-linux-arm64.AppImage",
  }),
  desktop({
    id: "linux-x64-deb",
    os: "linux",
    system: "Debian and Ubuntu",
    label: "Debian and Ubuntu x64, .deb",
    detail:
      "Install it with apt or your software center. It does not update itself: to update, install the newest .deb from this page.",
    file: "lictory_amd64.deb",
  }),
  desktop({
    id: "linux-arm64-deb",
    os: "linux",
    system: "Debian and Ubuntu (arm64)",
    label: "Debian and Ubuntu arm64, .deb",
    detail:
      "Install it with apt or your software center. It does not update itself: to update, install the newest .deb from this page.",
    file: "lictory_arm64.deb",
  }),
] as const satisfies readonly DesktopDownload[];

export const desktopSystems = [
  { os: "macos", name: "macOS" },
  { os: "windows", name: "Windows" },
  { os: "linux", name: "Linux" },
] as const satisfies readonly { os: DesktopOs; name: string }[];

const byId = (id: (typeof desktopDownloads)[number]["id"]) =>
  desktopDownloads.find((download) => download.id === id)!;

/**
 * The download to promote for a detected system, or none on a phone, a
 * tablet, a Chromebook or a browser that does not say. Linux without a known
 * architecture gets the x64 AppImage, the common case; the list offers arm64.
 */
export function primaryDownload(
  system: DetectedSystem,
): DesktopDownload | null {
  if (system.kind !== "computer") return null;
  if (system.os === "linux")
    return byId(
      system.arch === "arm64" ? "linux-arm64-appimage" : "linux-x64-appimage",
    );
  return byId(system.os);
}

/** The other systems' main download, offered under the promoted one. */
export function otherSystems(primary: DesktopDownload) {
  return desktopSystems
    .filter(({ os }) => os !== primary.os)
    .map(({ os, name }) => ({
      name,
      download: desktopDownloads.find((item) => item.os === os)!,
    }))
    .filter(({ download }) => download.available);
}

const installScript = latestDownloadUrl("lictory-runner-install.sh");
const installPowerShell = latestDownloadUrl("lictory-runner-install.ps1");

/** One command that installs the newest stable lictory-runner. */
export const runnerInstallCommands = [
  {
    id: "unix",
    label: "macOS and Linux",
    shell: "Terminal",
    // Downloaded, then run, so a failed download is an error instead of an
    // empty script that sh runs successfully.
    command: `curl -fsSLO ${installScript} && sh lictory-runner-install.sh`,
  },
  {
    id: "windows",
    label: "Windows",
    shell: "PowerShell",
    command: `irm ${installPowerShell} | iex`,
  },
] as const;

/** A file of the release: its name, link and whether the release has it. */
type ReleaseFile = {
  label: string;
  file: string;
  href: string;
  available: boolean;
};

const releaseFile = (label: string, file: string): ReleaseFile => ({
  label,
  file,
  href: latestDownloadUrl(file),
  available: isPublished(file),
});

const runnerTarget = (target: RunnerTarget, label: string) =>
  releaseFile(label, runnerAsset(target));

export const runnerBinaries = [
  runnerTarget("darwin-arm64", "macOS, Apple silicon"),
  runnerTarget("darwin-x64", "macOS, Intel"),
  runnerTarget("linux-x64", "Linux x64"),
  runnerTarget("linux-arm64", "Linux arm64"),
  runnerTarget("windows-x64", "Windows x64"),
  runnerTarget("windows-arm64", "Windows arm64"),
] as const;

export const runnerScripts = [
  releaseFile("Installer for macOS and Linux", "lictory-runner-install.sh"),
  releaseFile("Installer for Windows", "lictory-runner-install.ps1"),
] as const;

/** Whether the one-line installers work with the release. */
export const runnerInstallersAvailable = runnerScripts.every(
  (file) => file.available,
);

export const checksumFiles = [
  releaseFile("Checksums of every file", checksumsName),
  releaseFile("Signature of the checksums (Sigstore)", checksumsSignatureName),
] as const;

/** Building lictory-runner from source, for a release without its files. */
export const runnerFromSource = [
  "git clone https://github.com/chricarp/lictory.git && cd lictory",
  "bun install --frozen-lockfile",
  "bun run --cwd apps/runner build linux-x64   # or darwin-arm64, windows-x64…",
].join("\n");
