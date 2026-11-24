import { and, eq, inArray, lt } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { claim as claimMachine } from "@lictory/core/contracts/state-machines";
import { claimOrganizationEntities } from "@lictory/core/claims/projections";
import {
  CLAIM_LEASE_MS,
  claimDetail,
  endClaim,
  recordActivity,
  type ClaimRow,
} from "@lictory/core/claims/records";
import {
  derivedMutationId,
  projectClaims,
  recordDispatchFailure,
  returnItem,
} from "@lictory/core/claims/service";
import { requireStep } from "@lictory/core/domain/errors";
import {
  lock,
  organizationDirectory,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { signalWork } from "@lictory/core/jobs/signal";

// A claim follows the agent session working under it
// (docs/internals/claims.md#claims-follow-their-session): while the runner
// renews the session's lease the claim stays held, and when the session
// ends the claim is released (failed, canceled) or kept for the Definition
// of Done (completed). The Factory calls these after its own writes
// committed: claims take the exclusive organization lock, which the
// Factory's shared-lock writes never upgrade to.

// A completed session's work waits for evidence (a pull request reviewed and
// merged, checks, sign-offs). The claim holds the item that long before its
// lease ends; a person releases it sooner when the work is abandoned.
export const DELIVERY_HOLD_MS = 7 * 24 * 60 * 60_000;

// Renewed at most this often: heartbeats come every few seconds, the lease
// lasts fifteen minutes.
const RENEW_WHEN_LEFT_MS = CLAIM_LEASE_MS - 5 * 60_000;

const sessionClaims = (
  db: Database,
  organizationId: string,
  sessionIds: string[],
) =>
  db
    .select()
    .from(s.workItemClaim)
    .where(
      and(
        eq(s.workItemClaim.organizationId, organizationId),
        inArray(s.workItemClaim.agentSessionId, sessionIds),
        inArray(s.workItemClaim.state, ["starting", "active", "waiting"]),
      ),
    );

/** Renews the claims held by these sessions (their runner renewed them). */
export async function renewSessionClaims(
  db: Database,
  organizationId: string,
  sessionIds: string[],
  now = new Date(),
) {
  if (!sessionIds.length) return 0;
  // Cheap check outside the lock: most heartbeats renew nothing.
  const due = (await sessionClaims(db, organizationId, sessionIds)).filter(
    (c) =>
      c.state === "active" &&
      c.leaseExpiresAt.getTime() - now.getTime() < RENEW_WHEN_LEFT_MS,
  );
  if (!due.length) return 0;
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    let renewed = 0;
    for (const claim of due) requireStep(claimMachine, claim.state, "renew");
    for (const projectId of new Set(due.map((c) => c.projectId))) {
      const before = await claimOrganizationEntities(
        tx,
        organizationId,
        projectId,
      );
      const rows = await tx
        .update(s.workItemClaim)
        .set({ leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS) })
        .where(
          and(
            eq(s.workItemClaim.organizationId, organizationId),
            eq(s.workItemClaim.projectId, projectId),
            inArray(
              s.workItemClaim.id,
              due.filter((c) => c.projectId === projectId).map((c) => c.id),
            ),
            eq(s.workItemClaim.state, "active"),
            // A claim whose lease already ran out waits for the sweep.
            lt(
              s.workItemClaim.leaseExpiresAt,
              new Date(now.getTime() + RENEW_WHEN_LEFT_MS),
            ),
          ),
        )
        .returning({ id: s.workItemClaim.id });
      renewed += rows.length;
      await projectClaims(tx, organizationId, projectId, before);
    }
    return renewed;
  });
}

/**
 * The session a claim works under started or stopped waiting on a person
 * (an approval request). The claim carries it (`sessionWaitingSince`), so
 * the queue, the item and the board say "waiting on a person", never
 * "working", while the agent is blocked. Reads the session's status under
 * the lock rather than trusting the caller's, so status changes published
 * out of order settle on the truth. Idempotent.
 */
export async function followSessionWaiting(
  db: Database,
  organizationId: string,
  sessionId: string,
  now = new Date(),
) {
  const session = async (tx: Database | Tx) =>
    (
      await tx
        .select({ status: s.agentSession.status })
        .from(s.agentSession)
        .where(
          and(
            eq(s.agentSession.organizationId, organizationId),
            eq(s.agentSession.id, sessionId),
          ),
        )
    )[0];
  const differs = (claim: ClaimRow, waiting: boolean) =>
    (claim.sessionWaitingSince !== null) !== waiting;
  // Cheap check outside the lock: most status changes change no claim.
  const current = await session(db);
  if (!current) return 0;
  const stale = (await sessionClaims(db, organizationId, [sessionId])).filter(
    (c) => differs(c, current.status === "waiting"),
  );
  if (!stale.length) return 0;
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const status = (await session(tx))?.status;
    const waiting = status === "waiting";
    const claims = (
      await tx
        .select()
        .from(s.workItemClaim)
        .where(
          and(
            eq(s.workItemClaim.organizationId, organizationId),
            eq(s.workItemClaim.agentSessionId, sessionId),
            inArray(s.workItemClaim.state, ["starting", "active", "waiting"]),
          ),
        )
    ).filter((c) => differs(c, waiting));
    for (const projectId of new Set(claims.map((c) => c.projectId))) {
      const before = await claimOrganizationEntities(
        tx,
        organizationId,
        projectId,
      );
      await tx
        .update(s.workItemClaim)
        .set({ sessionWaitingSince: waiting ? now : null })
        .where(
          and(
            eq(s.workItemClaim.organizationId, organizationId),
            inArray(
              s.workItemClaim.id,
              claims.filter((c) => c.projectId === projectId).map((c) => c.id),
            ),
          ),
        );
      await projectClaims(tx, organizationId, projectId, before);
    }
    return claims.length;
  });
}

