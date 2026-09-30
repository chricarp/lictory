"use client";
import { useCallback, useSyncExternalStore } from "react";

// Layout preferences stay in this browser, outside synchronized domain state.
const listeners = new Set<() => void>();
const fallback = new Map<string, boolean>();

function read(key: string) {
  if (fallback.has(key)) return fallback.get(key)!;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return fallback.get(key) ?? false;
  }
}

export function usePanelCollapsed(
  organizationId: string,
  panel: "sidebar" | "work-item-list",
) {
  const key = `lictory:panel-collapsed:${organizationId}:${panel}`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );
  const collapsed = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const toggle = useCallback(() => {
    const next = !read(key);
    try {
      window.localStorage.setItem(key, String(next));
      fallback.delete(key);
    } catch {
      // Keep the control usable when browser storage is unavailable.
      fallback.set(key, next);
    }
    listeners.forEach((listener) => listener());
  }, [key]);
  return [collapsed, toggle] as const;
}
