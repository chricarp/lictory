import { createContext, useContext, useEffect, useState } from "react";

import {
  APPEARANCE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applyAppearance,
  applyTheme,
  parseAppearance,
  parseTheme,
  type Appearance,
  type Theme,
} from "@lictory/core/lib/appearance";

type AppearanceContextValue = {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

// Applies the signed-in person's saved appearance and theme and keeps them
// applied: follows OS changes while set to "system", and mirrors changes made
// in other tabs.
export function AppearanceProvider({
  initial,
  initialTheme,
  children,
}: {
  initial: Appearance;
  initialTheme: Theme;
  children: React.ReactNode;
}) {
  const [appearance, setAppearance] = useState(initial);
  const [theme, setTheme] = useState(initialTheme);

  // A newer server value (another device, router.refresh) wins.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setAppearance(initial);
  }
  const [lastInitialTheme, setLastInitialTheme] = useState(initialTheme);
  if (initialTheme !== lastInitialTheme) {
    setLastInitialTheme(initialTheme);
    setTheme(initialTheme);
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
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY)
        setAppearance(parseAppearance(event.newValue));
      if (event.key === THEME_STORAGE_KEY) setTheme(parseTheme(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <AppearanceContext value={{ appearance, setAppearance, theme, setTheme }}>
      {children}
    </AppearanceContext>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance needs an AppearanceProvider.");
  return value;
}
