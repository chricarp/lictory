import { authClient } from "@lictory/platform/lib/auth-client";
import {
  clearSession,
  loadSession,
  refreshSession,
} from "@lictory/platform/lib/session";
import { resetAnalytics, track } from "@lictory/core/lib/analytics/client";
import { deleteLocalWorkspaceData } from "@lictory/platform/data/zero";
import { clearRecoveryFor } from "@lictory/platform/data/recovery";

const accountEvent = "lictory:account";

// Something about the signed-in account changed (name, photo, handle,
// connected sign-in methods): read the session again and let account views
// reload. Workspace data needs nothing: Zero keeps it current.
export function accountChanged() {
  window.dispatchEvent(new Event(accountEvent));
  return refreshSession().catch(() => undefined);
}

export function onAccountChanged(listener: () => void) {
  window.addEventListener(accountEvent, listener);
  return () => window.removeEventListener(accountEvent, listener);
}

// Removes everything this browser kept for the person: the synchronized
// workspace cache, unsent text and drafts. Then starts over on the sign-in
// page with a fresh document, so no state of the previous account survives.
export async function forgetAccountLocally(userId: string | undefined) {
  resetAnalytics();
  await deleteLocalWorkspaceData();
  if (userId) {
    try {
      clearRecoveryFor(userId);
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key?.includes(userId)) sessionStorage.removeItem(key);
      }
    } catch {
      // Storage unavailable: nothing was kept.
    }
  }
  clearSession();
}

export async function signOut(): Promise<{ error?: string }> {
  const userId = (await loadSession().catch(() => undefined))?.user?.id;
  const result = await authClient.signOut();
  if (result.error)
    return { error: result.error.message ?? "Could not sign out. Try again." };
  track("signed_out");
  await forgetAccountLocally(userId);
  window.location.assign("/sign-in");
  return {};
}
