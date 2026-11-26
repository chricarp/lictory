import type {
  ClaimEntity,
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

// A lease's time left in the unit people read it in: "15 min", "3 h",
// "7 days" (a completed session's delivery hold), never "10080 min".
export function leaseLeftLabel(
  claim: Pick<ClaimEntity, "leaseExpiresAt">,
  now = Date.now(),
) {
  const minutes = Math.max(
    Math.round((new Date(claim.leaseExpiresAt).getTime() - now) / 60_000),
    0,
  );
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
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

// The evidence a Done item was delivered on: the Definition of Done record
// that moved it to Done, when its latest move into Done was that one. Its
// live evaluation leaves the projection at Done, so the item and its pull
// requests show this record instead (docs/internals/claims.md#definition-of-done).
export type DeliveredEvidence = {
  at: string;
  checks: {
    key: string;
    label: string;
    overridden: boolean;
    detail?: string;
  }[];
  pullRequests: {
    title: string;
    url: string | null;
    state: "open" | "merged" | "closed";
    headSha: string | null;
  }[];
};

type ActivityLike = {
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

export function deliveredEvidence(
  activity: readonly ActivityLike[],
): DeliveredEvidence | undefined {
  // The record is written just before the move it causes, at the same
  // time or earlier.
  const ordered = activity
    .filter(
      (a) =>
        a.action === "definition_of_done_passed" ||
        a.action === "status_changed",
    )
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        (a.action === "definition_of_done_passed" ? -1 : 1) -
          (b.action === "definition_of_done_passed" ? -1 : 1),
    );
  let pending: ActivityLike | undefined;
  let delivered: ActivityLike | undefined;
  for (const a of ordered) {
    if (a.action === "definition_of_done_passed") pending = a;
    else {
      delivered = a.detail?.category === "done" ? pending : undefined;
      pending = undefined;
    }
  }
  if (!delivered) return undefined;
  const d = delivered.detail ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    at: delivered.createdAt,
    checks: list(d.checks).flatMap((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      const label = text(c.label);
      return label
        ? [
            {
              key: text(c.key) ?? label,
              label,
              overridden: c.overridden === true,
              ...(text(c.detail) ? { detail: text(c.detail) } : {}),
            },
          ]
        : [];
    }),
    pullRequests: list(d.pullRequests).flatMap((raw) => {
      const p = (raw ?? {}) as Record<string, unknown>;
      const title = text(p.title);
      const state = text(p.state);
      return title &&
        (state === "open" || state === "merged" || state === "closed")
        ? [
            {
              title,
              url: text(p.url) ?? null,
              state,
              headSha: text(p.headSha) ?? null,
            },
          ]
        : [];
    }),
  };
}
