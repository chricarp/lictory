import { and, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { followDefinitionOfDone } from "@lictory/core/claims/service";
import type { Tx } from "@lictory/core/domain/service";

// Evidence moved: pull requests, reviews or checks of linked work changed
// in this transaction (ingest, reconciliation, the outbox recording a
// host's answer, a review recorded in Lictory). The Definition of Done of
// the items they are linked to follows in the same transaction, reading
// only Lictory's rows (docs/internals/claims.md#definition-of-done): passing
// items move to Done, Autopilot requests merges.
//
// A failure is logged and rolled back to a savepoint, never the caller's
// work: the mirror must stay correct even when an item cannot move, and the
// dispatcher evaluates claimed work again on its next run.
export async function followCodeEvidence(
  tx: Tx,
  organizationId: string,
  touched: {
    pullRequestIds: ReadonlySet<string>;
    workItemIds: ReadonlySet<string>;
  },
) {
  const items = new Set(touched.workItemIds);
  const pullRequestIds = [...touched.pullRequestIds];
  if (pullRequestIds.length) {
    const links = await tx
      .select({ workItemId: s.codeWorkLink.workItemId })
      .from(s.codeWorkLink)
      .where(
        and(
          eq(s.codeWorkLink.organizationId, organizationId),
          eq(s.codeWorkLink.target, "pull_request"),
          inArray(s.codeWorkLink.targetId, pullRequestIds),
          isNull(s.codeWorkLink.unlinkedAt),
        ),
      );
    for (const link of links) items.add(link.workItemId);
  }
  if (!items.size) return null;
  try {
    return await tx.transaction((inner) =>
      followDefinitionOfDone(inner, organizationId, [...items]),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "code.definition_of_done_follow_failed",
        organizationId,
        workItems: items.size,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}
