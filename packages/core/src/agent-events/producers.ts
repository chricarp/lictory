import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import { queueNotifications } from "@lictory/core/notifications/events";

// Agent-only notices (agent-events/catalog.ts): what an agent is woken for
// that no inbox shows. They go through the notification queue like every
// notice, so the fan-out applies the same recipient and access rules and an
// event exists exactly when its change committed.

type ClaimRow = typeof s.workItemClaim.$inferSelect;

async function itemContext(tx: Tx, organizationId: string, workItemId: string) {
  const [item] = await tx
    .select({
      number: s.workItem.number,
      title: s.workItem.title,
      teamId: s.workItem.teamId,
      key: s.project.key,
    })
    .from(s.workItem)
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.workItem.organizationId),
        eq(s.project.id, s.workItem.projectId),
      ),
    )
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.id, workItemId),
      ),
    );
  return item;
}

// A claim ended (released by a person, expired, completed, canceled with
// its item) or one of its questions was resolved: its agent is told
// through its accountable person, unless the agent itself did it.
export async function queueClaimEvent(
  tx: Tx,
  claim: ClaimRow,
  event:
    | {
        kind: "claim_released";
        state: "released" | "completed";
        reason: string;
        byId: string | null;
      }
    | { kind: "claim_question_resolved"; threadId: string; byId: string },
) {
  const item = await itemContext(tx, claim.organizationId, claim.workItemId);
  await queueNotifications(tx, claim.organizationId, [
    {
      userIds: [claim.ownerId],
      kind: event.kind,
      actorId: event.byId,
      // The holder releasing its own claim is not woken by it.
      actorAgentId:
        event.kind === "claim_released" && event.reason === "agent"
          ? claim.agentId
          : null,
      agentId: claim.agentId,
      projectId: claim.projectId,
      teamId: item?.teamId ?? null,
      workItemId: claim.workItemId,
      detail: {
        claimId: claim.id,
        agentName: claim.agentName,
        sessionId: claim.agentSessionId,
        ...(item
          ? { itemKey: `${item.key}-${item.number}`, title: item.title }
          : {}),
        ...(event.kind === "claim_released"
          ? { state: event.state, reason: event.reason }
          : { threadId: event.threadId }),
      },
      dedupeKey:
        event.kind === "claim_released"
          ? `claim-ended:${claim.id}`
          : `claim-question:${event.threadId}`,
    },
  ]);
}

// For the Code module (S3): call inside the transaction that records a code
// host pull request change, with the people it concerns (its author, the
// accountable people of linked items). Code pull requests have no inbox
// notification yet; when they get one, map its kind in the catalog instead.
export async function queueCodePullRequestEvent(
  tx: Tx,
  input: {
    organizationId: string;
    kind:
      | "code_pull_request_decided"
      | "code_pull_request_merged"
      | "code_pull_request_unmergeable";
    userIds: string[];
    // The person whose action caused it, if Lictory knows one.
    actorId: string | null;
    projectId: string | null;
    workItemId?: string | null;
    // Identifiers and the title only (agent-events/catalog.ts drops
    // anything else): codePullRequestId, repositoryId, number, title as
    // pullRequestTitle, provider, decision, reason, itemKey.
    detail: Record<string, string | number | boolean | null>;
    // Stable per change (`<pull request>:<head sha>:<kind>`).
    dedupeKey: string;
  },
) {
  await queueNotifications(tx, input.organizationId, [
    {
      userIds: input.userIds,
      kind: input.kind,
      actorId: input.actorId,
      projectId: input.projectId,
      workItemId: input.workItemId ?? null,
      detail: input.detail,
      dedupeKey: input.dedupeKey,
    },
  ]);
}
