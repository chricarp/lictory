import type { Appearance, Theme } from "@lictory/core/lib/appearance";

// Saves the signed-in person's appearance (mode or colour theme) to their
// account. Callers apply the change first and revert it when this returns an
// error message.
export async function saveAppearance(
  body: { appearance: Appearance } | { theme: Theme },
): Promise<string | null> {
  const response = await fetch("/api/appearance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (response?.ok) return null;
  const result = (await response?.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return (
    result?.error?.message ??
    "Appearance was not saved. Check your connection and try again."
  );
}
