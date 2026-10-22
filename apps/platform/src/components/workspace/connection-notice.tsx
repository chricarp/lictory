import { useState } from "react";
import { CloudAlert, CloudOff, KeyRound } from "lucide-react";
import { useConnectionState } from "@rocicorp/zero/react";
import { MissingState } from "@lictory/ui/status-page";
import {
  connectionProblem,
  viewStatus,
  type ConnectionName,
} from "@lictory/platform/data/connection";
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
      className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border bg-popover p-4 text-[13px] text-popover-foreground shadow-lg"
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

// Before any workspace data is local: the connection state decides between
// a loading skeleton and a recovery page.
export function useConnectionBlocked(): "offline" | "failed" | undefined {
  const name: ConnectionName = useConnectionState().name;
  const status = viewStatus(name, false);
  return status === "offline" || status === "failed" ? status : undefined;
}

export function ConnectionUnavailable({
  status,
}: {
  status: "offline" | "failed";
}) {
  const state = useConnectionState();
  const needsAuth = state.name === "needs-auth";
  const offline = status === "offline";
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <MissingState
        illustration="recovery"
        icon={offline ? CloudOff : CloudAlert}
        tone={offline ? "warning" : "danger"}
        title={
          offline ? "You are offline" : "The workspace could not be opened"
        }
        action={
          needsAuth ? (
            <Button onClick={() => void reauthenticate()}>Sign in again</Button>
          ) : (
            <>
              <Button onClick={reconnectWorkspace}>Try again</Button>
              <Button variant="ghost" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </>
          )
        }
      >
        {connectionProblem(
          state.name,
          "reason" in state && typeof state.reason === "string"
            ? state.reason
            : undefined,
        )}
      </MissingState>
    </div>
  );
}
