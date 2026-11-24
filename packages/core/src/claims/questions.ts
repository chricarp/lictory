import { and, count, eq, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { claim as claimMachine } from "@lictory/core/contracts/state-machines";
import { claimPorts } from "@lictory/core/claims/ports";
import {
  CLAIM_LEASE_MS,
  claimDetail,
  recordActivity,
} from "@lictory/core/claims/records";
import { requireStep } from "@lictory/core/domain/errors";
import type { Tx } from "@lictory/core/domain/service";
import { queueClaimEvent } from "@lictory/core/agent-events/producers";

// The hook `applyMutation` calls when a discussion is resolved: when it was
// an agent's question, the claim that asked resumes once every question it
// asked is resolved, and its session is told (SessionResumer). Resolving is
// a person's decision; the specification itself never changes here.
export async function claimQuestionResolved(
  tx: Tx,
  input: {
    organizationId: string;
    threadId: string;
    userId: string;
    now: Date;
  },
) {
  const { organizationId, threadId, userId, now } = input;
  const [question] = await tx
    .update(s.claimQuestion)
    .set({ resolvedAt: now, resolvedById: userId })
    .where(
      and(
        eq(s.claimQuestion.organizationId, organizationId),
        eq(s.claimQuestion.threadId, threadId),
        isNull(s.claimQuestion.resolvedAt),
      ),
    )
    .returning();
  if (!question) return;
  const [claim] = await tx
    .select()
    .from(s.workItemClaim)
    .where(
      and(
        eq(s.workItemClaim.organizationId, organizationId),
        eq(s.workItemClaim.id, question.claimId),
      ),
    );
  if (!claim) return;
  const [open] = await tx
    .select({ n: count() })
    .from(s.claimQuestion)
    .where(
      and(
        eq(s.claimQuestion.organizationId, organizationId),
        eq(s.claimQuestion.claimId, claim.id),
        isNull(s.claimQuestion.resolvedAt),
      ),
    );
  const resumed = claim.state === "waiting" && Number(open?.n ?? 0) === 0;
  if (resumed) {
    requireStep(claimMachine, claim.state, "resume");
    await tx
      .update(s.workItemClaim)
      .set({
        state: "active",
        leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
      })
      .where(
        and(
          eq(s.workItemClaim.organizationId, organizationId),
          eq(s.workItemClaim.id, claim.id),
        ),
      );
  }
  await recordActivity(tx, {
    organizationId,
    projectId: claim.projectId,
    workItemId: claim.workItemId,
    actorId: userId,
    action: "claim_question_resolved",
    detail: {
      ...claimDetail(claim),
      threadId,
      questionItemId: question.workItemId,
      resumed,
    },
    at: now,
  });
  await queueClaimEvent(tx, claim, {
    kind: "claim_question_resolved",
    threadId,
    byId: userId,
  });
  await claimPorts().resumer.resume(tx, {
    kind: "question_resolved",
    organizationId,
    claimId: claim.id,
    agentSessionId: claim.agentSessionId,
    workItemId: claim.workItemId,
    threadId,
    resolvedById: userId,
    resumed,
  });
}
