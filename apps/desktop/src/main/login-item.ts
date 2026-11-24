import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { autostartEntry } from "../shared/settings";

// Launch at login. macOS and Windows have a login item API; on Linux a
// desktop entry in ~/.config/autostart does the same (for the AppImage, the
// path of the AppImage file, which is where it was installed). The app starts
// hidden in the tray when launched this way.

const HIDDEN = "--hidden";

function linuxExecutable() {
  return process.env.APPIMAGE ?? process.execPath;
}

function autostartFile() {
  const config =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(config, "autostart", "lictory.desktop");
}

export const launchAtLoginSupported =
  app.isPackaged && ["darwin", "win32", "linux"].includes(process.platform);

export function setLaunchAtLogin(enabled: boolean) {
  if (!launchAtLoginSupported) return;
  if (process.platform === "linux") {
    const file = autostartFile();
    if (enabled) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, autostartEntry(linuxExecutable()));
    } else rmSync(file, { force: true });
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Windows passes the arguments; macOS reports wasOpenedAtLogin instead.
    args: process.platform === "win32" ? [HIDDEN] : undefined,
  });
}

export function launchedHidden(argv: readonly string[]) {
  if (argv.includes(HIDDEN)) return true;
  if (process.platform !== "darwin") return false;
  return app.getLoginItemSettings().wasOpenedAtLogin === true;
}
