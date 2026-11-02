import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import { directory } from "@lictory/core/domain/service";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  CapabilityError,
} from "@lictory/core/capabilities/core";

const searchProductKnowledge = defineCapability({
  name: "searchProductKnowledge",
  title: "Find product agreements",
  description:
    "Search recorded conclusions and approved or delivered specification revisions in your organization. Results retain the exact revision, author and evidence kind: a recorded decision is a conclusion, an approved revision is agreed intent, and a delivered revision is recorded delivery scope. Never infer delivered behavior from approval alone. Archived decisions, archived work items (with the decisions recorded on them) and archived projects are excluded. Returns bounded excerpts; open the work item for full evidence.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id.optional(),
    query: z.string().trim().max(200).default(""),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async run(ctx, q) {
    // The roster check and both searches read one snapshot, so a project
    // archived or a membership removed mid-request cannot leak results the
    // directory check already rejected (or the reverse).
    return ctx.db.transaction(
      async (tx) => {
        const roster = await directory(
          tx,
          ctx.principal.userId,
          q.organizationId,
        );
        if (q.projectId && !roster.projects.some((p) => p.id === q.projectId))
          throw new CapabilityError(
            "not_found",
            "This project is unavailable.",
          );
        const slug = roster.organizations.find(
          (o) => o.id === q.organizationId,
        )!.slug;
        const pattern = `%${q.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const [decisions, specifications] = await Promise.all([
          searchDecisions(tx, q, pattern),
          searchSpecifications(tx, q, pattern),
        ]);
        return {
          results: [
            ...decisions.map((d) => ({
              ...d,
              kind: "decision" as const,
              key: `${d.projectKey}-${d.number}`,
              href: `/${slug}/items/${d.projectKey}-${d.number}`,
            })),
            ...specifications.map((r) => ({
              ...r,
              revisionId: r.id,
              kind: r.delivered
                ? ("delivered" as const)
                : ("approved" as const),
              key: `${r.projectKey}-${r.number}`,
              href: `/${slug}/items/${r.projectKey}-${r.number}`,
            })),
          ],
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
});

type Search = {
  organizationId: string;
  projectId?: string;
  query: string;
  limit: number;
};

// Archived work items, like archived projects, are withdrawn from active
// product knowledge together with the decisions recorded on them. Restoring the
// item restores them; nothing is deleted.
function searchDecisions(tx: Tx, q: Search, pattern: string) {
  return tx
    .select({
      id: s.decision.id,
      title: s.decision.title,
      excerpt: sql<string>`left(${s.decision.body}, 4000)`,
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
              ilike(s.decision.title, pattern),
              ilike(s.decision.body, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(desc(s.decision.createdAt), desc(s.decision.id))
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
async function searchSpecifications(tx: Tx, q: Search, pattern: string) {
  const org = q.organizationId;
  const matches = q.query
    ? sql`(r.title ilike ${pattern} or r.content ilike ${pattern})`
    : sql`true`;
  const found = await tx.execute<{ id: string; delivered: boolean }>(sql`
    with candidate as materialized (
      select r.id, r.created_at,
        r.id is not distinct from w.delivered_revision_id as delivered,
        ${matches} as matches
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
    select id, delivered from candidate
    where matches
    order by created_at desc, id desc
    limit ${q.limit}
  `);
  if (!found.length) return [];
  const rows = await tx
    .select({
      id: s.specificationRevision.id,
      title: s.specificationRevision.title,
      excerpt: sql<string>`left(${s.specificationRevision.content}, 4000)`,
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
  return found.map((f) => ({ ...byId.get(f.id)!, delivered: f.delivered }));
}

export const productKnowledgeCapabilities = [searchProductKnowledge];
