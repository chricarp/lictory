import { agentSession } from "@lictory/core/contracts/state-machines";
import type { ClaimEntity } from "@lictory/core/claims/contracts";
import type {
  SessionEntity,
  SessionStatus,
} from "@lictory/core/factory/entities";
import type { StatusTone } from "@lictory/ui/status-chip";

// One vocabulary for where an agent's work stands, shared by every surface
// that shows a session or a claim: the Factory, Home, channel session cards,
// the project's Factory queue, the item's claim panel and the board's claim
// badge. A session and the claim it works for are one state, never two:
// a claim whose session waits on a person waits on that person.

export type { StatusTone };

// A glyph for the state, mapped to an icon by the chip that draws it.
export type StateGlyph =
  | "queued"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "canceled";

export type SessionState = {
  // What the state is called where it is shown: "Waiting on Ada".
  label: string;
  tone: StatusTone;
  glyph: StateGlyph;
  // The declared meaning, for a tooltip.
  meaning: string;
  // Still moving: queued, starting, running or waiting.
  active: boolean;
  // A person has to act (answer, approve, resolve a discussion).
  needsPerson: boolean;
};

export const statusLabels: Record<SessionStatus, string> = {
  queued: "Queued",
  assigned: "Starting",
  running: "Running",
  waiting: "Waiting on a person",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

export const sessionTone: Record<SessionStatus, StatusTone> = {
  queued: "neutral",
  assigned: "info",
  running: "info",
  waiting: "attention",
  completed: "success",
  failed: "danger",
  canceled: "neutral",
};

// The same tones in the older `Badge` names, for badges not yet replaced by
// `StatusChip`.
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

const glyphs: Record<SessionStatus, StateGlyph> = {
  queued: "queued",
  assigned: "starting",
  running: "running",
  waiting: "waiting",
  completed: "completed",
  failed: "failed",
  canceled: "canceled",
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

const claimLabels: Record<ClaimEntity["state"], string> = {
  starting: "Starting",
  active: "Running",
  waiting: "Waiting on people",
};

const claimMeanings: Record<ClaimEntity["state"], string> = {
  starting: "The agent claimed the item and its session is starting.",
  active: "The agent is working on the item.",
  waiting:
    "The agent asked questions on the item's discussions that people have not resolved yet.",
};

export const firstName = (name: string) => {
  return name.trim().split(/\s+/)[0] ?? name;
};

type SessionLike = Pick<SessionEntity, "status">;
type ClaimLike = Pick<ClaimEntity, "state" | "waitingThreadIds">;

// Where a session (and the claim it works for, when there is one) stands.
// `decider` is the person who answers the agent (the agent's owner or who
// started the session): with it, waiting reads "Waiting on Ada".
export function sessionState(
  session: SessionLike | null | undefined,
  options: {
    claim?: ClaimLike | null;
    decider?: string | null;
  } = {},
): SessionState {
  const { claim, decider } = options;
  const waitingOn = decider ? `Waiting on ${firstName(decider)}` : null;
  if (session) {
    const status = session.status;
    const waiting = status === "waiting";
    return {
      label: waiting
        ? (waitingOn ?? statusLabels.waiting)
        : statusLabels[status],
      tone: sessionTone[status],
      glyph: glyphs[status],
      meaning: statusMeaning(status),
      active: activeStatuses.includes(status),
      needsPerson: waiting || (claim?.waitingThreadIds.length ?? 0) > 0,
    };
  }
  if (claim) {
    const waiting =
      claim.state === "waiting" || claim.waitingThreadIds.length > 0;
    return {
      label: waiting ? claimLabels.waiting : claimLabels[claim.state],
      tone: waiting ? "attention" : "info",
      glyph: waiting
        ? "waiting"
        : claim.state === "starting"
          ? "starting"
          : "running",
      meaning: claimMeanings[waiting ? "waiting" : claim.state],
      active: true,
      needsPerson: waiting,
    };
  }
  return {
    label: "Not started",
    tone: "neutral",
    glyph: "queued",
    meaning: "No agent is working on this.",
    active: false,
    needsPerson: false,
  };
}
