import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import { authorize, directory } from "@lictory/core/domain/service";
import { paths } from "@lictory/core/lib/paths";
import {
  searchDecisions,
  searchPublishedPages,
  searchSpecifications,
  searchWorkItems,
  type PublishedPageRow,
  type SearchCursor,
} from "@lictory/core/knowledge/search";
import {
  highlightsIn,
  markdownText,
  pageSnippet,
  snippetOf,
  type Highlight,
  type Snippet,
} from "@lictory/core/knowledge/snippet";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  CapabilityError,
} from "@lictory/core/capabilities/core";

const readOnly = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

// The organization's slug for links, after the membership check.
async function organizationSlug(tx: Tx, organizationId: string) {
  const [org] = await tx
    .select({ slug: s.organization.slug })
    .from(s.organization)
    .where(eq(s.organization.id, organizationId));
  return org!.slug;
}

async function requireProject(
  tx: Tx,
  organizationId: string,
  projectId: string | undefined,
) {
  if (!projectId) return;
  const [project] = await tx
    .select({ id: s.project.id })
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, organizationId),
        eq(s.project.id, projectId),
      ),
    );
  if (!project)
    throw new CapabilityError("not_found", "This project is unavailable.");
}

// The address of a published page, and of one exact version of it.
function pageLinks(slug: string, page: PublishedPageRow) {
  const base = paths.spacePage(slug, page.spaceSlug, page.pageId);
  return { href: base, versionHref: `${base}?commit=${page.commitId}` };
}

// An agreement or a decision is evidence about one revision: its link opens
// that revision in the item's history (read alone, not compared), and
// `currentHref` opens the item as it is now.
function revisionLinks(
  slug: string,
  projectKey: string,
  number: number,
  revisionId: string | null,
) {
  const key = `${projectKey}-${number}`;
  const currentHref = paths.item(slug, projectKey, key);
  return {
    href: revisionId
      ? paths.item(
          slug,
          projectKey,
          key,
          new URLSearchParams({ history: revisionId, compare: "none" }),
        )
      : currentHref,
    currentHref,
  };
}

const productKnowledgeKinds = [
  "decision",
  "approved",
  "delivered",
  "page",
] as const;

// How much a kind of evidence says about intended behavior, for results of
// equal match quality: agreements and conclusions, then pages published
// through review, then pages published directly.
const authorityTier = (
  r: { kind: string } & { publishing?: "direct" | "reviewed" },
) => (r.kind !== "page" ? 0 : r.publishing === "reviewed" ? 1 : 2);

