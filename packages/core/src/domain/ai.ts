import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { signalWork } from "@lictory/core/jobs/signal";
import * as s from "@lictory/core/db/schema";
import {
  AI_ACTOR_ID,
  applyAiEdit,
  type AiActionPolicy,
} from "@lictory/core/contracts/ai";
import {
  entitySchema,
  noCapabilities,
  type Capabilities,
  type Command,
  type Directory,
  type Entity,
  type EntityOf,
} from "@lictory/core/contracts/protocol";
import { applyBranchCommand, ensureMain } from "@lictory/core/domain/branches";
import { DomainError } from "@lictory/core/domain/errors";
import type { Database, Tx } from "@lictory/core/domain/service";

// Commands that ask Lictory Intelligence for something. They only record
// requests or apply results a human explicitly chose; the model never runs
// inside the organization transaction.
export const aiCommands = new Set([
  "requestAiReview",
  "rerunAiAction",
  "createAiCorrectivePr",
  "applyAiSuggestion",
]);
const activeStatuses = ["queued", "running"] as const;
type RunRow = typeof s.aiRun.$inferSelect;

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
export async function aiPolicy(
  db: Database | Tx,
  organizationId: string,
): Promise<Directory["ai"]> {
  const [row] = await db
    .select({ enabled: s.organizationAiPolicy.enabled })
    .from(s.organizationAiPolicy)
    .where(eq(s.organizationAiPolicy.organizationId, organizationId));
  return { enabled: row?.enabled ?? false, available: aiConfigured() };
}
export async function setAiPolicy(
  tx: Tx,
  organizationId: string,
  userId: string,
  enabled: boolean,
) {
  await tx
    .insert(s.organizationAiPolicy)
    .values({ organizationId, enabled, updatedById: userId })
    .onConflictDoUpdate({
      target: s.organizationAiPolicy.organizationId,
      set: { enabled, updatedById: userId, updatedAt: new Date() },
    });
}
export function requireAi(ai: Directory["ai"]) {
  if (!ai.available)
    throw new DomainError(
      "unavailable",
      "Lictory Intelligence is not configured on this server. Ask an administrator to set OPENAI_API_KEY.",
    );
  if (!ai.enabled)
    throw new DomainError(
      "forbidden",
      "Lictory Intelligence is turned off for this organization. An administrator can enable it in Settings → Lictory Intelligence.",
    );
}

export function aiRunEntity(row: RunRow): EntityOf<"aiRun"> {
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return entitySchema.parse({
    type: "aiRun",
    id: row.id,
    organizationId: row.organizationId,
    workItemId: row.workItemId,
    kind: row.kind,
    status: row.status,
    pullRequestId: row.pullRequestId,
    headCommitId: row.headCommitId,
    requestedById: row.requestedById,
    contextRevisions: row.contextRevisions,
    score: row.score,
    summary: row.summary,
    strengths: row.strengths,
    findings: row.findings,
    correctivePullRequests: row.correctivePullRequests,
    appliedFindingIds: row.appliedFindingIds,
    intelligenceContext: row.intelligenceContext,
    model: row.model,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    staleAt: iso(row.staleAt),
    staleReason: row.staleReason,
  }) as EntityOf<"aiRun">;
}
// Recent history only: older runs remain in the database for audit.
export async function aiRunEntities(
  tx: Tx,
  organizationId: string,
  workItemId: string,
) {
  const rows = await tx
    .select()
    .from(s.aiRun)
    .where(
      and(
        eq(s.aiRun.organizationId, organizationId),
        eq(s.aiRun.workItemId, workItemId),
      ),
    )
    .orderBy(desc(s.aiRun.createdAt))
    .limit(25);
  return rows.map(aiRunEntity);
}

async function runOf(tx: Tx, organizationId: string, runId: string) {
  const [row] = await tx
    .select()
    .from(s.aiRun)
    .where(
      and(eq(s.aiRun.organizationId, organizationId), eq(s.aiRun.id, runId)),
    );
  if (!row)
    throw new DomainError(
      "not_found",
      "This Lictory Intelligence run is unavailable.",
    );
  return row;
}

