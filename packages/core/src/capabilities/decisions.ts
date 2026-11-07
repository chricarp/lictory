import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import { directory } from "@lictory/core/domain/service";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
} from "@lictory/core/capabilities/core";

// Recorded decisions by id, as pages show them (decision references and
// cards in Lictory Spaces): the conclusion, the work item and the exact
// revision it was recorded on, and whether it was withdrawn. Archived
// decisions are returned too, so a page that cites one can say it was
// archived instead of losing it. Decisions are work item content: every
// member of the organization reads them, like the item.

const EXCERPT = 2000;

const getDecisions = defineCapability({
  name: "getDecisions",
  title: "Get recorded decisions",
  description:
    "Recorded decisions by id (for example the decision references of a page): title, a bounded excerpt of the conclusion, the work item key and title, the revision number it was recorded on, and `archivedAt` (also set when its work item or project is archived: withdrawn from active product knowledge, kept for history). Ids that do not name a decision of this organization are left out. Find decisions with searchProductKnowledge.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    decisionIds: z.array(id).min(1).max(100),
  }),
  async run(ctx, q) {
    return ctx.db.transaction(
      async (tx) => {
        const roster = await directory(
          tx,
          ctx.principal.userId,
          q.organizationId,
        );
        const slug = roster.organizations.find(
          (o) => o.id === q.organizationId,
        )!.slug;
        const rows = await tx
          .select({
            id: s.decision.id,
            title: s.decision.title,
            body: s.decision.body,
            archivedAt: s.decision.archivedAt,
            createdAt: s.decision.createdAt,
            authorId: s.decision.authorId,
            workItemId: s.decision.workItemId,
            itemTitle: s.workItem.title,
            itemNumber: s.workItem.number,
            itemArchivedAt: s.workItem.archivedAt,
            projectId: s.project.id,
            projectKey: s.project.key,
            projectArchivedAt: s.project.archivedAt,
            revisionId: s.decision.revisionId,
            revisionNumber: s.specificationRevision.number,
          })
          .from(s.decision)
          .innerJoin(
            s.project,
            and(
              eq(s.project.organizationId, s.decision.organizationId),
              eq(s.project.id, s.decision.projectId),
            ),
          )
          .leftJoin(
            s.workItem,
            and(
              eq(s.workItem.organizationId, s.decision.organizationId),
              eq(s.workItem.id, s.decision.workItemId),
            ),
          )
          .leftJoin(
            s.specificationRevision,
            and(
              eq(
                s.specificationRevision.organizationId,
                s.decision.organizationId,
              ),
              eq(s.specificationRevision.id, s.decision.revisionId),
            ),
          )
          .where(
            and(
              eq(s.decision.organizationId, q.organizationId),
              inArray(s.decision.id, [...new Set(q.decisionIds)]),
            ),
          );
        const iso = (d: Date | null) => (d ? d.toISOString() : null);
        return {
          decisions: rows.map((r) => {
            const key =
              r.itemNumber == null ? null : `${r.projectKey}-${r.itemNumber}`;
            return {
              id: r.id,
              title: r.title,
              excerpt:
                r.body.length > EXCERPT
                  ? `${r.body.slice(0, EXCERPT - 1)}…`
                  : r.body,
              authorId: r.authorId,
              createdAt: r.createdAt.toISOString(),
              // Withdrawn with its item or project, or archived itself.
              archivedAt:
                iso(r.archivedAt) ??
                iso(r.itemArchivedAt) ??
                iso(r.projectArchivedAt),
              projectId: r.projectId,
              workItemId: r.workItemId,
              key,
              itemTitle: r.itemTitle,
              revisionId: r.revisionId,
              revisionNumber: r.revisionNumber,
              href: key ? `/${slug}/items/${key}` : null,
            };
          }),
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
});

export const decisionCapabilities = [getDecisions] as AnyCapability[];
