import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { canonicalJson } from "@lictory/core/domain/projections";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import {
  codeEntityKey,
  webhookPath,
  type CodeEntity,
  type CodeLinkRef,
  type CodeLinkSummary,
  type CodeReviewRef,
} from "@lictory/core/code/entities";
import { writeSummary } from "@lictory/core/code/write-summary";
import { reviewState } from "@lictory/core/code/merge-rules";

// Code read projections (`code_entity`), replicated to browsers by Zero and
// kept apart from `sync_entity` and `space_entity`. Writers call
// `writeCodeProjections` in the same transaction as their domain writes,
// under the organization lock, naming what they touched; it recomputes those
// rows from the domain tables and writes only what differs.
// `rebuildCodeProjections` reconciles a whole organization (operator recovery
// and the test invariant).
//
// Rows of an archived connection's repositories are not projected: the
// mirror stays in the database as history and returns when the same host is
// connected again.

export type CodeProjectionRow = {
  key: string;
  organizationId: string;
  repositoryId: string | null;
  projectId: string | null;
  workItemId: string | null;
  type: CodeEntity["type"];
  facet: string | null;
  data: Record<string, unknown>;
};

export type CodeTouch = {
  connectionIds?: string[];
  repositoryIds?: string[];
  pullRequestIds?: string[];
  issueIds?: string[];
  // Recompute these items' links and writes.
  workItemIds?: string[];
  // Recompute the links pointing at these mirror rows (branches and
  // commits are only projected through links).
  targetIds?: string[];
  writeIds?: string[];
  identityUserIds?: string[];
};

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null);
const visibleWrite = ["queued", "sending", "failed"] as const;

function row(
  entity: CodeEntity,
  scope: {
    repositoryId?: string | null;
    projectId?: string | null;
    workItemId?: string | null;
    facet?: string | null;
  },
): CodeProjectionRow {
  return {
    key: codeEntityKey(entity),
    organizationId: entity.organizationId,
    repositoryId: scope.repositoryId ?? null,
    projectId: scope.projectId ?? null,
    workItemId: scope.workItemId ?? null,
    type: entity.type,
    facet: scope.facet ?? null,
    data: entity,
  };
}

type Filter = { all: true } | CodeTouch;
const ids = (filter: Filter, key: keyof CodeTouch) =>
  "all" in filter ? undefined : (filter[key] ?? []);
const skip = (list: string[] | undefined) => list !== undefined && !list.length;

// Repositories whose connection is active, with what their rows embed.
async function repositoryContext(db: Database | Tx, organizationId: string) {
  const repositories = await db
    .select({
      repository: s.codeRepository,
      provider: s.codeConnection.provider,
      archivedAt: s.codeConnection.archivedAt,
    })
    .from(s.codeRepository)
    .innerJoin(
      s.codeConnection,
      and(
        eq(s.codeConnection.organizationId, s.codeRepository.organizationId),
        eq(s.codeConnection.id, s.codeRepository.connectionId),
      ),
    )
    .where(eq(s.codeRepository.organizationId, organizationId));
  return new Map(
    repositories
      .filter((r) => !r.archivedAt)
      .map((r) => [r.repository.id, { ...r.repository, provider: r.provider }]),
  );
}

async function linkRefs(
  db: Database | Tx,
  organizationId: string,
  target: "pull_request" | "issue",
  targetIds: string[] | undefined,
) {
  if (skip(targetIds)) return new Map<string, CodeLinkRef[]>();
  const links = await db
    .select({
      targetId: s.codeWorkLink.targetId,
      workItemId: s.codeWorkLink.workItemId,
      projectId: s.codeWorkLink.projectId,
      source: s.codeWorkLink.source,
    })
    .from(s.codeWorkLink)
    .where(
      and(
        eq(s.codeWorkLink.organizationId, organizationId),
        eq(s.codeWorkLink.target, target),
        isNull(s.codeWorkLink.unlinkedAt),
        targetIds ? inArray(s.codeWorkLink.targetId, targetIds) : undefined,
      ),
    )
    .orderBy(s.codeWorkLink.createdAt, s.codeWorkLink.id);
  const byTarget = new Map<string, CodeLinkRef[]>();
  for (const l of links)
    byTarget.set(l.targetId, [
      ...(byTarget.get(l.targetId) ?? []),
      { workItemId: l.workItemId, projectId: l.projectId, source: l.source },
    ]);
  return byTarget;
}

