import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KnowledgeResult } from "@lictory/core/capabilities/product-knowledge";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpaces } from "@lictory/platform/components/spaces/store";

// Content search answers are read once, but what they show can stop being
// true while they are on screen: a space's access is withdrawn, a page is
// archived or published again, an item is archived or its specification
// moves on (docs/internals/spaces.md#search-and-product-knowledge). Open
// results (the palette's and the search page's, every loaded batch) follow
// the synchronized rows the browser already has:
//
// - `visible` drops at once what those rows say I can no longer read (a page
//   whose space I no longer read, an archived page, space, item or project);
// - `facts` summarizes, for a set of results, what the rows say about them
//   (my access to each page's space, each page's published version, each
//   item's revision, refinement and delivery). When it differs from what it
//   was when the results were read, they are read again from the server,
//   which decides what remains (a withdrawn decision, a superseded
//   publication or approval);
// - `useVisibleRefresh` reads them again at a bounded interval while the
//   window is visible, and on focus, for what no synchronized row reports
//   (a decision archived on an item I have not opened).

export const SEARCH_REFRESH_MS = 60_000;
const FOCUS_STALE_MS = 5_000;

export function useSearchFreshness() {
  const { items, projects, view } = useWorkspace();
  const { index, levelOf, complete: spacesComplete } = useSpaces();
  const workComplete = view.status === "synced";
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  const pageArchived = useCallback(
    (pageId: string) => {
      // Archiving a page hides its subtree.
      for (
        let page = index.pageById.get(pageId), depth = 0;
        page && depth < 50;
        page = page.parentId ? index.pageById.get(page.parentId) : undefined,
          depth++
      )
        if (page.archivedAt) return true;
      return false;
    },
    [index],
  );

  const visible = useCallback(
    (results: readonly KnowledgeResult[]) =>
      results.filter((r) => {
        if (r.kind === "page") {
          if (!spacesComplete) return true;
          const space = index.spaceById.get(r.space.id);
          return (
            Boolean(space && levelOf(space.id)) &&
            !space!.archivedAt &&
            index.pageById.has(r.pageId) &&
            !pageArchived(r.pageId)
          );
        }
        if (!workComplete) return true;
        const item = itemById.get(r.workItemId);
        if (!item) return false;
        return !item.archivedAt && !projectById.get(item.projectId)?.archivedAt;
      }),
    [
      spacesComplete,
      workComplete,
      index,
      levelOf,
      pageArchived,
      itemById,
      projectById,
    ],
  );

  const facts = useCallback(
    (results: readonly KnowledgeResult[]) =>
      results
        .map((r) => {
          if (r.kind === "page") {
            const space = index.spaceById.get(r.space.id);
            const page = index.pageById.get(r.pageId);
            return [
              r.pageId,
              levelOf(r.space.id) ?? "-",
              space?.archivedAt ?? "",
              page?.publishedCommitId ?? "-",
              page && pageArchived(r.pageId) ? "archived" : "",
            ].join(":");
          }
          const item = itemById.get(r.workItemId);
          return [
            r.workItemId,
            item?.archivedAt ?? (item ? "" : "-"),
            item?.revisionId ?? "",
            item?.refinementState ?? "",
            item?.deliveredRevisionId ?? "",
          ].join(":");
        })
        .sort()
        .join("\n"),
    [index, levelOf, pageArchived, itemById],
  );
  return useMemo(() => ({ visible, facts }), [visible, facts]);
}

// Calls `refresh` every `interval` while the window is visible and `active`,
// and on focus or return to the tab when the last call is older than a few
// seconds.
export function useVisibleRefresh(
  refresh: () => void,
  active: boolean,
  interval = SEARCH_REFRESH_MS,
) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const run = (maxAge: number) => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < maxAge) return;
      last = Date.now();
      latest.current();
    };
    const timer = setInterval(() => run(interval - 1000), interval);
    const onFocus = () => run(FOCUS_STALE_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [active, interval]);
}