async function enqueueAction(
  tx: Tx,
  input: {
    organizationId: string;
    workItemId: string;
    pullRequestId: string;
    headCommitId: string;
    requestedById: string;
    runId?: string;
  },
) {
  // Only the newest head matters: older pending runs are superseded, not lost.
  await tx
    .update(s.aiRun)
    .set({ status: "superseded", completedAt: new Date() })
    .where(
      and(
        eq(s.aiRun.organizationId, input.organizationId),
        eq(s.aiRun.pullRequestId, input.pullRequestId),
        inArray(s.aiRun.status, [...activeStatuses]),
      ),
    );
  await tx.insert(s.aiRun).values({
    id: input.runId ?? crypto.randomUUID(),
    organizationId: input.organizationId,
    workItemId: input.workItemId,
    kind: "pr_action",
    pullRequestId: input.pullRequestId,
    headCommitId: input.headCommitId,
    requestedById: input.requestedById,
  });
  await signalWork(tx, "ai");
}

type Context = {
  organizationId: string;
  projectId: string;
  workItemId: string;
  userId: string;
  capabilities: Capabilities;
  roster: Directory;
  latest: EntityOf<"revision">;
  itemKey: string;
  log: (action: string, detail?: Record<string, unknown>) => void;
  // Runs owned by other items whose projection this command changed.
  touched: Set<string>;
};

