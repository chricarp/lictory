"use client";
import { useSyncExternalStore } from "react";

// The project a person is working in survives visits to organization-level
// surfaces (Inbox, organization settings, account). It is a per-organization
// browser preference, not domain state: the URL remains authoritative whenever
// it names a project.
const prefix = "lictory:last-project:";
const listeners = new Set<() => void>();
const storageKey = (organizationId: string) => `${prefix}${organizationId}`;

function read(organizationId: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(organizationId));
  } catch {
    return null;
  }
}

export function rememberProject(organizationId: string, key: string) {
  if (read(organizationId) === key) return;
  try {
    window.localStorage.setItem(storageKey(organizationId), key);
  } catch {
    // Storage may be unavailable (private mode, quota); the URL still works.
  }
  listeners.forEach((l) => l());
}

export function useLastProjectKey(organizationId: string) {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey(organizationId)) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => read(organizationId),
    () => null,
  );
}
