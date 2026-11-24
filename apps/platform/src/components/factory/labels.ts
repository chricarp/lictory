import { agentSession } from "@lictory/core/contracts/state-machines";
import type { SessionStatus } from "@lictory/core/factory/entities";
import { harnessLabels, type HarnessId } from "@lictory/core/factory/protocol";

export const statusLabels: Record<SessionStatus, string> = {
  queued: "Queued",
  assigned: "Starting",
  running: "Running",
  waiting: "Waiting on a person",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

export const statusTone: Record<
  SessionStatus,
  "neutral" | "good" | "warning" | "danger" | "info"
> = {
  queued: "neutral",
  assigned: "info",
  running: "info",
  waiting: "warning",
  completed: "good",
  failed: "danger",
  canceled: "neutral",
};

// The meaning of each status, from the declared state machine.
export const statusMeaning = (status: SessionStatus) =>
  agentSession.states[status];

export const activeStatuses: SessionStatus[] = [
  "queued",
  "assigned",
  "running",
  "waiting",
];

export const harnessLabel = (harness: string | null) =>
  harness ? (harnessLabels[harness as HarnessId] ?? harness) : "External";

export const osLabel = (os: string) =>
  ({ linux: "Linux", darwin: "macOS", win32: "Windows" })[os] ??
  (os || "Unknown");
