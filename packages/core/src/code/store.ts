import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  CodeLinkSource,
  CodeLinkTarget,
} from "@lictory/core/db/code-schema";
import { detectKeys } from "@lictory/core/code/keys";
import { queuePullRequestTransitions } from "@lictory/core/code/agent-events";
import { excerpt } from "@lictory/core/code/http";
import type {
  CodeBranchInfo,
  CodeChecksSummary,
  CodeCommitInfo,
  CodeIssueInfo,
  CodePullRequestInfo,
  CodeRepositoryInfo,
} from "@lictory/core/code/provider";
import type { CodeTouch } from "@lictory/core/code/projections";
import { writeEntities } from "@lictory/core/domain/projections";
import { serialize, type Tx } from "@lictory/core/domain/service";
import { SYSTEM_ACTOR } from "@lictory/core/domain/delivery";

// Mirror writes and links, shared by ingest, reconciliation, the outbox and
// commands. Every function runs inside a transaction holding the
// organization lock and records what it touched, so the caller writes the
// projections once at the end.
//
// Mirrors only move forward: a pull request or issue is never overwritten
// by data older than what is stored (`hostUpdatedAt`), so a replayed or
// late delivery cannot roll back state.

export class Touched {
  readonly connectionIds = new Set<string>();
  readonly repositoryIds = new Set<string>();
  readonly pullRequestIds = new Set<string>();
  readonly issueIds = new Set<string>();
  readonly workItemIds = new Set<string>();
  readonly targetIds = new Set<string>();
  readonly writeIds = new Set<string>();
  readonly identityUserIds = new Set<string>();
  toTouch(): CodeTouch {
    return {
      connectionIds: [...this.connectionIds],
      repositoryIds: [...this.repositoryIds],
      pullRequestIds: [...this.pullRequestIds],
      issueIds: [...this.issueIds],
      workItemIds: [...this.workItemIds],
      targetIds: [...this.targetIds],
      writeIds: [...this.writeIds],
      identityUserIds: [...this.identityUserIds],
    };
  }
}

export type RepositoryRow = typeof s.codeRepository.$inferSelect;

export async function repositoryProjects(
  tx: Tx,
  organizationId: string,
  repositoryId: string,
) {
  return tx
    .select({ id: s.project.id, key: s.project.key })
    .from(s.codeRepositoryProject)
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.codeRepositoryProject.organizationId),
        eq(s.project.id, s.codeRepositoryProject.projectId),
      ),
    )
    .where(
      and(
        eq(s.codeRepositoryProject.organizationId, organizationId),
        eq(s.codeRepositoryProject.repositoryId, repositoryId),
        isNull(s.project.archivedAt),
      ),
    );
}

export async function updateRepository(
  tx: Tx,
  repository: RepositoryRow,
  info: CodeRepositoryInfo,
  touched: Touched,
) {
  const values = {
    fullName: info.fullName || repository.fullName,
    defaultBranch: info.defaultBranch || repository.defaultBranch,
    webUrl: info.webUrl || repository.webUrl,
    cloneUrl: info.cloneUrl || repository.cloneUrl,
    visibility: info.visibility,
    hostArchived: info.archived,
  };
  const changed = (Object.keys(values) as (keyof typeof values)[]).some(
    (k) => values[k] !== repository[k],
  );
  if (!changed) return;
  await tx
    .update(s.codeRepository)
    .set(values)
    .where(
      and(
        eq(s.codeRepository.organizationId, repository.organizationId),
        eq(s.codeRepository.id, repository.id),
      ),
    );
  touched.repositoryIds.add(repository.id);
  // Rows embed the repository's name.
  if (values.fullName !== repository.fullName) {
    const [prs, issues, links] = await Promise.all([
      tx
        .select({ id: s.codePullRequest.id })
        .from(s.codePullRequest)
        .where(
          and(
            eq(s.codePullRequest.organizationId, repository.organizationId),
            eq(s.codePullRequest.repositoryId, repository.id),
          ),
        ),
      tx
        .select({ id: s.codeIssue.id })
        .from(s.codeIssue)
        .where(
          and(
            eq(s.codeIssue.organizationId, repository.organizationId),
            eq(s.codeIssue.repositoryId, repository.id),
          ),
        ),
      tx
        .select({ workItemId: s.codeWorkLink.workItemId })
        .from(s.codeWorkLink)
        .where(
          and(
            eq(s.codeWorkLink.organizationId, repository.organizationId),
            eq(s.codeWorkLink.repositoryId, repository.id),
          ),
        ),
    ]);
    prs.forEach((p) => touched.pullRequestIds.add(p.id));
    issues.forEach((i) => touched.issueIds.add(i.id));
    links.forEach((l) => touched.workItemIds.add(l.workItemId));
  }
}

