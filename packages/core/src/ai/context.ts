import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { diffLines } from "@lictory/core/contracts/diff";
import { mergeBase } from "@lictory/core/contracts/merge";
import {
  isChildChange,
  isNewChild,
  pendingEntries,
} from "@lictory/core/contracts/decomposition";
import type { Tx } from "@lictory/core/domain/service";
import { criteriaToRead } from "@lictory/core/ai/readings";
import {
  composeIntelligenceContext,
  promptContext,
} from "@lictory/core/intelligence/compose";

// Context is bounded: long documents and large trees are truncated rather than
// sent whole, and only what refinement needs is included.
const MAX_ITEMS = 60;
const MAX_CONTENT = 8_000;
const MAX_DISCUSSIONS = 6;
const clip = (text: string, max = MAX_CONTENT) =>
  text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;

export type ItemReviewContext = Awaited<
  ReturnType<typeof itemReviewContext>
>["context"];
export type PullRequestContext = NonNullable<
  Awaited<ReturnType<typeof pullRequestContext>>
>["context"];

type ItemRow = typeof s.workItem.$inferSelect;

async function latestRevisions(tx: Tx, organizationId: string, ids: string[]) {
  if (!ids.length)
    return new Map<string, typeof s.specificationRevision.$inferSelect>();
  const rows = await tx
    .select()
    .from(s.specificationRevision)
    .where(
      and(
        eq(s.specificationRevision.organizationId, organizationId),
        inArray(s.specificationRevision.workItemId, ids),
      ),
    )
    .orderBy(desc(s.specificationRevision.number));
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!map.has(r.workItemId)) map.set(r.workItemId, r);
  return map;
}

