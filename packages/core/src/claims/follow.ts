import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  claimDetail,
  endClaim,
  liveClaimOf,
} from "@lictory/core/claims/records";
import { DomainError } from "@lictory/core/domain/errors";
import type { Tx } from "@lictory/core/domain/service";

// Hooks `applyMutation` calls for every item command: a claim follows its
// item, whoever moved it (docs/internals/claims.md#claims-follow-their-item).

// Claimed work reaches Done through its Definition of Done, never because an
// agent reports it finished.
export async function refuseClaimedCompletion(
  tx: Tx,
  organizationId: string,
  workItemId: string,
  key: string,
) {
  const claim = await liveClaimOf(tx, organizationId, workItemId);
  if (claim)
    throw new DomainError(
      "validation",
      `${key} is claimed by ${claim.agentName}. Claimed work moves to Done when its Definition of Done passes (merged pull request, passing checks, sign-offs), never on an agent's report. Use reportProgress to tell people where it stands.`,
      undefined,
      "evidence_required",
    );
}

// Ends the item's live claim when the item left the claim's reach: Done
// completes it; canceling, archiving or moving it out of a started status
// releases it. Returns the activity to record on the item.
export async function followItemClaim(
  tx: Tx,
  input: {
    organizationId: string;
    workItemId: string;
    userId: string;
    now: Date;
    automation: string | null;
  },
): Promise<{ action: string; detail: Record<string, unknown> }[]> {
  const claim = await liveClaimOf(tx, input.organizationId, input.workItemId);
  if (!claim) return [];
  const [item] = await tx
    .select({
      archivedAt: s.workItem.archivedAt,
      deliveredRevisionId: s.workItem.deliveredRevisionId,
      category: s.workflowStatus.category,
    })
    .from(s.workItem)
    .innerJoin(
      s.workflowStatus,
      and(
        eq(s.workflowStatus.organizationId, s.workItem.organizationId),
        eq(s.workflowStatus.id, s.workItem.statusId),
      ),
    )
    .where(
      and(
        eq(s.workItem.organizationId, input.organizationId),
        eq(s.workItem.id, input.workItemId),
      ),
    );
  if (!item) return [];
  const end: { state: "released" | "completed"; reason: string } | undefined =
    item.archivedAt
      ? { state: "released", reason: "item_archived" }
      : item.category === "done"
        ? {
            state: "completed",
            reason:
              input.automation === "definition_of_done"
                ? "definition_of_done"
                : "moved_to_done",
          }
        : item.category === "canceled"
          ? { state: "released", reason: "item_canceled" }
          : claim.startedStatusId && item.category !== "started"
            ? { state: "released", reason: "item_moved" }
            : undefined;
  if (!end) return [];
  await endClaim(tx, claim, {
    ...end,
    byId: input.userId,
    now: input.now,
    deliveredRevisionId:
      end.state === "completed" ? item.deliveredRevisionId : null,
  });
  return [
    {
      action: end.state === "completed" ? "claim_completed" : "claim_released",
      detail: { ...claimDetail(claim), reason: end.reason },
    },
  ];
}