export async function upsertPullRequest(
  tx: Tx,
  repository: RepositoryRow,
  info: CodePullRequestInfo,
  touched: Touched,
  provenance?: {
    openedById: string;
    openedVia: string | null;
    agentId?: string | null;
    agentSessionId?: string | null;
  },
) {
  const organizationId = repository.organizationId;
  const [existing] = await tx
    .select()
    .from(s.codePullRequest)
    .where(
      and(
        eq(s.codePullRequest.organizationId, organizationId),
        eq(s.codePullRequest.repositoryId, repository.id),
        eq(s.codePullRequest.number, info.number),
      ),
    );
  const values = {
    externalId: info.externalId,
    title: info.title,
    bodyExcerpt: excerpt(info.body),
    state: info.state,
    draft: info.draft,
    authorLogin: info.authorLogin,
    authorIsBot: info.authorIsBot,
    headBranch: info.headBranch,
    headSha: info.headSha,
    baseBranch: info.baseBranch,
    reviewDecision: info.reviewDecision,
    requestedReviewers: info.requestedReviewers,
    approvedBy: info.approvedBy,
    mergeable: info.mergeable,
    webUrl: info.webUrl,
    mergedAt: info.mergedAt,
    mergedByLogin: info.mergedByLogin,
    closedAt: info.closedAt,
    hostCreatedAt: info.createdAt,
    hostUpdatedAt: info.updatedAt,
  };
  if (existing) {
    // Never older over newer.
    if (existing.hostUpdatedAt.getTime() > info.updatedAt.getTime())
      return { id: existing.id, changed: false, created: false };
    await tx
      .update(s.codePullRequest)
      .set({
        ...values,
        ...(provenance && !existing.openedById ? provenance : {}),
      })
      .where(eq(s.codePullRequest.id, existing.id));
    touched.pullRequestIds.add(existing.id);
    await queuePullRequestTransitions(tx, repository, existing, info);
    return { id: existing.id, changed: true, created: false };
  }
  const [created] = await tx
    .insert(s.codePullRequest)
    .values({
      organizationId,
      repositoryId: repository.id,
      number: info.number,
      ...values,
      ...(provenance ?? {}),
    })
    .returning({ id: s.codePullRequest.id });
  touched.pullRequestIds.add(created!.id);
  return { id: created!.id, changed: true, created: true };
}

