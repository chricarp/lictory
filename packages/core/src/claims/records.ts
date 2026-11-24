import { and, eq, inArray } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { liveClaimStates } from "@lictory/core/claims/contracts";
import { claimPorts } from "@lictory/core/claims/ports";
import { claim as claimMachine } from "@lictory/core/contracts/state-machines";
import { requireStep } from "@lictory/core/domain/errors";
import { writeEntities } from "@lictory/core/domain/projections";
import { serialize, type Tx } from "@lictory/core/domain/service";
import { queueClaimEvent } from "@lictory/core/agent-events/producers";

// Shared writes of the claims module: every claim state change goes through
// `endClaim` or the writers in service.ts, which take the step from the
// declared machine (contracts/state-machines.ts) before writing.

// How long a lease lasts without renewal. A starting claim (the dispatcher
// is launching its session) gets less: a launch that never reports back
// frees the item soon.
export const CLAIM_LEASE_MS = 15 * 60_000;
export const STARTING_LEASE_MS = 10 * 60_000;

export type ClaimRow = typeof s.workItemClaim.$inferSelect;

export async function liveClaimOf(
  tx: Tx,
  organizationId: string,
  workItemId: string,
): Promise<ClaimRow | undefined> {
  const [row] = await tx
    .select()
    .from(s.workItemClaim)
    .where(
      and(
        eq(s.workItemClaim.organizationId, organizationId),
        eq(s.workItemClaim.workItemId, workItemId),
        inArray(s.workItemClaim.state, [...liveClaimStates]),
      ),
    );
  return row;
}

// Ends a live claim (released or completed) and tells its session.
export async function endClaim(
  tx: Tx,
  claim: ClaimRow,
  end: {
    state: "released" | "completed";
    reason: string;
    note?: string | null;
    byId: string | null;
    now: Date;
    deliveredRevisionId?: string | null;
  },
) {
  requireStep(
    claimMachine,
    claim.state,
    end.state === "completed"
      ? "complete"
      : end.reason === "expired"
        ? "expire"
        : "release",
  );
  await tx
    .update(s.workItemClaim)
    .set({
      state: end.state,
      endedAt: end.now,
      endedById: end.byId,
      endReason: end.reason,
      endNote: end.note?.trim() ? end.note.trim().slice(0, 2000) : null,
      deliveredRevisionId: end.deliveredRevisionId ?? null,
    })
    .where(
      and(
        eq(s.workItemClaim.organizationId, claim.organizationId),
        eq(s.workItemClaim.id, claim.id),
      ),
    );
  if (end.state === "completed")
    await tx
      .delete(s.dispatchBackoff)
      .where(
        and(
          eq(s.dispatchBackoff.organizationId, claim.organizationId),
          eq(s.dispatchBackoff.workItemId, claim.workItemId),
        ),
      );
  await queueClaimEvent(tx, claim, {
    kind: "claim_released",
    state: end.state,
    reason: end.reason,
    byId: end.byId,
  });
  await claimPorts().resumer.resume(tx, {
    kind: "claim_ended",
    organizationId: claim.organizationId,
    claimId: claim.id,
    agentSessionId: claim.agentSessionId,
    workItemId: claim.workItemId,
    state: end.state,
    reason: end.reason,
  });
}

// Appends activity to an item's history and projects it in the item's
// scope, for writes outside `applyMutation`'s own activity log.
export async function recordActivity(
  tx: Tx,
  entry: {
    organizationId: string;
    projectId: string;
    workItemId: string;
    actorId: string;
    action: string;
    detail: Record<string, unknown>;
    at: Date;
  },
) {
  const [row] = await tx
    .insert(s.activity)
    .values({
      id: crypto.randomUUID(),
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      workItemId: entry.workItemId,
      actorId: entry.actorId,
      action: entry.action,
      detail: entry.detail,
      createdAt: entry.at,
    })
    .returning();
  await writeEntities(tx, entry.organizationId, [
    {
      entity: serialize("activity", row),
      scope: { projectId: entry.projectId, workItemId: entry.workItemId },
    },
  ]);
}

// What every claim activity names: the claim and the agent, as history
// shows it ("Forge via Ada").
export const claimDetail = (claim: ClaimRow) => ({
  claimId: claim.id,
  agentId: claim.agentId,
  agentName: claim.agentName,
  agentSessionId: claim.agentSessionId,
  source: claim.source,
});
