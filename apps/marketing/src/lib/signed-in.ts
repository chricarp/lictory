"use client";

import { useSyncExternalStore } from "react";
import { hasSignedInHint } from "@lictory/core/lib/signed-in-hint";

// Pages are prerendered for everyone; the application's signed-in hint (see
// `@lictory/core/lib/signed-in-hint`) switches calls to action after
// hydration. Read again when the tab regains focus, so signing in or out in
// another tab is reflected on return.

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("pageshow", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

export function useSignedIn() {
  return useSyncExternalStore(
    subscribe,
    () => hasSignedInHint(document.cookie),
    () => false,
  );
}