export async function upsertChecks(
  tx: Tx,
  repository: RepositoryRow,
  sha: string,
  summary: CodeChecksSummary,
  touched: Touched,
) {
  const organizationId = repository.organizationId;
  // The repository's first reported check changes what it shows
  // (`reportsChecks`).
  if (summary.state !== "none") {
    const [seen] = await tx
      .select({ sha: s.codeCommitChecks.sha })
      .from(s.codeCommitChecks)
      .where(
        and(
          eq(s.codeCommitChecks.organizationId, organizationId),
          eq(s.codeCommitChecks.repositoryId, repository.id),
          ne(s.codeCommitChecks.state, "none"),
        ),
      )
      .limit(1);
    if (!seen) touched.repositoryIds.add(repository.id);
  }
  await tx
    .insert(s.codeCommitChecks)
    .values({
      organizationId,
      repositoryId: repository.id,
      sha,
      state: summary.state,
      runs: summary.runs,
    })
    .onConflictDoUpdate({
      target: [
        s.codeCommitChecks.organizationId,
        s.codeCommitChecks.repositoryId,
        s.codeCommitChecks.sha,
      ],
      set: { state: summary.state, runs: summary.runs, updatedAt: new Date() },
    });
  // The pull requests at this head show the checks.
  const prs = await tx
    .select({ id: s.codePullRequest.id })
    .from(s.codePullRequest)
    .where(
      and(
        eq(s.codePullRequest.organizationId, organizationId),
        eq(s.codePullRequest.repositoryId, repository.id),
        eq(s.codePullRequest.headSha, sha),
      ),
    );
  for (const pr of prs) touched.pullRequestIds.add(pr.id);
}

export async function upsertBranch(
  tx: Tx,
  repository: RepositoryRow,
  branch: CodeBranchInfo | { name: string; deleted: true },
  touched: Touched,
) {
  const organizationId = repository.organizationId;
  const deleted = "deleted" in branch;
  const [existing] = await tx
    .select()
    .from(s.codeBranch)
    .where(
      and(
        eq(s.codeBranch.organizationId, organizationId),
        eq(s.codeBranch.repositoryId, repository.id),
        eq(s.codeBranch.name, branch.name),
      ),
    );
  if (existing) {
    const next = deleted
      ? { deletedAt: existing.deletedAt ?? new Date() }
      : { headSha: branch.headSha, deletedAt: null };
    if (
      (deleted && existing.deletedAt) ||
      (!deleted && existing.headSha === branch.headSha && !existing.deletedAt)
    )
      return existing.id;
    await tx
      .update(s.codeBranch)
      .set(next)
      .where(eq(s.codeBranch.id, existing.id));
    touched.targetIds.add(existing.id);
    return existing.id;
  }
  if (deleted) return null;
  const [created] = await tx
    .insert(s.codeBranch)
    .values({
      organizationId,
      repositoryId: repository.id,
      name: branch.name,
      headSha: branch.headSha,
    })
    .returning({ id: s.codeBranch.id });
  touched.targetIds.add(created!.id);
  return created!.id;
}

export async function upsertIssue(
  tx: Tx,
  repository: RepositoryRow,
  info: CodeIssueInfo,
  touched: Touched,
) {
  const organizationId = repository.organizationId;
  const [existing] = await tx
    .select()
    .from(s.codeIssue)
    .where(
      and(
        eq(s.codeIssue.organizationId, organizationId),
        eq(s.codeIssue.repositoryId, repository.id),
        eq(s.codeIssue.number, info.number),
      ),
    );
  const values = {
    externalId: info.externalId,
    title: info.title,
    bodyExcerpt: excerpt(info.body),
    state: info.state,
    labels: info.labels,
    assignees: info.assignees,
    authorLogin: info.authorLogin,
    webUrl: info.webUrl,
    hostCreatedAt: info.createdAt,
    hostUpdatedAt: info.updatedAt,
  };
  if (existing) {
    if (existing.hostUpdatedAt.getTime() > info.updatedAt.getTime())
      return { id: existing.id, changed: false };
    await tx
      .update(s.codeIssue)
      .set(values)
      .where(eq(s.codeIssue.id, existing.id));
    touched.issueIds.add(existing.id);
    return { id: existing.id, changed: true };
  }
  const [created] = await tx
    .insert(s.codeIssue)
    .values({
      organizationId,
      repositoryId: repository.id,
      number: info.number,
      ...values,
    })
    .returning({ id: s.codeIssue.id });
  touched.issueIds.add(created!.id);
  return { id: created!.id, changed: true };
}

