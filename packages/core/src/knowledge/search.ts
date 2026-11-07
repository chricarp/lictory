import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";

// Content searches behind searchKnowledge and searchProductKnowledge
// (docs/internals/spaces.md#search-and-product-knowledge). Every function runs
// inside the caller's read-only snapshot, after the caller checked the
// person's organization membership, and returns at most `limit` rows ranked
// title matches first, then most recent. Matching is a case-insensitive
// substring match with LIKE wildcards taken literally; the trigram indexes
// on page commits and specification revisions make it fast.

export type SearchScope = {
  organizationId: string;
  projectId?: string;
  // Trimmed; empty matches everything (most recent first).
  query: string;
  limit: number;
};

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

// Markdown escapes these characters (the page serializer and the rich
// editor's Markdown output), so `refund_limit` is stored as `refund\_limit`.
const markdownEscaped = (text: string) =>
  text.replace(/([\\`*_{}[\]<>|])/g, "\\$1");

// The LIKE patterns that find `query` in text and in Markdown.
function patterns(query: string) {
  const plain = `%${escapeLike(query)}%`;
  const escaped = markdownEscaped(query);
  return {
    plain,
    markdown: escaped === query ? null : `%${escapeLike(escaped)}%`,
    escapedQuery: escaped === query ? null : escaped,
  };
}

function matches(column: AnyPgColumn, query: string, markdown = false): SQL {
  if (!query) return sql`true`;
  const p = patterns(query);
  return markdown && p.markdown
    ? sql`(${column} ilike ${p.plain} or ${column} ilike ${p.markdown})`
    : sql`${column} ilike ${p.plain}`;
}

// About 900 characters of `column` around the first occurrence of the
// query (or its Markdown-escaped form): enough for an excerpt, without
// reading whole documents for a list of results.
function around(column: AnyPgColumn, query: string): SQL<string> {
  if (!query) return sql<string>`left(${column}, 900)`;
  const p = patterns(query);
  const position = p.escapedQuery
    ? sql`coalesce(nullif(strpos(lower(${column}), lower(${query})), 0), nullif(strpos(lower(${column}), lower(${p.escapedQuery})), 0), 1)`
    : sql`greatest(strpos(lower(${column}), lower(${query})), 1)`;
  return sql<string>`substring(${column} from greatest(1, ${position} - 300) for 900)`;
}

// ------------------------------------------------------------------ pages

export type PublishedPageRow = {
  pageId: string;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  publishing: "direct" | "reviewed";
  commitId: string;
  title: string;
  titleMatch: boolean;
  publishedAt: Date;
  authorId: string;
  approverIds: string[];
  pullRequestId: string | null;
  // Main's first-parent position of the commit: what readers call
  // "version N".
  version: number;
  // Titles of the pages above it, from the top of the space.
  path: string[];
  excerpt: string;
  content?: Record<string, unknown>;
};

// Published pages the person can read: the head commit of main of every
// page that is not archived (nor under an archived page) in a space that is
// not archived and that the person reads (`space_reader`, with a current
// organization membership, as spaceAccess checks). Restricted spaces count
// only for their named readers. Branches, pull requests and live drafts are
// never searched. `projectId` narrows to spaces homed in that project (or
// one of its teams).
export async function searchPublishedPages(
  tx: Tx,
  scope: SearchScope & { userId: string; withDocument?: boolean },
): Promise<PublishedPageRow[]> {
  const org = scope.organizationId;
  const titleMatch = scope.query
    ? sql<boolean>`${s.pageCommit.title} ilike ${patterns(scope.query).plain}`
    : sql<boolean>`false`;
  const found = await tx
    .select({
      pageId: s.page.id,
      spaceId: s.space.id,
      spaceName: s.space.name,
      spaceSlug: s.space.slug,
      publishing: s.space.publishing,
      commitId: s.pageCommit.id,
      title: s.pageCommit.title,
      titleMatch,
      publishedAt: s.pageCommit.createdAt,
      authorId: s.pageCommit.authorId,
      approverIds: s.pageCommit.approverIds,
      pullRequestId: s.pageCommit.pullRequestId,
    })
    .from(s.pageBranch)
    .innerJoin(
      s.page,
      and(
        eq(s.page.organizationId, org),
        eq(s.page.id, s.pageBranch.pageId),
        isNull(s.page.archivedAt),
      ),
    )
    .innerJoin(
      s.space,
      and(
        eq(s.space.organizationId, org),
        eq(s.space.id, s.page.spaceId),
        isNull(s.space.archivedAt),
      ),
    )
    .innerJoin(
      s.spaceReader,
      and(
        eq(s.spaceReader.organizationId, org),
        eq(s.spaceReader.spaceId, s.space.id),
        eq(s.spaceReader.userId, scope.userId),
      ),
    )
    // space_reader can lag a membership removal (see spaces/access.ts).
    .innerJoin(
      s.member,
      and(eq(s.member.organizationId, org), eq(s.member.userId, scope.userId)),
    )
    .innerJoin(
      s.pageCommit,
      and(
        eq(s.pageCommit.organizationId, org),
        eq(s.pageCommit.pageId, s.page.id),
        eq(s.pageCommit.id, s.pageBranch.headCommitId),
      ),
    )
    .where(
      and(
        eq(s.pageBranch.organizationId, org),
        eq(s.pageBranch.isMain, true),
        isNull(s.pageBranch.deletedAt),
        scope.projectId ? eq(s.space.projectId, scope.projectId) : undefined,
        // Archiving a page hides its subtree.
        sql`${s.page.id} not in (
          with recursive hidden(id) as (
            select h.id from page h
            where h.organization_id = ${org} and h.archived_at is not null
            union
            select c.id from page c join hidden on c.parent_id = hidden.id
            where c.organization_id = ${org}
          )
          select id from hidden)`,
        scope.query
          ? or(
              matches(s.pageCommit.title, scope.query),
              matches(s.pageCommit.markdown, scope.query, true),
            )
          : undefined,
      ),
    )
    .orderBy(
      ...(scope.query ? [desc(titleMatch)] : []),
      desc(s.pageCommit.createdAt),
      desc(s.page.id),
    )
    .limit(scope.limit);
  if (!found.length) return [];
  const commitIds = found.map((f) => f.commitId);
  const pageIds = found.map((f) => f.pageId);
  const [bodies, versions, ancestors] = await Promise.all([
    tx
      .select({
        id: s.pageCommit.id,
        excerpt: sql<string>`left(${s.pageCommit.markdown}, 4000)`,
        ...(scope.withDocument ? { content: s.pageCommit.content } : {}),
      })
      .from(s.pageCommit)
      .where(
        and(
          eq(s.pageCommit.organizationId, org),
          inArray(s.pageCommit.id, commitIds),
        ),
      ),
    commitVersions(tx, org, commitIds),
    pageAncestors(tx, org, pageIds),
  ]);
  const body = new Map(bodies.map((b) => [b.id, b]));
  return found.map((f) => ({
    ...f,
    version: versions.get(f.commitId) ?? 1,
    path: ancestors.get(f.pageId) ?? [],
    excerpt: body.get(f.commitId)?.excerpt ?? "",
    content: (body.get(f.commitId) as { content?: Record<string, unknown> })
      ?.content,
  }));
}

// Version numbers count main's first-parent chain, as the page history
// does: the first commit is version 1.
export async function commitVersions(tx: Tx, org: string, commitIds: string[]) {
  const rows = await tx.execute<{ head: string; version: number }>(sql`
    with recursive chain(head, next, n) as (
      select c.id, c.parent_ids[1], 1 from page_commit c
      where c.organization_id = ${org}
        and c.id in (${sql.join(
          commitIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      union all
      select chain.head, p.parent_ids[1], chain.n + 1
      from chain join page_commit p
        on p.organization_id = ${org} and p.id = chain.next
    )
    select head, max(n)::int as version from chain group by head
  `);
  return new Map(rows.map((r) => [r.head, Number(r.version)]));
}

// The published titles of each page's ancestors, from the top. Ancestors
// are in the same space, so whoever reads the page reads them.
async function pageAncestors(tx: Tx, org: string, pageIds: string[]) {
  const rows = await tx.execute<{
    page: string;
    ancestor: string;
    depth: number;
  }>(sql`
    with recursive up(page, ancestor, depth) as (
      select p.id, p.parent_id, 1 from page p
      where p.organization_id = ${org}
        and p.id in (${sql.join(
          pageIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        and p.parent_id is not null
      union all
      select up.page, q.parent_id, up.depth + 1
      from up join page q on q.organization_id = ${org} and q.id = up.ancestor
      where q.parent_id is not null and up.depth < 50
    )
    select page, ancestor, depth from up
  `);
  const out = new Map<string, string[]>();
  if (!rows.length) return out;
  const titles = new Map(
    (
      await tx
        .select({ pageId: s.pageBranch.pageId, title: s.pageCommit.title })
        .from(s.pageBranch)
        .innerJoin(
          s.pageCommit,
          and(
            eq(s.pageCommit.organizationId, org),
            eq(s.pageCommit.id, s.pageBranch.headCommitId),
          ),
        )
        .where(
          and(
            eq(s.pageBranch.organizationId, org),
            eq(s.pageBranch.isMain, true),
            inArray(s.pageBranch.pageId, [
              ...new Set(rows.map((r) => r.ancestor)),
            ]),
          ),
        )
    ).map((r) => [r.pageId, r.title]),
  );
  const byPage = new Map<string, { ancestor: string; depth: number }[]>();
  for (const r of rows)
    byPage.set(r.page, [
      ...(byPage.get(r.page) ?? []),
      { ancestor: r.ancestor, depth: Number(r.depth) },
    ]);
  for (const [page, list] of byPage)
    out.set(
      page,
      list
        .sort((a, b) => b.depth - a.depth)
        .map((a) => titles.get(a.ancestor) ?? "Untitled"),
    );
  return out;
}

// ------------------------------------------------------------- work items

// Unarchived work items of unarchived projects (every organization member
// reads every project) whose title or current specification (the latest
// revision on main) matches. Branches and unmerged proposals are not
// searched.
//
// Matching revisions are found first and then kept only when they are their
// item's latest, so the trigram index on revision content can find them
// without reading every item's specification.
export async function searchWorkItems(tx: Tx, scope: SearchScope) {
  const org = scope.organizationId;
  const p = scope.query ? patterns(scope.query) : null;
  const matched = p
    ? sql`
      select w.id, true as title_match from work_item w
      where w.organization_id = ${org} and w.title ilike ${p.plain}
      union all
      select r.work_item_id, false from specification_revision r
      where r.organization_id = ${org}
        and ${
          p.markdown
            ? sql`(r.content ilike ${p.plain} or r.content ilike ${p.markdown})`
            : sql`r.content ilike ${p.plain}`
        }
        and not exists (
          select 1 from specification_revision n
          where n.organization_id = ${org}
            and n.work_item_id = r.work_item_id and n.number > r.number
        )`
    : sql`select w.id, false as title_match from work_item w
      where w.organization_id = ${org}`;
  const found = await tx.execute<{
    id: string;
    revision_id: string | null;
    title_match: boolean;
  }>(sql`
    with matched(id, title_match) as (${matched})
    select w.id, bool_or(m.title_match) as title_match,
      (select l.id from specification_revision l
        where l.organization_id = ${org} and l.work_item_id = w.id
        order by l.number desc limit 1) as revision_id
    from matched m
    join work_item w on w.organization_id = ${org} and w.id = m.id
    join project p on p.organization_id = ${org} and p.id = w.project_id
    where w.archived_at is null
      and p.archived_at is null
      ${scope.projectId ? sql`and w.project_id = ${scope.projectId}` : sql``}
    group by w.id, w.updated_at
    order by title_match desc, w.updated_at desc, w.id desc
    limit ${scope.limit}
  `);
  if (!found.length) return [];
  const revisionIds = found.flatMap((f) =>
    f.revision_id ? [f.revision_id] : [],
  );
  const [items, revisions] = await Promise.all([
    tx
      .select({
        id: s.workItem.id,
        title: s.workItem.title,
        number: s.workItem.number,
        projectId: s.project.id,
        projectKey: s.project.key,
        refinementState: s.workItem.refinementState,
        updatedAt: s.workItem.updatedAt,
      })
      .from(s.workItem)
      .innerJoin(
        s.project,
        and(
          eq(s.project.organizationId, org),
          eq(s.project.id, s.workItem.projectId),
        ),
      )
      .where(
        and(
          eq(s.workItem.organizationId, org),
          inArray(
            s.workItem.id,
            found.map((f) => f.id),
          ),
        ),
      ),
    revisionIds.length
      ? tx
          .select({
            id: s.specificationRevision.id,
            number: s.specificationRevision.number,
            window: around(s.specificationRevision.content, scope.query),
          })
          .from(s.specificationRevision)
          .where(
            and(
              eq(s.specificationRevision.organizationId, org),
              inArray(s.specificationRevision.id, revisionIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const item = new Map(items.map((i) => [i.id, i]));
  const revision = new Map(revisions.map((r) => [r.id, r]));
  return found.map((f) => {
    const r = f.revision_id ? revision.get(f.revision_id) : undefined;
    return {
      ...item.get(f.id)!,
      titleMatch: Boolean(f.title_match),
      revisionId: r?.id ?? null,
      revisionNumber: r?.number ?? null,
      window: r?.window ?? "",
    };
  });
}

// -------------------------------------------- decisions and agreements

// Archived work items, like archived projects, are withdrawn from active
// product knowledge together with the decisions recorded on them. Restoring the
// item restores them; nothing is deleted.
export function searchDecisions(tx: Tx, q: SearchScope) {
  const titleMatch = q.query
    ? sql<boolean>`${s.decision.title} ilike ${patterns(q.query).plain}`
    : sql<boolean>`false`;
  return tx
    .select({
      id: s.decision.id,
      title: s.decision.title,
      excerpt: sql<string>`left(${s.decision.body}, 4000)`,
      window: around(s.decision.body, q.query),
      titleMatch,
      workItemId: s.decision.workItemId,
      revisionId: s.decision.revisionId,
      revisionNumber: s.specificationRevision.number,
      projectKey: s.project.key,
      number: s.workItem.number,
      authorId: s.decision.authorId,
      sourceThreadId: s.decision.sourceThreadId,
      createdAt: s.decision.createdAt,
    })
    .from(s.decision)
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, q.organizationId),
        eq(s.project.id, s.decision.projectId),
      ),
    )
    .innerJoin(
      s.workItem,
      and(
        eq(s.workItem.organizationId, q.organizationId),
        eq(s.workItem.id, s.decision.workItemId),
      ),
    )
    .innerJoin(
      s.specificationRevision,
      and(
        eq(s.specificationRevision.organizationId, q.organizationId),
        eq(s.specificationRevision.id, s.decision.revisionId),
      ),
    )
    .where(
      and(
        eq(s.decision.organizationId, q.organizationId),
        isNull(s.decision.archivedAt),
        isNull(s.workItem.archivedAt),
        isNull(s.project.archivedAt),
        q.projectId ? eq(s.decision.projectId, q.projectId) : undefined,
        q.query
          ? or(
              matches(s.decision.title, q.query),
              matches(s.decision.body, q.query, true),
            )
          : undefined,
      ),
    )
    .orderBy(
      ...(q.query ? [desc(titleMatch)] : []),
      desc(s.decision.createdAt),
      desc(s.decision.id),
    )
    .limit(q.limit);
}

// Each unarchived work item contributes at most two candidate revisions: its
// recorded delivered revision and, while it is ready, its latest revision when
// that revision holds a granted approval. Candidates are found from work items
// (one index probe for the latest revision each) and only their text is
// matched, so the cost follows the number of items rather than the length of
// their revision history.
//
// The match is computed inside a MATERIALIZED CTE on purpose: PostgreSQL cannot
// estimate ILIKE selectivity, and as a plain filter it would push the match
// down to a scan of every historical revision before the candidate join.
export async function searchSpecifications(tx: Tx, q: SearchScope) {
  const org = q.organizationId;
  const p = q.query ? patterns(q.query) : null;
  const matched = p
    ? p.markdown
      ? sql`(r.title ilike ${p.plain} or r.content ilike ${p.plain} or r.content ilike ${p.markdown})`
      : sql`(r.title ilike ${p.plain} or r.content ilike ${p.plain})`
    : sql`true`;
  const titleMatch = p ? sql`r.title ilike ${p.plain}` : sql`false`;
  const found = await tx.execute<{
    id: string;
    delivered: boolean;
    title_match: boolean;
  }>(sql`
    with candidate as materialized (
      select r.id, r.created_at,
        r.id is not distinct from w.delivered_revision_id as delivered,
        ${matched} as matches,
        ${titleMatch} as title_match
      from work_item w
      join project p on p.organization_id = ${org} and p.id = w.project_id
      left join lateral (
        select l.id from specification_revision l
        where l.organization_id = ${org} and l.work_item_id = w.id
          and w.refinement_state = 'ready'
        order by l.number desc
        limit 1
      ) latest on true
      join specification_revision r
        on r.organization_id = ${org} and r.work_item_id = w.id
        and r.id in (w.delivered_revision_id, latest.id)
      where w.organization_id = ${org}
        and w.archived_at is null
        and p.archived_at is null
        ${q.projectId ? sql`and w.project_id = ${q.projectId}` : sql``}
        -- Provider status describes an issue, not which specification
        -- revision was implemented: only the recorded delivered revision
        -- counts as delivered, and anything else needs a granted approval.
        and (
          r.id = w.delivered_revision_id
          or exists (
            select 1 from approval a
            where a.organization_id = ${org} and a.revision_id = r.id
              and a.status = 'granted'
          )
        )
    )
    select id, delivered, title_match from candidate
    where matches
    order by title_match desc, created_at desc, id desc
    limit ${q.limit}
  `);
  if (!found.length) return [];
  const rows = await tx
    .select({
      id: s.specificationRevision.id,
      title: s.specificationRevision.title,
      excerpt: sql<string>`left(${s.specificationRevision.content}, 4000)`,
      window: around(s.specificationRevision.content, q.query),
      workItemId: s.workItem.id,
      revisionNumber: s.specificationRevision.number,
      projectKey: s.project.key,
      number: s.workItem.number,
      authorId: s.specificationRevision.authorId,
      createdAt: s.specificationRevision.createdAt,
    })
    .from(s.specificationRevision)
    .innerJoin(
      s.workItem,
      and(
        eq(s.workItem.organizationId, org),
        eq(s.workItem.id, s.specificationRevision.workItemId),
      ),
    )
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, org),
        eq(s.project.id, s.workItem.projectId),
      ),
    )
    .where(
      and(
        eq(s.specificationRevision.organizationId, org),
        inArray(
          s.specificationRevision.id,
          found.map((f) => f.id),
        ),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return found.map((f) => ({
    ...byId.get(f.id)!,
    delivered: Boolean(f.delivered),
    titleMatch: Boolean(f.title_match),
  }));
}
