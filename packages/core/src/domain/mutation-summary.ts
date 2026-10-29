import { and, desc, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Command } from "@lictory/core/contracts/protocol";
import type { Tx } from "@lictory/core/domain/service";

// Capture identifiers before releasing the organization lock. The receipt
// retains this exact result even after later edits or branch cleanup.
export async function commandSummary(
  tx: Tx,
  organizationId: string,
  command: Command,
) {
  const extra: Record<string, unknown> = {};
  const workItemId = "workItemId" in command ? command.workItemId : undefined;
  const type = command.type;
  if (
    workItemId &&
    (type === "createWorkItem" ||
      type === "updateSpecification" ||
      type === "revertSpecification" ||
      type === "mergeSuggestion" ||
      type === "mergePullRequest")
  ) {
    const [row] = await tx
      .select({ number: s.workItem.number, key: s.project.key })
      .from(s.workItem)
      .innerJoin(
        s.project,
        and(
          eq(s.project.id, s.workItem.projectId),
          eq(s.project.organizationId, s.workItem.organizationId),
        ),
      )
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          eq(s.workItem.id, workItemId),
        ),
      );
    if (row && type === "createWorkItem")
      extra.key = `${row.key}-${row.number}`;
    const [revision] = await tx
      .select({ id: s.specificationRevision.id })
      .from(s.specificationRevision)
      .where(
        and(
          eq(s.specificationRevision.organizationId, organizationId),
          eq(s.specificationRevision.workItemId, workItemId),
        ),
      )
      .orderBy(desc(s.specificationRevision.number))
      .limit(1);
    if (revision && type !== "mergePullRequest") extra.revisionId = revision.id;
  }
  if (
    (type === "commitBranch" || type === "syncBranch") &&
    "branchId" in command
  ) {
    const [branch] = await tx
      .select({ headId: s.specificationBranch.headId })
      .from(s.specificationBranch)
      .where(
        and(
          eq(s.specificationBranch.organizationId, organizationId),
          eq(s.specificationBranch.id, command.branchId),
        ),
      );
    if (branch) {
      extra.commitId = branch.headId;
      if (type === "syncBranch" && branch.headId === command.sourceHeadId)
        extra.alreadyUpToDate = true;
    }
  }
  if (type === "mergePullRequest" && "pullRequestId" in command) {
    const [pullRequest] = await tx
      .select({
        mergedCommitId: s.specificationPullRequest.mergedCommitId,
      })
      .from(s.specificationPullRequest)
      .where(
        and(
          eq(s.specificationPullRequest.organizationId, organizationId),
          eq(s.specificationPullRequest.id, command.pullRequestId),
        ),
      );
    if (pullRequest?.mergedCommitId) {
      extra.commitId = pullRequest.mergedCommitId;
      const [commit] = await tx
        .select({ revisionId: s.specificationCommit.revisionId })
        .from(s.specificationCommit)
        .where(
          and(
            eq(s.specificationCommit.organizationId, organizationId),
            eq(s.specificationCommit.id, pullRequest.mergedCommitId),
          ),
        );
      if (commit?.revisionId) extra.revisionId = commit.revisionId;
    }
  }
  if (type === "createPullRequest" && "pullRequestId" in command) {
    extra.reviews = await tx
      .select({
        id: s.pullRequestReview.id,
        disciplineId: s.pullRequestReview.disciplineId,
        userId: s.pullRequestReview.userId,
        required: s.pullRequestReview.required,
      })
      .from(s.pullRequestReview)
      .where(
        and(
          eq(s.pullRequestReview.organizationId, organizationId),
          eq(s.pullRequestReview.pullRequestId, command.pullRequestId),
        ),
      );
  }
  return extra;
}