export async function upsertCommit(
  tx: Tx,
  repository: RepositoryRow,
  commit: CodeCommitInfo,
  branch: string | null,
) {
  const [row] = await tx
    .insert(s.codeCommit)
    .values({
      organizationId: repository.organizationId,
      repositoryId: repository.id,
      sha: commit.sha,
      message: excerpt(commit.message, 1000),
      authorName: commit.authorName,
      authorLogin: commit.authorLogin,
      branch,
      webUrl: commit.webUrl,
      committedAt: commit.committedAt,
    })
    .onConflictDoNothing()
    .returning({ id: s.codeCommit.id });
  if (row) return row.id;
  const [existing] = await tx
    .select({ id: s.codeCommit.id })
    .from(s.codeCommit)
    .where(
      and(
        eq(s.codeCommit.organizationId, repository.organizationId),
        eq(s.codeCommit.repositoryId, repository.id),
        eq(s.codeCommit.sha, commit.sha),
      ),
    );
  return existing!.id;
}

// The work items of the repository's projects that these texts name.
export async function itemsNamedIn(
  tx: Tx,
  organizationId: string,
  repositoryId: string,
  texts: (string | null | undefined)[],
) {
  const projects = await repositoryProjects(tx, organizationId, repositoryId);
  const keys = detectKeys(
    texts,
    projects.map((p) => p.key),
  );
  if (!keys.length) return [];
  const byKey = new Map(projects.map((p) => [p.key, p.id]));
  const items = await tx
    .select({
      id: s.workItem.id,
      projectId: s.workItem.projectId,
      number: s.workItem.number,
      organizationId: s.workItem.organizationId,
    })
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        inArray(s.workItem.projectId, [
          ...new Set(keys.map((k) => byKey.get(k.projectKey)!)),
        ]),
        inArray(
          s.workItem.number,
          keys.map((k) => k.number),
        ),
        isNull(s.workItem.archivedAt),
      ),
    );
  const wanted = new Set(
    keys.map((k) => `${byKey.get(k.projectKey)}:${k.number}`),
  );
  return items.filter((i) => wanted.has(`${i.projectId}:${i.number}`));
}

type LinkInput = {
  organizationId: string;
  workItemId: string;
  projectId: string;
  repositoryId: string;
  target: CodeLinkTarget;
  targetId: string;
  source: CodeLinkSource;
  createdById: string;
  performedVia?: string | null;
  agentSessionId?: string | null;
  // What the activity entry names (branch, #12, sha) and links to.
  ref: string;
  url: string | null;
};

// Adds a link unless an active one exists. Detection (`source: "key"`)
// also skips a link a person removed earlier: unlinking is a decision that
// later mentions do not overrule.
export async function addLink(tx: Tx, input: LinkInput, touched: Touched) {
  const existing = await tx
    .select()
    .from(s.codeWorkLink)
    .where(
      and(
        eq(s.codeWorkLink.organizationId, input.organizationId),
        eq(s.codeWorkLink.workItemId, input.workItemId),
        eq(s.codeWorkLink.target, input.target),
        eq(s.codeWorkLink.targetId, input.targetId),
      ),
    );
  const active = existing.find((l) => !l.unlinkedAt);
  if (active) return { link: active, created: false };
  if (input.source === "key" && existing.some((l) => l.unlinkedById))
    return { link: null, created: false };
  const [link] = await tx
    .insert(s.codeWorkLink)
    .values({
      organizationId: input.organizationId,
      workItemId: input.workItemId,
      projectId: input.projectId,
      repositoryId: input.repositoryId,
      target: input.target,
      targetId: input.targetId,
      source: input.source,
      createdById: input.createdById,
      performedVia: input.performedVia ?? null,
      agentSessionId: input.agentSessionId ?? null,
    })
    .returning();
  touched.workItemIds.add(input.workItemId);
  touched.targetIds.add(input.targetId);
  if (input.target === "pull_request")
    touched.pullRequestIds.add(input.targetId);
  if (input.target === "issue") touched.issueIds.add(input.targetId);
  await recordActivity(tx, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    actorId: input.createdById,
    action: "code_linked",
    detail: {
      target: input.target,
      ref: input.ref,
      url: input.url,
      source: input.source,
      ...(input.performedVia ? { performedVia: input.performedVia } : {}),
    },
  });
  return { link: link!, created: true };
}

