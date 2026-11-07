import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  SpaceEntity,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { pageAccess } from "@lictory/core/spaces/access";
import { knowledgeRows } from "@lictory/core/spaces/projections";

// On-demand reads of knowledge links (docs/internals/knowledge-links.md)
// for capabilities (MCP, Litto, browser routes). They compute the same rows
// the browser receives through Zero (`knowledgeRows`), then keep only pages
// the reader can read now (a `space_reader` row of an active page and
// space), and add titles. Nothing about other pages is returned: no row,
// no title, no count.

const readOnly = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

type Reader = { organizationId: string; userId: string };

export type ReadablePage = {
  pageId: string;
  spaceId: string;
  spaceName: string;
  title: string;
  publishedCommitId: string;
};

// The given pages the reader can read, active, with their published title.
async function readablePages(
  tx: Database | Tx,
  reader: Reader,
  pageIds: string[],
): Promise<Map<string, ReadablePage>> {
  const ids = [...new Set(pageIds)];
  if (!ids.length) return new Map();
  const rows = await tx
    .select({
      pageId: s.page.id,
      spaceId: s.space.id,
      spaceName: s.space.name,
      title: s.pageCommit.title,
      publishedCommitId: s.pageCommit.id,
    })
    .from(s.page)
    .innerJoin(
      s.space,
      and(
        eq(s.space.organizationId, s.page.organizationId),
        eq(s.space.id, s.page.spaceId),
      ),
    )
    .innerJoin(
      s.spaceReader,
      and(
        eq(s.spaceReader.organizationId, s.space.organizationId),
        eq(s.spaceReader.spaceId, s.space.id),
        eq(s.spaceReader.userId, reader.userId),
      ),
    )
    .innerJoin(
      s.pageBranch,
      and(
        eq(s.pageBranch.organizationId, s.page.organizationId),
        eq(s.pageBranch.pageId, s.page.id),
        eq(s.pageBranch.isMain, true),
      ),
    )
    .innerJoin(
      s.pageCommit,
      and(
        eq(s.pageCommit.organizationId, s.pageBranch.organizationId),
        eq(s.pageCommit.pageId, s.pageBranch.pageId),
        eq(s.pageCommit.id, s.pageBranch.headCommitId),
      ),
    )
    .where(
      and(
        eq(s.page.organizationId, reader.organizationId),
        inArray(s.page.id, ids),
        isNull(s.page.archivedAt),
        isNull(s.space.archivedAt),
      ),
    );
  return new Map(rows.map((r) => [r.pageId, r]));
}

export type ItemSummary = {
  workItemId: string;
  key: string;
  title: string;
  projectId: string;
  // The item's current main revision.
  revisionId: string | null;
  archived: boolean;
};

// Work items of the organization (every member reads every item).
async function itemSummaries(
  tx: Database | Tx,
  organizationId: string,
  ids: string[],
): Promise<Map<string, ItemSummary>> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return new Map();
  const [items, revisions] = await Promise.all([
    tx
      .select({
        id: s.workItem.id,
        number: s.workItem.number,
        title: s.workItem.title,
        projectId: s.workItem.projectId,
        key: s.project.key,
        archivedAt: s.workItem.archivedAt,
      })
      .from(s.workItem)
      .innerJoin(
        s.project,
        and(
          eq(s.project.organizationId, s.workItem.organizationId),
          eq(s.project.id, s.workItem.projectId),
        ),
      )
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          inArray(s.workItem.id, wanted),
        ),
      ),
    tx
      .selectDistinctOn([s.specificationRevision.workItemId], {
        workItemId: s.specificationRevision.workItemId,
        id: s.specificationRevision.id,
      })
      .from(s.specificationRevision)
      .where(
        and(
          eq(s.specificationRevision.organizationId, organizationId),
          inArray(s.specificationRevision.workItemId, wanted),
        ),
      )
      .orderBy(
        asc(s.specificationRevision.workItemId),
        desc(s.specificationRevision.number),
      ),
  ]);
  const current = new Map(revisions.map((r) => [r.workItemId, r.id]));
  return new Map(
    items.map((i) => [
      i.id,
      {
        workItemId: i.id,
        key: `${i.key}-${i.number}`,
        title: i.title,
        projectId: i.projectId,
        revisionId: current.get(i.id) ?? null,
        archived: Boolean(i.archivedAt),
      },
    ]),
  );
}

