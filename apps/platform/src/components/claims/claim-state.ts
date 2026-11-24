import type { ClaimEntity } from "@lictory/core/claims/contracts";
import {
  firstName,
  sessionState,
  type SessionState,
} from "@lictory/platform/lib/session-state";

// Where a live claim stands, in the one vocabulary of `sessionState`: the
// board's badge, the queue and the item's claim panel all read it here, so
// the same claim never says "Working" in one place and "Waiting" in another.

// What a live claim shows, as a stable token for tests and styling. Its own
// state, except that a claim whose agent session waits on a person's answer
// (an approval request) waits too: the agent is blocked, not working.
export type ClaimShownState = ClaimEntity["state"] | "session_waiting";

type ClaimFacts = Pick<
  ClaimEntity,
  "state" | "waitingThreadIds" | "sessionWaitingSince"
>;

export function claimShownState(claim: ClaimFacts): ClaimShownState {
  return claim.state !== "waiting" && claim.sessionWaitingSince
    ? "session_waiting"
    : claim.state;
}

export const claimWaitsOnPeople = (claim: ClaimFacts) =>
  claim.state === "waiting" ||
  claim.waitingThreadIds.length > 0 ||
  Boolean(claim.sessionWaitingSince);

// The claim's state. `decider` is the person who answers the agent's
// session (its owner): a session waiting on an approval reads "Waiting on
// Ada". Questions on the specification wait on whoever resolves them, so
// they read "Waiting on people".
export function claimState(
  claim: ClaimFacts,
  decider?: string | null,
): SessionState {
  if (claim.state !== "waiting" && claim.sessionWaitingSince)
    return sessionState({ status: "waiting" }, { claim, decider });
  return sessionState(null, { claim });
}

// The claim as one compact phrase, for badges: "Forge · waiting on Ada".
export function claimBadgeLabel(
  claim: ClaimFacts & Pick<ClaimEntity, "agentName">,
  decider?: string | null,
) {
  const { label } = claimState(claim, decider);
  return `${claim.agentName} · ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

// Whose work it is when an agent holds an item assigned to someone else:
// "for Ben". Nothing when the item is unassigned or assigned to the agent's
// owner (the owner line already names them).
export function claimFor(
  claim: Pick<ClaimEntity, "ownerId">,
  assigneeId: string | null | undefined,
  assigneeName: (id: string) => string,
) {
  return assigneeId && assigneeId !== claim.ownerId
    ? `for ${firstName(assigneeName(assigneeId))}`
    : null;
}