// Links the items the texts name to one mirror row.
export async function linkNamedItems(
  tx: Tx,
  repository: RepositoryRow,
  target: CodeLinkTarget,
  targetId: string,
  texts: (string | null | undefined)[],
  ref: { label: string; url: string | null },
  touched: Touched,
) {
  const items = await itemsNamedIn(
    tx,
    repository.organizationId,
    repository.id,
    texts,
  );
  for (const item of items)
    await addLink(
      tx,
      {
        organizationId: repository.organizationId,
        workItemId: item.id,
        projectId: item.projectId,
        repositoryId: repository.id,
        target,
        targetId,
        source: "key",
        createdById: SYSTEM_ACTOR,
        ref: ref.label,
        url: ref.url,
      },
      touched,
    );
  return items.length;
}

export async function recordActivity(
  tx: Tx,
  entry: {
    organizationId: string;
    projectId: string;
    workItemId: string;
    actorId: string;
    action: string;
    detail: Record<string, unknown>;
  },
) {
  const [row] = await tx
    .insert(s.activity)
    .values({ id: crypto.randomUUID(), ...entry })
    .returning();
  await writeEntities(tx, entry.organizationId, [
    {
      entity: serialize("activity", row),
      scope: { projectId: entry.projectId, workItemId: entry.workItemId },
    },
  ]);
}

// Repositories of an organization that still exist in a connection,
// newest sync first.
export async function connectionRepositoryIds(
  tx: Tx,
  organizationId: string,
  connectionId: string,
) {
  return (
    await tx
      .select({ id: s.codeRepository.id })
      .from(s.codeRepository)
      .where(
        and(
          eq(s.codeRepository.organizationId, organizationId),
          eq(s.codeRepository.connectionId, connectionId),
        ),
      )
  ).map((r) => r.id);
}

// Everything projected from the given repositories, for a connection that
// returns (reconnect) or leaves (disconnect).
export async function touchRepositories(
  tx: Tx,
  organizationId: string,
  repositoryIds: string[],
  touched: Touched,
) {
  if (!repositoryIds.length) return;
  repositoryIds.forEach((id) => touched.repositoryIds.add(id));
  const scope = (table: typeof s.codePullRequest | typeof s.codeIssue) =>
    and(
      eq(table.organizationId, organizationId),
      inArray(table.repositoryId, repositoryIds),
    );
  const [prs, issues, links, writes] = await Promise.all([
    tx
      .select({ id: s.codePullRequest.id })
      .from(s.codePullRequest)
      .where(scope(s.codePullRequest)),
    tx
      .select({ id: s.codeIssue.id })
      .from(s.codeIssue)
      .where(scope(s.codeIssue)),
    tx
      .select({ workItemId: s.codeWorkLink.workItemId })
      .from(s.codeWorkLink)
      .where(
        and(
          eq(s.codeWorkLink.organizationId, organizationId),
          inArray(s.codeWorkLink.repositoryId, repositoryIds),
        ),
      ),
    tx
      .select({ id: s.codeWrite.id })
      .from(s.codeWrite)
      .where(
        and(
          eq(s.codeWrite.organizationId, organizationId),
          inArray(s.codeWrite.repositoryId, repositoryIds),
          sql`${s.codeWrite.status} in ('queued', 'sending', 'failed')`,
        ),
      ),
  ]);
  prs.forEach((p) => touched.pullRequestIds.add(p.id));
  issues.forEach((i) => touched.issueIds.add(i.id));
  links.forEach((l) => touched.workItemIds.add(l.workItemId));
  writes.forEach((w) => touched.writeIds.add(w.id));
}