async function checksOf(
  db: Database | Tx,
  organizationId: string,
  pairs: { repositoryId: string; sha: string }[],
) {
  if (!pairs.length) return new Map<string, CodeEntityChecks>();
  const rows = await db
    .select()
    .from(s.codeCommitChecks)
    .where(
      and(
        eq(s.codeCommitChecks.organizationId, organizationId),
        inArray(s.codeCommitChecks.sha, [...new Set(pairs.map((p) => p.sha))]),
      ),
    );
  return new Map(
    rows.map((r) => [
      `${r.repositoryId}:${r.sha}`,
      { state: r.state, runs: r.runs },
    ]),
  );
}
type CodeEntityChecks = {
  state: "pending" | "success" | "failure" | "none";
  runs: s.CodeCheckRun[];
};
const noChecks: CodeEntityChecks = { state: "none", runs: [] };

// Reviews recorded in Lictory, newest first; superseded ones stay out of
// the projection (history keeps them).
async function reviewsOf(
  db: Database | Tx,
  organizationId: string,
  pullRequestIds: string[] | undefined,
) {
  const rows = await db
    .select()
    .from(s.codeReview)
    .where(
      and(
        eq(s.codeReview.organizationId, organizationId),
        isNull(s.codeReview.supersededAt),
        pullRequestIds
          ? inArray(s.codeReview.pullRequestId, pullRequestIds)
          : undefined,
      ),
    )
    .orderBy(desc(s.codeReview.createdAt));
  const map = new Map<string, Omit<CodeReviewRef, "current">[]>();
  for (const r of rows) {
    const list = map.get(r.pullRequestId) ?? [];
    if (list.length < 20)
      list.push({
        id: r.id,
        decision: r.decision,
        headSha: r.headSha,
        reviewerId: r.reviewerId,
        agentId: r.agentId,
        agentName: r.agentName,
        agentSessionId: r.agentSessionId,
        body: r.body.slice(0, 2000),
        createdAt: iso(r.createdAt),
      });
    map.set(r.pullRequestId, list);
  }
  return map;
}

