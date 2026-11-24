import type {
  ClaimEntity,
  DoneCheckResult,
  DoneEvaluationEntity,
} from "@lictory/core/claims/contracts";
import type { StatusTone } from "@lictory/ui/status-chip";
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

// The pull request part of an item's delivery status strip, from its
// Definition of Done evaluation: the open pull request (else the merged
// one) and its checks in the code host's words. Checks still running are
// not failing: only a check the code host reported as failed reads
// "checks failing".
export function pullRequestStripPart(
  evaluation: Pick<DoneEvaluationEntity, "code"> | undefined,
): { label: string; tone: StatusTone; title: string } | null {
  const pulls = evaluation?.code.pullRequests ?? [];
  const pull =
    pulls.find((p) => p.state === "open") ??
    pulls.find((p) => p.state === "merged");
  if (!pull) return null;
  if (pull.state === "merged")
    return { label: "PR merged", tone: "success", title: pull.title };
  switch (pull.checks) {
    case "failing":
      return {
        label: "PR open · checks failing",
        tone: "danger",
        title: pull.title,
      };
    case "pending":
      return {
        label: "PR open · checks running",
        tone: "info",
        title: pull.title,
      };
    case "passing":
      return {
        label: "PR open · checks pass",
        tone: "info",
        title: pull.title,
      };
    default:
      return { label: "PR open", tone: "info", title: pull.title };
  }
}

// How a Definition of Done check is drawn: passed, open, or passed with
// nothing to check. The CI check passes when the code host reports no
// required checks on the pull requests it looks at (the merged ones once
// any merged, else the open ones); a green tick would read as "CI ran and
// passed", so that case gets its own neutral glyph. A check a person passed
// by hand is passed.
export type DoneCheckGlyph = "passed" | "no_checks" | "open";

export function doneCheckGlyph(
  check: Pick<DoneCheckResult, "kind" | "passed" | "override">,
  evaluation: Pick<DoneEvaluationEntity, "code"> | undefined,
): DoneCheckGlyph {
  if (!check.passed) return "open";
  if (check.kind !== "checks_passed" || check.override) return "passed";
  const pulls = (evaluation?.code.pullRequests ?? []).filter(
    (p) => p.state !== "closed",
  );
  const merged = pulls.filter((p) => p.state === "merged");
  const looked = merged.length ? merged : pulls;
  return looked.length > 0 && looked.every((p) => p.checks === "none")
    ? "no_checks"
    : "passed";
}
