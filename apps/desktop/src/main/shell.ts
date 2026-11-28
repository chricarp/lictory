import { randomUUID } from "node:crypto";
import {
  app,
  BaseWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  screen,
  session as electronSession,
  shell as electronShell,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { SHELL_URL } from "./app-protocol";
import { createServerView, type ServerView } from "./server-view";
import type { createJsonStore } from "./store";
import {
  badgeLabel,
  renderBadge,
  sanitizeCount,
  totalCount,
  unreadSummary,
} from "../shared/badge";
import {
  originForHost,
  parseDeepLink,
  serverForLink,
} from "../shared/deep-link";
import {
  SHELL,
  WEB,
  type AddServerResult,
  type RunnerState,
  type Screen,
  type ShellServer,
  type ShellState,
  type UpdateState,
} from "../shared/ipc";
import {
  createRateLimiter,
  sanitizeNotification,
  shouldShowNotification,
} from "../shared/notifications";
import type { NetworkProblem } from "../shared/net-errors";
import { mediaPrompt, type MediaKind } from "../shared/permissions";
import { parseServerAddress, probeServer } from "../shared/server-address";
import {
  addServer,
  initials,
  moveServer,
  nameFromOrganization,
  removeServer,
  selectServer,
  serverForShortcut,
  updateServer,
  type Server,
  type ServersState,
} from "../shared/servers";
import { stoppedSnapshot } from "../shared/runner";
import { patchSettings, type Settings } from "../shared/settings";
import {
  inAppPathOf,
  isInAppPath,
  isSafeExternalUrl,
  originOf,
} from "../shared/urls";
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  restoreBounds,
  type WindowState,
} from "../shared/window-state";

// The one window: the shell page (server switcher, top bar and local
// screens) as its base layer, and each server's page in its own view over
// the content area. Owns the servers list, badges and notifications.

type Store<T> = ReturnType<typeof createJsonStore<T>>;

export const RAIL_WIDTH = 68;
export const TOP_BAR = 40;

export type ShellOptions = {
  isDev: boolean;
  version: string;
  preloads: { web: string; shell: string };
  icon: string;
  stores: {
    servers: Store<ServersState>;
    settings: Store<Settings>;
    window: Store<WindowState | null>;
  };
  startHidden: boolean;
};

// Integrations around the window: they read the state and are told when it
// changes.
export type ShellHooks = {
  menu(): void;
  tray(total: number): void;
  launchAtLogin(enabled: boolean): void;
  launchAtLoginSupported: boolean;
  trayAvailable(): boolean;
  update(): UpdateState;
  checkForUpdates(): void;
  installUpdate(): void;
  runner(): RunnerState;
  serversChanged(state: ServersState): void;
};

const hueOf = (text: string) =>
  [...text].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;

// A page without a title of its own (loading, Chromium's error page) is
// titled with its address by Chromium: the server's name reads better.
function pageTitle(contents: WebContents, server: Server) {
  const title = contents.getTitle().trim();
  const address =
    !title ||
    contents.getURL().includes(title) ||
    title.startsWith(new URL(server.origin).host);
  return address ? server.name : title;
}

export class Shell {
  window: BaseWindow | null = null;
  private chrome: WebContentsView | null = null;
  private views = new Map<string, ServerView>();
  private unread = new Map<string, number>();
  private loading = new Set<string>();
  private errors = new Map<string, NetworkProblem>();
  // Servers whose page reports no network (navigator.onLine is false).
  private offline = new Set<string>();
  private retries = new Map<
    string,
    { attempt: number; timer: NodeJS.Timeout | null }
  >();
  private overlay: "add-server" | "settings" | null = null;
  private notifications = new Map<string, Notification>();
  private allowNotification = createRateLimiter();
  private pendingLinks: string[] = [];
  private quitting = false;
  servers: ServersState;
  settings: Settings;
  hooks: ShellHooks | null = null;

