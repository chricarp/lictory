import { CloudAlert, CloudOff } from "lucide-react";

import { Button } from "@lictory/ui/button";
import { MissingState } from "@lictory/ui/status-page";
import {
  useWorkspace,
  type View,
} from "@lictory/platform/components/workspace/provider";
import { reauthenticate } from "@lictory/platform/components/workspace/connection-notice";

export function isSyncBlocked(
  status: View["status"],
): status is "failed" | "offline" {
  return status === "failed" || status === "offline";
}

export function SyncIssue({
  status,
  error,
}: {
  status: Extract<View["status"], "failed" | "offline">;
  error?: string;
}) {
  const { view, connection, reconnect } = useWorkspace();
  const offline = status === "offline";
  const needsAuth = connection === "needs-auth";
  return (
    <MissingState
      illustration="recovery"
      icon={offline ? CloudOff : CloudAlert}
      tone={offline ? "warning" : "danger"}
      title={offline ? "You are offline" : "The workspace could not be synced"}
      action={
        needsAuth ? (
          <Button onClick={() => void reauthenticate()}>Sign in again</Button>
        ) : (
          <>
            <Button onClick={reconnect}>Try again</Button>
            <Button variant="ghost" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </>
        )
      }
    >
      {error ??
        view.error ??
        (needsAuth
          ? "Your session expired or your access changed. Sign in again to continue."
          : offline
            ? "Reconnect to the internet. The workspace opens as soon as the connection is back."
            : "Check your connection and try again.")}
    </MissingState>
  );
}