export type SessionEnd = {
  organizationId: string;
  sessionId: string;
  status: "completed" | "failed" | "canceled";
  // Why it failed, or the agent's summary.
  detail: string | null;
};

/**
 * The session a claim works under ended. Failed or canceled: the claim is
 * released and the item returns to where it was (a dispatcher claim backs
 * off; a person's cancel holds it until someone retries). Completed: the
 * claim is kept, its lease extended to the delivery hold, until the
 * Definition of Done moves the item to Done. Idempotent: a claim that
 * already ended, or a completion already recorded, changes nothing.
 */
export async function followSessionEnd(
  db: Database,
  end: SessionEnd,
  now = new Date(),
) {
  const { organizationId } = end;
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const claims = await tx
      .select()
      .from(s.workItemClaim)
      .where(
        and(
          eq(s.workItemClaim.organizationId, organizationId),
          eq(s.workItemClaim.agentSessionId, end.sessionId),
          inArray(s.workItemClaim.state, ["starting", "active", "waiting"]),
        ),
      );
    if (!claims.length) return [];
    const roster = await organizationDirectory(tx, organizationId);
    const outcomes: { claimId: string; outcome: "released" | "held" }[] = [];
    for (const claim of claims) {
      const before = await claimOrganizationEntities(
        tx,
        organizationId,
        claim.projectId,
      );
      if (end.status === "completed")
        outcomes.push({
          claimId: claim.id,
          outcome: await holdForDelivery(tx, claim, end, now),
        });
      else {
        await releaseForSession(tx, claim, end, roster, now);
        outcomes.push({ claimId: claim.id, outcome: "released" });
      }
      await projectClaims(tx, organizationId, claim.projectId, before);
    }
    await signalWork(tx, "factory");
    return outcomes;
  });
}

async function holdForDelivery(
  tx: Tx,
  claim: ClaimRow,
  end: SessionEnd,
  now: Date,
): Promise<"held"> {
  const holdUntil = new Date(now.getTime() + DELIVERY_HOLD_MS);
  // Already held (a replayed completion): nothing to record.
  if (claim.leaseExpiresAt.getTime() >= holdUntil.getTime() - 60 * 60_000)
    return "held";
  requireStep(claimMachine, claim.state, "renew");
  const note = `The session completed; the claim holds the item until its Definition of Done passes${end.detail ? `: ${end.detail.slice(0, 300)}` : "."}`;
  await tx
    .update(s.workItemClaim)
    .set({
      leaseExpiresAt: holdUntil,
      lastProgress: note,
      lastProgressAt: now,
      sessionWaitingSince: null,
    })
    .where(
      and(
        eq(s.workItemClaim.organizationId, claim.organizationId),
        eq(s.workItemClaim.id, claim.id),
      ),
    );
  await recordActivity(tx, {
    organizationId: claim.organizationId,
    projectId: claim.projectId,
    workItemId: claim.workItemId,
    actorId: claim.ownerId,
    action: "claim_progress",
    detail: {
      ...claimDetail(claim),
      note,
      automation: "agent_session",
      performedVia: "runner",
    },
    at: now,
  });
  return "held";
}

async function releaseForSession(
  tx: Tx,
  claim: ClaimRow,
  end: SessionEnd,
  roster: Awaited<ReturnType<typeof organizationDirectory>>,
  now: Date,
) {
  const reason =
    end.status === "failed" ? "session_failed" : "session_canceled";
  const note = end.detail?.slice(0, 2000) ?? null;
  await endClaim(tx, claim, {
    state: "released",
    reason,
    note,
    byId: null,
    now,
  });
  const returned = await returnItem(
    tx,
    claim,
    { userId: claim.ownerId, automation: "agent_session" },
    roster,
    derivedMutationId(claim.id, "session-ended"),
  );
  // A failed session is a failed attempt; a canceled one was a person's
  // call, so the dispatcher waits for someone to retry.
  if (claim.source === "dispatcher")
    await recordDispatchFailure(
      tx,
      claim.organizationId,
      claim.workItemId,
      end.status === "failed"
        ? `${claim.agentName}'s session failed${note ? `: ${note}` : "."}`
        : `${claim.agentName}'s session was canceled. Retry to dispatch it again.`,
      now,
      { hold: end.status === "canceled" },
    );
  await recordActivity(tx, {
    organizationId: claim.organizationId,
    projectId: claim.projectId,
    workItemId: claim.workItemId,
    actorId: claim.ownerId,
    action: "claim_released",
    detail: {
      ...claimDetail(claim),
      reason,
      note,
      automation: "agent_session",
      returnedTo: returned.returnedTo,
      ...(returned.note ? { returnNote: returned.note } : {}),
    },
    at: now,
  });
}
