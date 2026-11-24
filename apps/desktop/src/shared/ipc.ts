import type { RunnerSnapshot, LogLine } from "./runner";
import type { Settings } from "./settings";

// Messages between the main process and its two kinds of pages: a server's
// page (through the desktop bridge, preload/web.ts) and the app's own shell
// page (the server switcher and local screens, preload/shell.ts). The main
// process checks every sender before acting on a message.

export const WEB = {
  notify: "lictory:notify",
  setBadge: "lictory:set-badge",
  navigate: "lictory:navigate",
} as const;

export const SHELL = {
  state: "shell:state",
  changed: "shell:changed",
  addServer: "shell:add-server",
  selectServer: "shell:select-server",
  serverMenu: "shell:server-menu",
  showScreen: "shell:show-screen",
  retry: "shell:retry",
  removeServer: "shell:remove-server",
  back: "shell:back",
  forward: "shell:forward",
  updateSettings: "shell:update-settings",
  installUpdate: "shell:install-update",
  checkForUpdates: "shell:check-for-updates",
  runner: "shell:runner",
  runnerLogs: "shell:runner-logs",
} as const;

// A screen of the shell page shown instead of a server's view.
export type Screen =
  | { kind: "server" }
  | { kind: "welcome" }
  | { kind: "add-server" }
  | { kind: "settings" }
  | { kind: "error"; serverId: string; message: string };

export type ShellServer = {
  id: string;
  name: string;
  origin: string;
  host: string;
  initials: string;
  hue: number;
  unread: number;
  loading: boolean;
  shortcut: string | null;
};

export type UpdateState =
  | { status: "unsupported"; reason: string }
  | { status: "idle" | "checking" | "current" }
  | { status: "downloading"; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

export type RunnerState = {
  // The feature flag is on (LICTORY_DESKTOP_RUNNER=1).
  enabled: boolean;
  // Where the binary was looked for, and whether it is there.
  binary: string | null;
  available: boolean;
  snapshot: RunnerSnapshot;
};

export type ShellState = {
  platform: NodeJS.Platform;
  version: string;
  servers: ShellServer[];
  activeId: string | null;
  screen: Screen;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  settings: Settings;
  // Windows and Linux: whether a tray is available for closeToTray.
  trayAvailable: boolean;
  launchAtLoginSupported: boolean;
  update: UpdateState;
  runner: RunnerState;
};

export type AddServerResult =
  { ok: true; serverId: string } | { ok: false; error: string };

export type RunnerCommand =
  | { action: "start" }
  | { action: "stop" }
  | { action: "register"; serverId: string; token: string };

export type RunnerCommandResult = { ok: true } | { ok: false; error: string };

export type ShellApi = {
  state(): Promise<ShellState>;
  onChange(listener: (state: ShellState) => void): () => void;
  addServer(address: string): Promise<AddServerResult>;
  selectServer(id: string): void;
  serverMenu(id: string): void;
  showScreen(screen: "add-server" | "settings" | "server"): void;
  retry(id: string): void;
  removeServer(id: string): void;
  back(): void;
  forward(): void;
  updateSettings(patch: unknown): Promise<ShellState>;
  checkForUpdates(): void;
  installUpdate(): void;
  runner(command: RunnerCommand): Promise<RunnerCommandResult>;
  runnerLogs(): Promise<readonly LogLine[]>;
};

declare global {
  interface Window {
    lictoryShell?: ShellApi;
  }
}
