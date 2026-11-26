import { useEffect, useRef, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { ConsentProvider } from "@lictory/ui/consent/consent-provider";
import { Toaster } from "@lictory/ui/toast";
import { LoadingState } from "@lictory/ui/spinner";
import { publicConfig } from "@lictory/platform/lib/public-config";

export function RootLayout() {
  return (
    <ConsentProvider privacyHref={publicConfig.legal.privacyUrl ?? undefined}>
      <Outlet />
      <RouteAnnouncer />
      <Toaster />
    </ConsentProvider>
  );
}

// While the session check is on its way (every page waits for it): a quiet
// spinner on the page background, so nothing jumps when the page replaces
// it. The router shows the pending component of the first route still
// loading; a route without one leaves the page blank.
export function LoadingScreen() {
  return (
    <main className="min-h-dvh bg-background">
      <LoadingState label="Loading Lictory" className="min-h-dvh" />
    </main>
  );
}

// After a client navigation, screen readers hear the new page's title, and
// keyboard focus that was on a link of the previous page moves to the main
// region instead of falling back to the document.
function RouteAnnouncer() {
  const pathname = useRouterState({
    select: (s) => s.resolvedLocation?.pathname,
  });
  const [message, setMessage] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Wait for the page to render its title.
    const frame = requestAnimationFrame(() => {
      setMessage(document.title);
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected)
        document
          .querySelector<HTMLElement>("#main")
          ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}