async function computeCodeRows(
  db: Database | Tx,
  organizationId: string,
  filter: Filter,
): Promise<CodeProjectionRow[]> {
  const rows: CodeProjectionRow[] = [];
  const repositories = await repositoryContext(db, organizationId);

  // Connections.
  const connectionIds = ids(filter, "connectionIds");
  if (!skip(connectionIds)) {
    const connections = await db
      .select()
      .from(s.codeConnection)
      .where(
        and(
          eq(s.codeConnection.organizationId, organizationId),
          isNull(s.codeConnection.archivedAt),
          connectionIds
            ? inArray(s.codeConnection.id, connectionIds)
            : undefined,
        ),
      );
    for (const c of connections)
      rows.push(
        row(
          {
            type: "codeConnection",
            id: c.id,
            organizationId,
            provider: c.provider,
            name: c.name,
            baseUrl: c.baseUrl,
            authKind: c.authKind,
            accountLabel: c.accountLabel,
            status: c.status,
            lastError: c.lastError,
            longLivedCredential: c.authKind === "token",
            webhookPath: webhookPath(c.id),
            lastWebhookAt: isoOrNull(c.lastWebhookAt),
            createdAt: iso(c.createdAt),
          },
          {},
        ),
      );
  }

  // Repositories.
  const repositoryIds = ids(filter, "repositoryIds");
  if (!skip(repositoryIds)) {
    const links = await db
      .select()
      .from(s.codeRepositoryProject)
      .where(eq(s.codeRepositoryProject.organizationId, organizationId));
    // Repositories whose host has reported at least one check: Autopilot
    // and the Definition of Done wait for CI, so the Autonomy settings warn
    // about a repository that never reported one.
    const reporting = new Set(
      (
        await db
          .selectDistinct({ repositoryId: s.codeCommitChecks.repositoryId })
          .from(s.codeCommitChecks)
          .where(
            and(
              eq(s.codeCommitChecks.organizationId, organizationId),
              ne(s.codeCommitChecks.state, "none"),
              repositoryIds
                ? inArray(s.codeCommitChecks.repositoryId, repositoryIds)
                : undefined,
            ),
          )
      ).map((r) => r.repositoryId),
    );
    for (const repository of repositories.values()) {
      if (repositoryIds && !repositoryIds.includes(repository.id)) continue;
      rows.push(
        row(
          {
            type: "codeRepository",
            id: repository.id,
            organizationId,
            connectionId: repository.connectionId,
            provider: repository.provider,
            fullName: repository.fullName,
            defaultBranch: repository.defaultBranch,
            webUrl: repository.webUrl,
            visibility: repository.visibility,
            hostArchived: repository.hostArchived,
            projectIds: links
              .filter((l) => l.repositoryId === repository.id)
              .map((l) => l.projectId)
              .sort(),
            defaultForProjectIds: links
              .filter((l) => l.repositoryId === repository.id && l.isDefault)
              .map((l) => l.projectId)
              .sort(),
            lastSyncedAt: isoOrNull(repository.lastSyncedAt),
            lastSyncError: repository.lastSyncError,
            reportsChecks: reporting.has(repository.id),
          },
          { repositoryId: repository.id },
        ),
      );
    }
  }

  // Pull requests.
  const pullRequestIds = ids(filter, "pullRequestIds");
  if (!skip(pullRequestIds)) {
    const prs = await db
      .select()
      .from(s.codePullRequest)
      .where(
        and(
          eq(s.codePullRequest.organizationId, organizationId),
          pullRequestIds
            ? inArray(s.codePullRequest.id, pullRequestIds)
            : undefined,
        ),
      );
    const visible = prs.filter((p) => repositories.has(p.repositoryId));
    const [refs, checks, reviews] = await Promise.all([
      linkRefs(db, organizationId, "pull_request", pullRequestIds),
      checksOf(
        db,
        organizationId,
        visible.map((p) => ({ repositoryId: p.repositoryId, sha: p.headSha })),
      ),
      reviewsOf(db, organizationId, pullRequestIds),
    ]);
    for (const p of visible) {
      const repository = repositories.get(p.repositoryId)!;
      rows.push(
        row(
          {
            type: "codePullRequest",
            id: p.id,
            organizationId,
            repositoryId: p.repositoryId,
            repositoryFullName: repository.fullName,
            provider: repository.provider,
            number: p.number,
            title: p.title,
            bodyExcerpt: p.bodyExcerpt,
            state: p.state,
            draft: p.draft,
            authorLogin: p.authorLogin,
            authorIsBot: p.authorIsBot,
            headBranch: p.headBranch,
            headSha: p.headSha,
            baseBranch: p.baseBranch,
            reviewDecision: p.reviewDecision,
            requestedReviewers: p.requestedReviewers,
            approvedBy: p.approvedBy,
            mergeable: p.mergeable,
            checks: checks.get(`${p.repositoryId}:${p.headSha}`) ?? noChecks,
            webUrl: p.webUrl,
            mergedAt: isoOrNull(p.mergedAt),
            mergedByLogin: p.mergedByLogin,
            closedAt: isoOrNull(p.closedAt),
            hostCreatedAt: iso(p.hostCreatedAt),
            hostUpdatedAt: iso(p.hostUpdatedAt),
            openedById: p.openedById,
            openedVia: p.openedVia,
            agentId: p.agentId,
            agentSessionId: p.agentSessionId,
            agentAuthored: Boolean(
              p.agentId ?? p.agentSessionId ?? p.openedVia,
            ),
            mergeRequestedById: p.mergeRequestedById,
            mergedVia: p.mergedVia,
            reviews: (reviews.get(p.id) ?? []).map((r) => ({
              ...r,
              current: r.headSha === p.headSha,
            })),
            links: refs.get(p.id) ?? [],
          },
          { repositoryId: p.repositoryId, facet: p.state },
        ),
      );
    }
  }

  // Issues.
  const issueIds = ids(filter, "issueIds");
  if (!skip(issueIds)) {
    const issues = await db
      .select()
      .from(s.codeIssue)
      .where(
        and(
          eq(s.codeIssue.organizationId, organizationId),
          issueIds ? inArray(s.codeIssue.id, issueIds) : undefined,
        ),
      );
    const refs = await linkRefs(db, organizationId, "issue", issueIds);
    for (const i of issues) {
      const repository = repositories.get(i.repositoryId);
      if (!repository) continue;
      rows.push(
        row(
          {
            type: "codeIssue",
            id: i.id,
            organizationId,
            repositoryId: i.repositoryId,
            repositoryFullName: repository.fullName,
            provider: repository.provider,
            number: i.number,
            title: i.title,
            bodyExcerpt: i.bodyExcerpt,
            state: i.state,
            labels: i.labels,
            assignees: i.assignees,
            authorLogin: i.authorLogin,
            webUrl: i.webUrl,
            hostCreatedAt: iso(i.hostCreatedAt),
            hostUpdatedAt: iso(i.hostUpdatedAt),
            importedWorkItemId: i.importedWorkItemId,
            links: refs.get(i.id) ?? [],
          },
          { repositoryId: i.repositoryId, facet: i.state },
        ),
      );
    }
  }

  rows.push(...(await linkRows(db, organizationId, filter, repositories)));
  rows.push(...(await writeRows(db, organizationId, filter, repositories)));

  // Identities.
  const identityUserIds = ids(filter, "identityUserIds");
  const identityConnections = ids(filter, "connectionIds");
  if (!skip(identityUserIds) || !skip(identityConnections)) {
    const identities = await db
      .select({
        identity: s.codeHostIdentity,
        archivedAt: s.codeConnection.archivedAt,
      })
      .from(s.codeHostIdentity)
      .innerJoin(
        s.codeConnection,
        and(
          eq(
            s.codeConnection.organizationId,
            s.codeHostIdentity.organizationId,
          ),
          eq(s.codeConnection.id, s.codeHostIdentity.connectionId),
        ),
      )
      .where(
        and(
          eq(s.codeHostIdentity.organizationId, organizationId),
          "all" in filter
            ? undefined
            : or(
                identityUserIds?.length
                  ? inArray(s.codeHostIdentity.userId, identityUserIds)
                  : sql`false`,
                identityConnections?.length
                  ? inArray(
                      s.codeHostIdentity.connectionId,
                      identityConnections,
                    )
                  : sql`false`,
              ),
        ),
      );
    for (const { identity, archivedAt } of identities)
      if (!archivedAt)
        rows.push(
          row(
            {
              type: "codeIdentity",
              id: `${identity.connectionId}:${identity.userId}`,
              organizationId,
              connectionId: identity.connectionId,
              userId: identity.userId,
              login: identity.login,
            },
            {},
          ),
        );
  }
  return rows;
}