const of = <T extends SpaceEntity["type"]>(
  rows: { data: unknown }[],
  type: T,
) =>
  rows
    .map((r) => r.data as SpaceEntity)
    .filter((e): e is SpaceEntityOf<T> => e.type === type);

const page = (p: ReadablePage) => ({
  pageId: p.pageId,
  spaceId: p.spaceId,
  spaceName: p.spaceName,
  title: p.title,
  publishedCommitId: p.publishedCommitId,
});

/**
 * Everything pages say about one work item, as the reader may see it:
 * pages whose published version references it (with blocks and commit),
 * pages its specification revisions cite (pinned commits per revision, and
 * whether the current revision cites them), attached pages, the page it was
 * created from, and page branches proposed from it. Also the items and
 * decisions its current revision references.
 */
export async function getWorkItemKnowledge(
  db: Database,
  userId: string,
  organizationId: string,
  workItemId: string,
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const reader = { organizationId, userId };
    const item = (await itemSummaries(tx, organizationId, [workItemId])).get(
      workItemId,
    );
    if (!item)
      throw new DomainError("not_found", "This work item is unavailable.");
    const [referenced, cited, attached, source, origins] = await Promise.all([
      tx
        .selectDistinct({ pageId: s.pageReference.pageId })
        .from(s.pageReference)
        .where(
          and(
            eq(s.pageReference.organizationId, organizationId),
            eq(s.pageReference.kind, "item"),
            eq(s.pageReference.targetId, workItemId),
          ),
        ),
      tx
        .selectDistinct({ pageId: s.specificationReference.targetId })
        .from(s.specificationReference)
        .where(
          and(
            eq(s.specificationReference.organizationId, organizationId),
            eq(s.specificationReference.workItemId, workItemId),
            eq(s.specificationReference.kind, "page"),
          ),
        ),
      tx
        .selectDistinct({ pageId: s.workItemPageAttachment.pageId })
        .from(s.workItemPageAttachment)
        .where(
          and(
            eq(s.workItemPageAttachment.organizationId, organizationId),
            eq(s.workItemPageAttachment.workItemId, workItemId),
            isNull(s.workItemPageAttachment.detachedAt),
          ),
        ),
      tx
        .select({ pageId: s.workItemPageSource.pageId })
        .from(s.workItemPageSource)
        .where(
          and(
            eq(s.workItemPageSource.organizationId, organizationId),
            eq(s.workItemPageSource.workItemId, workItemId),
          ),
        ),
      tx
        .selectDistinct({ pageId: s.pageBranchOrigin.pageId })
        .from(s.pageBranchOrigin)
        .where(
          and(
            eq(s.pageBranchOrigin.organizationId, organizationId),
            eq(s.pageBranchOrigin.workItemId, workItemId),
          ),
        ),
    ]);
    const candidates = [
      ...[...referenced, ...cited, ...attached, ...source, ...origins].map(
        (r) => r.pageId,
      ),
    ];
    const readable = await readablePages(tx, reader, candidates);
    const rows = (
      await knowledgeRows(tx, organizationId, [...readable.keys()])
    ).filter((r) => r.workItemId === workItemId);
    const withPage = <T extends { pageId: string }>(entities: T[]) =>
      entities.flatMap((e) => {
        const p = readable.get(e.pageId);
        return p ? [{ entity: e, page: p }] : [];
      });
    const currentReferences = item.revisionId
      ? await tx
          .select()
          .from(s.specificationReference)
          .where(
            and(
              eq(s.specificationReference.organizationId, organizationId),
              eq(s.specificationReference.revisionId, item.revisionId),
            ),
          )
          .orderBy(asc(s.specificationReference.position))
      : [];
    const sourceRow = withPage(of(rows, "workItemSource"))[0];
    return {
      workItem: item,
      referencedIn: withPage(of(rows, "pageReference")).map(
        ({ entity, page: p }) => ({
          ...page(p),
          commitId: entity.commitId,
          blockIds: entity.blockIds,
        }),
      ),
      citations: withPage(of(rows, "specificationCitation")).map(
        ({ entity, page: p }) => ({
          ...page(p),
          revisions: entity.revisions,
          citedByCurrentRevision: entity.revisions.some(
            (r) => r.revisionId === item.revisionId,
          ),
        }),
      ),
      attachments: withPage(of(rows, "pageAttachment")).map(
        ({ entity, page: p }) => ({
          ...page(p),
          attachmentId: entity.id,
          purpose: entity.purpose,
          commitId: entity.commitId,
          createdById: entity.createdById,
          createdAt: entity.createdAt,
        }),
      ),
      source: sourceRow
        ? {
            ...page(sourceRow.page),
            commitId: sourceRow.entity.commitId,
            blockId: sourceRow.entity.blockId,
            quote: sourceRow.entity.quote,
            createdById: sourceRow.entity.createdById,
            createdAt: sourceRow.entity.createdAt,
          }
        : null,
      pageBranches: withPage(of(rows, "pageBranchOrigin")).map(
        ({ entity, page: p }) => ({
          ...page(p),
          branchId: entity.branchId,
          name: entity.name,
          revisionId: entity.revisionId,
          authorId: entity.authorId,
          createdAt: entity.createdAt,
          deletedAt: entity.deletedAt,
          pullRequests: entity.pullRequests,
        }),
      ),
      // What the current revision references besides pages: items and
      // decisions (every member reads them).
      currentRevisionReferences: currentReferences
        .filter((r) => r.kind !== "page" || readable.has(r.targetId))
        .map((r) => ({
          kind: r.kind,
          id: r.targetId,
          ...(r.targetCommitId ? { commitId: r.targetCommitId } : {}),
        })),
    };
  }, readOnly);
}

