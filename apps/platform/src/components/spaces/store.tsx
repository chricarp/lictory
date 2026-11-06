import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type {
  SpaceAccessLevel,
  SpaceEntity,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import {
  createSpaceIndexMemo,
  createSpaceRowMemo,
  levelsOf,
  mainHead,
  spaceBySlug,
  type PageBranch,
  type PageCommit,
  type ReaderRow,
  type Space,
  type SpaceIndex,
  type SpaceRow,
} from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Lictory Spaces in the workspace: the space-level rows (spaces, grants,
// page trees) and my access levels are subscribed when the workspace opens;
// one page's history is subscribed while that page is open.

export type CreateSpaceDefaults = {
  projectId?: string | null;
  teamId?: string | null;
};

type SpacesValue = {
  index: SpaceIndex;
  entities: ReadonlyMap<string, SpaceEntity>;
  levels: ReadonlyMap<string, SpaceAccessLevel>;
  // Both subscriptions have their complete server answer.
  complete: boolean;
  openCreateSpace: (defaults?: CreateSpaceDefaults) => void;
};
const SpacesContext = createContext<SpacesValue | null>(null);

const CreateSpaceDialog = lazy(() =>
  import("@lictory/platform/components/spaces/create-space").then((m) => ({
    default: m.CreateSpaceDialog,
  })),
);

const PAGE_TTL = "5m";

export function SpacesProvider({ children }: { children: ReactNode }) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.spaces({ organizationId: organization.id }),
  );
  const [readerRows, readerResult] = useQuery(
    queries.mySpaceAccess({ organizationId: organization.id }),
  );
  const [memo] = useState(createSpaceIndexMemo);
  const { entities, index } = useMemo(
    () => memo(rows as readonly SpaceRow[]),
    [memo, rows],
  );
  const levels = useMemo(
    () => levelsOf(readerRows as readonly ReaderRow[]),
    [readerRows],
  );
  const [creating, setCreating] = useState<CreateSpaceDefaults | null>(null);
  const openCreateSpace = useCallback(
    (defaults: CreateSpaceDefaults = {}) => setCreating(defaults),
    [],
  );
  const complete =
    result.type === "complete" && readerResult.type === "complete";
  const value = useMemo<SpacesValue>(
    () => ({ index, entities, levels, complete, openCreateSpace }),
    [index, entities, levels, complete, openCreateSpace],
  );
  return (
    <SpacesContext.Provider value={value}>
      {children}
      {creating && (
        <Suspense fallback={null}>
          <CreateSpaceDialog
            defaults={creating}
            onClose={() => setCreating(null)}
          />
        </Suspense>
      )}
    </SpacesContext.Provider>
  );
}

function useSpacesContext() {
  const value = useContext(SpacesContext);
  if (!value) throw new Error("Spaces hooks require SpacesProvider.");
  return value;
}

// Every space I can read (archived ones included; filter with `archivedAt`),
// my level in each, and who may administer it.
export function useSpaces() {
  const { index, levels, complete, entities, openCreateSpace } =
    useSpacesContext();
  const { userId, isAdmin, canManage } = useWorkspace();
  // Mirrors `canManageSpaceAccess` for showing controls; the server decides.
  const canManageSpace = useCallback(
    (space: Pick<Space, "createdById" | "projectId">) =>
      space.createdById === userId ||
      isAdmin ||
      (space.projectId !== null && canManage(space.projectId)),
    [userId, isAdmin, canManage],
  );
  const levelOf = useCallback(
    (spaceId: string): SpaceAccessLevel | undefined => levels.get(spaceId),
    [levels],
  );
  return {
    spaces: index.spaces,
    index,
    entities,
    complete,
    levelOf,
    canManageSpace,
    openCreateSpace,
  };
}

// The space at an address (`/{org}/spaces/{slug}`), or undefined when I
// cannot read one with that handle.
export function useSpaceBySlug(slug: string | undefined) {
  const { index } = useSpacesContext();
  return useMemo(
    () => (slug ? spaceBySlug(index.spaces, slug) : undefined),
    [index.spaces, slug],
  );
}

// Every page of a space (archived ones included), in rank order.
const noPages: never[] = [];
export function useSpacePages(spaceId: string | undefined) {
  const { index } = useSpacesContext();
  return spaceId ? (index.pagesBySpace.get(spaceId) ?? noPages) : noPages;
}

export function useSpaceGrants(spaceId: string | undefined) {
  const { index } = useSpacesContext();
  return spaceId ? (index.grantsBySpace.get(spaceId) ?? noPages) : noPages;
}

// One page's history (commits with content, branches), subscribed while the
// caller is mounted. `head` is the commit main publishes.
export function usePageHistory(pageId: string | undefined) {
  const { organization } = useWorkspace();
  const { index } = useSpacesContext();
  const [rows, result] = useQuery(
    // Disabled without a page; the placeholder only satisfies the arguments.
    queries.page({ organizationId: organization.id, pageId: pageId ?? "none" }),
    { enabled: Boolean(pageId), ttl: PAGE_TTL },
  );
  const [memo] = useState(createSpaceRowMemo);
  const entities = useMemo(
    () => memo(rows as readonly SpaceRow[]),
    [memo, rows],
  );
  const summary = pageId ? index.pageById.get(pageId) : undefined;
  return useMemo(() => {
    const commits: PageCommit[] = [];
    const branches: PageBranch[] = [];
    const pullRequests: SpaceEntityOf<"pagePullRequest">[] = [];
    const reviews: SpaceEntityOf<"pagePullRequestReview">[] = [];
    for (const entity of entities.values())
      if (entity.type === "pageCommit") commits.push(entity);
      else if (entity.type === "pageBranch") branches.push(entity);
      else if (entity.type === "pagePullRequest") pullRequests.push(entity);
      else if (entity.type === "pagePullRequestReview") reviews.push(entity);
    commits.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      commits,
      branches,
      pullRequests,
      reviews,
      head: mainHead(commits, branches, summary?.publishedCommitId),
      loaded: result.type === "complete",
    };
  }, [entities, result.type, summary?.publishedCommitId]);
}

const SIDEBAR_SPACES = 8;

// Spaces for navigation (active ones): the organization's own, those of the
// projects and teams I belong to, and a lookup by project for each project's
// navigation (its spaces and its teams' spaces).
export function useNavigationSpaces() {
  const { index } = useSpacesContext();
  const { directory, userId } = useWorkspace();
  return useMemo(() => {
    const active = index.spaces.filter((s) => !s.archivedAt);
    const myProjects = new Set(
      directory.projectMembers
        .filter((m) => m.userId === userId)
        .map((m) => m.projectId),
    );
    const myTeams = new Set(
      directory.teams
        .filter((t) => t.memberIds.includes(userId))
        .map((t) => t.id),
    );
    const organization = active.filter((s) => !s.projectId);
    const mine = active.filter((s) =>
      s.teamId
        ? myTeams.has(s.teamId)
        : s.projectId !== null && myProjects.has(s.projectId),
    );
    const listed = [...organization, ...mine];
    return {
      // The sidebar shows the first few; "All spaces" lists the rest.
      sidebar: listed.slice(0, SIDEBAR_SPACES),
      more: listed.length > SIDEBAR_SPACES,
      ofProject: (projectId: string) =>
        active.filter((s) => s.projectId === projectId),
    };
  }, [index.spaces, directory.projectMembers, directory.teams, userId]);
}
