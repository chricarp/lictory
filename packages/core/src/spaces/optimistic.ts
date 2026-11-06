import type { Command, SpaceEntityOf } from "@lictory/core/contracts/protocol";
import { rankBetween } from "@lictory/core/contracts/rank";

// Local predictions for page tree commands (docs/internals/spaces.md). The
// browser shows a created, moved or archived page at once; the server's
// rows replace the prediction when they replicate, and Zero drops it when
// the command is refused. Only the tree's structure is predicted: access,
// publishing and every other decision wait for the server.

type PageSummary = SpaceEntityOf<"page">;
export type PredictedPageCommand = Extract<
  Command,
  { type: "createPage" | "movePage" | "archivePage" }
>;

export function predictsPageTree(
  command: Command,
): command is PredictedPageCommand {
  return (
    command.type === "createPage" ||
    command.type === "movePage" ||
    command.type === "archivePage"
  );
}

// The rank the server would choose (`rankAmong` in commands.ts): strictly
// between the chosen siblings, after the last one when neither is named.
// Unknown neighbours (a stale view) fall back to the end; the server decides.
function rankAmong(
  siblings: PageSummary[],
  afterId: string | null | undefined,
  beforeId: string | null | undefined,
) {
  const rankOf = (id: string | null | undefined) =>
    id ? (siblings.find((p) => p.id === id)?.rank ?? null) : null;
  let low = rankOf(afterId);
  let high = rankOf(beforeId);
  if (low !== null && high !== null && low >= high) high = null;
  if (low === null && high === null)
    low =
      siblings
        .map((p) => p.rank)
        .sort()
        .at(-1) ?? null;
  const occupied = new Set(siblings.map((p) => p.rank));
  let rank = rankBetween(low, high);
  while (occupied.has(rank)) rank = rankBetween(rank, high);
  return rank;
}

function descendants(pages: PageSummary[], pageId: string) {
  const children = new Map<string, string[]>();
  for (const page of pages)
    if (page.parentId)
      children.set(page.parentId, [
        ...(children.get(page.parentId) ?? []),
        page.id,
      ]);
  const ids = [pageId];
  // Visits the ids appended while iterating, level by level.
  for (const id of ids) ids.push(...(children.get(id) ?? []));
  return new Set(ids);
}

// The page summaries a command changes, given every page of its space.
// Returns nothing when the command cannot apply to the local view; the
// server answers it either way.
export function predictPageTree(
  pages: PageSummary[],
  command: PredictedPageCommand,
  context: { organizationId: string; userId: string; now: string },
): PageSummary[] {
  switch (command.type) {
    case "createPage": {
      if (pages.some((p) => p.id === command.pageId)) return [];
      const parentId = command.parentId ?? null;
      return [
        {
          type: "page",
          id: command.pageId,
          organizationId: context.organizationId,
          spaceId: command.spaceId,
          parentId,
          rank: rankAmong(
            pages.filter((p) => p.parentId === parentId),
            command.afterId,
            command.beforeId,
          ),
          title: command.title.trim(),
          // The first commit gets its id on the server; the page's history
          // arrives with it.
          publishedCommitId: command.pageId,
          approvedCommitId: null,
          mainDraft: null,
          createdById: context.userId,
          createdAt: context.now,
          updatedAt: context.now,
          publishedById: context.userId,
          publishedMessage: null,
          archivedAt: null,
          openThreads: 0,
          blockingThreads: 0,
        },
      ];
    }
    case "movePage": {
      const page = pages.find((p) => p.id === command.pageId);
      if (!page || page.archivedAt) return [];
      if (command.parentId && descendants(pages, page.id).has(command.parentId))
        return [];
      const siblings = pages.filter(
        (p) => p.parentId === command.parentId && p.id !== page.id,
      );
      return [
        {
          ...page,
          parentId: command.parentId,
          rank: rankAmong(siblings, command.afterId, command.beforeId),
        },
      ];
    }
    case "archivePage": {
      const page = pages.find((p) => p.id === command.pageId);
      if (!page || Boolean(page.archivedAt) === command.archived) return [];
      const subtree = descendants(pages, page.id);
      // As on the server: archiving stamps what is not archived yet;
      // restoring brings back what was archived together with the page.
      return pages
        .filter(
          (p) =>
            subtree.has(p.id) &&
            (command.archived
              ? !p.archivedAt
              : p.archivedAt === page.archivedAt),
        )
        .map((p) => ({
          ...p,
          archivedAt: command.archived ? context.now : null,
        }));
    }
  }
}
