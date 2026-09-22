"use client";

import { CloudAlert, CloudOff } from "lucide-react";

import { Button } from "~/components/ui/button";
import { MissingState } from "~/components/ui/status-page";
import type { View } from "~/sync/client/engine";
import { useWorkspace } from "./provider";

export function isSyncBlocked(status: View["status"]) {
  return status === "failed" || status === "offline";
}

export function SyncIssue({
  status,
  error,
}: {
  status: Extract<View["status"], "failed" | "offline">;
  error?: string;
}) {
  const { engine, view } = useWorkspace();
  const offline = status === "offline";
  return (
    <MissingState
      icon={offline ? CloudOff : CloudAlert}
      tone={offline ? "warning" : "danger"}
      title={offline ? "You are offline" : "The workspace could not be synced"}
      action={
        <>
          <Button onClick={() => void engine.sync()}>Try again</Button>
          <Button variant="ghost" onClick={() => void engine.reset()}>
            Reload server state
          </Button>
        </>
      }
    >
      {error ??
        view.error ??
        (offline
          ? "Queued changes remain on this device and will sync when you reconnect."
          : "Check your connection and try again. Previously queued changes remain in this browser.")}
    </MissingState>
  );
}
