import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import { referencesInDocument } from "@lictory/core/contracts/references";
import { iterationLabel } from "@lictory/core/contracts/protocol";
import {
  workListAttrs,
  type MarkdownOptions,
  type ResolvedWorkList,
  type WorkListAttrs,
} from "@lictory/core/spaces/document/blocks";
import type { PageNode } from "@lictory/core/spaces/document/canonical";

// Resolves the work lists of a page's content at export time (getPage's
// Markdown for agents and Litto): each list becomes the items it names now,
// as static references. Work items are read by every member of the
// organization, so the list is the same for every reader of the page.
// Archived items are left out, as in the page.

const LIMIT = 200;

function workLists(content: unknown) {
  const found: WorkListAttrs[] = [];
  const visit = (n: PageNode) => {
    if (n.type === "workList") found.push(workListAttrs(n));
    n.content?.forEach(visit);
  };
  visit(content as PageNode);
  return found;
}

const keyOf = (attrs: WorkListAttrs) =>
  JSON.stringify([attrs.projectId, attrs.filter, attrs.filterId]);

export async function workListResolver(
  tx: Tx,
  organizationId: string,
  content: unknown,
): Promise<MarkdownOptions | null> {
  const lists = workLists(content);
  if (!lists.length) return null;
  const resolved = new Map<string, ResolvedWorkList>();
  const columns = {
    id: s.workItem.id,
    title: s.workItem.title,
    number: s.workItem.number,
    projectId: s.workItem.projectId,
    key: s.project.key,
  };
  const withProject = and(
    eq(s.project.organizationId, s.workItem.organizationId),
    eq(s.project.id, s.workItem.projectId),
  );
  for (const list of lists) {
    const key = keyOf(list);
    if (resolved.has(key)) continue;
    let rows: { id: string; title: string; number: number; key: string }[];
    let label: string | undefined;
    if (list.filter === "referenced") {
      const ids = [
        ...new Set(
          referencesInDocument(content)
            .filter((r) => r.kind === "item")
            .map((r) => r.id),
        ),
      ].slice(0, LIMIT);
      const found = ids.length
        ? await tx
            .select(columns)
            .from(s.workItem)
            .innerJoin(s.project, withProject)
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                inArray(s.workItem.id, ids),
                isNull(s.workItem.archivedAt),
                ...(list.projectId
                  ? [eq(s.workItem.projectId, list.projectId)]
                  : []),
              ),
            )
        : [];
      const byId = new Map(found.map((r) => [r.id, r]));
      rows = ids.flatMap((id) => byId.get(id) ?? []);
    } else {
      const base = and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.projectId, list.projectId ?? ""),
        isNull(s.workItem.archivedAt),
      );
      const filterId = list.filterId ?? "";
      rows =
        list.filter === "label"
          ? await tx
              .select(columns)
              .from(s.workItem)
              .innerJoin(s.project, withProject)
              .innerJoin(
                s.workItemLabel,
                and(
                  eq(s.workItemLabel.organizationId, s.workItem.organizationId),
                  eq(s.workItemLabel.workItemId, s.workItem.id),
                  eq(s.workItemLabel.labelId, filterId),
                ),
              )
              .where(base)
              .orderBy(asc(s.workItem.rank))
              .limit(LIMIT)
          : await tx
              .select(columns)
              .from(s.workItem)
              .innerJoin(s.project, withProject)
              .where(
                and(
                  base,
                  list.filter === "epic-children"
                    ? eq(s.workItem.parentId, filterId)
                    : eq(s.workItem.iterationId, filterId),
                ),
              )
              .orderBy(asc(s.workItem.rank))
              .limit(LIMIT);
      if (list.filter === "epic-children") {
        const [epic] = await tx
          .select({ number: s.workItem.number, key: s.project.key })
          .from(s.workItem)
          .innerJoin(s.project, withProject)
          .where(
            and(
              eq(s.workItem.organizationId, organizationId),
              eq(s.workItem.id, filterId),
            ),
          );
        if (epic) label = `Children of ${epic.key}-${epic.number}`;
      } else if (list.filter === "iteration") {
        const [iteration] = await tx
          .select({ name: s.iteration.name, number: s.iteration.number })
          .from(s.iteration)
          .where(
            and(
              eq(s.iteration.organizationId, organizationId),
              eq(s.iteration.id, filterId),
            ),
          );
        if (iteration) label = iterationLabel(iteration);
      } else {
        const [found] = await tx
          .select({ name: s.label.name })
          .from(s.label)
          .where(
            and(
              eq(s.label.organizationId, organizationId),
              eq(s.label.id, filterId),
            ),
          );
        if (found) label = `Label: ${found.name}`;
      }
    }
    resolved.set(key, {
      ...(label ? { label } : {}),
      items: rows.map((r) => ({
        id: r.id,
        key: `${r.key}-${r.number}`,
        title: r.title,
      })),
    });
  }
  return { workList: (attrs) => resolved.get(keyOf(attrs)) ?? null };
}
