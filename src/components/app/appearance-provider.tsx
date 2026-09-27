"use client";

import { createContext, useContext, useEffect, useState } from "react";

import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  parseAppearance,
  type Appearance,
} from "~/lib/appearance";

type AppearanceContextValue = {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

// Applies the signed-in person's saved appearance and keeps it applied: follows
// OS changes while set to "system", and mirrors changes made in other tabs.
export function AppearanceProvider({
  initial,
  children,
}: {
  initial: Appearance;
  children: React.ReactNode;
}) {
  const [appearance, setAppearance] = useState(initial);

  // A newer server value (another device, router.refresh) wins.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setAppearance(initial);
  }

  useEffect(() => {
    applyAppearance(appearance);
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    } catch {}
    if (appearance !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyAppearance("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [appearance]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY)
        setAppearance(parseAppearance(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <AppearanceContext value={{ appearance, setAppearance }}>
      {children}
    </AppearanceContext>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance needs an AppearanceProvider.");
  return value;
}
