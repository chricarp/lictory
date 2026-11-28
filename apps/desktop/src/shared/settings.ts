// The app's own preferences. Nothing here is a credential: the shell stores
// none (see docs/internals/desktop.md).

export type Settings = {
  // Native notifications for activity that asks for the person's attention.
  notifications: boolean;
  notificationSound: boolean;
  launchAtLogin: boolean;
  // Windows and Linux: closing the window keeps Lictory in the tray.
  closeToTray: boolean;
  // Download and install updates (when this build can update itself).
  autoUpdate: boolean;
  runner: RunnerSettings;
};

export type RunnerSettings = {
  // The server the personal runner works for, if any.
  serverId: string | null;
  startWithApp: boolean;
};

export const defaultSettings: Settings = {
  notifications: true,
  notificationSound: true,
  launchAtLogin: false,
  closeToTray: true,
  autoUpdate: true,
  runner: { serverId: null, startWithApp: false },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const flag = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

export function normalizeSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return defaultSettings;
  const runner = isRecord(raw.runner) ? raw.runner : {};
  return {
    notifications: flag(raw.notifications, defaultSettings.notifications),
    notificationSound: flag(
      raw.notificationSound,
      defaultSettings.notificationSound,
    ),
    launchAtLogin: flag(raw.launchAtLogin, defaultSettings.launchAtLogin),
    closeToTray: flag(raw.closeToTray, defaultSettings.closeToTray),
    autoUpdate: flag(raw.autoUpdate, defaultSettings.autoUpdate),
    runner: {
      serverId:
        typeof runner.serverId === "string" && runner.serverId
          ? runner.serverId
          : null,
      startWithApp: flag(
        runner.startWithApp,
        defaultSettings.runner.startWithApp,
      ),
    },
  };
}

// Applies a change sent by the settings screen, keeping only known keys of
// the right type.
export function patchSettings(current: Settings, patch: unknown): Settings {
  if (!isRecord(patch)) return current;
  const runner = isRecord(patch.runner) ? patch.runner : {};
  return normalizeSettings({
    ...current,
    ...patch,
    runner: { ...current.runner, ...runner },
  });
}

// Linux has no login item API: a desktop entry in ~/.config/autostart starts
// the app at login.
export function autostartEntry(exec: string) {
  const quoted = /[\s"'\\$`]/.test(exec)
    ? `"${exec.replace(/(["\\$`])/g, "\\$1")}"`
    : exec;
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Lictory",
    "Comment=Lictory desktop app",
    `Exec=${quoted} --hidden`,
    "X-GNOME-Autostart-enabled=true",
    "Terminal=false",
    "",
  ].join("\n");
}
