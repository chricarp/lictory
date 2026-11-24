import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  DesktopBridge,
  DesktopNotification,
  DesktopPlatform,
} from "@lictory/platform/lib/desktop";
import { WEB } from "../shared/ipc";
import { isInAppPath } from "../shared/urls";

// The desktop bridge (apps/platform/src/lib/desktop.ts), exposed to a
// server's own top-level page only: identity provider pages shown during a
// sign-in run in the same view and get nothing. It carries no Node.js access
// and no credentials; the main process checks the sender of every message
// again.

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const origin = argument("lictory-origin");
const version = argument("lictory-version") ?? "0.0.0";
const listeners = new Set<(path: string) => void>();

ipcRenderer.on(WEB.navigate, (_event: IpcRendererEvent, path: unknown) => {
  if (!isInAppPath(path)) return;
  if (listeners.size) for (const listener of listeners) listener(path);
  // A page without the bridge listener (signed out, an error page) loads it.
  else window.location.assign(path);
});

const platform: DesktopPlatform =
  process.platform === "darwin" || process.platform === "win32"
    ? process.platform
    : "linux";

const bridge: DesktopBridge = {
  platform,
  version,
  notify(notification: DesktopNotification) {
    ipcRenderer.send(WEB.notify, {
      title: notification?.title,
      body: notification?.body,
      path: notification?.path,
      tag: notification?.tag,
    });
  },
  setBadge(count: number) {
    ipcRenderer.send(WEB.setBadge, count);
  },
  onNavigate(listener: (path: string) => void) {
    if (typeof listener !== "function") return () => undefined;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

if (origin && window.location.origin === origin)
  contextBridge.exposeInMainWorld("lictoryDesktop", bridge);
