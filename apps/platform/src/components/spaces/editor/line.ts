import { useCallback, useMemo } from "react";
import {
  spaceLevelAtLeast,
  type PageDraftSummary,
} from "@lictory/core/contracts/protocol";
import type {
  PageBranch,
  PageCommit,
  Space,
  SpacePage,
} from "@lictory/platform/data/spaces";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useSpaces,
  type usePageHistory,
} from "@lictory/platform/components/spaces/store";

// The line of a page being looked at (main, or a branch named by the
// `?branch=<branchId>` search parameter) and what I may do with it. Small
// and synchronous: the page header uses it before the editor bundle loads.

export type PageHistory = ReturnType<typeof usePageHistory>;

export type PageLine = {
  // The branch row; undefined until the page's history arrives (main is
  // still known from the page summary).
  branch: PageBranch | undefined;
  branchId: string | undefined;
  isMain: boolean;
  // The line's open live draft (main in Direct spaces, every branch).
  draft: PageDraftSummary | null;
  // The commit the line points at, and a commit picked with `?commit=`.
  head: PageCommit | undefined;
  viewed: PageCommit | undefined;
  reviewed: boolean;
  canEditSpace: boolean;
  canComment: boolean;
  // Whether I may type into this line's draft.
  writable: boolean;
};

export function useSelectedBranchId(): string | null {
  return useSearchParams().get("branch");
}

// Switches the page to a line (null: main), keeping the address shareable.
export function useSelectLine() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (branchId: string | null) => {
      const next = new URLSearchParams(params);
      next.delete("commit");
      if (branchId) next.set("branch", branchId);
      else next.delete("branch");
      const query = next.toString();
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, params],
  );
}

export function usePageLine(
  space: Space,
  page: SpacePage,
  history: PageHistory,
): PageLine {
  const { userId } = useWorkspace();
  const { levelOf } = useSpaces();
  const params = useSearchParams();
  const selected = params.get("branch");
  const commitId = params.get("commit");
  const level = levelOf(space.id);
  return useMemo(() => {
    const active = !space.archivedAt && !page.archivedAt;
    const main = history.branches.find((b) => b.isMain);
    const chosen = selected
      ? history.branches.find((b) => b.id === selected)
      : undefined;
    const branch = chosen ?? main;
    const isMain = !chosen;
    const reviewed = space.publishing === "reviewed";
    const draft = isMain
      ? reviewed
        ? null
        : (main?.draft ?? page.mainDraft)
      : (chosen.draft ?? null);
    const head = isMain
      ? history.head
      : history.commits.find((c) => c.id === chosen.headCommitId);
    const viewed = commitId
      ? history.commits.find((c) => c.id === commitId)
      : undefined;
    const canEditSpace = active && spaceLevelAtLeast(level, "edit");
    const author =
      !isMain &&
      (chosen.authorId === userId || chosen.collaboratorIds.includes(userId));
    return {
      branch,
      branchId: branch?.id,
      isMain,
      draft,
      head,
      viewed,
      reviewed,
      canEditSpace,
      canComment: active && spaceLevelAtLeast(level, "comment"),
      writable: canEditSpace && draft !== null && (isMain ? !reviewed : author),
    };
  }, [space, page, history, selected, commitId, level, userId]);
}

// Version numbers count main's first-parent chain: the first commit is
// version 1. Branch commits are numbered on their own chain.
export function versionOf(
  commits: readonly PageCommit[],
  commitId: string | undefined,
) {
  const byId = new Map(commits.map((c) => [c.id, c]));
  let n = 0;
  const seen = new Set<string>();
  for (let id = commitId; id && !seen.has(id);) {
    seen.add(id);
    const commit = byId.get(id);
    if (!commit) return undefined;
    n += 1;
    id = commit.parentIds[0];
  }
  return n || undefined;
}