/**
 * The work one readable page knows about: items its published version
 * references (with blocks), items whose specifications cite it, items it is
 * attached to, items created from it, branches proposed from items, the
 * project, team and iteration lists it is a context page of, and the other
 * readable pages whose published version references it.
 */
export async function listPageWork(
  db: Database,
  userId: string,
  organizationId: string,
  pageId: string,
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const reader = { organizationId, userId };
    const found = await pageAccess(tx, reader, pageId);
    if (!found?.level)
      throw new DomainError("not_found", "This page is unavailable.");
    const rows = await knowledgeRows(tx, organizationId, [pageId]);
    const items = await itemSummaries(
      tx,
      organizationId,
      rows.flatMap((r) => (r.workItemId ? [r.workItemId] : [])),
    );
    const withItem = <T extends { workItemId: string }>(entities: T[]) =>
      entities.flatMap((e) => {
        const item = items.get(e.workItemId);
        return item ? [{ entity: e, item }] : [];
      });
    const backlinks = await tx
      .select({
        pageId: s.pageReference.pageId,
        commitId: s.pageReference.targetCommitId,
      })
      .from(s.pageReference)
      .where(
        and(
          eq(s.pageReference.organizationId, organizationId),
          eq(s.pageReference.kind, "page"),
          eq(s.pageReference.targetId, pageId),
        ),
      )
      .orderBy(asc(s.pageReference.pageId), asc(s.pageReference.position));
    const sources = await readablePages(
      tx,
      reader,
      backlinks.map((b) => b.pageId).filter((id) => id !== pageId),
    );
    const referencedBy = new Map<
      string,
      ReturnType<typeof page> & { commitIds: string[]; latest: boolean }
    >();
    for (const b of backlinks) {
      const p = sources.get(b.pageId);
      if (!p) continue;
      const entry = referencedBy.get(b.pageId) ?? {
        ...page(p),
        commitIds: [],
        latest: false,
      };
      if (b.commitId) {
        if (!entry.commitIds.includes(b.commitId))
          entry.commitIds.push(b.commitId);
      } else entry.latest = true;
      referencedBy.set(b.pageId, entry);
    }
    return {
      page: {
        pageId,
        spaceId: found.space.id,
        archived: Boolean(found.page.archivedAt ?? found.space.archivedAt),
      },
      references: withItem(of(rows, "pageReference")).map(
        ({ entity, item }) => ({
          ...item,
          commitId: entity.commitId,
          blockIds: entity.blockIds,
        }),
      ),
      citedBy: withItem(of(rows, "specificationCitation")).map(
        ({ entity, item }) => ({
          ...item,
          revisions: entity.revisions,
          citedByCurrentRevision: entity.revisions.some(
            (r) => r.revisionId === item.revisionId,
          ),
        }),
      ),
      attachedTo: withItem(of(rows, "pageAttachment")).map(
        ({ entity, item }) => ({
          ...item,
          attachmentId: entity.id,
          purpose: entity.purpose,
          commitId: entity.commitId,
          createdById: entity.createdById,
          createdAt: entity.createdAt,
        }),
      ),
      createdItems: withItem(of(rows, "workItemSource")).map(
        ({ entity, item }) => ({
          ...item,
          commitId: entity.commitId,
          blockId: entity.blockId,
          quote: entity.quote,
          createdById: entity.createdById,
          createdAt: entity.createdAt,
        }),
      ),
      branchOrigins: withItem(of(rows, "pageBranchOrigin")).map(
        ({ entity, item }) => ({
          ...item,
          branchId: entity.branchId,
          name: entity.name,
          originRevisionId: entity.revisionId,
          authorId: entity.authorId,
          createdAt: entity.createdAt,
          deletedAt: entity.deletedAt,
          pullRequests: entity.pullRequests,
        }),
      ),
      contexts: of(rows, "pageContextLink").map((link) => ({
        linkId: link.id,
        projectId: link.projectId,
        teamId: link.teamId,
        iterationId: link.iterationId,
        rank: link.rank,
      })),
      referencedByPages: [...referencedBy.values()],
    };
  }, readOnly);
}