  constructor(private readonly options: ShellOptions) {
    this.servers = options.stores.servers.read();
    this.settings = options.stores.settings.read();
    powerMonitor.on("resume", () => this.retryFailed());
    powerMonitor.on("unlock-screen", () => this.retryFailed());
    nativeTheme.on("updated", () => {
      const win = this.window;
      if (process.platform === "win32" && win && !win.isDestroyed())
        win.setTitleBarOverlay(this.titleBarOverlay());
    });
  }

  // ------------------------------------------------------------ window

  createWindow() {
    const saved = restoreBounds(
      this.options.stores.window.read(),
      screen.getAllDisplays().map((d) => d.workArea),
    );
    const dark = nativeTheme.shouldUseDarkColors;
    const win = new BaseWindow({
      x: saved.x,
      y: saved.y,
      width: saved.width,
      height: saved.height,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      title: "Lictory",
      icon: process.platform === "darwin" ? undefined : this.options.icon,
      backgroundColor: dark ? "#0c0d0f" : "#f2f3f5",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 14, y: 13 },
          }
        : process.platform === "win32"
          ? {
              titleBarStyle: "hidden" as const,
              titleBarOverlay: this.titleBarOverlay(),
            }
          : { autoHideMenuBar: false }),
    });
    this.window = win;
    const chrome = new WebContentsView({
      webPreferences: {
        preload: this.options.preloads.shell,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        devTools: this.options.isDev,
      },
    });
    chrome.setBackgroundColor(dark ? "#0c0d0f" : "#f2f3f5");
    this.chrome = chrome;
    win.contentView.addChildView(chrome);
    chrome.webContents.on("will-navigate", (event) => event.preventDefault());
    // Links on the app's own screens (the releases page) open in the browser.
    chrome.webContents.setWindowOpenHandler(({ url }) => {
      this.openExternal(url);
      return { action: "deny" };
    });
    void chrome.webContents.loadURL(SHELL_URL);

    for (const server of this.servers.servers) this.ensureView(server);
    this.layout();

    win.on("resize", () => {
      this.layout();
      this.saveWindow();
    });
    win.on("move", () => this.saveWindow());
    for (const event of [
      "maximize",
      "unmaximize",
      "enter-full-screen",
      "leave-full-screen",
    ] as const)
      win.on(event as "maximize", () => this.saveWindow());
    win.on("focus", () => this.focusContent());
    win.on("close", (event) => {
      this.options.stores.window.flush();
      if (this.quitting) return;
      const keep =
        process.platform === "darwin" ||
        (this.settings.closeToTray && (this.hooks?.trayAvailable() ?? false));
      if (keep) {
        event.preventDefault();
        if (win.isFullScreen()) {
          win.once("leave-full-screen", () => win.hide());
          win.setFullScreen(false);
        } else win.hide();
      }
    });
    win.on("closed", () => {
      this.window = null;
      this.chrome = null;
      for (const view of this.views.values()) view.destroy();
      this.views.clear();
    });
    chrome.webContents.once("did-finish-load", () => {
      if (saved.maximized) win.maximize();
      if (!this.options.startHidden) win.show();
      this.focusContent();
      for (const link of this.pendingLinks.splice(0))
        void this.openDeepLink(link);
    });
    this.hooks?.menu();
    this.updateBadge();
  }

  private titleBarOverlay() {
    const dark = nativeTheme.shouldUseDarkColors;
    return {
      color: dark ? "#0c0d0f" : "#f2f3f5",
      symbolColor: dark ? "#e8e8ea" : "#27272a",
      height: TOP_BAR,
    };
  }

  private saveWindow() {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    this.options.stores.window.writeSoon({
      ...bounds,
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
    });
  }

  // Keyboard focus goes to what is shown: the server's page or the shell's
  // own screen.
  private focusContent() {
    if (this.screen().kind === "server") this.activeView()?.contents.focus();
    else this.chrome?.webContents.focus();
  }

  show() {
    const win = this.window;
    if (!win) {
      this.createWindow();
      this.window?.show();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  // Quitting: the window may close, and coalesced writes are written now.
  quit() {
    this.quitting = true;
    this.options.stores.servers.flush();
    this.options.stores.window.flush();
  }

  private layout() {
    const win = this.window;
    if (!win || !this.chrome) return;
    const { width, height } = win.getContentBounds();
    this.chrome.setBounds({ x: 0, y: 0, width, height });
    const screen = this.screen();
    for (const [id, entry] of this.views) {
      const visible = screen.kind === "server" && id === this.servers.activeId;
      entry.view.setBounds({
        x: RAIL_WIDTH,
        y: TOP_BAR,
        width: Math.max(0, width - RAIL_WIDTH),
        height: Math.max(0, height - TOP_BAR),
      });
      entry.view.setVisible(visible);
    }
  }

  // ------------------------------------------------------------ state

  screen(): Screen {
    const active = this.servers.activeId;
    if (!this.servers.servers.length) return { kind: "welcome" };
    if (this.overlay) return { kind: this.overlay };
    const error = active ? this.errors.get(active) : undefined;
    if (active && error)
      return {
        kind: "error",
        serverId: active,
        message: error.summary,
        next: error.next,
        detail: error.code,
      };
    return { kind: "server" };
  }

  activeView() {
    const id = this.servers.activeId;
    return id ? this.views.get(id) : undefined;
  }

  state(): ShellState {
    const active = this.activeView();
    const history = active?.contents.navigationHistory;
    return {
      platform: process.platform,
      version: this.options.version,
      servers: this.servers.servers.map((s, i): ShellServer => ({
        id: s.id,
        name: s.name,
        origin: s.origin,
        host: new URL(s.origin).host,
        initials: initials(s.name),
        hue: hueOf(s.origin),
        unread: this.unread.get(s.id) ?? 0,
        loading: this.loading.has(s.id),
        offline: this.offline.has(s.id),
        shortcut: i < 9 ? String(i + 1) : null,
      })),
      activeId: this.servers.activeId,
      screen: this.screen(),
      title: active ? pageTitle(active.contents, active.server) : "Lictory",
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
      settings: this.settings,
      notificationsSupported: Notification.isSupported(),
      trayAvailable: this.hooks?.trayAvailable() ?? false,
      launchAtLoginSupported: this.hooks?.launchAtLoginSupported ?? false,
      update: this.hooks?.update() ?? { status: "idle" },
      runner: this.hooks?.runner() ?? {
        enabled: false,
        binary: null,
        available: false,
        snapshot: stoppedSnapshot,
      },
    };
  }

  private changedTimer: NodeJS.Timeout | null = null;
  // Coalesced: loading and title events come in bursts.
  changed() {
    if (this.changedTimer) return;
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null;
      const chrome = this.chrome?.webContents;
      if (chrome && !chrome.isDestroyed())
        chrome.send(SHELL.changed, this.state());
    }, 16);
  }

  private setServers(
    next: ServersState,
    options: { save?: "now" | "soon" } = {},
  ) {
    // The menu lists the servers and marks the active one.
    const listChanged =
      next.activeId !== this.servers.activeId ||
      next.servers.length !== this.servers.servers.length ||
      next.servers.some(
        (s, i) =>
          s.id !== this.servers.servers[i]?.id ||
          s.name !== this.servers.servers[i]?.name,
      );
    this.servers = next;
    if (options.save === "soon") this.options.stores.servers.writeSoon(next);
    else this.options.stores.servers.write(next);
    if (listChanged) {
      this.hooks?.menu();
      this.hooks?.serversChanged(next);
    }
    this.layout();
    this.changed();
  }

  // ------------------------------------------------------------ servers

  private ensureView(server: Server) {
    const existing = this.views.get(server.id);
    if (existing) return existing;
    const entry = createServerView(server, {
      isDev: this.options.isDev,
      preload: this.options.preloads.web,
      version: this.options.version,
      servers: () => this.servers.servers,
      switchTo: (serverId, url) => {
        const target = this.servers.servers.find((s) => s.id === serverId);
        const path = target ? url.slice(target.origin.length) || "/" : "/";
        this.navigate(serverId, isInAppPath(path) ? path : "/");
      },
      openExternal: (url) => this.openExternal(url),
      confirmMedia: (s, kinds) => this.confirmMedia(s, kinds),
      loadFailed: (id, problem) => {
        // The error screen says it; the page that reported it is gone.
        this.offline.delete(id);
        this.errors.set(id, problem);
        this.scheduleRetry(id);
        this.layout();
        this.changed();
      },
      loaded: (id) => {
        this.clearRetry(id);
        if (this.errors.delete(id)) this.layout();
        this.changed();
      },
      navigated: (id, path) => {
        if (path)
          this.setServers(updateServer(this.servers, id, { lastPath: path }), {
            save: "soon",
          });
        this.changed();
      },
      titleChanged: () => this.changed(),
      loadingChanged: (id) => {
        const contents = this.views.get(id)?.contents;
        if (contents?.isLoading()) this.loading.add(id);
        else this.loading.delete(id);
        this.changed();
      },
    });
    this.views.set(server.id, entry);
    this.window?.contentView.addChildView(entry.view);
    entry.view.setVisible(false);
    entry.load(server.lastPath);
    return entry;
  }

  async addServer(address: string): Promise<AddServerResult> {
    const parsed = parseServerAddress(address);
    if (!parsed.ok) return parsed;
    const probe = await this.probe(parsed.origin);
    if (!probe.ok) return probe;
    let result;
    try {
      result = addServer(this.servers, {
        id: randomUUID(),
        origin: probe.origin,
        now: new Date(),
      });
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    this.overlay = null;
    this.setServers(result.state);
    this.ensureView(result.server);
    this.layout();
    this.activeView()?.contents.focus();
    return { ok: true, serverId: result.server.id };
  }

  // The probe runs in an empty in-memory session: no server's cookies are
  // ever sent to an address being checked.
  private probe(origin: string) {
    const ses = electronSession.fromPartition("lictory-probe", {
      cache: false,
    });
    return probeServer(origin, (url, init) =>
      ses.fetch(url, {
        signal: init.signal,
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
  }

  select(id: string) {
    if (!this.servers.servers.some((s) => s.id === id)) return;
    this.overlay = null;
    this.setServers(selectServer(this.servers, id), { save: "soon" });
    this.focusContent();
  }

  selectShortcut(digit: number) {
    const server = serverForShortcut(this.servers, digit);
    if (server) this.select(server.id);
  }

  move(id: string, offset: number) {
    this.setServers(moveServer(this.servers, id, offset));
  }

  showScreen(screen: "add-server" | "settings" | "server") {
    this.overlay = screen === "server" ? null : screen;
    this.show();
    this.layout();
    this.changed();
    this.focusContent();
  }

  // A server that cannot be loaded keeps its error screen while it is tried
  // again: after 5 seconds, then less and less often up to every minute, at
  // once when the computer wakes up, or when the person asks.
  retry(id: string) {
    const entry = this.views.get(id);
    if (!entry) return;
    const pending = this.retries.get(id);
    if (pending?.timer) clearTimeout(pending.timer);
    if (pending) pending.timer = null;
    const url = entry.contents.getURL();
    if (originOf(url) === entry.server.origin) entry.contents.reload();
    else entry.load(entry.server.lastPath);
  }

  private scheduleRetry(id: string) {
    const previous = this.retries.get(id);
    if (previous?.timer) clearTimeout(previous.timer);
    const attempt = (previous?.attempt ?? 0) + 1;
    const delay = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
    this.retries.set(id, {
      attempt,
      timer: setTimeout(() => this.retry(id), delay),
    });
  }

  private clearRetry(id: string) {
    const pending = this.retries.get(id);
    if (pending?.timer) clearTimeout(pending.timer);
    this.retries.delete(id);
  }

  retryFailed() {
    for (const id of this.errors.keys()) this.retry(id);
  }

  async removeServer(id: string) {
    const server = this.servers.servers.find((s) => s.id === id);
    if (!server || !this.window) return;
    const { response } = await dialog.showMessageBox(this.window, {
      type: "warning",
      buttons: ["Remove", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `Remove ${server.name}?`,
      detail: "Signs you out of this server and removes its data from the app.",
    });
    if (response !== 0) return;
    const entry = this.views.get(id);
    if (entry) {
      this.window.contentView.removeChildView(entry.view);
      const ses = entry.contents.session;
      entry.destroy();
      this.views.delete(id);
      await ses.clearStorageData().catch(() => undefined);
      await ses.clearCache().catch(() => undefined);
    }
    this.unread.delete(id);
    this.errors.delete(id);
    this.offline.delete(id);
    this.clearRetry(id);
    this.setServers(removeServer(this.servers, id));
    this.updateBadge();
  }

  rename(id: string, name: string) {
    this.setServers(updateServer(this.servers, id, { name }));
  }

  // Opens an in-app path on a server: through the page's router when it
  // listens (the preload falls back to a full load otherwise).
  navigate(serverId: string, path: string) {
    const entry = this.views.get(serverId);
    if (!entry || !isInAppPath(path)) return;
    this.select(serverId);
    this.show();
    const current = originOf(entry.contents.getURL());
    if (current === entry.server.origin && !entry.contents.isLoading())
      entry.contents.send(WEB.navigate, path);
    else entry.load(path);
  }

  openExternal(url: string) {
    if (isSafeExternalUrl(url)) void electronShell.openExternal(url);
  }

  private async confirmMedia(server: Server, kinds: MediaKind[]) {
    if (!this.window) return false;
    const { response } = await dialog.showMessageBox(this.window, {
      type: "question",
      buttons: ["Allow", "Don't allow"],
      defaultId: 0,
      cancelId: 1,
      message: mediaPrompt(new URL(server.origin).host, kinds),
      detail: "Asked again the next time the app starts.",
    });
    return response === 0;
  }

  // ------------------------------------------------------------ view actions

  reload(force = false) {
    const entry = this.activeView();
    if (!entry) return;
    if (this.errors.has(entry.server.id)) this.retry(entry.server.id);
    else if (force) entry.contents.reloadIgnoringCache();
    else entry.contents.reload();
  }

  zoom(direction: 1 | -1 | 0) {
    const entry = this.activeView();
    if (!entry) return;
    const level =
      direction === 0 ? 0 : entry.contents.getZoomLevel() + direction * 0.5;
    const next = Math.max(-3, Math.min(5, level));
    entry.contents.setZoomLevel(next);
    this.setServers(
      updateServer(this.servers, entry.server.id, { zoomLevel: next }),
      { save: "soon" },
    );
  }

  back() {
    const history = this.activeView()?.contents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  }

  forward() {
    const history = this.activeView()?.contents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  }

  // ⌘K / Ctrl+K belongs to the page (its command palette): the menu item
  // does not capture the key and, when chosen with the mouse, types it.
  openPalette() {
    const contents = this.activeView()?.contents;
    if (!contents || this.screen().kind !== "server") return;
    contents.focus();
    const modifiers: ("meta" | "control")[] = [
      process.platform === "darwin" ? "meta" : "control",
    ];
    contents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers });
    contents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers });
  }

  toggleDevTools() {
    if (!this.options.isDev) return;
    const contents =
      this.screen().kind === "server"
        ? this.activeView()?.contents
        : this.chrome?.webContents;
    contents?.toggleDevTools();
  }

  // ------------------------------------------------------------ settings

  updateSettings(patch: unknown) {
    const before = this.settings;
    this.settings = patchSettings(this.settings, patch);
    this.options.stores.settings.write(this.settings);
    if (before.launchAtLogin !== this.settings.launchAtLogin)
      this.hooks?.launchAtLogin(this.settings.launchAtLogin);
    this.changed();
    return this.state();
  }

  // ------------------------------------------------------------ badge

  setUnread(serverId: string, value: unknown) {
    const count = sanitizeCount(value);
    if ((this.unread.get(serverId) ?? 0) === count) return;
    this.unread.set(serverId, count);
    this.updateBadge();
    this.changed();
  }

  private setOffline(serverId: string, offline: boolean) {
    if (this.offline.has(serverId) === offline) return;
    if (offline) this.offline.add(serverId);
    else this.offline.delete(serverId);
    this.changed();
  }

  totalUnread() {
    return totalCount(this.unread);
  }

  unreadFor(serverId: string) {
    return this.unread.get(serverId) ?? 0;
  }

  private updateBadge() {
    const total = this.totalUnread();
    if (process.platform === "darwin") app.dock?.setBadge(badgeLabel(total));
    else if (process.platform === "win32") {
      const win = this.window;
      if (win && !win.isDestroyed())
        win.setOverlayIcon(
          total
            ? nativeImage.createFromBitmap(
                Buffer.from(renderBadge(total, 32)),
                {
                  width: 32,
                  height: 32,
                  scaleFactor: 2,
                },
              )
            : null,
          unreadSummary(total),
        );
    } else app.setBadgeCount(Math.min(total, 99));
    this.hooks?.tray(total);
  }

  // ------------------------------------------------------------ notifications

  notify(serverId: string, input: unknown) {
    const notification = sanitizeNotification(input);
    if (!notification || !Notification.isSupported()) return;
    const win = this.window;
    const active = this.activeView();
    if (
      !shouldShowNotification({
        enabled: this.settings.notifications,
        windowFocused:
          !!win &&
          win.isVisible() &&
          win.isFocused() &&
          this.screen().kind === "server",
        activeServerId: this.servers.activeId,
        serverId,
        activePath: active
          ? inAppPathOf(active.contents.getURL(), active.server.origin)
          : null,
        path: notification.path,
      })
    )
      return;
    if (!this.allowNotification(serverId, Date.now())) return;
    const server = this.servers.servers.find((s) => s.id === serverId);
    const key = `${serverId}:${notification.tag ?? randomUUID()}`;
    this.notifications.get(key)?.close();
    const native = new Notification({
      title: notification.title,
      body: notification.body,
      silent: !this.settings.notificationSound,
      // Several servers: name the one it came from.
      subtitle:
        this.servers.servers.length > 1 && server ? server.name : undefined,
      icon: process.platform === "darwin" ? undefined : this.options.icon,
    });
    native.on("click", () => {
      this.notifications.delete(key);
      this.navigate(serverId, notification.path ?? "/");
    });
    native.on("close", () => this.notifications.delete(key));
    // Kept referenced: a collected notification loses its click handler.
    this.notifications.set(key, native);
    if (this.notifications.size > 50) {
      const oldest = this.notifications.keys().next().value;
      if (oldest) this.notifications.delete(oldest);
    }
    native.show();
  }

  // ------------------------------------------------------------ deep links

  async openDeepLink(raw: string) {
    if (!this.window || this.chrome?.webContents.isLoading()) {
      this.pendingLinks.push(raw);
      return;
    }
    const link = parseDeepLink(raw);
    if (!link) {
      void dialog.showMessageBox(this.window, {
        type: "warning",
        message: "This link cannot be opened.",
        detail:
          "Lictory links look like lictory://lictory.example.com/acme/items/PAY-142.",
      });
      return;
    }
    const known = serverForLink(link, this.servers.servers);
    if (known) {
      this.navigate(known.id, link.path);
      return;
    }
    this.show();
    const origin = originForHost(link.host);
    const { response } = await dialog.showMessageBox(this.window, {
      type: "question",
      buttons: ["Add server", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: `Add ${link.host} to Lictory?`,
      detail: `A link to ${link.path} on ${origin}, which is not one of your servers. Add it only if you trust it.`,
    });
    if (response !== 0) return;
    const added = await this.addServer(origin);
    if (!added.ok) {
      void dialog.showMessageBox(this.window, {
        type: "error",
        message: `${link.host} could not be added.`,
        detail: added.error,
      });
      return;
    }
    this.navigate(added.serverId, link.path);
  }

  // ------------------------------------------------------------ IPC

  // Every message is checked against its sender: shell messages only from
  // the shell page, bridge messages only from a server's own top-level page.
  registerIpc(handlers: {
    runner(command: unknown): Promise<unknown>;
    runnerLogs(): unknown;
  }) {
    const fromShell = (event: IpcMainEvent | IpcMainInvokeEvent) =>
      !!this.chrome &&
      event.sender === this.chrome.webContents &&
      event.senderFrame?.url.startsWith("lictory-app://shell/") === true;
    const handle = (
      channel: string,
      listener: (...args: unknown[]) => unknown,
    ) =>
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!fromShell(event)) throw new Error("Not allowed.");
        return listener(...args);
      });
    const on = (channel: string, listener: (...args: unknown[]) => void) =>
      ipcMain.on(channel, (event, ...args: unknown[]) => {
        if (fromShell(event)) listener(...args);
      });
    const id = (value: unknown) => (typeof value === "string" ? value : "");

    handle(SHELL.state, () => this.state());
    handle(SHELL.addServer, (address) =>
      typeof address === "string" && address.length < 2048
        ? this.addServer(address)
        : { ok: false, error: "Enter a server address." },
    );
    on(SHELL.selectServer, (serverId) => this.select(id(serverId)));
    on(SHELL.serverMenu, (serverId) => this.serverMenu?.(id(serverId)));
    on(SHELL.showScreen, (screen) => {
      if (
        screen === "add-server" ||
        screen === "settings" ||
        screen === "server"
      )
        this.showScreen(screen);
    });
    on(SHELL.retry, (serverId) => this.retry(id(serverId)));
    on(SHELL.removeServer, (serverId) => void this.removeServer(id(serverId)));
    on(SHELL.back, () => this.back());
    on(SHELL.forward, () => this.forward());
    handle(SHELL.updateSettings, (patch) => this.updateSettings(patch));
    on(SHELL.checkForUpdates, () => this.hooks?.checkForUpdates());
    on(SHELL.installUpdate, () => this.hooks?.installUpdate());
    handle(SHELL.runner, (command) => handlers.runner(command));
    handle(SHELL.runnerLogs, () => handlers.runnerLogs());

    const fromServer = (event: IpcMainEvent) => {
      const entry = this.viewFor(event.sender);
      const frame = event.senderFrame;
      if (!entry || !frame || frame !== event.sender.mainFrame) return null;
      return originOf(frame.url) === entry.server.origin ? entry : null;
    };
    ipcMain.on(WEB.notify, (event, notification: unknown) => {
      const entry = fromServer(event);
      if (entry) this.notify(entry.server.id, notification);
    });
    ipcMain.on(WEB.setBadge, (event, count: unknown) => {
      const entry = fromServer(event);
      if (entry) this.setUnread(entry.server.id, count);
    });
    ipcMain.on(WEB.online, (event, online: unknown) => {
      const entry = fromServer(event);
      if (entry && typeof online === "boolean")
        this.setOffline(entry.server.id, !online);
    });
    ipcMain.on(WEB.organization, (event, name: unknown) => {
      const entry = fromServer(event);
      if (!entry) return;
      const next = nameFromOrganization(this.servers, entry.server.id, name);
      if (next !== this.servers) this.setServers(next);
    });
  }

  // Set by the menu module: the native menu of a server in the switcher.
  serverMenu: ((serverId: string) => void) | null = null;

  private viewFor(contents: WebContents) {
    for (const entry of this.views.values())
      if (entry.contents === contents) return entry;
    return undefined;
  }
}