export const searchProductKnowledge = defineCapability({
  name: "searchProductKnowledge",
  title: "Find product agreements",
  description:
    "Search recorded conclusions, approved or delivered specification revisions and published pages of Lictory Spaces in your organization. Results retain the exact version, author and evidence kind: a recorded decision is a conclusion, an approved revision is agreed intent, a delivered revision is recorded delivery scope, and a page is published documentation (`publishing` says whether its space publishes through reviewed pull requests or directly; `commitId` and `version` name the exact version). Published documentation is neither agreed intent nor delivered behavior: prefer agreements and decisions when they disagree, and cite the page version you used. Never infer delivered behavior from approval alone. Archived decisions, archived work items (with the decisions recorded on them), archived projects, archived pages and spaces, live drafts and unmerged page branches are excluded, and pages come only from spaces you can read. Title matches rank first; for equal match quality agreements and decisions rank above reviewed pages, and reviewed pages above directly published ones. Returns bounded excerpts; open the work item or the page (getPage with the commitId) for full evidence.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id
      .optional()
      .describe(
        "Narrows to this project's work and the spaces homed in it or its teams.",
      ),
    query: z.string().trim().max(200).default(""),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("At most this many results of each kind."),
    kinds: z
      .array(z.enum(productKnowledgeKinds))
      .min(1)
      .optional()
      .describe("Only these evidence kinds (default: all)."),
  }),
  async run(ctx, q) {
    // The roster check and every search read one snapshot, so a project
    // archived or a membership removed mid-request cannot leak results the
    // directory check already rejected (or the reverse).
    return ctx.db.transaction(async (tx) => {
      const roster = await directory(
        tx,
        ctx.principal.userId,
        q.organizationId,
      );
      if (q.projectId && !roster.projects.some((p) => p.id === q.projectId))
        throw new CapabilityError("not_found", "This project is unavailable.");
      const slug = roster.organizations.find(
        (o) => o.id === q.organizationId,
      )!.slug;
      const wanted = new Set(q.kinds ?? productKnowledgeKinds);
      const [decisions, specifications, pages] = await Promise.all([
        wanted.has("decision") ? searchDecisions(tx, q) : [],
        wanted.has("approved") || wanted.has("delivered")
          ? searchSpecifications(tx, q)
          : [],
        wanted.has("page")
          ? searchPublishedPages(tx, { ...q, userId: ctx.principal.userId })
          : [],
      ]);
      const results = [
        ...decisions.map(({ window: _, cursor: _c, titleMatch, ...d }) => ({
          ...d,
          kind: "decision" as const,
          key: `${d.projectKey}-${d.number}`,
          ...revisionLinks(slug, d.projectKey, d.number, d.revisionId),
          titleMatch,
        })),
        ...specifications
          .map(({ window: _, cursor: _c, titleMatch, ...r }) => ({
            ...r,
            revisionId: r.id,
            kind: r.delivered ? ("delivered" as const) : ("approved" as const),
            key: `${r.projectKey}-${r.number}`,
            ...revisionLinks(slug, r.projectKey, r.number, r.id),
            titleMatch,
          }))
          .filter((r) => wanted.has(r.kind)),
        ...pages.map((p) => ({
          kind: "page" as const,
          id: p.pageId,
          pageId: p.pageId,
          title: p.title,
          excerpt: p.excerpt,
          spaceId: p.spaceId,
          spaceName: p.spaceName,
          path: p.path,
          publishing: p.publishing,
          commitId: p.commitId,
          version: p.version,
          authorId: p.authorId,
          approverIds: p.approverIds,
          createdAt: p.publishedAt,
          href: pageLinks(slug, p).versionHref,
          titleMatch: p.titleMatch,
        })),
      ];
      // Stable: within a match quality and tier, each search's own order
      // (title matches, then most recent).
      const ranked = results
        .map((r, index) => ({ r, index }))
        .sort(
          (a, b) =>
            Number(b.r.titleMatch) - Number(a.r.titleMatch) ||
            authorityTier(a.r) - authorityTier(b.r) ||
            a.index - b.index,
        )
        .map(({ r: { titleMatch: _, ...r } }) => r);
      return { results: ranked };
    }, readOnly);
  },
});

// ------------------------------------------------------- content search

const knowledgeKinds = [
  "page",
  "item",
  "decision",
  "approved",
  "delivered",
] as const;
export type KnowledgeKind = (typeof knowledgeKinds)[number];

type ResultBase = {
  id: string;
  title: string;
  // Where the result was found: a page's block in its published version, an
  // item, or (for decisions and agreements) the exact revision in the item's
  // history.
  href: string;
  updatedAt: string;
  // Why it was found: the title, or only the content.
  matched: "title" | "content";
  titleHighlights: Highlight[];
  snippet: Snippet;
};
export type KnowledgeResult =
  | (ResultBase & {
      kind: "page";
      pageId: string;
      space: { id: string; name: string; slug: string };
      // Titles of the pages above it, from the top of the space.
      path: string[];
      publishing: "direct" | "reviewed";
      commitId: string;
      version: number;
      // The block holding the match (`href` scrolls to it), when known.
      blockId: string | null;
      // The exact version that was searched.
      versionHref: string;
    })
  | (ResultBase & {
      kind: "item";
      workItemId: string;
      key: string;
      projectId: string;
      // The current specification revision (null without a specification).
      revisionId: string | null;
      revisionNumber: number | null;
    })
  | (ResultBase & {
      kind: "decision";
      workItemId: string;
      key: string;
      // The revision it was recorded on (`href` opens it).
      revisionId: string;
      revisionNumber: number;
      // The item as it is now.
      currentHref: string;
    })
  | (ResultBase & {
      kind: "approved" | "delivered";
      workItemId: string;
      key: string;
      revisionId: string;
      revisionNumber: number;
      currentHref: string;
    });

