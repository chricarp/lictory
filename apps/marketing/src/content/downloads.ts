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
// so the page never needs a redeploy for a release and never asks GitHub
// anything from the visitor's browser.

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
};

const desktop = (download: Omit<DesktopDownload, "href">): DesktopDownload => ({
  ...download,
  href: latestDownloadUrl(download.file),
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
    detail: "Installs with your package manager, which also updates it.",
    file: "lictory_amd64.deb",
  }),
  desktop({
    id: "linux-arm64-deb",
    os: "linux",
    system: "Debian and Ubuntu (arm64)",
    label: "Debian and Ubuntu arm64, .deb",
    detail: "Installs with your package manager, which also updates it.",
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
    }));
}

const installScript = latestDownloadUrl("lictory-runner-install.sh");
const installPowerShell = latestDownloadUrl("lictory-runner-install.ps1");

/** One command that installs the newest stable lictory-runner. */
export const runnerInstallCommands = [
  {
    id: "unix",
    label: "macOS and Linux",
    shell: "Terminal",
    command: `curl -fsSL ${installScript} | sh`,
  },
  {
    id: "windows",
    label: "Windows",
    shell: "PowerShell",
    command: `irm ${installPowerShell} | iex`,
  },
] as const;

const runnerTarget = (target: RunnerTarget, label: string) => ({
  label,
  file: runnerAsset(target),
  href: latestDownloadUrl(runnerAsset(target)),
});

export const runnerBinaries = [
  runnerTarget("darwin-arm64", "macOS, Apple silicon"),
  runnerTarget("darwin-x64", "macOS, Intel"),
  runnerTarget("linux-x64", "Linux x64"),
  runnerTarget("linux-arm64", "Linux arm64"),
  runnerTarget("windows-x64", "Windows x64"),
  runnerTarget("windows-arm64", "Windows arm64"),
] as const;

export const runnerScripts = [
  {
    label: "Installer for macOS and Linux",
    file: "lictory-runner-install.sh",
    href: installScript,
  },
  {
    label: "Installer for Windows",
    file: "lictory-runner-install.ps1",
    href: installPowerShell,
  },
] as const;

export const checksumFiles = [
  {
    label: "Checksums of every file",
    file: checksumsName,
    href: latestDownloadUrl(checksumsName),
  },
  {
    label: "Signature of the checksums (Sigstore)",
    file: checksumsSignatureName,
    href: latestDownloadUrl(checksumsSignatureName),
  },
] as const;