type Repositories = Awaited<ReturnType<typeof repositoryContext>>;

function linkScope(filter: Filter): SQL | undefined {
  if ("all" in filter) return undefined;
  const conditions: SQL[] = [];
  if (filter.workItemIds?.length)
    conditions.push(inArray(s.codeWorkLink.workItemId, filter.workItemIds));
  const targets = [
    ...(filter.targetIds ?? []),
    ...(filter.pullRequestIds ?? []),
    ...(filter.issueIds ?? []),
  ];
  if (targets.length)
    conditions.push(inArray(s.codeWorkLink.targetId, targets));
  if (filter.repositoryIds?.length)
    conditions.push(inArray(s.codeWorkLink.repositoryId, filter.repositoryIds));
  return conditions.length ? or(...conditions) : sql`false`;
}

async function linkRows(
  db: Database | Tx,
  organizationId: string,
  filter: Filter,
  repositories: Repositories,
) {
  const links = await db
    .select()
    .from(s.codeWorkLink)
    .where(
      and(
        eq(s.codeWorkLink.organizationId, organizationId),
        isNull(s.codeWorkLink.unlinkedAt),
        linkScope(filter),
      ),
    );
  const visible = links.filter((l) => repositories.has(l.repositoryId));
  const of = (target: string) =>
    visible.filter((l) => l.target === target).map((l) => l.targetId);
  const [branches, prs, issues, commits] = await Promise.all([
    of("branch").length
      ? db
          .select()
          .from(s.codeBranch)
          .where(
            and(
              eq(s.codeBranch.organizationId, organizationId),
              inArray(s.codeBranch.id, of("branch")),
            ),
          )
      : [],
    of("pull_request").length
      ? db
          .select()
          .from(s.codePullRequest)
          .where(
            and(
              eq(s.codePullRequest.organizationId, organizationId),
              inArray(s.codePullRequest.id, of("pull_request")),
            ),
          )
      : [],
    of("issue").length
      ? db
          .select()
          .from(s.codeIssue)
          .where(
            and(
              eq(s.codeIssue.organizationId, organizationId),
              inArray(s.codeIssue.id, of("issue")),
            ),
          )
      : [],
    of("commit").length
      ? db
          .select()
          .from(s.codeCommit)
          .where(
            and(
              eq(s.codeCommit.organizationId, organizationId),
              inArray(s.codeCommit.id, of("commit")),
            ),
          )
      : [],
  ]);
  const [checks, reviews] = await Promise.all([
    checksOf(
      db,
      organizationId,
      prs.map((p) => ({ repositoryId: p.repositoryId, sha: p.headSha })),
    ),
    prs.length
      ? reviewsOf(
          db,
          organizationId,
          prs.map((p) => p.id),
        )
      : new Map<string, Omit<CodeReviewRef, "current">[]>(),
  ]);
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const prById = new Map(prs.map((p) => [p.id, p]));
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const commitById = new Map(commits.map((c) => [c.id, c]));
  const rows: CodeProjectionRow[] = [];
  for (const l of visible) {
    const repository = repositories.get(l.repositoryId)!;
    let summary: CodeLinkSummary | undefined;
    if (l.target === "branch") {
      const b = branchById.get(l.targetId);
      if (b)
        summary = {
          target: "branch",
          name: b.name,
          headSha: b.headSha,
          deleted: !!b.deletedAt,
          webUrl: branchUrl(repository, b.name),
        };
    } else if (l.target === "pull_request") {
      const p = prById.get(l.targetId);
      if (p)
        summary = {
          target: "pull_request",
          number: p.number,
          title: p.title,
          state: p.state,
          draft: p.draft,
          headBranch: p.headBranch,
          checks: checks.get(`${p.repositoryId}:${p.headSha}`)?.state ?? "none",
          // The host's decision with the reviews recorded in Lictory.
          reviewDecision: reviewState({
            ...p,
            reviews: reviews.get(p.id),
          }),
          webUrl: p.webUrl,
        };
    } else if (l.target === "issue") {
      const i = issueById.get(l.targetId);
      if (i)
        summary = {
          target: "issue",
          number: i.number,
          title: i.title,
          state: i.state,
          webUrl: i.webUrl,
        };
    } else {
      const c = commitById.get(l.targetId);
      if (c)
        summary = {
          target: "commit",
          sha: c.sha,
          message: c.message.split("\n")[0]!.slice(0, 200),
          authorName: c.authorName,
          committedAt: iso(c.committedAt),
          webUrl: c.webUrl,
        };
    }
    if (!summary) continue;
    rows.push(
      row(
        {
          type: "codeLink",
          id: l.id,
          organizationId,
          workItemId: l.workItemId,
          projectId: l.projectId,
          repositoryId: l.repositoryId,
          repositoryFullName: repository.fullName,
          provider: repository.provider,
          target: l.target,
          targetId: l.targetId,
          source: l.source,
          createdById: l.createdById,
          performedVia: l.performedVia,
          agentSessionId: l.agentSessionId,
          createdAt: iso(l.createdAt),
          summary,
        },
        {
          repositoryId: l.repositoryId,
          projectId: l.projectId,
          workItemId: l.workItemId,
        },
      ),
    );
  }
  return rows;
}

