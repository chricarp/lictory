// The bridge the Lictory desktop app (apps/desktop) exposes to the web app
// through its preload script. In a browser it is absent and `desktop()`
// returns null, so every caller keeps working on the web.
//
// The preload must implement exactly this shape; it carries no Node access
// and no credentials, only the few native features a page may ask for.

export type DesktopPlatform = "darwin" | "win32" | "linux";

export interface DesktopNotification {
  title: string;
  body: string;
  // An in-app path (for example `/acme/channels/general`) opened when the
  // person clicks the notification.
  path?: string;
  // Notifications with the same tag replace each other.
  tag?: string;
}

export interface DesktopBridge {
  platform: DesktopPlatform;
  version: string;
  // Shows a native notification. Pages call it only for activity that
  // notifies the person (mentions, direct messages, decisions waiting on them).
  notify(notification: DesktopNotification): void;
  // Unread mentions and direct messages; 0 clears the dock or taskbar badge.
  setBadge(count: number): void;
  // Called when the shell navigates the page (deep link, notification click,
  // tray menu). Returns a function that stops listening.
  onNavigate(listener: (path: string) => void): () => void;
}

declare global {
  interface Window {
    lictoryDesktop?: DesktopBridge;
  }
}

export function desktop(): DesktopBridge | null {
  return typeof window === "undefined" ? null : (window.lictoryDesktop ?? null);
}
