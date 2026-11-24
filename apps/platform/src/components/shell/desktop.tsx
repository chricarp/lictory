import { useEffect } from "react";
import { safeCallbackPath } from "@lictory/core/lib/paths";
import { desktop } from "@lictory/platform/lib/desktop";
import { useRouter } from "@lictory/platform/lib/navigation";

// The web app inside the desktop app (apps/desktop). Without the bridge (a
// browser) every hook here does nothing.
//
// Inside the desktop app the root element carries `data-desktop` and
// `data-desktop-platform`: the stylesheet turns `[data-drag-region]`
// elements (the sidebar's top strip, page headers) into the window's title
// bar, keeps their controls clickable, and on macOS leaves room for the
// window buttons above the organization rail.

export function useDesktopIntegration() {
  const router = useRouter();
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    const root = document.documentElement;
    root.dataset.desktop = "";
    root.dataset.desktopPlatform = bridge.platform;
    // Deep links, notification clicks and the tray navigate inside the app,
    // never to another origin or an account flow.
    const stop = bridge.onNavigate((path) => {
      const target = safeCallbackPath(path);
      if (target !== "/" || path === "/") router.push(target);
    });
    return () => {
      stop();
      delete root.dataset.desktop;
      delete root.dataset.desktopPlatform;
    };
  }, [router]);
}

// The dock or taskbar badge: unread mentions and direct messages.
export function useDesktopBadge(count: number) {
  useEffect(() => {
    desktop()?.setBadge(count);
  }, [count]);
}