// A branch's page on its host.
function branchUrl(
  repository: { webUrl: string; provider: string },
  name: string,
) {
  const path = name.split("/").map(encodeURIComponent).join("/");
  return repository.provider === "gitlab"
    ? `${repository.webUrl}/-/tree/${path}`
    : repository.provider === "bitbucket"
      ? `${repository.webUrl}/branch/${path}`
      : `${repository.webUrl}/tree/${path}`;
}

async function writeRows(
  db: Database | Tx,
  organizationId: string,
  filter: Filter,
  repositories: Repositories,
) {
  const writeIds = ids(filter, "writeIds") ?? [];
  const items = ids(filter, "workItemIds") ?? [];
  const all = "all" in filter;
  if (!all && !writeIds.length && !items.length) return [];
  const writes = await db
    .select()
    .from(s.codeWrite)
    .where(
      and(
        eq(s.codeWrite.organizationId, organizationId),
        inArray(s.codeWrite.status, [...visibleWrite]),
        all
          ? undefined
          : or(
              writeIds.length ? inArray(s.codeWrite.id, writeIds) : sql`false`,
              items.length
                ? inArray(s.codeWrite.workItemId, items)
                : sql`false`,
            ),
      ),
    );
  const rows: CodeProjectionRow[] = [];
  for (const w of writes) {
    const repository = repositories.get(w.repositoryId);
    if (!repository) continue;
    rows.push(
      row(
        {
          type: "codeWrite",
          id: w.id,
          organizationId,
          repositoryId: w.repositoryId,
          repositoryFullName: repository.fullName,
          kind: w.kind,
          status: w.status as (typeof visibleWrite)[number],
          summary: writeSummary(w.kind, w.payload),
          workItemId: w.workItemId,
          pullRequestId: w.pullRequestId,
          requestedById: w.requestedById,
          performedVia: w.performedVia,
          attempts: w.attempts,
          lastError: w.lastError,
          createdAt: iso(w.createdAt),
          updatedAt: iso(w.updatedAt),
        },
        {
          repositoryId: w.repositoryId,
          workItemId: w.workItemId,
          facet: w.status,
        },
      ),
    );
  }
  return rows;
}

