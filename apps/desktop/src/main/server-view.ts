import {
  app,
  session as electronSession,
  systemPreferences,
  WebContentsView,
  type Session,
  type WebContents,
} from "electron";
import { attachContextMenu } from "./context-menu";
import {
  decideNavigation,
  decideWindowOpen,
  type NavigationDecision,
} from "../shared/navigation";
import {
  checkPermission,
  decidePermission,
  type MediaKind,
} from "../shared/permissions";
import { partitionFor, type Server } from "../shared/servers";
import { inAppPathOf, originOf } from "../shared/urls";

// One server's page: a WebContentsView on the server's own persistent
// session partition, so each server keeps its own sign-in, with context
// isolation, the renderer sandbox and no Node.js. The only code it shares
// with the app is the desktop bridge of preload/web.ts.

export type ServerViewHost = {
  isDev: boolean;
  preload: string;
  version: string;
  servers(): readonly { id: string; origin: string }[];
  // A link to another configured server.
  switchTo(serverId: string, url: string): void;
  openExternal(url: string): void;
  confirmMedia(server: Server, kinds: MediaKind[]): Promise<boolean>;
  loadFailed(serverId: string, message: string): void;
  loaded(serverId: string): void;
  navigated(serverId: string, path: string | null): void;
  titleChanged(serverId: string): void;
  loadingChanged(serverId: string): void;
};

export type ServerView = {
  server: Server;
  view: WebContentsView;
  contents: WebContents;
  load(path?: string | null): void;
  // Media the person allowed in this run, by kind.
  mediaAllowed: Set<MediaKind>;
  destroy(): void;
};

const configured = new WeakSet<Session>();

// Chrome's user agent without the Electron and app tokens: some identity
// providers refuse to sign in from what they recognise as an embedded
// browser. Pages detect the desktop app by its bridge, never by agent.
function browserUserAgent() {
  const name = app.getName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return app.userAgentFallback
    .replace(/\sElectron\/\S+/, "")
    .replace(new RegExp(`\\s${name}/\\S+`, "i"), "");
}

function spellCheckLanguages(ses: Session) {
  if (process.platform === "darwin") return; // The system spell checker.
  const available = ses.availableSpellCheckerLanguages;
  const wanted = app.getPreferredSystemLanguages().flatMap((tag) => {
    const exact = available.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return [exact];
    const base = tag.split("-")[0]?.toLowerCase();
    const near = available.find((l) => l.toLowerCase().split("-")[0] === base);
    return near ? [near] : [];
  });
  try {
    ses.setSpellCheckerLanguages([...new Set(wanted)].slice(0, 3));
  } catch {
    // An unsupported language keeps the default.
  }
}

function configureSession(
  ses: Session,
  server: Server,
  host: ServerViewHost,
  allowed: () => Set<MediaKind>,
) {
  if (configured.has(ses)) return;
  configured.add(ses);
  ses.setUserAgent(browserUserAgent());
  spellCheckLanguages(ses);
  ses.setPermissionRequestHandler(
    (_contents, permission, callback, details) => {
      const decision = decidePermission({
        permission,
        requestingOrigin: originOf(details.requestingUrl),
        serverOrigin: server.origin,
        isMainFrame: details.isMainFrame,
      });
      if (decision !== "ask") {
        callback(decision === "allow");
        return;
      }
      const kinds = (
        "mediaTypes" in details ? (details.mediaTypes ?? []) : []
      ).filter((k): k is MediaKind => k === "audio" || k === "video");
      if (!kinds.length) {
        callback(false);
        return;
      }
      if (kinds.every((k) => allowed().has(k))) {
        callback(true);
        return;
      }
      void host
        .confirmMedia(server, kinds)
        .then(async (yes) => {
          if (!yes) return false;
          if (process.platform === "darwin")
            for (const kind of kinds)
              if (
                !(await systemPreferences.askForMediaAccess(
                  kind === "audio" ? "microphone" : "camera",
                ))
              )
                return false;
          for (const kind of kinds) allowed().add(kind);
          return true;
        })
        .then(callback, () => callback(false));
    },
  );
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    checkPermission(
      {
        permission,
        requestingOrigin: originOf(requestingOrigin),
        serverOrigin: server.origin,
      },
      allowed().size > 0,
    ),
  );
  // USB, serial and HID devices are never offered to a page.
  ses.setDevicePermissionHandler(() => false);
}