export async function itemReviewContext(
  tx: Tx,
  organizationId: string,
  workItemId: string,
) {
  const items = await tx
    .select()
    .from(s.workItem)
    .where(eq(s.workItem.organizationId, organizationId));
  const byId = new Map(items.map((i) => [i.id, i]));
  const target = byId.get(workItemId);
  if (!target) throw new Error("The reviewed item no longer exists.");
  const [project] = await tx
    .select()
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, organizationId),
        eq(s.project.id, target.projectId),
      ),
    );
  const ancestors: ItemRow[] = [];
  for (
    let p = target.parentId ? byId.get(target.parentId) : undefined;
    p && ancestors.length < 4;
    p = p.parentId ? byId.get(p.parentId) : undefined
  )
    ancestors.unshift(p);
  const descendants: ItemRow[] = [];
  const queue = [target.id];
  for (const parentId of queue)
    for (const child of items.filter(
      (i) => i.parentId === parentId && !i.archivedAt,
    )) {
      if (descendants.length >= MAX_ITEMS) break;
      descendants.push(child);
      queue.push(child.id);
    }
  const included = [...ancestors, target, ...descendants];
  const ids = included.map((i) => i.id);
  const revisions = await latestRevisions(tx, organizationId, ids);
  const types = new Map(
    (
      await tx
        .select()
        .from(s.workItemType)
        .where(eq(s.workItemType.organizationId, organizationId))
    ).map((t) => [t.id, t]),
  );
  const statuses = new Map(
    (
      await tx
        .select()
        .from(s.workflowStatus)
        .where(eq(s.workflowStatus.organizationId, organizationId))
    ).map((x) => [x.id, x]),
  );
  const threads = await tx
    .select()
    .from(s.thread)
    .where(
      and(
        eq(s.thread.organizationId, organizationId),
        inArray(s.thread.workItemId, ids),
        eq(s.thread.status, "open"),
        isNull(s.thread.pullRequestId),
        isNull(s.thread.suggestionId),
      ),
    )
    .orderBy(asc(s.thread.createdAt));
  const firstMessages = threads.length
    ? await tx
        .select()
        .from(s.threadMessage)
        .where(
          and(
            eq(s.threadMessage.organizationId, organizationId),
            inArray(
              s.threadMessage.threadId,
              threads.map((t) => t.id),
            ),
          ),
        )
        .orderBy(asc(s.threadMessage.createdAt))
    : [];
  const relations = (
    await tx
      .select()
      .from(s.workItemRelation)
      .where(eq(s.workItemRelation.organizationId, organizationId))
  ).filter((r) => ids.includes(r.fromId) || ids.includes(r.toId));
  const key = (i: ItemRow) => `${project?.key ?? "ITEM"}-${i.number}`;
  const keyOf = (id: string) => {
    const i = byId.get(id);
    return i ? key(i) : id;
  };
  const contextRevisions: Record<string, string> = {};
  for (const i of included) {
    const r = revisions.get(i.id);
    if (r) contextRevisions[i.id] = r.id;
  }
  const intelligence = await composeIntelligenceContext(tx, organizationId, {
    projectId: target.projectId,
    teamId: target.teamId,
  });
  const context = {
    project: { key: project?.key ?? "", name: project?.name ?? "" },
    intelligenceContext: promptContext(intelligence),
    target: key(target),
    items: included.map((i) => {
      const type = types.get(i.typeId);
      const status = statuses.get(i.statusId);
      const revision = revisions.get(i.id);
      return {
        key: key(i),
        role:
          i.id === target.id
            ? "target"
            : ancestors.includes(i)
              ? "ancestor"
              : "descendant",
        parentKey: i.parentId ? keyOf(i.parentId) : null,
        type: type?.name ?? "Item",
        hasSpecification: type?.hasSpecification ?? false,
        status: status ? `${status.name} (${status.category})` : null,
        refinementState: i.refinementState,
        priority: i.priority,
        estimate: i.estimate,
        title: revision?.title ?? i.title,
        revision: revision?.number ?? 0,
        // Ancestors give context; their full text is less relevant.
        specification: clip(
          revision?.content ?? "",
          ancestors.includes(i) ? 3_000 : MAX_CONTENT,
        ),
        openDiscussions: threads
          .filter((t) => t.workItemId === i.id)
          .slice(0, MAX_DISCUSSIONS)
          .map((t) => ({
            blocking: t.blocking,
            section: (t.anchor as { section?: string } | null)?.section ?? null,
            quote: (t.anchor as { quote?: string } | null)?.quote ?? null,
            message: clip(
              firstMessages.find((m) => m.threadId === t.id)?.body ?? "",
              600,
            ),
          })),
      };
    }),
    relations: relations.map((r) => ({
      from: keyOf(r.fromId),
      kind: r.kind,
      to: keyOf(r.toId),
    })),
    truncated: descendants.length >= MAX_ITEMS,
  };
  const keys = new Map(included.map((i) => [key(i), i.id]));
  return {
    context,
    contextRevisions,
    keys,
    projectId: target.projectId,
    intelligence,
  };
}