// The stored keys a touch may have to delete.
async function storedKeys(
  tx: Tx,
  organizationId: string,
  touch: CodeTouch,
  expected: string[],
) {
  const keys = new Set(expected);
  const add = (type: string, list?: string[]) =>
    list?.forEach((id) => keys.add(`${type}:${id}`));
  add("codeConnection", touch.connectionIds);
  add("codeRepository", touch.repositoryIds);
  add("codePullRequest", touch.pullRequestIds);
  add("codeIssue", touch.issueIds);
  add("codeWrite", touch.writeIds);
  // Every link (also unlinked ones) the touch covers.
  const scope = linkScope(touch);
  const links = await tx
    .select({ id: s.codeWorkLink.id })
    .from(s.codeWorkLink)
    .where(and(eq(s.codeWorkLink.organizationId, organizationId), scope));
  add(
    "codeLink",
    links.map((l) => l.id),
  );
  const conditions: SQL[] = [inArray(s.codeEntity.key, [...keys])];
  if (touch.workItemIds?.length)
    conditions.push(
      and(
        inArray(s.codeEntity.type, ["codeLink", "codeWrite"]),
        inArray(s.codeEntity.workItemId, touch.workItemIds),
      )!,
    );
  if (touch.connectionIds?.length) {
    // An archived connection's rows (repositories, mirrors, links, writes)
    // leave the projection with it.
    const archived = await tx
      .select({ id: s.codeRepository.id })
      .from(s.codeRepository)
      .innerJoin(
        s.codeConnection,
        and(
          eq(s.codeConnection.organizationId, s.codeRepository.organizationId),
          eq(s.codeConnection.id, s.codeRepository.connectionId),
        ),
      )
      .where(
        and(
          eq(s.codeRepository.organizationId, organizationId),
          inArray(s.codeRepository.connectionId, touch.connectionIds),
          sql`${s.codeConnection.archivedAt} is not null`,
        ),
      );
    if (archived.length)
      conditions.push(
        inArray(
          s.codeEntity.repositoryId,
          archived.map((r) => r.id),
        ),
      );
  }
  if (touch.connectionIds?.length)
    conditions.push(
      and(
        eq(s.codeEntity.type, "codeIdentity"),
        or(
          ...touch.connectionIds.map(
            (id) => sql`${s.codeEntity.key} like ${`codeIdentity:${id}:%`}`,
          ),
        ),
      )!,
    );
  if (touch.identityUserIds?.length)
    conditions.push(
      and(
        eq(s.codeEntity.type, "codeIdentity"),
        or(
          ...touch.identityUserIds.map(
            (id) => sql`${s.codeEntity.key} like ${`codeIdentity:%:${id}`}`,
          ),
        ),
      )!,
    );
  return tx
    .select({ key: s.codeEntity.key, row: s.codeEntity })
    .from(s.codeEntity)
    .where(
      and(eq(s.codeEntity.organizationId, organizationId), or(...conditions)),
    );
}

const BATCH = 500;