export function createServerView(
  server: Server,
  host: ServerViewHost,
): ServerView {
  const mediaAllowed = new Set<MediaKind>();
  const ses = electronSession.fromPartition(partitionFor(server));
  configureSession(ses, server, host, () => mediaAllowed);

  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      preload: host.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: true,
      safeDialogs: true,
      autoplayPolicy: "user-gesture-required",
      devTools: host.isDev,
      additionalArguments: [
        `--lictory-origin=${server.origin}`,
        `--lictory-version=${host.version}`,
      ],
    },
  });
  const contents = view.webContents;
  contents.setZoomLevel(server.zoomLevel);
  let signInUntil: number | null = null;

  function apply(decision: NavigationDecision, prevent: () => void) {
    switch (decision.kind) {
      case "allow":
        return;
      case "switch":
        prevent();
        host.switchTo(decision.serverId, decision.url);
        return;
      case "external":
        prevent();
        host.openExternal(decision.url);
        return;
      case "block":
        prevent();
    }
  }

  function onNavigation(event: { preventDefault(): void; url: string }) {
    const result = decideNavigation(event.url, {
      serverOrigin: server.origin,
      servers: host.servers(),
      signInUntil,
      now: Date.now(),
    });
    signInUntil = result.signInUntil;
    apply(result.decision, () => event.preventDefault());
  }

  contents.on("will-navigate", (event) => {
    if (event.isMainFrame) onNavigation(event);
  });
  // Server-side redirects of the top-level page follow the same rule.
  contents.on("will-redirect", (event) => {
    if (event.isMainFrame) onNavigation(event);
  });
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url, {
      serverOrigin: server.origin,
      servers: host.servers(),
    });
    if (decision.kind === "allow") void contents.loadURL(url);
    else apply(decision, () => undefined);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());

  // Chromium finishes loading its own error page after a failed load: that
  // is not the server answering.
  let failed = false;
  contents.on("did-start-navigation", (event) => {
    if (event.isMainFrame && !event.isSameDocument) failed = false;
  });
  contents.on(
    "did-fail-load",
    (_event, code, description, url, isMainFrame) => {
      // -3 is an aborted load (a newer navigation replaced it).
      if (!isMainFrame || code === -3) return;
      failed = true;
      const where = originOf(url) ? new URL(url).host : server.name;
      host.loadFailed(
        server.id,
        `${where} could not be loaded (${description || `error ${code}`}).`,
      );
    },
  );
  contents.on("did-finish-load", () => {
    if (!failed) host.loaded(server.id);
  });
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    host.loadFailed(
      server.id,
      `This page stopped working (${details.reason.replace(/-/g, " ")}).`,
    );
  });
  const navigated = (_event: unknown, url: string) =>
    host.navigated(server.id, inAppPathOf(url, server.origin));
  contents.on("did-navigate", navigated);
  contents.on("did-navigate-in-page", (event, url, isMainFrame) => {
    if (isMainFrame) navigated(event, url);
  });
  contents.on("page-title-updated", () => host.titleChanged(server.id));
  contents.on("did-start-loading", () => host.loadingChanged(server.id));
  contents.on("did-stop-loading", () => host.loadingChanged(server.id));
  attachContextMenu(contents, {
    isDev: host.isDev,
    openExternal: (url) => host.openExternal(url),
  });

  return {
    server,
    view,
    contents,
    mediaAllowed,
    load(path) {
      signInUntil = null;
      void contents.loadURL(`${server.origin}${path ?? "/"}`).catch(() => {
        // did-fail-load reports it.
      });
    },
    destroy() {
      if (!contents.isDestroyed()) contents.close();
    },
  };
}
