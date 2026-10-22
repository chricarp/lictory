import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@lictory/ui/button";
import { refreshSession } from "@lictory/platform/lib/session";
import { reconnectWorkspace } from "@lictory/platform/data/zero";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Zero reports `needs-auth` when the query or mutate endpoint answered 401 or
// 403: the session expired or access changed. A still-valid session (another
// tab signed in again) only needs a reconnect; otherwise sign in again and
// come back here.
export async function reauthenticate() {
  const here = `${window.location.pathname}${window.location.search}`;
  try {
    const session = await refreshSession();
    if (session.user) {
      reconnectWorkspace();
      return;
    }
  } catch {
    // Fall through to signing in again.
  }
  window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(here)}`);
}

export function ConnectionNotice() {
  const { connection } = useWorkspace();
  const [busy, setBusy] = useState(false);
  if (connection !== "needs-auth") return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border bg-popover p-4 text-[13px] text-popover-foreground shadow-lg"
    >
      <KeyRound className="size-4 shrink-0 text-destructive" aria-hidden />
      <p className="min-w-0 flex-1 leading-relaxed">
        Your session expired or your access changed. Changes can’t be saved
        until you sign in again.
      </p>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void reauthenticate().finally(() => setBusy(false));
        }}
      >
        {busy ? "Checking…" : "Sign in again"}
      </Button>
    </div>
  );
}