export async function applyAiCommand(tx: Tx, c: Command, ctx: Context) {
  if (!aiCommands.has(c.type) || !("workItemId" in c)) return;
  const { organizationId, workItemId, userId, roster, latest, log } = ctx;
  const branch = (command: Command, actor: string) =>
    applyBranchCommand(tx, command, {
      organizationId,
      projectId: ctx.projectId,
      workItemId,
      userId: actor,
      capabilities: actor === userId ? ctx.capabilities : noCapabilities,
      roster,
      latest,
      // Lictory Intelligence commands never write main directly.
      revision: () => {
        throw new DomainError(
          "conflict",
          "Lictory Intelligence cannot change main.",
        );
      },
      materializeChildren: () => {
        throw new DomainError(
          "conflict",
          "Lictory Intelligence cannot accept a delivery breakdown.",
        );
      },
      inspectChildChange: () => {
        throw new DomainError(
          "conflict",
          "Lictory Intelligence cannot propose changes to existing children.",
        );
      },
      applyChildChanges: () => {
        throw new DomainError(
          "conflict",
          "Lictory Intelligence cannot accept a delivery breakdown.",
        );
      },
      log,
    });
  switch (c.type) {
    case "requestAiReview": {
      requireAi(roster.ai);
      if (
        !ctx.capabilities.requestReviews &&
        !ctx.capabilities.editSpecifications
      )
        throw new DomainError(
          "forbidden",
          "Your disciplines in this project cannot request reviews, including Lictory Intelligence reviews.",
        );
      const [active] = await tx
        .select({ id: s.aiRun.id })
        .from(s.aiRun)
        .where(
          and(
            eq(s.aiRun.organizationId, organizationId),
            eq(s.aiRun.workItemId, workItemId),
            eq(s.aiRun.kind, "item_review"),
            inArray(s.aiRun.status, [...activeStatuses]),
          ),
        );
      if (active)
        throw new DomainError(
          "conflict",
          "A Lictory Intelligence review of this item is already in progress.",
        );
      await tx.insert(s.aiRun).values({
        id: c.runId,
        organizationId,
        workItemId,
        kind: "item_review",
        requestedById: userId,
      });
      await signalWork(tx, "ai");
      log("ai_review_requested", { runId: c.runId });
      return;
    }
    case "rerunAiAction": {
      requireAi(roster.ai);
      const [pr] = await tx
        .select()
        .from(s.specificationPullRequest)
        .where(
          and(
            eq(s.specificationPullRequest.organizationId, organizationId),
            eq(s.specificationPullRequest.workItemId, workItemId),
            eq(s.specificationPullRequest.id, c.pullRequestId),
            isNull(s.specificationPullRequest.deletedAt),
          ),
        );
      if (!pr || pr.status === "merged")
        throw new DomainError(
          pr ? "conflict" : "not_found",
          "This pull request is not open for review.",
        );
      const [source] = await tx
        .select()
        .from(s.specificationBranch)
        .where(
          and(
            eq(s.specificationBranch.organizationId, organizationId),
            eq(s.specificationBranch.id, pr.sourceId),
          ),
        );
      await enqueueAction(tx, {
        organizationId,
        workItemId,
        pullRequestId: pr.id,
        headCommitId: source!.headId,
        requestedById: userId,
        runId: c.runId,
      });
      log("ai_action_requested", { pullRequestId: pr.id, runId: c.runId });
      return;
    }
    case "createAiCorrectivePr": {
      const run = await runOf(tx, organizationId, c.runId);
      if (run.kind !== "item_review" || run.status !== "completed")
        throw new DomainError(
          "conflict",
          "This Lictory Intelligence review has not completed.",
        );
      if (run.staleAt)
        throw new DomainError(
          "conflict",
          `This Lictory Intelligence review is outdated (${run.staleReason ?? "content changed"}). Run a new review first.`,
        );
      if (run.contextRevisions[workItemId] !== latest.id)
        throw new DomainError(
          "conflict",
          `${ctx.itemKey} changed after the review. Run a new review first.`,
        );
      if (run.correctivePullRequests[workItemId])
        throw new DomainError(
          "conflict",
          `A corrective pull request for ${ctx.itemKey} already exists for this review.`,
        );
      const chosen = c.findingIds.map((id) =>
        run.findings.find((f) => f.id === id),
      );
      if (chosen.some((f) => f?.workItemId !== workItemId || !f.edit))
        throw new DomainError(
          "validation",
          `Choose findings about ${ctx.itemKey} that propose a text change.`,
        );
      let content = latest.content;
      for (const f of chosen) {
        const next = applyAiEdit(content, f!.edit!);
        if (next === undefined)
          throw new DomainError(
            "conflict",
            `The text quoted by “${f!.title}” is no longer in ${ctx.itemKey}, or overlaps another chosen change. Deselect it and retry.`,
          );
        content = next;
      }
      if (content === latest.content)
        throw new DomainError(
          "validation",
          "The chosen findings change nothing.",
        );
      const main = await ensureMain(tx, organizationId, workItemId);
      const branchName = `ai/review-${run.id.slice(0, 8)}`;
      await branch(
        {
          type: "createBranch",
          workItemId,
          baseRevisionId: latest.id,
          branchId: c.branchId,
          name: branchName,
        },
        AI_ACTOR_ID,
      );
      await branch(
        {
          type: "commitBranch",
          workItemId,
          branchId: c.branchId,
          baseCommitId: main.headId,
          title: latest.title,
          content,
          message: `Apply ${chosen.length} Lictory Intelligence review ${chosen.length === 1 ? "finding" : "findings"}`,
        },
        AI_ACTOR_ID,
      );
      // The requester owns the follow-up: they can edit the branch and manage the PR.
      await branch(
        {
          type: "setBranchCollaborator",
          workItemId,
          branchId: c.branchId,
          userId,
          assigned: true,
        },
        AI_ACTOR_ID,
      );
      const requester =
        roster.members.find((m) => m.id === userId)?.name ?? "A team member";
      await branch(
        {
          type: "createPullRequest",
          workItemId,
          pullRequestId: c.pullRequestId,
          sourceId: c.branchId,
          targetId: main.id,
          title: `Resolve ${chosen.length} Lictory Intelligence review ${chosen.length === 1 ? "finding" : "findings"}`,
          description: correctiveDescription(
            requester,
            chosen.map((f) => f!),
          ),
          draft: false,
        },
        AI_ACTOR_ID,
      );
      await tx
        .update(s.aiRun)
        .set({
          correctivePullRequests: {
            ...run.correctivePullRequests,
            [workItemId]: c.pullRequestId,
          },
        })
        .where(eq(s.aiRun.id, run.id));
      if (run.workItemId !== workItemId) ctx.touched.add(run.id);
      log("ai_corrective_pr_created", {
        runId: run.id,
        pullRequestId: c.pullRequestId,
        findings: chosen.length,
      });
      return;
    }
    case "applyAiSuggestion": {
      const run = await runOf(tx, organizationId, c.runId);
      if (run.kind !== "pr_action" || run.workItemId !== workItemId)
        throw new DomainError(
          "not_found",
          "This Lictory Intelligence review run is unavailable.",
        );
      const finding = run.findings.find((f) => f.id === c.findingId);
      if (!finding)
        throw new DomainError("not_found", "This finding is unavailable.");
      if (!finding.edit)
        throw new DomainError("validation", "This finding proposes no change.");
      if (run.appliedFindingIds.includes(finding.id))
        throw new DomainError(
          "conflict",
          "This suggestion was already committed.",
        );
      const [pr] = await tx
        .select()
        .from(s.specificationPullRequest)
        .where(
          and(
            eq(s.specificationPullRequest.organizationId, organizationId),
            eq(s.specificationPullRequest.id, run.pullRequestId!),
            isNull(s.specificationPullRequest.deletedAt),
          ),
        );
      if (!pr || pr.status === "merged")
        throw new DomainError(
          "conflict",
          "This pull request is no longer open.",
        );
      const [source] = await tx
        .select()
        .from(s.specificationBranch)
        .where(
          and(
            eq(s.specificationBranch.organizationId, organizationId),
            eq(s.specificationBranch.id, pr.sourceId),
            isNull(s.specificationBranch.deletedAt),
          ),
        );
      if (!source)
        throw new DomainError("not_found", "The source branch was deleted.");
      const [head] = await tx
        .select()
        .from(s.specificationCommit)
        .where(
          and(
            eq(s.specificationCommit.organizationId, organizationId),
            eq(s.specificationCommit.id, source.headId),
          ),
        );
      const content = applyAiEdit(head!.content, finding.edit);
      if (content === undefined)
        throw new DomainError(
          "conflict",
          "The suggested text is no longer in the branch. Re-run the Lictory Intelligence review on the latest commit.",
        );
      // Committed by the person who accepted it, like a GitHub suggestion.
      await branch(
        {
          type: "commitBranch",
          workItemId,
          branchId: source.id,
          baseCommitId: source.headId,
          title: head!.title,
          content,
          message:
            `Apply Lictory Intelligence suggestion: ${finding.title}`.slice(
              0,
              500,
            ),
        },
        userId,
      );
      await tx
        .update(s.aiRun)
        .set({ appliedFindingIds: [...run.appliedFindingIds, finding.id] })
        .where(eq(s.aiRun.id, run.id));
      log("ai_suggestion_applied", {
        runId: run.id,
        pullRequestId: pr.id,
        findingId: finding.id,
      });
      return;
    }
  }
}

