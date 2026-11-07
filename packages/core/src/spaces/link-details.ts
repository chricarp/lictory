import { and, eq, inArray } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { authorize, type Database } from "@lictory/core/domain/service";
import { commitVersions } from "@lictory/core/knowledge/search";
import { readablePages } from "@lictory/core/spaces/knowledge-reads";

// What a work item shows about the pages that refer to it, beyond the link
// rows (docs/internals/knowledge-links.md, Work surfaces): where in a page
// the item is mentioned (the section heading above the block and a short
// excerpt of it) and which version numbers pinned commits have. Read on
// demand for pages the reader can read now; others are left out entirely
// (no entry, no title, no count), exactly like a page that does not exist.

const readOnly = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

export const EXCERPT_LENGTH = 160;

type DocNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
};

// The text a reader sees of a node: references read as their label.
function nodeText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  const a = node.attrs ?? {};
  if (node.type === "workItemRef")
    return typeof a.key === "string" ? a.key : "";
  if (node.type === "decisionRef")
    return typeof a.label === "string" ? a.label : "decision";
  if (node.type === "pageRef") return "page";
  const parts = (node.content ?? []).map(nodeText);
  return node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "codeBlock"
    ? parts.join("")
    : parts.join(" ");
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

function excerpt(text: string) {
  const value = flat(text);
  if (value.length <= EXCERPT_LENGTH) return value;
  const cut = value.slice(0, EXCERPT_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > EXCERPT_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type BlockContext = {
  blockId: string;
  // The heading the block sits under (null above the first heading, and
  // for a heading itself).
  heading: string | null;
  excerpt: string;
};

/**
 * Top-level blocks of a canonical page document with their section: each
 * requested block's nearest preceding top-level heading and its own text,
 * shortened. Blocks not in the document are left out.
 */
export function blockContexts(doc: unknown, blockIds: readonly string[]) {
  const wanted = new Set(blockIds);
  const found = new Map<string, BlockContext>();
  let heading: string | null = null;
  for (const block of ((doc ?? {}) as DocNode).content ?? []) {
    const id = typeof block.attrs?.id === "string" ? block.attrs.id : null;
    const text = nodeText(block);
    if (id && wanted.has(id))
      found.set(id, {
        blockId: id,
        heading: block.type === "heading" ? null : heading,
        excerpt: excerpt(text),
      });
    if (block.type === "heading") heading = flat(text) || null;
  }
  return blockIds.flatMap((id) => {
    const context = found.get(id);
    return context ? [context] : [];
  });
}

export type PageLinkRequest = {
  pageId: string;
  // A commit of the page and top-level blocks of it to describe.
  blocks?: { commitId: string; blockIds: string[] };
  // Another commit of the page (a pinned version) where the same blocks
  // are described too, so a reader can tell what that version said from
  // what the latest one says.
  pinned?: { commitId: string };
  // Commits of the page whose version number is wanted.
  versions?: string[];
};

export async function describePageLinks(
  db: Database,
  userId: string,
  organizationId: string,
  requests: PageLinkRequest[],
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const readable = await readablePages(
      tx,
      { organizationId, userId },
      requests.map((r) => r.pageId),
    );
    const allowed = requests.filter((r) => readable.has(r.pageId));
    const commitIds = [
      ...new Set(
        allowed.flatMap((r) => [
          readable.get(r.pageId)!.publishedCommitId,
          ...(r.versions ?? []),
          ...(r.blocks ? [r.blocks.commitId] : []),
          ...(r.blocks && r.pinned ? [r.pinned.commitId] : []),
        ]),
      ),
    ];
    // Only commits of the page they are asked about: a commit id of
    // another page answers nothing.
    const commits = commitIds.length
      ? await tx
          .select({ id: s.pageCommit.id, pageId: s.pageCommit.pageId })
          .from(s.pageCommit)
          .where(
            and(
              eq(s.pageCommit.organizationId, organizationId),
              inArray(s.pageCommit.id, commitIds),
            ),
          )
      : [];
    const pageOf = new Map(commits.map((c) => [c.id, c.pageId]));
    const ofPage = (pageId: string, commitId: string) =>
      pageOf.get(commitId) === pageId;
    const versions = commits.length
      ? await commitVersions(
          tx,
          organizationId,
          commits.map((c) => c.id),
        )
      : new Map<string, number>();
    const contentIds = allowed.flatMap((r) => [
      ...(r.blocks && ofPage(r.pageId, r.blocks.commitId)
        ? [r.blocks.commitId]
        : []),
      ...(r.blocks && r.pinned && ofPage(r.pageId, r.pinned.commitId)
        ? [r.pinned.commitId]
        : []),
    ]);
    const contents = new Map(
      (contentIds.length
        ? await tx
            .select({ id: s.pageCommit.id, content: s.pageCommit.content })
            .from(s.pageCommit)
            .where(
              and(
                eq(s.pageCommit.organizationId, organizationId),
                inArray(s.pageCommit.id, contentIds),
              ),
            )
        : []
      ).map((c) => [c.id, c.content]),
    );
    return {
      pages: allowed.map((r) => {
        const page = readable.get(r.pageId)!;
        return {
          pageId: r.pageId,
          title: page.title,
          publishedCommitId: page.publishedCommitId,
          publishedVersion: versions.get(page.publishedCommitId) ?? 1,
          versions: Object.fromEntries(
            (r.versions ?? [])
              .filter((id) => ofPage(r.pageId, id))
              .map((id) => [id, versions.get(id) ?? 1]),
          ),
          blocks:
            r.blocks && contents.has(r.blocks.commitId)
              ? blockContexts(
                  contents.get(r.blocks.commitId),
                  r.blocks.blockIds,
                )
              : [],
          // The same blocks in the pinned commit (those it has).
          pinnedBlocks:
            r.blocks && r.pinned && contents.has(r.pinned.commitId)
              ? blockContexts(
                  contents.get(r.pinned.commitId),
                  r.blocks.blockIds,
                )
              : [],
        };
      }),
    };
  }, readOnly);
}