export async function pullRequestContext(
  tx: Tx,
  organizationId: string,
  run: typeof s.aiRun.$inferSelect,
) {
  const [pr] = await tx
    .select()
    .from(s.specificationPullRequest)
    .where(
      and(
        eq(s.specificationPullRequest.organizationId, organizationId),
        eq(s.specificationPullRequest.id, run.pullRequestId!),
      ),
    );
  if (!pr || pr.deletedAt || pr.status === "merged") return undefined;
  const branches = await tx
    .select()
    .from(s.specificationBranch)
    .where(
      and(
        eq(s.specificationBranch.organizationId, organizationId),
        eq(s.specificationBranch.workItemId, pr.workItemId),
      ),
    );
  const commits = await tx
    .select()
    .from(s.specificationCommit)
    .where(
      and(
        eq(s.specificationCommit.organizationId, organizationId),
        eq(s.specificationCommit.workItemId, pr.workItemId),
      ),
    );
  const source = branches.find((b) => b.id === pr.sourceId);
  const target = branches.find((b) => b.id === pr.targetId);
  const head = commits.find((c) => c.id === source?.headId);
  const main = commits.find((c) => c.id === target?.headId);
  if (!source || !target || !head || !main || source.deletedAt)
    return undefined;
  const base = mergeBase(commits, head.id, main.id) ?? main;
  const [item] = await tx
    .select()
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.id, pr.workItemId),
      ),
    );
  const [project] = await tx
    .select()
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, organizationId),
        eq(s.project.id, item!.projectId),
      ),
    );
  const parent = item!.parentId
    ? (
        await tx
          .select()
          .from(s.workItem)
          .where(
            and(
              eq(s.workItem.organizationId, organizationId),
              eq(s.workItem.id, item!.parentId),
            ),
          )
      )[0]
    : undefined;
  const revisions = await latestRevisions(
    tx,
    organizationId,
    [item!.id, parent?.id].filter((v): v is string => Boolean(v)),
  );
  const key = (n: number) => `${project?.key ?? "ITEM"}-${n}`;
  const changed = diffLines(base.content, head.content)
    .filter((l) => l.kind !== "same")
    .map((l) => `${l.kind === "added" ? "+" : "-"} ${l.text}`)
    .join("\n");
  const previous = await tx
    .select()
    .from(s.aiRun)
    .where(
      and(
        eq(s.aiRun.organizationId, organizationId),
        eq(s.aiRun.pullRequestId, pr.id),
        eq(s.aiRun.status, "completed"),
      ),
    )
    .orderBy(desc(s.aiRun.completedAt))
    .limit(1);
  const openThreadIds = new Set(
    (
      await tx
        .select({ id: s.thread.id })
        .from(s.thread)
        .where(
          and(
            eq(s.thread.organizationId, organizationId),
            eq(s.thread.pullRequestId, pr.id),
            eq(s.thread.status, "open"),
          ),
        )
    ).map((t) => t.id),
  );
  const previousFindings = (previous[0]?.findings ?? []).filter(
    (f) => f.threadId && openThreadIds.has(f.threadId),
  );
  const intelligence = await composeIntelligenceContext(tx, organizationId, {
    projectId: item!.projectId,
    teamId: item!.teamId,
  });
  // Criteria are read from the committed head, never from a live draft.
  const reading = criteriaToRead(
    base.content,
    head.content,
    previousFindings.flatMap((f) => (f.readings ? [f.readings.criterion] : [])),
  );
  const context = {
    intelligenceContext: promptContext(intelligence),
    item: {
      key: key(item!.number),
      title: revisions.get(item!.id)?.title ?? item!.title,
    },
    parent: parent
      ? {
          key: key(parent.number),
          title: revisions.get(parent.id)?.title ?? parent.title,
          specification: clip(revisions.get(parent.id)?.content ?? "", 3_000),
        }
      : null,
    pullRequest: {
      title: pr.title,
      description: clip(pr.description, 2_000),
      source: source.name,
      target: target.name,
    },
    main: { title: main.title, content: clip(main.content) },
    proposed: {
      title: head.title,
      content: clip(head.content),
      children: pendingEntries(head.proposedChildren, main.proposedChildren)
        .filter(isNewChild)
        .slice(0, MAX_ITEMS)
        .map((child) => ({
          title: child.title,
          typeId: child.typeId,
          description: clip(child.description, 1000),
        })),
      // Proposed changes to existing children, against the child's base.
      childChanges: pendingEntries(head.proposedChildren, main.proposedChildren)
        .filter(isChildChange)
        .slice(0, MAX_ITEMS)
        .map((change) => ({
          workItemId: change.workItemId,
          currentTitle: change.base.title,
          ...(change.title !== undefined ? { title: change.title } : {}),
          ...(change.description !== undefined
            ? { description: clip(change.description, 1000) }
            : {}),
          ...(change.parentId !== undefined
            ? { parentId: change.parentId }
            : {}),
          ...(change.archive ? { archive: true } : {}),
        })),
      childrenTruncated: head.proposedChildren.length > MAX_ITEMS,
    },
    changedLines: clip(changed, 6_000),
    acceptanceCriteria: reading.criteria.map((c) => ({
      ref: c.ref,
      text: c.text,
    })),
    acceptanceCriteriaTruncated: reading.truncated,
    previousFindings: previousFindings.map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      ...(f.readings ? { criterion: f.readings.criterion } : {}),
    })),
  };
  return {
    context,
    pr,
    head,
    item: item!,
    previousFindings,
    criteria: reading.criteria,
    criteriaTruncated: reading.truncated,
    intelligence,
    keys: new Map([[key(item!.number), item!.id]]),
    contextRevisions: Object.fromEntries(
      [...revisions].map(([id, r]) => [id, r.id]),
    ) as Record<string, string>,
  };
}
