import { useCallback, useEffect, useId, useState } from "react";
import { Archive, Lock, Plus, Search, ShieldAlert, X } from "lucide-react";
import type { SpaceAccessLevel } from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Badge, EmptyState } from "@lictory/ui/primitives";
import { LoadingState } from "@lictory/ui/spinner";
import { Link } from "@lictory/platform/lib/navigation";
import { spacesIManageWithoutAccess } from "@lictory/platform/data/lookups";
import type { Space } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useSpacePages,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { Dialog, RadioCards } from "@lictory/platform/components/spaces/dialog";
import {
  SpaceIcon,
  homeOf,
  levelDescriptions,
  levelLabels,
} from "@lictory/platform/components/spaces/space-meta";

// Past this many spaces the index offers a filter.
const filterFrom = 7;

type Group = { key: string; title: string; kind?: string; spaces: Space[] };

// Every space I can read as one list of rows grouped by home (the
// organization first, then each project), so a handful of spaces and fifty
// read the same way: name and purpose on the left, size and freshness in
// aligned columns on the right.
export function SpacesIndex() {
  const { organization, directory } = useWorkspace();
  const { spaces, complete, openCreateSpace } = useSpaces();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const active = spaces.filter((s) => !s.archivedAt);
  const archived = spaces.filter((s) => s.archivedAt);
  const filtering = active.length >= filterFrom;
  const needle = filtering ? query.trim().toLocaleLowerCase() : "";
  const matches = (space: Space) =>
    !needle ||
    space.name.toLocaleLowerCase().includes(needle) ||
    (space.description ?? "").toLocaleLowerCase().includes(needle) ||
    homeOf(space, directory, organization.name)
      .label.toLocaleLowerCase()
      .includes(needle);
  const shown = active.filter(matches);
  const groups: Group[] = [
    {
      key: "organization",
      title: organization.name,
      kind: "Organization",
      spaces: shown.filter((s) => !s.projectId),
    },
    ...directory.projects
      .map((project) => ({
        key: project.id,
        title: project.name,
        kind: "Project",
        spaces: shown.filter((s) => s.projectId === project.id),
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  ].filter((g) => g.spaces.length);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-4">
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="text-xl font-semibold tracking-tight">Spaces</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Pages your teams write and review together.
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {filtering && (
              <SpaceFilter
                value={query}
                onChange={setQuery}
                count={shown.length}
                total={active.length}
              />
            )}
            <Button onClick={() => openCreateSpace()} className="shrink-0">
              <Plus className="size-3.5" aria-hidden /> New space
            </Button>
          </div>
        </header>
        {!complete && !spaces.length ? (
          <LoadingState label="Loading spaces" />
        ) : !active.length && !archived.length ? (
          <EmptyState
            illustration="knowledge"
            title="No spaces yet"
            action={
              <Button onClick={() => openCreateSpace()}>
                <Plus className="size-3.5" aria-hidden /> New space
              </Button>
            }
          >
            Create a space for a handbook, a project’s decisions or a team’s
            runbooks. You choose who can read and edit it.
          </EmptyState>
        ) : (
          <div className="mt-6 space-y-6">
            {groups.length > 0 ? (
              <SpaceList groups={groups} />
            ) : active.length ? (
              <div className="rounded-xl border border-transparent bg-card px-4 py-10 text-center text-[13px] text-muted-foreground shadow-(--shadow-border)">
                No spaces match “{query.trim()}”.{" "}
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  Clear filter
                </button>
              </div>
            ) : null}
            {archived.length > 0 && (
              <div>
                <button
                  type="button"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((v) => !v)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <Archive className="size-3.5" aria-hidden />
                  {showArchived
                    ? "Hide archived spaces"
                    : `Show archived spaces (${archived.length})`}
                </button>
                {showArchived && (
                  <div className="mt-3">
                    <SpaceList
                      groups={[
                        {
                          key: "archived",
                          title: "Archived",
                          spaces: archived,
                        },
                      ]}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <ManagedWithoutAccess />
      </div>
    </div>
  );
}

function SpaceFilter({
  value,
  onChange,
  count,
  total,
}: {
  value: string;
  onChange: (value: string) => void;
  count: number;
  total: number;
}) {
  const filtering = value.trim() !== "";
  return (
    <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        aria-label="Filter spaces"
        placeholder="Filter spaces"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && onChange("")}
        className={cn(
          "h-8 w-full min-w-0 rounded-full border border-foreground/15 bg-card pl-8 text-[13px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:ring-3 focus-visible:ring-ring/15 touch:text-base [&::-webkit-search-cancel-button]:hidden",
          filtering ? "pr-32" : "pr-3",
        )}
      />
      <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-1">
        <span
          role="status"
          className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {filtering ? `${count} of ${total} spaces` : ""}
        </span>
        {filtering && (
          <button
            type="button"
            aria-label="Clear filter"
            title="Clear filter"
            onClick={() => onChange("")}
            className="pointer-events-auto grid size-6 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

// Rows share one grid with their group header, so the column names line up
// with the values under them at every width. Wide lists give names and
// purposes a column each, so descriptions start on one line.
const columns =
  "grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-4 @min-[40rem]/list:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_3.5rem_5rem] @min-[40rem]/list:gap-x-5";

function SpaceList({ groups }: { groups: Group[] }) {
  return (
    <div className="@container/list overflow-clip rounded-xl border border-transparent bg-card shadow-(--shadow-border)">
      {groups.map((group, index) => (
        <SpaceGroup key={group.key} group={group} first={index === 0} />
      ))}
    </div>
  );
}

function SpaceGroup({ group, first }: { group: Group; first: boolean }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div
        className={cn(
          columns,
          "sticky top-0 z-1 h-8 border-b bg-muted/60 px-4 backdrop-blur",
          !first && "border-t",
        )}
      >
        <div className="flex min-w-0 items-baseline gap-2 text-xs @min-[40rem]/list:col-span-2">
          <h2 id={headingId} className="truncate font-medium">
            {group.title}
          </h2>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {group.kind && `${group.kind} · `}
            {group.spaces.length === 1
              ? "1 space"
              : `${group.spaces.length} spaces`}
          </span>
        </div>
        {first && (
          <>
            <span
              aria-hidden
              className="hidden text-right font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase @min-[40rem]/list:block"
            >
              Pages
            </span>
            <span
              aria-hidden
              className="text-right font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              Updated
            </span>
          </>
        )}
      </div>
      <ul className="divide-y divide-border/70">
        {group.spaces.map((space) => (
          <li key={space.id}>
            <SpaceRow space={space} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SpaceRow({ space }: { space: Space }) {
  const { organization, directory } = useWorkspace();
  const { levelOf } = useSpaces();
  const pages = useSpacePages(space.id);
  const level = levelOf(space.id);
  const home = homeOf(space, directory, organization.name);
  const live = pages.filter((p) => !p.archivedAt);
  const updatedAt = live.reduce(
    (latest, p) => (p.updatedAt > latest ? p.updatedAt : latest),
    space.updatedAt,
  );
  const pageCount = live.length === 1 ? "1 page" : `${live.length} pages`;
  return (
    <Link
      href={paths.space(organization.slug, space.slug)}
      className={cn(
        columns,
        "min-h-13 px-4 py-2.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
          <SpaceIcon space={space} className="-translate-y-px text-base" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{space.name}</span>
            {home.kind === "team" && (
              <Badge className="shrink-0">{home.teamName} team</Badge>
            )}
            {space.accessMode === "restricted" && (
              <Badge className="shrink-0">
                <Lock className="size-3" aria-hidden /> Restricted
              </Badge>
            )}
            {level && level !== "edit" && (
              <Badge className="shrink-0">{levelLabels[level]}</Badge>
            )}
          </span>
          {/* Narrow lists keep the purpose under the name (two lines), or
              the page count when there is none. */}
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-[1.125rem] text-muted-foreground @min-[40rem]/list:hidden">
            {space.description?.length ? space.description : pageCount}
          </span>
        </span>
      </span>
      <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground @min-[40rem]/list:block">
        {space.description}
      </span>
      <span className="hidden text-right text-[13px] text-muted-foreground tabular-nums @min-[40rem]/list:block">
        {live.length}
        <span className="sr-only"> {live.length === 1 ? "page" : "pages"}</span>
      </span>
      <span className="text-right text-xs text-muted-foreground tabular-nums @min-[40rem]/list:text-[13px]">
        <span className="sr-only">Updated </span>
        <time dateTime={updatedAt} title={absoluteTime(updatedAt)}>
          {relativeTime(updatedAt)}
        </time>
      </span>
    </Link>
  );
}

// Restricted spaces I administer but cannot read (names only, from the
// server). Reading one takes an explicit grant to myself, which the audit
// log records.
function ManagedWithoutAccess() {
  const { organization, userId, mutateConfirmed } = useWorkspace();
  const { spaces } = useSpaces();
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const [granting, setGranting] = useState<{ id: string; name: string }>();
  const readable = spaces.map((s) => s.id).join(",");
  const load = useCallback(() => {
    let live = true;
    spacesIManageWithoutAccess(organization.id).then(
      (next) => live && setList(next),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [organization.id]);
  // Reload when the readable set changes (a grant arrived).
  useEffect(() => load(), [load, readable]);
  const shown = list.filter((x) => !spaces.some((s) => s.id === x.id));
  if (!shown.length) return null;
  return (
    <section aria-labelledby="managed-without-access" className="mt-10">
      <h2
        id="managed-without-access"
        className="mb-1 px-1 text-sm font-semibold"
      >
        Restricted spaces you administer
      </h2>
      <p className="mb-3 px-1 text-xs text-muted-foreground">
        You manage these spaces but are not on their access list, so their pages
        stay closed to you.
      </p>
      <ul className="divide-y rounded-xl border border-transparent bg-card shadow-(--shadow-border)">
        {shown.map((space) => (
          <li
            key={space.id}
            className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]"
          >
            <Lock className="size-4 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">
              {space.name}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setGranting(space)}
            >
              Grant myself access…
            </Button>
          </li>
        ))}
      </ul>
      {granting && (
        <SelfGrantDialog
          name={granting.name}
          onClose={() => setGranting(undefined)}
          onGrant={async (level) => {
            await mutateConfirmed({
              type: "setSpaceGrant",
              spaceId: granting.id,
              userId,
              level,
            });
            setGranting(undefined);
            load();
          }}
        />
      )}
    </section>
  );
}

function SelfGrantDialog({
  name,
  onClose,
  onGrant,
}: {
  name: string;
  onClose: () => void;
  onGrant: (level: SpaceAccessLevel) => Promise<void>;
}) {
  const [level, setLevel] = useState<SpaceAccessLevel>("view");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setPending(true);
    setError(undefined);
    try {
      await onGrant(level);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Access was not granted.");
      setPending(false);
    }
  };
  return (
    <Dialog
      title={`Grant yourself access to ${name}`}
      description="As an administrator you can add yourself to this restricted space. The grant is recorded in the audit log with your name, and other administrators can see and remove it."
      onClose={onClose}
      onSubmit={() => void submit()}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            <ShieldAlert className="size-3.5" aria-hidden />
            {pending ? "Granting…" : "Grant access (audited)"}
          </Button>
        </>
      }
    >
      <RadioCards
        legend="Your access"
        name="self-grant-level"
        value={level}
        onChange={setLevel}
        columns={1}
        options={(["view", "comment", "edit"] as const).map((value) => ({
          value,
          label: levelLabels[value],
          description: levelDescriptions[value],
        }))}
      />
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  );
}
