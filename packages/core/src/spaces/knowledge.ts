import { and, asc, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  referenceHref,
  referencesInDocument,
  referencesInMarkdown,
} from "@lictory/core/contracts/references";
import { canonicalJson } from "@lictory/core/domain/projections";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import { writeSpaceProjections } from "@lictory/core/spaces/projections";

// The derived reference indexes of knowledge links
// (docs/internals/knowledge-links.md):
//
// - `page_reference`: the references of every page's published version,
//   rewritten by `indexPublishedPage` in the same transaction as every move
//   of main's head (page creation, publishing, restores, merges into main);
// - `specification_reference`: the references of every main specification
//   revision, written by `indexSpecificationRevisions` with the revision.
//
// Both are rebuilt exactly from the stored commits and revisions
// (`referenceIndexDrift` is the invariant, `rebuildReferenceIndex` the
// repair and backfill).

type PageReferenceRow = typeof s.pageReference.$inferInsert;
type SpecificationReferenceRow = typeof s.specificationReference.$inferInsert;

const BATCH = 500;

/** The index rows of one page version: its references in document order. */
export function pageReferenceRows(
  organizationId: string,
  pageId: string,
  commitId: string,
  content: unknown,
): PageReferenceRow[] {
  return referencesInDocument(content).map((reference, position) => ({
    organizationId,
    pageId,
    commitId,
    position,
    blockId: reference.blockId,
    kind: reference.kind,
    targetId: reference.id,
    targetCommitId:
      reference.kind === "page" ? (reference.commitId ?? null) : null,
  }));
}

/** The index rows of one specification revision: distinct targets in order. */
export function specificationReferenceRows(
  organizationId: string,
  workItemId: string,
  revisionId: string,
  content: string,
): SpecificationReferenceRow[] {
  const seen = new Set<string>();
  return referencesInMarkdown(content)
    .filter((reference) => {
      const key = referenceHref(reference);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((reference, position) => ({
      organizationId,
      workItemId,
      revisionId,
      position,
      kind: reference.kind,
      targetId: reference.id,
      targetCommitId:
        reference.kind === "page" ? (reference.commitId ?? null) : null,
    }));
}

async function insertBatches<T>(rows: T[], insert: (batch: T[]) => unknown) {
  for (let index = 0; index < rows.length; index += BATCH)
    await insert(rows.slice(index, index + BATCH));
}

// Main's head commit of a page with its content.
async function publishedHead(
  tx: Database | Tx,
  organizationId: string,
  pageId: string,
) {
  const [head] = await tx
    .select({ commitId: s.pageCommit.id, content: s.pageCommit.content })
    .from(s.pageBranch)
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
        eq(s.pageBranch.organizationId, organizationId),
        eq(s.pageBranch.pageId, pageId),
        eq(s.pageBranch.isMain, true),
      ),
    );
  return head;
}

/**
 * Rewrites a page's references from main's current head, in the caller's
 * transaction (which holds the organization lock). Every writer that moves
 * main's head calls it; its projections follow with the page's (`pages`).
 */
export async function indexPublishedPage(
  tx: Tx,
  organizationId: string,
  pageId: string,
) {
  const head = await publishedHead(tx, organizationId, pageId);
  await tx
    .delete(s.pageReference)
    .where(
      and(
        eq(s.pageReference.organizationId, organizationId),
        eq(s.pageReference.pageId, pageId),
      ),
    );
  if (!head) return;
  const rows = pageReferenceRows(
    organizationId,
    pageId,
    head.commitId,
    head.content,
  );
  await insertBatches(rows, (batch) =>
    tx.insert(s.pageReference).values(batch),
  );
}

/**
 * Indexes the references of new main specification revisions and rewrites
 * the knowledge projections of the pages they cite, in the caller's
 * transaction. Every writer that inserts a specification revision calls it.
 */
export async function indexSpecificationRevisions(
  tx: Tx,
  organizationId: string,
  revisions: { id: string; workItemId: string; content: string }[],
) {
  const rows = revisions.flatMap((r) =>
    specificationReferenceRows(organizationId, r.workItemId, r.id, r.content),
  );
  if (!rows.length) return;
  await insertBatches(rows, (batch) =>
    tx.insert(s.specificationReference).values(batch).onConflictDoNothing(),
  );
  const pages = [
    ...new Set(rows.filter((r) => r.kind === "page").map((r) => r.targetId)),
  ];
  if (pages.length)
    await writeSpaceProjections(tx, organizationId, { knowledge: pages });
}

const pageKey = (r: PageReferenceRow) => `${r.pageId}:${r.position}`;
const specificationKey = (r: SpecificationReferenceRow) =>
  `${r.revisionId}:${r.position}`;
const comparable = (r: Record<string, unknown>) =>
  canonicalJson(
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? null])),
  );

function diffRows<T extends Record<string, unknown>>(
  label: string,
  expected: T[],
  stored: T[],
  key: (row: T) => string,
) {
  const want = new Map(expected.map((r) => [key(r), comparable(r)]));
  const drift: string[] = [];
  const seen = new Set<string>();
  for (const r of stored) {
    const k = key(r);
    seen.add(k);
    const w = want.get(k);
    if (w === undefined) drift.push(`extra ${label}:${k}`);
    else if (w !== comparable(r)) drift.push(`stale ${label}:${k}`);
  }
  for (const k of want.keys())
    if (!seen.has(k)) drift.push(`missing ${label}:${k}`);
  return drift;
}

/**
 * Differences between the stored reference indexes and a rebuild from the
 * stored commits and revisions. Empty when the invariant holds.
 */