/**
 * The context pages of a project the reader can read, in order: the
 * project's own (board and backlog), a team's (`teamId`) or an iteration's
 * (`iterationId`); every list of the project when `scope` is "all".
 */
export async function listContextPages(
  db: Database,
  userId: string,
  organizationId: string,
  filter: {
    projectId: string;
    teamId?: string;
    iterationId?: string;
    all?: boolean;
  },
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const [projectRow] = await tx
      .select({ id: s.project.id })
      .from(s.project)
      .where(
        and(
          eq(s.project.organizationId, organizationId),
          eq(s.project.id, filter.projectId),
        ),
      );
    if (!projectRow)
      throw new DomainError("not_found", "This project is unavailable.");
    const links = await tx
      .select()
      .from(s.pageContextLink)
      .where(
        and(
          eq(s.pageContextLink.organizationId, organizationId),
          eq(s.pageContextLink.projectId, filter.projectId),
          isNull(s.pageContextLink.removedAt),
          filter.all
            ? undefined
            : filter.teamId
              ? eq(s.pageContextLink.teamId, filter.teamId)
              : isNull(s.pageContextLink.teamId),
          filter.all
            ? undefined
            : filter.iterationId
              ? eq(s.pageContextLink.iterationId, filter.iterationId)
              : isNull(s.pageContextLink.iterationId),
        ),
      )
      .orderBy(asc(s.pageContextLink.rank), asc(s.pageContextLink.id));
    const readable = await readablePages(
      tx,
      { organizationId, userId },
      links.map((l) => l.pageId),
    );
    return {
      projectId: filter.projectId,
      pages: links.flatMap((link) => {
        const p = readable.get(link.pageId);
        return p
          ? [
              {
                ...page(p),
                linkId: link.id,
                teamId: link.teamId,
                iterationId: link.iterationId,
                rank: link.rank,
                createdById: link.createdById,
                createdAt: link.createdAt.toISOString(),
              },
            ]
          : [];
      }),
    };
  }, readOnly);
}