const iso = (d: Date) => d.toISOString();

// Which search a kind's next batch continues (approved and delivered
// revisions are one search).
type Positions = Partial<
  Record<"page" | "item" | "decision" | "agreement", SearchCursor>
>;
const cursorSchema = z.object({
  title: z.boolean(),
  at: z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?$/),
  id: z.string().min(1).max(200),
});
const positionsSchema = z
  .object({
    page: cursorSchema,
    item: cursorSchema,
    decision: cursorSchema,
    agreement: cursorSchema,
  })
  .partial();

// The continuation token is opaque to callers: the positions after which
// each kind's next batch starts.
function encodeCursor(positions: Positions) {
  return Buffer.from(JSON.stringify(positions)).toString("base64url");
}
function decodeCursor(cursor: string): Positions {
  try {
    const parsed = positionsSchema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // Not a token this capability issued.
  }
  throw new CapabilityError(
    "validation",
    "This continuation is not valid. Search again from the start.",
  );
}

export const searchKnowledge = defineCapability({
  name: "searchKnowledge",
  title: "Search pages and work",
  description:
    "Full-text search across what you can read: published pages of Lictory Spaces (the published version on main, never live drafts or branches), work items (title and current specification), recorded decisions and approved or delivered specification revisions. Each result names its kind (page, item, decision, approved, delivered), the exact version (page commitId and version number, or revision number), a link, an excerpt around the match with highlight offsets and whether the title or only the content matched. Results are for finding things: a textual match is not evidence of authority (use searchProductKnowledge for agreements). Case-insensitive phrase match; title matches first, then most recent; at most `limit` results of each kind. Decisions and approved or delivered revisions link to that exact revision (`href`) and to the item as it is now (`currentHref`). `more` lists the kinds with results after this batch: ask again with the returned `cursor` and those kinds for the next one (results added meanwhile are not repeated).",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    query: z.string().trim().min(2).max(200),
    projectId: id
      .optional()
      .describe(
        "Narrows to this project's work and the spaces homed in it or its teams.",
      ),
    kinds: z.array(z.enum(knowledgeKinds)).min(1).optional(),
    limit: z.number().int().min(1).max(20).default(8),
    cursor: z
      .string()
      .max(2000)
      .optional()
      .describe(
        "The `cursor` of the previous batch, to continue after it (with the kinds in its `more`).",
      ),
  }),
  async run(
    ctx,
    q,
  ): Promise<{
    query: string;
    results: KnowledgeResult[];
    more: KnowledgeKind[];
    // Continues after this batch; null when nothing follows.
    cursor: string | null;
  }> {
    const positions = q.cursor ? decodeCursor(q.cursor) : {};
    return ctx.db.transaction(async (tx) => {
      await authorize(tx, ctx.principal.userId, q.organizationId);
      await requireProject(tx, q.organizationId, q.projectId);
      const slug = await organizationSlug(tx, q.organizationId);
      const wanted = new Set(q.kinds ?? knowledgeKinds);
      const scope = {
        organizationId: q.organizationId,
        projectId: q.projectId,
        query: q.query,
        // One more than asked tells whether another batch exists.
        limit: q.limit + 1,
      };
      const [allPages, allItems, allDecisions, allSpecifications] =
        await Promise.all([
          wanted.has("page")
            ? searchPublishedPages(tx, {
                ...scope,
                after: positions.page,
                userId: ctx.principal.userId,
                withDocument: true,
              })
            : [],
          wanted.has("item")
            ? searchWorkItems(tx, { ...scope, after: positions.item })
            : [],
          wanted.has("decision")
            ? searchDecisions(tx, { ...scope, after: positions.decision })
            : [],
          wanted.has("approved") || wanted.has("delivered")
            ? searchSpecifications(tx, {
                ...scope,
                after: positions.agreement,
              })
            : [],
        ]);
      const more = new Set<KnowledgeKind>();
      const next: Positions = {};
      const batch = <T extends { cursor: SearchCursor }>(
        rows: T[],
        position: keyof Positions,
        ...kinds: KnowledgeKind[]
      ) => {
        const shown = rows.slice(0, q.limit);
        if (rows.length > q.limit && kinds.some((kind) => wanted.has(kind))) {
          for (const kind of kinds) if (wanted.has(kind)) more.add(kind);
          next[position] = shown.at(-1)!.cursor;
        }
        return shown;
      };
      const pages = batch(allPages, "page", "page");
      const items = batch(allItems, "item", "item");
      const decisions = batch(allDecisions, "decision", "decision");
      const specifications = batch(
        allSpecifications,
        "agreement",
        "approved",
        "delivered",
      );
      const text = (title: string, titleMatch: boolean) => ({
        matched: titleMatch ? ("title" as const) : ("content" as const),
        titleHighlights: highlightsIn(title, q.query),
      });
      const agreements: KnowledgeResult[] = specifications
        .filter((r) => wanted.has(r.delivered ? "delivered" : "approved"))
        .map((r) => {
          const key = `${r.projectKey}-${r.number}`;
          return {
            kind: r.delivered ? "delivered" : "approved",
            id: r.id,
            workItemId: r.workItemId,
            key,
            revisionId: r.id,
            revisionNumber: r.revisionNumber,
            title: r.title,
            ...revisionLinks(slug, r.projectKey, r.number, r.id),
            updatedAt: iso(r.createdAt),
            ...text(r.title, r.titleMatch),
            snippet: snippetOf(markdownText(r.window), q.query),
          };
        });
      // An agreement already names that exact revision more precisely.
      const agreed = new Set(agreements.map((a) => a.id));
      const results: KnowledgeResult[] = [
        ...pages.map((p): KnowledgeResult => {
          const found = pageSnippet(p.content, q.query);
          const links = pageLinks(slug, p);
          return {
            kind: "page",
            id: p.pageId,
            pageId: p.pageId,
            space: { id: p.spaceId, name: p.spaceName, slug: p.spaceSlug },
            path: p.path,
            publishing: p.publishing,
            commitId: p.commitId,
            version: p.version,
            blockId: found.blockId,
            title: p.title,
            href: found.blockId
              ? `${links.href}#block-${found.blockId}`
              : links.href,
            versionHref: links.versionHref,
            updatedAt: iso(p.publishedAt),
            ...text(p.title, p.titleMatch),
            snippet: found.snippet,
          };
        }),
        ...items
          .filter((i) => !i.revisionId || !agreed.has(i.revisionId))
          .map((i): KnowledgeResult => {
            const key = `${i.projectKey}-${i.number}`;
            return {
              kind: "item",
              id: i.id,
              workItemId: i.id,
              key,
              projectId: i.projectId,
              revisionId: i.revisionId,
              revisionNumber: i.revisionNumber,
              title: i.title,
              href: paths.item(slug, i.projectKey, key),
              updatedAt: iso(i.updatedAt),
              ...text(i.title, i.titleMatch),
              snippet: snippetOf(markdownText(i.window), q.query),
            };
          }),
        ...decisions.map((d): KnowledgeResult => {
          const key = `${d.projectKey}-${d.number}`;
          return {
            kind: "decision",
            id: d.id,
            workItemId: d.workItemId!,
            key,
            revisionId: d.revisionId!,
            revisionNumber: d.revisionNumber,
            title: d.title,
            ...revisionLinks(slug, d.projectKey, d.number, d.revisionId),
            updatedAt: iso(d.createdAt),
            ...text(d.title, d.titleMatch),
            snippet: snippetOf(markdownText(d.window), q.query),
          };
        }),
        ...agreements,
      ];
      results.sort(
        (a, b) =>
          Number(b.matched === "title") - Number(a.matched === "title") ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
      return {
        query: q.query,
        results,
        more: [...more],
        cursor: more.size ? encodeCursor(next) : null,
      };
    }, readOnly);
  },
});

export const productKnowledgeCapabilities = [
  searchProductKnowledge,
  searchKnowledge,
];