export async function referenceIndexDrift(
  tx: Database | Tx,
  organizationId: string,
) {
  const [heads, pageRows, revisions, specificationRows] = await Promise.all([
    tx
      .select({
        pageId: s.pageBranch.pageId,
        commitId: s.pageCommit.id,
        content: s.pageCommit.content,
      })
      .from(s.pageBranch)
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
          eq(s.pageBranch.organizationId, organizationId),
          eq(s.pageBranch.isMain, true),
        ),
      ),
    tx
      .select()
      .from(s.pageReference)
      .where(eq(s.pageReference.organizationId, organizationId)),
    tx
      .select({
        id: s.specificationRevision.id,
        workItemId: s.specificationRevision.workItemId,
        content: s.specificationRevision.content,
      })
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.organizationId, organizationId)),
    tx
      .select()
      .from(s.specificationReference)
      .where(eq(s.specificationReference.organizationId, organizationId)),
  ]);
  return [
    ...diffRows(
      "pageReference",
      heads.flatMap((h) =>
        pageReferenceRows(organizationId, h.pageId, h.commitId, h.content),
      ),
      pageRows,
      pageKey,
    ),
    ...diffRows(
      "specificationReference",
      revisions.flatMap((r) =>
        specificationReferenceRows(
          organizationId,
          r.workItemId,
          r.id,
          r.content,
        ),
      ),
      specificationRows,
      specificationKey,
    ),
  ].sort();
}

/**
 * Rebuilds the reference indexes of an organization from its stored
 * commits and revisions and rewrites the affected knowledge projections:
 * one short transaction per page and per work item, under the
 * organization lock. Resumable and idempotent (the backfill
 * `rebuild-knowledge-index` and operator repair). Revisions and commits are
 * only read.
 */
export async function rebuildReferenceIndex(
  db: Database,
  organizationId: string,
  options: { dryRun?: boolean } = {},
) {
  const summary = { pages: 0, pagesChanged: 0, items: 0, itemsChanged: 0 };
  const pages = await db
    .select({ id: s.page.id })
    .from(s.page)
    .where(eq(s.page.organizationId, organizationId))
    .orderBy(asc(s.page.id));
  for (const { id: pageId } of pages)
    await db.transaction(async (tx) => {
      await lock(tx, organizationId);
      summary.pages++;
      const head = await publishedHead(tx, organizationId, pageId);
      const expected = head
        ? pageReferenceRows(organizationId, pageId, head.commitId, head.content)
        : [];
      const stored = await tx
        .select()
        .from(s.pageReference)
        .where(
          and(
            eq(s.pageReference.organizationId, organizationId),
            eq(s.pageReference.pageId, pageId),
          ),
        );
      if (!diffRows("p", expected, stored, pageKey).length) return;
      summary.pagesChanged++;
      if (options.dryRun) return;
      await indexPublishedPage(tx, organizationId, pageId);
      await writeSpaceProjections(tx, organizationId, { knowledge: [pageId] });
    });
  const items = await db
    .selectDistinct({ id: s.specificationRevision.workItemId })
    .from(s.specificationRevision)
    .where(eq(s.specificationRevision.organizationId, organizationId))
    .orderBy(asc(s.specificationRevision.workItemId));
  for (const { id: workItemId } of items)
    await db.transaction(async (tx) => {
      await lock(tx, organizationId);
      summary.items++;
      const [revisions, stored] = await Promise.all([
        tx
          .select({
            id: s.specificationRevision.id,
            workItemId: s.specificationRevision.workItemId,
            content: s.specificationRevision.content,
          })
          .from(s.specificationRevision)
          .where(
            and(
              eq(s.specificationRevision.organizationId, organizationId),
              eq(s.specificationRevision.workItemId, workItemId),
            ),
          ),
        tx
          .select()
          .from(s.specificationReference)
          .where(
            and(
              eq(s.specificationReference.organizationId, organizationId),
              eq(s.specificationReference.workItemId, workItemId),
            ),
          ),
      ]);
      const expected = revisions.flatMap((r) =>
        specificationReferenceRows(
          organizationId,
          r.workItemId,
          r.id,
          r.content,
        ),
      );
      if (!diffRows("s", expected, stored, specificationKey).length) return;
      summary.itemsChanged++;
      if (options.dryRun) return;
      // Derived rows only: the revisions themselves are never touched.
      await tx
        .delete(s.specificationReference)
        .where(
          and(
            eq(s.specificationReference.organizationId, organizationId),
            eq(s.specificationReference.workItemId, workItemId),
          ),
        );
      await insertBatches(expected, (batch) =>
        tx.insert(s.specificationReference).values(batch),
      );
      const cited = [
        ...new Set(
          [...expected, ...stored]
            .filter((r) => r.kind === "page")
            .map((r) => r.targetId),
        ),
      ];
      if (cited.length)
        await writeSpaceProjections(tx, organizationId, { knowledge: cited });
    });
  return summary;
}

/** Whether a revision id belongs to a work item of the organization. */
export async function revisionOfItem(
  tx: Database | Tx,
  organizationId: string,
  workItemId: string,
  revisionId: string,
) {
  const [row] = await tx
    .select({ id: s.specificationRevision.id })
    .from(s.specificationRevision)
    .where(
      and(
        eq(s.specificationRevision.organizationId, organizationId),
        eq(s.specificationRevision.workItemId, workItemId),
        eq(s.specificationRevision.id, revisionId),
      ),
    );
  return Boolean(row);
}
