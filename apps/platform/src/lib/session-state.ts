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
  // Completed, but what it changed was discarded (no repository).
  | "unkept"
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
  starting: "Claimed; the session is starting.",
  active: "Working on the item.",
  waiting: "Waiting on answers in the item's discussions.",
};

// Why a queued session does not start, and what starts it.
export const noRunnerMeaning =
  "No online runner can run this agent. Start or add one with its harness.";

export const firstName = (name: string) => {
  return name.trim().split(/\s+/)[0] ?? name;
};

type SessionLike = Pick<SessionEntity, "status"> &
  Partial<Pick<SessionEntity, "discardedFiles">>;

// A completed session with no repository whose changes were discarded as
// it ended: the outcome is that its work was not kept, never success.
export function workNotKept(session: SessionLike | null | undefined) {
  return session?.status === "completed" && (session.discardedFiles ?? 0) > 0;
}

export const notKeptMeaning = (files: number) =>
  `No repository was linked, so the ${files === 1 ? "file" : `${files} files`} it changed ${files === 1 ? "was" : "were"} discarded. Link one and start again to keep the work.`;
type ClaimLike = Pick<ClaimEntity, "state" | "waitingThreadIds">;

// Where a session (and the claim it works for, when there is one) stands.
// `decider` is the person who answers the agent (the agent's owner or who
// started the session): with it, waiting reads "Waiting on Ada".
export function sessionState(
  session: SessionLike | null | undefined,
  options: {
    claim?: ClaimLike | null;
    decider?: string | null;
    // Queued, and no online runner may take it (`waitsForRunner`).
    noRunner?: boolean;
  } = {},
): SessionState {
  const { claim, decider, noRunner } = options;
  const waitingOn = decider ? `Waiting on ${firstName(decider)}` : null;
  if (session?.status === "queued" && noRunner)
    return {
      label: "No runner",
      tone: "attention",
      glyph: "queued",
      meaning: noRunnerMeaning,
      active: true,
      needsPerson: false,
    };
  if (session && workNotKept(session))
    return {
      label: "Work not kept",
      tone: "attention",
      glyph: "unkept",
      meaning: notKeptMeaning(session.discardedFiles!),
      active: false,
      needsPerson: false,
    };
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
