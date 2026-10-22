import { useEffect, useRef, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { ConsentProvider } from "@lictory/ui/consent/consent-provider";
import { Toaster } from "@lictory/ui/toast";
import { siteLink } from "@lictory/platform/lib/site";

export function RootLayout() {
  return (
    <ConsentProvider privacyHref={siteLink("/privacy")}>
      <Outlet />
      <RouteAnnouncer />
      <Toaster />
    </ConsentProvider>
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
