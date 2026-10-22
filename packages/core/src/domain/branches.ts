import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  Command,
  Directory,
  EntityOf,
  Capabilities,
} from "@lictory/core/contracts/protocol";
import { mergeBase, mergeSnapshot, type Snapshot } from "@lictory/core/contracts/merge";
import type { Tx } from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";

export const branchCommands = new Set([
  "createBranch",
  "setBranchCollaborator",
  "commitBranch",
  "syncBranch",
  "deleteBranch",
  "createPullRequest",
  "setPullRequestDraft",
  "deletePullRequest",
  "requestPullRequestReview",
  "decidePullRequest",
  "mergePullRequest",
  "revertSpecification",
]);
export function resultHash(snapshot: Snapshot) {
  return createHash("sha256")
    .update(JSON.stringify([snapshot.title, snapshot.content]))
    .digest("hex");
}
const require = (ok: unknown, message: string) => {
  if (!ok) throw new DomainError("forbidden", message);
};
const available = <T>(value: T | undefined): T => {
  if (!value)
    throw new DomainError(
      "unavailable",
      "This branch or pull request is unavailable.",
    );
  return value;
};

// Lazily map legacy revision chains into the commit graph, inside the same
// organization transaction as the first branch command. Reads never mutate.
export async function ensureMain(
  tx: Tx,
  organizationId: string,
  workItemId: string,
) {
  const where = and(
    eq(s.specificationBranch.organizationId, organizationId),
    eq(s.specificationBranch.workItemId, workItemId),
    eq(s.specificationBranch.name, "main"),
  );
  const existing = (
    await tx.select().from(s.specificationBranch).where(where)
  )[0];
  if (existing) return existing;
  const revisions = (
    await tx
      .select()
      .from(s.specificationRevision)
      .where(
        and(
          eq(s.specificationRevision.organizationId, organizationId),
          eq(s.specificationRevision.workItemId, workItemId),
        ),
      )
  ).sort((a, b) => a.number - b.number);
  let parent: string | undefined;
  for (const r of revisions) {
    const id = crypto.randomUUID();
    await tx.insert(s.specificationCommit).values({
      id,
      organizationId,
      workItemId,
      title: r.title,
      content: r.content,
      message: r.changeSummary ?? `Revision ${r.number}`,
      authorId: r.authorId,
      createdAt: r.createdAt,
      revisionId: r.id,
      parentIds: parent ? [parent] : [],
    });
    parent = id;
  }
  const r = available(revisions.at(-1));
  return (
    await tx
      .insert(s.specificationBranch)
      .values({
        organizationId,
        workItemId,
        name: "main",
        headId: parent!,
        authorId: r.authorId,
      })
      .returning()
  )[0]!;
}
export async function recordMain(
  tx: Tx,
  r: typeof s.specificationRevision.$inferInsert,
  parents?: string[],
) {
  const [main] = await tx
    .select()
    .from(s.specificationBranch)
    .where(
      and(
        eq(s.specificationBranch.organizationId, r.organizationId),
        eq(s.specificationBranch.workItemId, r.workItemId),
        eq(s.specificationBranch.name, "main"),
      ),
    );
  if (!main) return; // First branch operation imports the complete revision chain.
  const id = crypto.randomUUID();
  await tx.insert(s.specificationCommit).values({
    id,
    organizationId: r.organizationId,
    workItemId: r.workItemId,
    title: r.title,
    content: r.content,
    message: r.changeSummary ?? "Main updated",
    authorId: r.authorId,
    parentIds: parents ?? [main.headId],
    revisionId: r.id,
  });
  await tx
    .update(s.specificationBranch)
    .set({ headId: id })
    .where(eq(s.specificationBranch.id, main.id));
}
export async function applyBranchCommand(
  tx: Tx,
  c: Command,
  ctx: {
    organizationId: string;
    workItemId: string;
    userId: string;
    // Item's project; disciplines and capabilities are this project's.
    projectId: string;
    capabilities: Capabilities;
    roster: Directory;
    latest: EntityOf<"revision">;
    revision: (
      title: string,
      content: string,
      summary: string,
      parents?: string[],
    ) => Promise<string>;
    log: (action: string, detail?: Record<string, unknown>) => void;
    // Project policy gate for the Lictory Intelligence review action; returns the
    // blocking reason.
    actionCheck?: (
      pullRequestId: string,
      sourceHeadId: string,
    ) => Promise<string | undefined>;
  },
) {
  if (!branchCommands.has(c.type) || !("workItemId" in c)) return;
  const { organizationId, workItemId, userId, capabilities, roster, log } = ctx;
  const disciplines = roster.disciplines.filter(
    (d) => d.projectId === ctx.projectId,
  );
  const main = await ensureMain(tx, organizationId, workItemId);
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
  const commits = await tx
    .select()
    .from(s.specificationCommit)
    .where(
      and(
        eq(s.specificationCommit.organizationId, organizationId),
        eq(s.specificationCommit.workItemId, workItemId),
      ),
    );
  const prs = await tx
    .select()
    .from(s.specificationPullRequest)
    .where(
      and(
        eq(s.specificationPullRequest.organizationId, organizationId),
        eq(s.specificationPullRequest.workItemId, workItemId),
        isNull(s.specificationPullRequest.deletedAt),
      ),
    );
  const branch = (id: string) => available(branches.find((b) => b.id === id));
  const commit = (id: string) => available(commits.find((b) => b.id === id));
  const pr = (id: string) => available(prs.find((p) => p.id === id));
  const collaborator = (b: typeof main) =>
    b.authorId === userId || b.collaboratorIds.includes(userId);
  const editBranch = (b: typeof main) => {
    require(b.name !== "main", "Use a pull request to commit to main.");
    require(collaborator(
      b,
    ), "Only invited collaborators can commit to this branch.");
  };
  const managePR = (p: (typeof prs)[number]) =>
    require(p.authorId === userId ||
      collaborator(
        branch(p.sourceId),
      ), "Only the author or a source branch collaborator can manage this pull request.");
  const heads = (
    p: (typeof prs)[number],
    sourceHeadId: string,
    targetHeadId: string,
  ) => {
    const source = branch(p.sourceId),
      target = branch(p.targetId);
    if (source.headId !== sourceHeadId || target.headId !== targetHeadId)
      throw new DomainError(
        "conflict",
        "A branch changed. Inspect the updated merge result before continuing.",
      );
    return { source, target };
  };
  const merge = (source: typeof main, target: typeof main) => {
    const base = mergeBase(commits, source.headId, target.headId);
    if (!base)
      throw new DomainError(
        "conflict",
        "The branches have multiple or missing common ancestors. Resolve the merge explicitly.",
      );
    return mergeSnapshot(base, commit(source.headId), commit(target.headId));
  };
  const insertCommit = async (
    b: typeof main,
    snapshot: Snapshot,
    message: string,
    parents: string[],
  ) => {
    const id = crypto.randomUUID();
    await tx.insert(s.specificationCommit).values({
      id,
      organizationId,
      workItemId,
      ...snapshot,
      message,
      parentIds: parents,
      authorId: userId,
    });
    await tx
      .update(s.specificationBranch)
      .set({ headId: id })
      .where(eq(s.specificationBranch.id, b.id));
    log("branch_committed", { branch: b.name, message, commitId: id });
    return id;
  };
  switch (c.type) {
    case "createBranch": {
      if (
        c.name.toLowerCase() === "main" ||
        branches.some((b) => b.name === c.name)
      )
        throw new DomainError(
          "validation",
          "That branch name is already in use.",
        );
      const from = c.fromBranchId ? branch(c.fromBranchId) : main;
      await tx.insert(s.specificationBranch).values({
        id: c.branchId,
        organizationId,
        workItemId,
        name: c.name,
        headId: from.headId,
        authorId: userId,
        collaboratorIds: [userId],
      });
      log("branch_created", { branch: c.name, from: from.name });
      break;
    }
    case "setBranchCollaborator": {
      const b = branch(c.branchId);
      require(b.name !== "main" &&
        b.authorId ===
          userId, "Only the branch author can invite or remove collaborators.");
      require(roster.members.some(
        (m) => m.id === c.userId,
      ), "The collaborator is outside this organization.");
      require(c.userId !== b.authorId ||
        c.assigned, "The branch author cannot be removed.");
      const ids = new Set(b.collaboratorIds);
      if (c.assigned) ids.add(c.userId);
      else ids.delete(c.userId);
      await tx
        .update(s.specificationBranch)
        .set({ collaboratorIds: [...ids] })
        .where(eq(s.specificationBranch.id, b.id));
      log("branch_collaborator_changed", {
        branch: b.name,
        userId: c.userId,
        assigned: c.assigned,
      });
      break;
    }
    case "commitBranch": {
      const b = branch(c.branchId);
      editBranch(b);
      const base = commit(c.baseCommitId),
        head = commit(b.headId);
      if (
        !mergeBase(commits, c.baseCommitId, b.headId) ||
        mergeBase(commits, c.baseCommitId, b.headId)?.id !== c.baseCommitId
      )
        throw new DomainError(
          "conflict",
          "Your starting commit is not in this branch's history.",
        );
      if (c.expectedHeadId && c.expectedHeadId !== b.headId)
        throw new DomainError(
          "conflict",
          "The branch changed again. Resolve against its current head.",
        );
      const result = mergeSnapshot(base, c, head);
      if (result.conflicted && !c.expectedHeadId)
        throw new DomainError(
          "conflict",
          "Your edits overlap another commit. Resolve the conflicts before committing.",
        );
      const snapshot = c.expectedHeadId
        ? { title: c.title, content: c.content }
        : { title: result.title, content: result.content };
      if (snapshot.title === head.title && snapshot.content === head.content)
        break;
      await insertCommit(b, snapshot, c.message, [b.headId]);
      break;
    }
    case "syncBranch": {
      const b = branch(c.branchId),
        target = branch(c.targetId);
      editBranch(b);
      if (b.id === target.id)
        throw new DomainError(
          "validation",
          "Choose another branch to merge from.",
        );
      if (b.headId !== c.sourceHeadId || target.headId !== c.targetHeadId)
        throw new DomainError(
          "conflict",
          "A branch changed again. Refresh the conflict resolution.",
        );
      const base = mergeBase(commits, b.headId, target.headId);
      const result = base
        ? mergeSnapshot(base, commit(b.headId), commit(target.headId))
        : undefined;
      if (
        (!result || result.conflicted) &&
        (c.title === undefined || c.content === undefined)
      )
        throw new DomainError(
          "conflict",
          "Resolve the overlapping changes before updating the branch.",
        );
      await insertCommit(
        b,
        {
          title: c.title ?? result!.title,
          content: c.content ?? result!.content,
        },
        `Merge ${target.name} into ${b.name}`,
        [b.headId, target.headId],
      );
      break;
    }
    case "deleteBranch": {
      const b = branch(c.branchId);
      require(b.name !== "main", "Main cannot be deleted.");
      require(b.authorId === userId ||
        capabilities.editSpecifications, "Only the author or a specification editor can delete this branch.");
      if (
        prs.some(
          (p) =>
            p.status !== "merged" &&
            (p.sourceId === b.id || p.targetId === b.id),
        )
      )
        throw new DomainError(
          "conflict",
          "Delete the active pull requests for this branch first.",
        );
      await tx
        .update(s.specificationBranch)
        .set({ deletedAt: new Date() })
        .where(eq(s.specificationBranch.id, b.id));
      log("branch_deleted", { branchId: b.id, branch: b.name });
      break;
    }
    case "createPullRequest": {
      const source = branch(c.sourceId),
        target = branch(c.targetId);
      editBranch(source);
      if (source.id === target.id)
        throw new DomainError(
          "validation",
          "A pull request must target another branch.",
        );
      if (source.headId === target.headId)
        throw new DomainError(
          "validation",
          "Commit changes before opening a pull request.",
        );
      if (
        prs.some(
          (p) =>
            p.sourceId === source.id &&
            p.targetId === target.id &&
            p.status !== "merged",
        )
      )
        throw new DomainError(
          "conflict",
          "A pull request between these branches already exists.",
        );
      await tx.insert(s.specificationPullRequest).values({
        id: c.pullRequestId,
        organizationId,
        workItemId,
        sourceId: source.id,
        targetId: target.id,
        title: c.title,
        description: c.description,
        status: c.draft ? "draft" : "open",
        authorId: userId,
      });
      // Carry existing required responsibilities as PR review requests.
      const reviews = await tx
        .select()
        .from(s.review)
        .where(
          and(
            eq(s.review.organizationId, organizationId),
            eq(s.review.workItemId, workItemId),
            eq(s.review.revisionId, ctx.latest.id),
          ),
        );
      const assignments = await tx
        .select()
        .from(s.reviewAssignment)
        .where(eq(s.reviewAssignment.organizationId, organizationId));
      const added = new Set<string>();
      for (const review of reviews.filter((r) => r.status !== "cancelled")) {
        const targets = assignments.filter(
          (a) => a.reviewId === review.id && !a.withdrawnAt,
        );
        for (const a of targets) {
          const role = disciplines.find(
            (role) =>
              !role.archivedAt &&
              role.capabilities.review &&
              (a.disciplineId
                ? role.id === a.disciplineId
                : role.name === review.responsibility &&
                  role.userIds.includes(a.userId ?? "")),
          );
          if (!role || added.has(role.id)) continue;
          added.add(role.id);
          await tx.insert(s.pullRequestReview).values({
            organizationId,
            workItemId,
            pullRequestId: c.pullRequestId,
            disciplineId: role.id,
            userId: a.userId,
            required: review.required,
          });
        }
      }
      log("pull_request_created", {
        pullRequestId: c.pullRequestId,
        title: c.title,
        source: source.name,
        target: target.name,
        draft: c.draft,
      });
      break;
    }
    case "setPullRequestDraft": {
      const p = pr(c.pullRequestId);
      managePR(p);
      require(p.status !==
        "merged", "Merged pull requests cannot become drafts.");
      await tx
        .update(s.specificationPullRequest)
        .set({ status: c.draft ? "draft" : "open" })
        .where(eq(s.specificationPullRequest.id, p.id));
      log("pull_request_draft_changed", {
        pullRequestId: p.id,
        title: p.title,
        draft: c.draft,
      });
      break;
    }
    case "deletePullRequest": {
      const p = pr(c.pullRequestId);
      require(p.authorId === userId ||
        capabilities.editSpecifications, "Only the author or a specification editor can delete this pull request.");
      await tx
        .update(s.specificationPullRequest)
        .set({ deletedAt: new Date() })
        .where(eq(s.specificationPullRequest.id, p.id));
      log("pull_request_deleted", { title: p.title, pullRequestId: p.id });
      break;
    }
    case "requestPullRequestReview": {
      const p = pr(c.pullRequestId);
      managePR(p);
      require(capabilities.requestReviews, "Your disciplines in this project cannot request reviews.");
      require(p.status !== "merged", "This pull request is merged.");
      const role = available(
        disciplines.find(
          (r) =>
            r.id === c.disciplineId && !r.archivedAt && r.capabilities.review,
        ),
      );
      require(!c.userId ||
        role.userIds.includes(
          c.userId,
        ), "Choose a reviewer from this discipline.");
      const existing = (
        await tx
          .select()
          .from(s.pullRequestReview)
          .where(
            and(
              eq(s.pullRequestReview.pullRequestId, p.id),
              eq(s.pullRequestReview.disciplineId, role.id),
            ),
          )
      )[0];
      if (existing)
        throw new DomainError(
          "validation",
          "This responsibility is already requested.",
        );
      await tx.insert(s.pullRequestReview).values({
        organizationId,
        workItemId,
        pullRequestId: p.id,
        disciplineId: role.id,
        userId: c.userId,
        required: c.required,
      });
      log("pull_request_review_requested", {
        title: p.title,
        discipline: role.name,
        disciplineId: role.id,
        pullRequestId: p.id,
      });
      break;
    }
    case "decidePullRequest": {
      const p = pr(c.pullRequestId);
      require(p.status === "open", "Mark the draft ready for review first.");
      const { source, target } = heads(p, c.sourceHeadId, c.targetHeadId);
      const r = available(
        (
          await tx
            .select()
            .from(s.pullRequestReview)
            .where(
              and(
                eq(s.pullRequestReview.organizationId, organizationId),
                eq(s.pullRequestReview.pullRequestId, p.id),
                eq(s.pullRequestReview.id, c.reviewId),
              ),
            )
        )[0],
      );
      const role = disciplines.find(
        (role) =>
          role.id === r.disciplineId &&
          !role.archivedAt &&
          role.capabilities.review,
      );
      require(role?.userIds.includes(userId) &&
        (!r.userId ||
          r.userId ===
            userId), "Only an assigned reviewer can decide this review.");
      require(c.decision !== "approve" ||
        !commits.some(
          (commit) =>
            commit.authorId === userId &&
            commit.id !==
              mergeBase(commits, source.headId, target.headId)?.id &&
            reachable(commits, source.headId, commit.id) &&
            !reachable(commits, target.headId, commit.id),
        ), "Contributors cannot approve their own changes.");
      const result = merge(source, target);
      if (result.conflicted)
        throw new DomainError(
          "conflict",
          "Resolve merge conflicts before reviewing the result.",
        );
      // Append a durable decision event to activity before changing the projection.
      await tx
        .update(s.pullRequestReview)
        .set({
          decision:
            c.decision === "revoke"
              ? null
              : c.decision === "approve"
                ? "approved"
                : "changes_requested",
          reviewerId: userId,
          resultHash: resultHash(result),
        })
        .where(eq(s.pullRequestReview.id, r.id));
      log("pull_request_review_decided", {
        pullRequestId: p.id,
        title: p.title,
        discipline: role!.name,
        decision: c.decision,
        resultHash: resultHash(result),
        sourceHeadId: source.headId,
        targetHeadId: target.headId,
      });
      break;
    }
    case "mergePullRequest": {
      const p = pr(c.pullRequestId);
      require(p.status === "open", "Only an open pull request can be merged.");
      const { source, target } = heads(p, c.sourceHeadId, c.targetHeadId);
      require(target.name === "main"
        ? capabilities.editSpecifications
        : collaborator(
            target,
          ), "Your disciplines in this project cannot merge into the target branch.");
      const result = merge(source, target);
      if (result.conflicted)
        throw new DomainError(
          "conflict",
          "Resolve merge conflicts on the source branch first.",
        );
      if (
        result.title === commit(target.headId).title &&
        result.content === commit(target.headId).content
      )
        throw new DomainError(
          "validation",
          "The pull request has no remaining changes to merge.",
        );
      const hash = resultHash(result),
        reviews = await tx
          .select()
          .from(s.pullRequestReview)
          .where(
            and(
              eq(s.pullRequestReview.organizationId, organizationId),
              eq(s.pullRequestReview.pullRequestId, p.id),
            ),
          );
      const valid = (r: (typeof reviews)[number]) =>
        r.decision === "approved" &&
        r.resultHash === hash &&
        roster.members.some((m) => m.id === r.reviewerId) &&
        !commits.some(
          (c) =>
            c.authorId === r.reviewerId &&
            reachable(commits, source.headId, c.id) &&
            !reachable(commits, target.headId, c.id),
        ) &&
        disciplines.some(
          (role) =>
            role.id === r.disciplineId &&
            !role.archivedAt &&
            role.capabilities.review &&
            role.userIds.includes(r.reviewerId ?? ""),
        );
      if (
        !reviews.some((r) => r.required) ||
        reviews.some((r) => r.required && !valid(r)) ||
        reviews.some(
          (r) => r.decision === "changes_requested" && r.resultHash === hash,
        )
      )
        throw new DomainError(
          "conflict",
          "Every required responsibility must approve the current merge result.",
        );
      const blocking = await tx
        .select()
        .from(s.thread)
        .where(
          and(
            eq(s.thread.organizationId, organizationId),
            eq(s.thread.pullRequestId, p.id),
            eq(s.thread.status, "open"),
            eq(s.thread.blocking, true),
          ),
        );
      if (blocking.length)
        throw new DomainError(
          "conflict",
          "Resolve the blocking pull request discussions before merging.",
        );
      const actionProblem = await ctx.actionCheck?.(p.id, source.headId);
      if (actionProblem) throw new DomainError("conflict", actionProblem);
      let mergedId: string;
      if (target.name === "main") {
        const revisionId = await ctx.revision(
          result.title,
          result.content,
          `Merge PR: ${p.title}`,
          [target.headId, source.headId],
        );
        const [newMain] = await tx
          .select()
          .from(s.specificationBranch)
          .where(eq(s.specificationBranch.id, main.id));
        mergedId = newMain!.headId;
        // Main approvals refer to the exact reviewed merge result. Supersede
        // pending carried reviews for the same responsibilities with PR evidence.
        for (const r of reviews.filter(valid)) {
          const role = disciplines.find((role) => role.id === r.disciplineId)!;
          await tx
            .update(s.review)
            .set({ status: "cancelled" })
            .where(
              and(
                eq(s.review.organizationId, organizationId),
                eq(s.review.workItemId, workItemId),
                eq(s.review.revisionId, revisionId),
                eq(s.review.responsibility, role.name),
              ),
            );
          const id = crypto.randomUUID();
          await tx.insert(s.review).values({
            id,
            organizationId,
            workItemId,
            revisionId,
            responsibility: role.name,
            required: r.required,
            requestedById: p.authorId,
            status: "completed",
            completedAt: new Date(),
          });
          await tx.insert(s.reviewAssignment).values({
            organizationId,
            reviewId: id,
            disciplineId: r.userId ? null : r.disciplineId,
            userId: r.userId,
            assignedById: p.authorId,
          });
          await tx.insert(s.approval).values({
            organizationId,
            workItemId,
            revisionId,
            reviewId: id,
            reviewerId: r.reviewerId!,
          });
        }
      } else
        mergedId = await insertCommit(target, result, `Merge PR: ${p.title}`, [
          target.headId,
          source.headId,
        ]);
      await tx
        .update(s.specificationPullRequest)
        .set({ status: "merged", mergedCommitId: mergedId })
        .where(eq(s.specificationPullRequest.id, p.id));
      log("pull_request_merged", {
        pullRequestId: p.id,
        title: p.title,
        source: source.name,
        target: target.name,
        commitId: mergedId,
      });
      // Preserve branches still used by another active PR. Removing their
      // pointer would make that review impossible to finish.
      if (
        target.name === "main" &&
        !prs.some(
          (other) =>
            other.id !== p.id &&
            other.status !== "merged" &&
            (other.sourceId === source.id || other.targetId === source.id),
        )
      ) {
        await tx
          .update(s.specificationBranch)
          .set({ deletedAt: new Date() })
          .where(eq(s.specificationBranch.id, source.id));
        log("branch_deleted", {
          branchId: source.id,
          branch: source.name,
          automatic: true,
          reason: "pull_request_merged",
          pullRequestId: p.id,
        });
      }
      break;
    }
    case "revertSpecification": {
      require(capabilities.editSpecifications, "Your disciplines in this project cannot restore specification revisions.");
      const r = available(
        (
          await tx
            .select()
            .from(s.specificationRevision)
            .where(
              and(
                eq(s.specificationRevision.organizationId, organizationId),
                eq(s.specificationRevision.workItemId, workItemId),
                eq(s.specificationRevision.id, c.revisionId),
              ),
            )
        )[0],
      );
      await ctx.revision(r.title, r.content, `Restore revision ${r.number}`);
      log("revision_restored", { revision: r.number });
      break;
    }
  }
}
function reachable(
  commits: { id: string; parentIds: string[] }[],
  head: string,
  id: string,
): boolean {
  const map = new Map(commits.map((c) => [c.id, c])),
    seen = new Set<string>(),
    queue = [head];
  for (const next of queue) {
    if (next === id) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(map.get(next)?.parentIds ?? []));
  }
  return false;
}

export function pullRequestResultHash(
  p: { sourceId: string; targetId: string },
  branches: { id: string; headId: string }[],
  commits: (Snapshot & { id: string; parentIds: string[] })[],
) {
  const source = branches.find((b) => b.id === p.sourceId),
    target = branches.find((b) => b.id === p.targetId);
  if (!source || !target) return null;
  const base = mergeBase(commits, source.headId, target.headId),
    ours = commits.find((c) => c.id === source.headId),
    theirs = commits.find((c) => c.id === target.headId);
  if (!base || !ours || !theirs) return null;
  const result = mergeSnapshot(base, ours, theirs);
  return result.conflicted ? null : resultHash(result);
}