function correctiveDescription(
  requester: string,
  findings: RunRow["findings"],
) {
  return [
    `Lictory Intelligence proposes these changes from a review requested by ${requester}. Review them like any other change: nothing is merged without the required approvals.`,
    "",
    ...findings.flatMap((f) => [
      `### ${f.title}`,
      "",
      f.detail,
      ...(f.evidence.length ? ["", ...f.evidence.map((e) => `> ${e}`)] : []),
      "",
    ]),
  ]
    .join("\n")
    .slice(0, 10_000);
}

// The Lictory Intelligence review action runs when a pull request opens for
// review and on every new commit to its source branch. Drafts wait until they
// are marked ready.
export async function scheduleActionRuns(
  tx: Tx,
  input: {
    organizationId: string;
    workItemId: string;
    userId: string;
    before: Entity[];
    policy: AiActionPolicy;
    ai: Directory["ai"];
  },
) {
  const { organizationId, workItemId, before } = input;
  if (!input.ai.enabled || !input.ai.available || input.policy === "off")
    return;
  const prs = await tx
    .select()
    .from(s.specificationPullRequest)
    .where(
      and(
        eq(s.specificationPullRequest.organizationId, organizationId),
        eq(s.specificationPullRequest.workItemId, workItemId),
        eq(s.specificationPullRequest.status, "open"),
        isNull(s.specificationPullRequest.deletedAt),
      ),
    );
  if (!prs.length) return;
  const branches = await tx
    .select()
    .from(s.specificationBranch)
    .where(
      and(
        eq(s.specificationBranch.organizationId, organizationId),
        eq(s.specificationBranch.workItemId, workItemId),
        isNull(s.specificationBranch.deletedAt),
      ),
    );
  for (const pr of prs) {
    const source = branches.find((b) => b.id === pr.sourceId);
    if (!source) continue;
    const old = before.find(
      (e): e is EntityOf<"pullRequest"> =>
        e.type === "pullRequest" && e.id === pr.id,
    );
    const oldSource = before.find(
      (e): e is EntityOf<"specBranch"> =>
        e.type === "specBranch" && e.id === source.id,
    );
    if (old?.status === "open" && oldSource?.headId === source.headId) continue;
    await enqueueAction(tx, {
      organizationId,
      workItemId,
      pullRequestId: pr.id,
      headCommitId: source.headId,
      requestedById: input.userId,
    });
  }
}

