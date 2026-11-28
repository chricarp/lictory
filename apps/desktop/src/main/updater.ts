import { readFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AppUpdater } from "electron-updater";
import type { UpdateState } from "../shared/ipc";
import {
  updateErrorMessage,
  updateSupport as decideSupport,
} from "../shared/updates";

// Updates come from the GitHub releases of chricarp/lictory through
// electron-updater (the `publish` setting of package.mjs writes
// app-update.yml into the package). A build updates itself only when it can
// do so safely: packaged, signed (Squirrel.Mac refuses unsigned apps and an
// unsigned Windows installer cannot be verified), installed in a form that
// can be replaced (the AppImage; a .deb belongs to the package manager and
// no apt repository serves Lictory), and not turned off by
// LICTORY_DESKTOP_UPDATES=off. Otherwise the settings screen says why and
// what to do instead, with a link to the download page.

const CHECK_EVERY_MS = 6 * 60 * 60_000;
const FIRST_CHECK_MS = 30_000;

type BuildInfo = { updatable?: boolean };

function buildInfo(): BuildInfo {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"),
    ) as { lictory?: BuildInfo };
    return manifest.lictory ?? {};
  } catch {
    return {};
  }
}

function updateSupport() {
  return decideSupport({
    packaged: app.isPackaged,
    platform: process.platform,
    turnedOff: process.env.LICTORY_DESKTOP_UPDATES === "off",
    appStore: !!(process.mas || process.windowsStore),
    appImage: !!process.env.APPIMAGE,
    signed: buildInfo().updatable === true,
  });
}

export function createUpdater(options: {
  autoDownload: () => boolean;
  onChange: () => void;
}) {
  const support = updateSupport();
  let state: UpdateState = support.supported
    ? { status: "idle" }
    : { status: "unsupported", reason: support.reason };
  const set = (next: UpdateState) => {
    state = next;
    options.onChange();
  };
  let updater: AppUpdater | null = null;

  async function load() {
    if (!support.supported) return null;
    if (updater) return updater;
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.autoDownload = options.autoDownload();
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
    autoUpdater.on("update-not-available", () => set({ status: "current" }));
    autoUpdater.on("update-available", (info) =>
      set(
        autoUpdater.autoDownload
          ? { status: "downloading", percent: 0 }
          : { status: "ready", version: info.version },
      ),
    );
    autoUpdater.on("download-progress", (progress) =>
      set({ status: "downloading", percent: Math.round(progress.percent) }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      set({ status: "ready", version: info.version }),
    );
    autoUpdater.on("error", (error) =>
      set({ status: "error", message: updateErrorMessage(error) }),
    );
    updater = autoUpdater;
    return autoUpdater;
  }

  async function check() {
    const instance = await load();
    if (!instance) return;
    instance.autoDownload = options.autoDownload();
    await instance.checkForUpdates().catch(() => undefined);
  }

  let timer: NodeJS.Timeout | null = null;
  return {
    state: () => state,
    start() {
      if (!support.supported || timer) return;
      timer = setTimeout(function again() {
        if (options.autoDownload()) void check();
        timer = setTimeout(again, CHECK_EVERY_MS);
      }, FIRST_CHECK_MS);
    },
    check: () => void check(),
    async install() {
      const instance = await load();
      if (state.status !== "ready" || !instance) return;
      if (!instance.autoDownload) {
        // Downloaded on request when automatic updates are off.
        set({ status: "downloading", percent: 0 });
        await instance.downloadUpdate().catch(() => undefined);
        if (state.status !== "ready") return;
      }
      instance.quitAndInstall();
    },
  };
}