/**
 * Where a work item, page or decision is referenced: readable pages whose
 * published version mentions it (with blocks and pinned commits) and the
 * specifications whose revisions do (with the revisions, and whether each
 * item's current revision still does). A page target must itself be
 * readable.
 */
export async function listReferencesTo(
  db: Database,
  userId: string,
  organizationId: string,
  target: { kind: "item" | "page" | "decision"; id: string },
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const reader = { organizationId, userId };
    if (target.kind === "page") {
      const found = await pageAccess(tx, reader, target.id);
      if (!found?.level)
        throw new DomainError("not_found", "This page is unavailable.");
    } else if (target.kind === "item") {
      if (!(await itemSummaries(tx, organizationId, [target.id])).size)
        throw new DomainError("not_found", "This work item is unavailable.");
    } else {
      const [decision] = await tx
        .select({ id: s.decision.id })
        .from(s.decision)
        .where(
          and(
            eq(s.decision.organizationId, organizationId),
            eq(s.decision.id, target.id),
          ),
        );
      if (!decision)
        throw new DomainError("not_found", "This decision is unavailable.");
    }
    const [pageRows, specificationRows] = await Promise.all([
      tx
        .select()
        .from(s.pageReference)
        .where(
          and(
            eq(s.pageReference.organizationId, organizationId),
            eq(s.pageReference.kind, target.kind),
            eq(s.pageReference.targetId, target.id),
          ),
        )
        .orderBy(asc(s.pageReference.pageId), asc(s.pageReference.position)),
      tx
        .select({
          reference: s.specificationReference,
          number: s.specificationRevision.number,
        })
        .from(s.specificationReference)
        .innerJoin(
          s.specificationRevision,
          and(
            eq(
              s.specificationRevision.organizationId,
              s.specificationReference.organizationId,
            ),
            eq(
              s.specificationRevision.workItemId,
              s.specificationReference.workItemId,
            ),
            eq(s.specificationRevision.id, s.specificationReference.revisionId),
          ),
        )
        .where(
          and(
            eq(s.specificationReference.organizationId, organizationId),
            eq(s.specificationReference.kind, target.kind),
            eq(s.specificationReference.targetId, target.id),
          ),
        )
        .orderBy(
          asc(s.specificationReference.workItemId),
          asc(s.specificationRevision.number),
        ),
    ]);
    const readable = await readablePages(
      tx,
      reader,
      pageRows.map((r) => r.pageId),
    );
    const pages = new Map<
      string,
      ReturnType<typeof page> & {
        commitId: string;
        blockIds: string[];
        pinnedCommitIds: string[];
      }
    >();
    for (const r of pageRows) {
      const p = readable.get(r.pageId);
      if (!p) continue;
      const entry = pages.get(r.pageId) ?? {
        ...page(p),
        commitId: r.commitId,
        blockIds: [],
        pinnedCommitIds: [],
      };
      if (r.blockId && !entry.blockIds.includes(r.blockId))
        entry.blockIds.push(r.blockId);
      if (r.targetCommitId && !entry.pinnedCommitIds.includes(r.targetCommitId))
        entry.pinnedCommitIds.push(r.targetCommitId);
      pages.set(r.pageId, entry);
    }
    const items = await itemSummaries(
      tx,
      organizationId,
      specificationRows.map((r) => r.reference.workItemId),
    );
    const specifications = new Map<
      string,
      ItemSummary & {
        revisions: {
          revisionId: string;
          number: number;
          commitId: string | null;
        }[];
        citedByCurrentRevision: boolean;
      }
    >();
    for (const { reference: r, number } of specificationRows) {
      const item = items.get(r.workItemId);
      if (!item) continue;
      const entry = specifications.get(r.workItemId) ?? {
        ...item,
        revisions: [],
        citedByCurrentRevision: false,
      };
      entry.revisions.push({
        revisionId: r.revisionId,
        number,
        commitId: r.targetCommitId,
      });
      if (r.revisionId === item.revisionId) entry.citedByCurrentRevision = true;
      specifications.set(r.workItemId, entry);
    }
    return {
      target,
      pages: [...pages.values()],
      specifications: [...specifications.values()],
    };
  }, readOnly);
}
