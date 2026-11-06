import type {
  SpaceAccessLevel,
  SpaceEntity,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";

// Lictory Spaces as the browser sees them: synchronized `space_entity` rows
// (space-level rows from the `spaces` query, one page's history from the
// `page` query) and my `space_reader` rows. Everything here is pure so the
// tree, placement and naming rules are tested without a browser.

export type Space = SpaceEntityOf<"space">;
export type SpacePage = SpaceEntityOf<"page">;
export type SpaceGrant = SpaceEntityOf<"spaceGrant">;
export type PageCommit = SpaceEntityOf<"pageCommit">;
export type PageBranch = SpaceEntityOf<"pageBranch">;

export type SpaceRow = {
  readonly key: string;
  readonly type: string;
  readonly data: unknown;
  readonly updatedAt: number;
};
export type ReaderRow = {
  readonly spaceId: string;
  readonly level: string;
};

// Keeps each row's previous object while its content is unchanged, so lists
// and tree rows re-render only for real changes.
export function createSpaceRowMemo() {
  const cache = new Map<
    string,
    { data: unknown; updatedAt: number; entity: SpaceEntity }
  >();
  return (rows: readonly SpaceRow[]) => {
    const next = new Map<string, SpaceEntity>();
    for (const row of rows) {
      const hit = cache.get(row.key);
      const same =
        hit !== undefined &&
        (hit.data === row.data ||
          (hit.updatedAt === row.updatedAt &&
            JSON.stringify(hit.data) === JSON.stringify(row.data)));
      const entity = same ? hit.entity : (row.data as SpaceEntity);
      cache.set(row.key, { data: row.data, updatedAt: row.updatedAt, entity });
      next.set(row.key, entity);
    }
    for (const key of cache.keys()) if (!next.has(key)) cache.delete(key);
    return next;
  };
}

export type SpaceIndex = {
  spaces: Space[];
  spaceById: Map<string, Space>;
  // Every page of each space, archived ones included.
  pagesBySpace: Map<string, SpacePage[]>;
  pageById: Map<string, SpacePage>;
  grantsBySpace: Map<string, SpaceGrant[]>;
};

const sameItems = <T>(a: readonly T[] | undefined, b: readonly T[]) =>
  a?.length === b.length && a.every((x, i) => x === b[i]);

// Groups space-level entities. Per-space arrays keep their identity while
// their members are unchanged, so one space's edit never re-renders
// another space's tree.
export function indexSpaces(
  entities: Iterable<SpaceEntity>,
  previous?: SpaceIndex,
): SpaceIndex {
  const spaces: Space[] = [];
  const pagesBySpace = new Map<string, SpacePage[]>();
  const grantsBySpace = new Map<string, SpaceGrant[]>();
  const pageById = new Map<string, SpacePage>();
  for (const entity of entities) {
    if (entity.type === "space") spaces.push(entity);
    else if (entity.type === "page") {
      pageById.set(entity.id, entity);
      const list = pagesBySpace.get(entity.spaceId);
      if (list) list.push(entity);
      else pagesBySpace.set(entity.spaceId, [entity]);
    } else if (entity.type === "spaceGrant") {
      const list = grantsBySpace.get(entity.spaceId);
      if (list) list.push(entity);
      else grantsBySpace.set(entity.spaceId, [entity]);
    }
  }
  spaces.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  for (const [id, list] of pagesBySpace) {
    list.sort(byRank);
    const before = previous?.pagesBySpace.get(id);
    if (before && sameItems(before, list)) pagesBySpace.set(id, before);
  }
  for (const [id, list] of grantsBySpace) {
    const before = previous?.grantsBySpace.get(id);
    if (before && sameItems(before, list)) grantsBySpace.set(id, before);
  }
  return {
    spaces: sameItems(previous?.spaces, spaces) ? previous!.spaces : spaces,
    spaceById: new Map(spaces.map((s) => [s.id, s])),
    pagesBySpace,
    pageById,
    grantsBySpace,
  };
}

const byRank = (a: SpacePage, b: SpacePage) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id.localeCompare(b.id);

// Rows to entities and their index, both keeping identity across updates.
export function createSpaceIndexMemo() {
  const rowsMemo = createSpaceRowMemo();
  let previous: SpaceIndex | undefined;
  return (rows: readonly SpaceRow[]) => {
    const entities = rowsMemo(rows);
    previous = indexSpaces(entities.values(), previous);
    return { entities, index: previous };
  };
}

export function levelsOf(rows: readonly ReaderRow[]) {
  return new Map(rows.map((r) => [r.spaceId, r.level as SpaceAccessLevel]));
}

// A space address names its handle. Handles are unique among active spaces;
// an archived space may share one with an active space, which wins.
export function spaceBySlug(spaces: readonly Space[], slug: string) {
  const wanted = slug.toLowerCase();
  const matches = spaces.filter((s) => s.slug.toLowerCase() === wanted);
  return matches.find((s) => !s.archivedAt) ?? matches[0];
}

// A handle suggestion for a name: "Payments handbook" → "payments-handbook".
export function suggestSlug(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug;
}

export const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ------------------------------------------------------------- page tree

export type PageTree = {
  // Children by parent (null: the top level), in rank order.
  children: Map<string | null, SpacePage[]>;
  byId: Map<string, SpacePage>;
};

// Archived pages (and their subpages, which are archived with them) are left
// out unless asked for. A page whose parent is missing from the view stays
// reachable at the top level rather than disappearing.
export function pageTree(
  pages: readonly SpacePage[],
  includeArchived = false,
): PageTree {
  const shown = includeArchived ? pages : pages.filter((p) => !p.archivedAt);
  const byId = new Map(shown.map((p) => [p.id, p]));
  const children = new Map<string | null, SpacePage[]>();
  for (const page of shown) {
    const parent =
      page.parentId && byId.has(page.parentId) ? page.parentId : null;
    const list = children.get(parent);
    if (list) list.push(page);
    else children.set(parent, [page]);
  }
  for (const list of children.values()) list.sort(byRank);
  return { children, byId };
}

export type TreeRow = {
  page: SpacePage;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  // Position among its siblings (1-based) and their count, for aria.
  position: number;
  siblings: number;
};

// The rows a person sees: depth first, children only under expanded pages.
export function visibleRows(
  tree: PageTree,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const list = tree.children.get(parentId) ?? [];
    list.forEach((page, index) => {
      const hasChildren = (tree.children.get(page.id)?.length ?? 0) > 0;
      const open = hasChildren && expanded.has(page.id);
      rows.push({
        page,
        depth,
        hasChildren,
        expanded: open,
        position: index + 1,
        siblings: list.length,
      });
      if (open) walk(page.id, depth + 1);
    });
  };
  walk(null, 1);
  return rows;
}

