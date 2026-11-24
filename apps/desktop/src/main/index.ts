import path from "node:path";
import { app } from "electron";
import { registerAppScheme, serveShell } from "./app-protocol";
import {
  launchAtLoginSupported,
  launchedHidden,
  setLaunchAtLogin,
} from "./login-item";
import { installMenu } from "./menu";
import { createPersonalRunner } from "./runner";
import { Shell } from "./shell";
import { createJsonStore } from "./store";
import { createTray } from "./tray";
import { createUpdater } from "./updater";
import { DEEP_LINK_SCHEME, deepLinkFromArgv } from "../shared/deep-link";
import { normalizeServers } from "../shared/servers";
import { normalizeSettings } from "../shared/settings";
import { normalizeWindowState } from "../shared/window-state";

// The desktop app's main process: one window per installation, servers
// added by the person, everything else delegated to the modules next door.
// Security model: docs/internals/desktop.md.

const isDev = !app.isPackaged;
const dist = __dirname;

// Development and the smoke test keep their data apart from a real
// installation.
if (isDev && process.env.LICTORY_DESKTOP_USER_DATA)
  app.setPath("userData", process.env.LICTORY_DESKTOP_USER_DATA);

app.setName("Lictory");
// Every renderer runs in the Chromium sandbox, whatever a view asks for.
app.enableSandbox();
registerAppScheme();
if (process.platform === "win32") app.setAppUserModelId("com.lictory.desktop");

function registerDeepLinks() {
  // Development builds leave the system's handler alone unless asked: it
  // would point lictory:// links at a bare Electron binary.
  if (isDev && process.env.LICTORY_DESKTOP_REGISTER_PROTOCOL !== "1") return;
  if (isDev && process.platform === "win32" && process.argv[1])
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  else app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  registerDeepLinks();

  let shell: Shell | null = null;
  const early: string[] = [];
  const openLink = (url: string) => {
    if (shell) void shell.openDeepLink(url);
    else early.push(url);
  };
  // macOS delivers links as events, also before the app is ready.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    openLink(url);
  });
  // Windows and Linux start a second instance with the link as an argument.
  app.on("second-instance", (_event, argv) => {
    shell?.show();
    const link = deepLinkFromArgv(argv);
    if (link) openLink(link);
  });
  const first = deepLinkFromArgv(process.argv);
  if (first) early.push(first);

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  void app.whenReady().then(() => {
    serveShell(path.join(dist, "shell"));
    const userData = app.getPath("userData");
    const version = app.getVersion();
    app.setAboutPanelOptions({
      applicationName: "Lictory",
      applicationVersion: version,
      copyright: "MIT License",
      website: "https://lictory.com",
    });
    const current = new Shell({
      isDev,
      version,
      preloads: {
        web: path.join(dist, "preload-web.cjs"),
        shell: path.join(dist, "preload-shell.cjs"),
      },
      icon: path.join(dist, "assets", "icon.png"),
      stores: {
        servers: createJsonStore(userData, "servers", normalizeServers),
        settings: createJsonStore(userData, "settings", normalizeSettings),
        window: createJsonStore(userData, "window", normalizeWindowState),
      },
      startHidden: launchedHidden(process.argv),
    });
    shell = current;

    const runner = createPersonalRunner({
      servers: () => current.servers,
      serverId: () => current.settings.runner.serverId,
      setServerId: (serverId) =>
        current.updateSettings({ runner: { serverId } }),
      onChange: () => current.changed(),
    });
    const updater = createUpdater({
      autoDownload: () => current.settings.autoUpdate,
      onChange: () => current.changed(),
    });
    let tray: ReturnType<typeof createTray> | null = null;
    current.hooks = {
      menu: () => installMenu(current, { isDev }),
      tray: (total) => tray?.update(total),
      launchAtLogin: setLaunchAtLogin,
      launchAtLoginSupported,
      trayAvailable: () => tray?.available() ?? false,
      update: updater.state,
      checkForUpdates: () => updater.check(),
      installUpdate: () => void updater.install(),
      runner: () => runner.state(),
      serversChanged: (state) => runner.serversChanged(state),
    };
    tray = createTray(
      current,
      {
        mac: path.join(dist, "assets", "trayTemplate.png"),
        other: path.join(dist, "assets", "tray.png"),
      },
      { launchAtLoginSupported },
    );
    current.registerIpc({
      runner: (command) => runner.command(command),
      runnerLogs: () => runner.logs(),
    });
    current.createWindow();
    for (const link of early.splice(0)) void current.openDeepLink(link);
    updater.start();
    void runner.startWithApp(current.settings.runner.startWithApp);

    app.on("activate", () => current.show());

    // Quitting stops the runner first, so its sessions end cleanly.
    let stopped = false;
    app.on("before-quit", (event) => {
      current.quit();
      if (stopped) return;
      event.preventDefault();
      stopped = true;
      const timeout = new Promise((resolve) => setTimeout(resolve, 12_000));
      void Promise.race([runner.stop(), timeout]).finally(() => app.quit());
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

main();