async function upsertRows(
  tx: Tx,
  organizationId: string,
  rows: CodeProjectionRow[],
) {
  for (let index = 0; index < rows.length; index += BATCH) {
    const batch = rows.slice(index, index + BATCH);
    const written = await tx
      .insert(s.codeEntity)
      .values(batch)
      .onConflictDoUpdate({
        target: s.codeEntity.key,
        set: {
          repositoryId: sql`excluded.repository_id`,
          projectId: sql`excluded.project_id`,
          workItemId: sql`excluded.work_item_id`,
          type: sql`excluded.type`,
          facet: sql`excluded.facet`,
          data: sql`excluded.data`,
          updatedAt: sql`now()`,
        },
        // Keys are server-chosen ids; a row never moves across tenants.
        setWhere: eq(s.codeEntity.organizationId, organizationId),
      })
      .returning({ key: s.codeEntity.key });
    if (written.length !== batch.length)
      throw new Error("A code projection key belongs to another organization.");
  }
}

async function deleteKeys(tx: Tx, organizationId: string, keys: string[]) {
  for (let index = 0; index < keys.length; index += BATCH)
    await tx
      .delete(s.codeEntity)
      .where(
        and(
          eq(s.codeEntity.organizationId, organizationId),
          inArray(s.codeEntity.key, keys.slice(index, index + BATCH)),
        ),
      );
}

type StoredRow = typeof s.codeEntity.$inferSelect;
const same = (a: CodeProjectionRow, b: StoredRow) =>
  a.repositoryId === b.repositoryId &&
  a.projectId === b.projectId &&
  a.workItemId === b.workItemId &&
  a.type === b.type &&
  a.facet === b.facet &&
  canonicalJson(a.data) === canonicalJson(b.data);

// Recomputes the rows a writer touched. The caller holds the organization
// lock inside `tx`.
export async function writeCodeProjections(
  tx: Tx,
  organizationId: string,
  touch: CodeTouch,
) {
  const expected = await computeCodeRows(tx, organizationId, touch);
  for (const r of expected)
    if (r.organizationId !== organizationId)
      throw new Error(
        `Code projection ${r.key} belongs to another organization.`,
      );
  const stored = await storedKeys(
    tx,
    organizationId,
    touch,
    expected.map((r) => r.key),
  );
  const existing = new Map(stored.map((r) => [r.key, r.row]));
  const wanted = new Set(expected.map((r) => r.key));
  await upsertRows(
    tx,
    organizationId,
    expected.filter((r) => {
      const current = existing.get(r.key);
      return !current || !same(r, current);
    }),
  );
  await deleteKeys(
    tx,
    organizationId,
    stored.map((r) => r.key).filter((key) => !wanted.has(key)),
  );
}

// Rows that differ from a rebuild (the test invariant).
export async function codeProjectionDrift(
  db: Database,
  organizationId: string,
) {
  return db.transaction(async (tx) => {
    const expected = new Map(
      (await computeCodeRows(tx, organizationId, { all: true })).map((r) => [
        r.key,
        r,
      ]),
    );
    const stored = await tx
      .select()
      .from(s.codeEntity)
      .where(eq(s.codeEntity.organizationId, organizationId));
    const drift: string[] = [];
    for (const r of stored) {
      const want = expected.get(r.key);
      if (!want) drift.push(`extra ${r.key}`);
      else if (!same(want, r)) drift.push(`differs ${r.key}`);
      expected.delete(r.key);
    }
    for (const key of expected.keys()) drift.push(`missing ${key}`);
    return drift;
  });
}

// Reconciles `code_entity` with the domain under the organization lock.
export async function rebuildCodeProjections(tx: Tx, organizationId: string) {
  await lock(tx, organizationId);
  const expected = await computeCodeRows(tx, organizationId, { all: true });
  const stored = await tx
    .select()
    .from(s.codeEntity)
    .where(eq(s.codeEntity.organizationId, organizationId));
  const existing = new Map(stored.map((r) => [r.key, r]));
  const wanted = new Set(expected.map((r) => r.key));
  const upserts = expected.filter((r) => {
    const current = existing.get(r.key);
    return !current || !same(r, current);
  });
  const deletes = stored.map((r) => r.key).filter((k) => !wanted.has(k));
  await upsertRows(tx, organizationId, upserts);
  await deleteKeys(tx, organizationId, deletes);
  return { upserted: upserts.length, deleted: deletes.length };
}