// Ancestors of a page, the top-level page first.
export function ancestorsOf(
  byId: ReadonlyMap<string, SpacePage>,
  pageId: string,
) {
  const chain: SpacePage[] = [];
  const seen = new Set<string>([pageId]);
  let parentId = byId.get(pageId)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return chain;
}

// Whether `candidateId` is `rootId` or one of its subpages.
export function isWithin(
  byId: ReadonlyMap<string, SpacePage>,
  candidateId: string,
  rootId: string,
) {
  if (candidateId === rootId) return true;
  return ancestorsOf(byId, candidateId).some((p) => p.id === rootId);
}

export type DropPosition = "before" | "after" | "inside";
export type Placement = {
  parentId: string | null;
  afterId: string | null;
  beforeId: string | null;
};

// Where a page goes when dropped before, after or inside another page of the
// tree as shown. Null when the move is impossible (onto itself or into its
// own subtree) or changes nothing.
export function placement(
  tree: PageTree,
  pageId: string,
  targetId: string,
  position: DropPosition,
): Placement | null {
  const page = tree.byId.get(pageId);
  const target = tree.byId.get(targetId);
  if (!page || !target || isWithin(tree.byId, targetId, pageId)) return null;
  const parentOf = (p: SpacePage) =>
    p.parentId && tree.byId.has(p.parentId) ? p.parentId : null;
  let result: Placement;
  if (position === "inside") {
    const children = (tree.children.get(target.id) ?? []).filter(
      (p) => p.id !== pageId,
    );
    result = {
      parentId: target.id,
      afterId: children.at(-1)?.id ?? null,
      beforeId: null,
    };
  } else {
    const parentId = parentOf(target);
    const siblings = (tree.children.get(parentId) ?? []).filter(
      (p) => p.id !== pageId,
    );
    const index = siblings.findIndex((p) => p.id === target.id);
    result =
      position === "before"
        ? {
            parentId,
            afterId: siblings[index - 1]?.id ?? null,
            beforeId: target.id,
          }
        : {
            parentId,
            afterId: target.id,
            beforeId: siblings[index + 1]?.id ?? null,
          };
  }
  return unchanged(tree, page, result) ? null : result;
}

// One step up or down among its siblings (Alt+Arrow on a focused page).
export function siblingStep(
  tree: PageTree,
  pageId: string,
  direction: -1 | 1,
): Placement | null {
  const page = tree.byId.get(pageId);
  if (!page) return null;
  const parentId =
    page.parentId && tree.byId.has(page.parentId) ? page.parentId : null;
  const siblings = tree.children.get(parentId) ?? [];
  const index = siblings.findIndex((p) => p.id === pageId);
  const neighbour = siblings[index + direction];
  if (!neighbour) return null;
  return placement(
    tree,
    pageId,
    neighbour.id,
    direction < 0 ? "before" : "after",
  );
}

// First or last under a parent (the Move dialog).
export function placeUnder(
  tree: PageTree,
  pageId: string,
  parentId: string | null,
  where: "first" | "last",
): Placement | null {
  const page = tree.byId.get(pageId);
  if (!page) return null;
  if (parentId && isWithin(tree.byId, parentId, pageId)) return null;
  const siblings = (tree.children.get(parentId) ?? []).filter(
    (p) => p.id !== pageId,
  );
  const result: Placement =
    where === "first"
      ? { parentId, afterId: null, beforeId: siblings[0]?.id ?? null }
      : { parentId, afterId: siblings.at(-1)?.id ?? null, beforeId: null };
  return unchanged(tree, page, result) ? null : result;
}

function unchanged(tree: PageTree, page: SpacePage, to: Placement) {
  const parentId =
    page.parentId && tree.byId.has(page.parentId) ? page.parentId : null;
  if (parentId !== to.parentId) return false;
  const siblings = tree.children.get(parentId) ?? [];
  const index = siblings.findIndex((p) => p.id === page.id);
  return (
    (siblings[index - 1]?.id ?? null) === to.afterId &&
    (siblings[index + 1]?.id ?? null) === to.beforeId
  );
}

// Every page of the tree in reading order with its depth (the Move dialog's
// list of destinations).
export function readingOrder(tree: PageTree) {
  const all: { page: SpacePage; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const page of tree.children.get(parentId) ?? []) {
      all.push({ page, depth });
      walk(page.id, depth + 1);
    }
  };
  walk(null, 0);
  return all;
}

// The newest commit on the page's main line, from its synchronized history.
export function mainHead(
  commits: readonly PageCommit[],
  branches: readonly PageBranch[],
  publishedCommitId?: string,
) {
  const main = branches.find((b) => b.isMain);
  const id = main?.headCommitId ?? publishedCommitId;
  return commits.find((c) => c.id === id);
}
