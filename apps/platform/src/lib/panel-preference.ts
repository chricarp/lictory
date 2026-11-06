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
  // "sidebar-views" stores whether the sidebar's Views group is expanded;
  // "sidebar-spaces" whether its Spaces group is collapsed.
  panel: "sidebar" | "work-item-list" | "sidebar-views" | "sidebar-spaces",
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
  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
        fallback.delete(key);
      } catch {
        // Keep the control usable when browser storage is unavailable.
        fallback.set(key, next);
      }
      listeners.forEach((listener) => listener());
    },
    [key],
  );
  const toggle = useCallback(() => set(!read(key)), [set, key]);
  return [collapsed, toggle, set] as const;
}
