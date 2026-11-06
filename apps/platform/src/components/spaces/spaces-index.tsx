import { useCallback, useEffect, useId, useState } from "react";
import { Archive, FileText, Lock, Plus, ShieldAlert } from "lucide-react";
import type { SpaceAccessLevel } from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
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

// Every space I can read, organization spaces first, then by project: a
// card grid that uses the width, each card saying what the space holds and
// when it last changed.
export function SpacesIndex() {
  const { organization, directory } = useWorkspace();
  const { spaces, complete, openCreateSpace } = useSpaces();
  const [showArchived, setShowArchived] = useState(false);
  const active = spaces.filter((s) => !s.archivedAt);
  const archived = spaces.filter((s) => s.archivedAt);
  const organizationSpaces = active.filter((s) => !s.projectId);
  const byProject = directory.projects
    .map((project) => ({
      project,
      spaces: active.filter((s) => s.projectId === project.id),
    }))
    .filter((g) => g.spaces.length)
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="text-xl font-semibold tracking-tight">Spaces</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Pages your teams write and review together. Every space belongs to{" "}
              {organization.name}, a project or a team.
            </p>
          </div>
          <Button onClick={() => openCreateSpace()}>
            <Plus className="size-3.5" aria-hidden /> New space
          </Button>
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
          <div className="mt-8 space-y-10">
            {organizationSpaces.length > 0 && (
              <SpaceGroup
                title={organization.name}
                kind="Organization"
                spaces={organizationSpaces}
              />
            )}
            {byProject.map(({ project, spaces: list }) => (
              <SpaceGroup
                key={project.id}
                title={project.name}
                kind="Project"
                spaces={list}
              />
            ))}
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
                    <SpaceGroup title="Archived" spaces={archived} />
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

function SpaceGroup({
  title,
  kind,
  spaces,
}: {
  title: string;
  kind?: string;
  spaces: Space[];
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-3 flex items-baseline gap-2 px-1">
        <h2 id={headingId} className="text-sm font-semibold">
          {title}
        </h2>
        {kind && <span className="text-xs text-muted-foreground">{kind}</span>}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spaces.map((space) => (
          <li key={space.id} className="min-w-0">
            <SpaceCard space={space} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SpaceCard({ space }: { space: Space }) {
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
  return (
    <Link
      href={paths.space(organization.slug, space.slug)}
      className="group flex h-full min-h-36 flex-col rounded-2xl border border-transparent bg-card p-4 shadow-(--shadow-border) transition-[box-shadow,scale] duration-150 ease-out outline-none hover:shadow-(--shadow-border-hover) focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.99]"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
          <SpaceIcon space={space} className="size-6 text-xl" />
        </span>
        <span className="flex flex-wrap justify-end gap-1">
          {home.kind === "team" && <Badge>{home.teamName} team</Badge>}
          {space.accessMode === "restricted" && (
            <Badge tone="warning">
              <Lock className="size-3" aria-hidden /> Restricted
            </Badge>
          )}
          {level && level !== "edit" && <Badge>{levelLabels[level]}</Badge>}
        </span>
      </span>
      <span className="mt-3 block truncate text-[15px] font-semibold tracking-tight">
        {space.name}
      </span>
      <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-muted-foreground">
        {space.description ??
          (space.publishing === "reviewed"
            ? "Changes are reviewed before they are published."
            : "Editors publish changes directly.")}
      </span>
      <span className="mt-auto flex flex-wrap items-center gap-x-1.5 pt-4 text-xs text-muted-foreground tabular-nums">
        <FileText className="size-3.5" aria-hidden />
        {live.length === 1 ? "1 page" : `${live.length} pages`}
        <span aria-hidden>·</span>
        <span>
          Updated{" "}
          <time dateTime={updatedAt} title={absoluteTime(updatedAt)}>
            {relativeTime(updatedAt)}
          </time>
        </span>
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
      <ul className="divide-y rounded-2xl border border-transparent bg-card shadow-(--shadow-border)">
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
