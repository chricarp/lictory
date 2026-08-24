"use client";

import * as React from "react";

export type ThemePreference = "system" | "dark" | "light";

export type UserPreferences = {
  theme: ThemePreference;
  highContrast: boolean;
  largeText: boolean;
  reduceMotion: boolean;
};

export const PREFERENCES_STORAGE_KEY = "lictory.preferences.v1";

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "system",
  highContrast: false,
  largeText: false,
  reduceMotion: false,
};

function readPreferences(): UserPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "{}",
    ) as Partial<UserPreferences>;
    return {
      theme:
        stored.theme === "dark" || stored.theme === "light"
          ? stored.theme
          : "system",
      highContrast: stored.highContrast === true,
      largeText: stored.largeText === true,
      reduceMotion: stored.reduceMotion === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

let currentPreferences = readPreferences();
const listeners = new Set<() => void>();

function applyPreferences(preferences: UserPreferences) {
  if (typeof document === "undefined") return;

  const prefersLight = window.matchMedia(
    "(prefers-color-scheme: light)",
  ).matches;
  const resolvedTheme =
    preferences.theme === "system"
      ? prefersLight
        ? "light"
        : "dark"
      : preferences.theme;
  const root = document.documentElement;
  root.classList.toggle("light", resolvedTheme === "light");
  root.classList.toggle("a11y-high-contrast", preferences.highContrast);
  root.classList.toggle("a11y-large-text", preferences.largeText);
  root.classList.toggle("a11y-reduce-motion", preferences.reduceMotion);
  root.style.colorScheme = resolvedTheme;
}

export function setUserPreferences(next: UserPreferences) {
  currentPreferences = next;
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  applyPreferences(next);
  listeners.forEach((listener) => listener());
}

export function useUserPreferences() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentPreferences,
    () => DEFAULT_PREFERENCES,
  );
}

export function PreferencesManager() {
  const preferences = useUserPreferences();

  React.useEffect(() => {
    applyPreferences(preferences);
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemTheme = () => {
      if (preferences.theme === "system") applyPreferences(preferences);
    };
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [preferences]);

  return null;
}
