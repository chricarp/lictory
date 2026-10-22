// How Zero's connection state and this tab's unsent work appear in the
// workspace: the sidebar sync indicator and the gates that show a recovery
// page when the workspace cannot be read.

export type ConnectionName =
  | "initializing"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "needs-auth"
  | "closed";

export type ViewStatus = "hydrating" | "synced" | "offline" | "failed";

// `complete`: the organization query has had an authoritative answer.
export function viewStatus(
  connection: ConnectionName,
  complete: boolean,
): ViewStatus {
  if (complete) return "synced";
  switch (connection) {
    case "disconnected":
      return "offline";
    case "error":
    case "needs-auth":
    case "closed":
      return "failed";
    default:
      return "hydrating";
  }
}

export type Presentation =
  "idle" | "busy" | "offline" | "recovering" | "attention" | "access";

export function presentation(input: {
  connection: ConnectionName;
  // Has this Zero instance been connected before (a reconnect, not a start)?
  everConnected: boolean;
  // Debounced: unsent mutations or a first load in progress.
  busy: boolean;
  // Rejected changes whose text is kept for recovery.
  rejected: number;
}): Presentation {
  switch (input.connection) {
    case "needs-auth":
    case "closed":
      return "access";
    case "disconnected":
      return "offline";
    case "error":
      return "attention";
    case "connecting":
      if (input.everConnected) return "recovering";
      break;
  }
  if (input.rejected > 0) return "attention";
  return input.busy ? "busy" : "idle";
}

// Writes are refused while Zero cannot reach the server.
export function canWrite(connection: ConnectionName) {
  return (
    connection === "initializing" ||
    connection === "connecting" ||
    connection === "connected"
  );
}

export function connectionProblem(
  connection: ConnectionName,
  reason?: string,
): string | undefined {
  switch (connection) {
    case "disconnected":
      return "You’re offline. Reconnect to keep working; changes can’t be saved until then.";
    case "error":
      return reason
        ? `The workspace connection failed: ${reason}`
        : "The workspace connection failed.";
    case "needs-auth":
      return "Your session expired or your access changed. Sign in again to continue.";
    case "closed":
      return "This workspace session has ended. Reload the page.";
    default:
      return undefined;
  }
}
