import { and, desc, eq, exists, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
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
    "Search recorded conclusions and approved or delivered specification revisions in your organization. Results retain the exact revision, author and evidence kind: a recorded decision is a conclusion, an approved revision is agreed intent, and a delivered revision is recorded delivery scope. Never infer delivered behavior from approval alone. Archived decisions and archived projects are excluded. Returns bounded excerpts; open the work item for full evidence.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id.optional(),
    query: z.string().trim().max(200).default(""),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async run(ctx, q) {
    const roster = await directory(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
    );
    if (q.projectId && !roster.projects.some((p) => p.id === q.projectId))
      throw new CapabilityError("not_found", "This project is unavailable.");
    const pattern = `%${q.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    // Provider status describes an issue, not which specification revision was
    // implemented. A later export to an already-done issue must never turn a
    // new proposal into purported delivered behavior.
    const delivered = eq(
      s.workItem.deliveredRevisionId,
      s.specificationRevision.id,
    );
    const approved = exists(
      ctx.db
        .select({ id: s.approval.id })
        .from(s.approval)
        .where(
          and(
            eq(s.approval.organizationId, q.organizationId),
            eq(s.approval.revisionId, s.specificationRevision.id),
            eq(s.approval.status, "granted"),
          ),
        ),
    );
    const [decisions, specifications] = await Promise.all([
      ctx.db
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
        .limit(q.limit),
      ctx.db
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
          delivered: sql<boolean>`coalesce(${delivered}, false)`,
        })
        .from(s.specificationRevision)
        .innerJoin(
          s.workItem,
          and(
            eq(s.workItem.organizationId, q.organizationId),
            eq(s.workItem.id, s.specificationRevision.workItemId),
          ),
        )
        .innerJoin(
          s.project,
          and(
            eq(s.project.organizationId, q.organizationId),
            eq(s.project.id, s.workItem.projectId),
          ),
        )
        .where(
          and(
            eq(s.specificationRevision.organizationId, q.organizationId),
            isNull(s.project.archivedAt),
            q.projectId ? eq(s.workItem.projectId, q.projectId) : undefined,
            or(
              and(
                approved,
                eq(s.workItem.refinementState, "ready"),
                sql`${s.specificationRevision.number} = (select max(r.number) from specification_revision r where r.organization_id = ${q.organizationId} and r.work_item_id = ${s.workItem.id})`,
              ),
              delivered,
            ),
            q.query
              ? or(
                  ilike(s.specificationRevision.title, pattern),
                  ilike(s.specificationRevision.content, pattern),
                )
              : undefined,
          ),
        )
        .orderBy(
          desc(s.specificationRevision.createdAt),
          desc(s.specificationRevision.id),
        )
        .limit(q.limit),
    ]);
    return {
      results: [
        ...decisions.map((d) => ({
          ...d,
          kind: "decision" as const,
          key: `${d.projectKey}-${d.number}`,
          href: `/${roster.organizations.find((o) => o.id === q.organizationId)!.slug}/items/${d.projectKey}-${d.number}`,
        })),
        ...specifications.map((r) => ({
          ...r,
          revisionId: r.id,
          kind: r.delivered ? ("delivered" as const) : ("approved" as const),
          key: `${r.projectKey}-${r.number}`,
          href: `/${roster.organizations.find((o) => o.id === q.organizationId)!.slug}/items/${r.projectKey}-${r.number}`,
        })),
      ],
    };
  },
});

export const productKnowledgeCapabilities = [searchProductKnowledge];
