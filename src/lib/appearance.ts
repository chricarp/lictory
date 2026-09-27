// A person's colour-scheme preference. "system" follows the operating system
// and keeps following it as it changes (e.g. automatic dark mode at night).
export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export function parseAppearance(value: unknown): Appearance {
  return APPEARANCES.includes(value as Appearance)
    ? (value as Appearance)
    : "system";
}

// The account preference is authoritative; this device-local copy only exists
// so the first paint (before any server data, and on signed-out pages) already
// uses the right scheme instead of flashing light.
export const APPEARANCE_STORAGE_KEY = "lictory-appearance";

export function applyAppearance(appearance: Appearance) {
  const dark =
    appearance === "dark" ||
    (appearance === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

// Inlined in <head> and run before first paint. Must stay self-contained.
export const appearanceBootScript = `(function(){try{var a=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});var d=a==="dark"||(a!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d)r.classList.add("dark");r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