// A new main revision of any analysed item makes item reviews outdated. They
// stay readable as history but can no longer produce corrective PRs.
export async function invalidateItemReviews(
  tx: Tx,
  organizationId: string,
  workItemId: string,
  reason: string,
) {
  return tx
    .update(s.aiRun)
    .set({ staleAt: new Date(), staleReason: reason })
    .where(
      and(
        eq(s.aiRun.organizationId, organizationId),
        eq(s.aiRun.kind, "item_review"),
        isNull(s.aiRun.staleAt),
        sql`jsonb_exists(${s.aiRun.contextRevisions}, ${workItemId})`,
      ),
    )
    .returning({ id: s.aiRun.id, workItemId: s.aiRun.workItemId });
}

// Merge gate for teams that require the Lictory Intelligence review action.
// Returns the blocking reason, or undefined when the latest head was reviewed.
export async function actionCheckProblem(
  tx: Tx,
  organizationId: string,
  pullRequestId: string,
  sourceHeadId: string,
) {
  const [latest] = await tx
    .select()
    .from(s.aiRun)
    .where(
      and(
        eq(s.aiRun.organizationId, organizationId),
        eq(s.aiRun.pullRequestId, pullRequestId),
        sql`${s.aiRun.status} <> 'superseded'`,
      ),
    )
    .orderBy(desc(s.aiRun.createdAt))
    .limit(1);
  if (!latest)
    return "The Lictory Intelligence review has not reviewed this pull request. Run it before merging.";
  if (latest.status === "queued" || latest.status === "running")
    return "The Lictory Intelligence review is still reviewing the latest commit.";
  if (latest.status === "failed")
    return `The Lictory Intelligence review failed: ${latest.error ?? "unknown error"} Run it again before merging.`;
  if (latest.headCommitId !== sourceHeadId)
    return "The Lictory Intelligence review has not reviewed the latest commit. Run it again.";
  return undefined;
}

export async function runsById(tx: Tx, organizationId: string, ids: string[]) {
  if (!ids.length) return [];
  return tx
    .select()
    .from(s.aiRun)
    .where(
      and(eq(s.aiRun.organizationId, organizationId), inArray(s.aiRun.id, ids)),
    );
}
