import { useMemo, useState } from "react";
import {
  Archive,
  Building2,
  FileText,
  FolderKanban,
  GitPullRequest,
  Lock,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { Input as InputPrimitive } from "@ui-sdk/react/input";
import { Button } from "@lictory/ui/button";
import { EmptyState } from "@lictory/ui/primitives";
import { StatusChip } from "@lictory/ui/status-chip";
import { Tooltip } from "@lictory/ui/tooltip";
import { Link } from "@lictory/platform/lib/navigation";
import { ancestorsOf, type SpacePage } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useSpacePages,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { PageTree } from "@lictory/platform/components/spaces/page-tree";
import {
  SpaceIcon,
  homeOf,
  levelLabels,
} from "@lictory/platform/components/spaces/space-meta";
import { ArchivedSpaceNotice } from "@lictory/platform/components/spaces/archived-notice";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { Actor } from "@lictory/platform/components/identity/actor";
import { SpaceLinkedWork } from "@lictory/platform/components/spaces/work/space-work";

const RECENT = 5;

// A space's front page: what it is in one quiet line (home, publishing, my
// access), then its pages, then what changed lately. Who exactly can read
// and edit it lives in its settings.
export function SpaceHome() {
  const space = useSpace();
  const { organization, directory } = useWorkspace();
  const { levelOf, canManageSpace } = useSpaces();
  const { canEdit, createPage } = usePageActions();
  const pages = useSpacePages(space.id);
  const level = levelOf(space.id);
  const home = homeOf(space, directory, organization.name);
  const manage = canManageSpace(space);
  const active = useMemo(() => pages.filter((p) => !p.archivedAt), [pages]);
  const recent = useMemo(
    () =>
      [...active]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, RECENT),
    [active],
  );
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const found = useMemo(
    () =>
      needle
        ? active
            .filter((p) => p.title.toLocaleLowerCase().includes(needle))
            .sort(
              (a, b) =>
                Number(!a.title.toLocaleLowerCase().startsWith(needle)) -
                  Number(!b.title.toLocaleLowerCase().startsWith(needle)) ||
                a.title.localeCompare(b.title),
            )
        : [],
    [active, needle],
  );
  const HomeIcon =
    home.kind === "organization"
      ? Building2
      : home.kind === "project"
        ? FolderKanban
        : Users;
  const fact = "inline-flex items-center gap-1.5 whitespace-nowrap";
  const factIcon = "size-3.5 shrink-0 text-muted-foreground";
  const actions = (
    <>
      {space.publishing === "reviewed" && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Pull requests"
          render={
            <Link
              href={`${paths.space(organization.slug, space.slug)}/pull-requests`}
            />
          }
        >
          <GitPullRequest className="size-3.5" aria-hidden />
          <span className="max-sm:hidden">Pull requests</span>
        </Button>
      )}
      {(manage || level === "edit") && (
        <Tooltip label="Space settings">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Space settings"
            render={
              <Link href={paths.spaceSettings(organization.slug, space.slug)} />
            }
          >
            <Settings2 className="size-3.5" aria-hidden />
          </Button>
        </Tooltip>
      )}
      {canEdit && (
        <Button size="sm" onClick={() => createPage(null)}>
          <Plus className="size-3.5" aria-hidden />
          <span className="max-sm:sr-only">New page</span>
        </Button>
      )}
    </>
  );
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={space.name}
        icon={<SpaceIcon space={space} className="text-sm" />}
        breadcrumbs={[
          { label: "Spaces", href: paths.spaces(organization.slug) },
        ]}
        actions={actions}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pt-5 pb-16 sm:px-8 sm:pt-8">
          {space.archivedAt && <ArchivedSpaceNotice space={space} />}
          {/* What the space is for, where it lives and how it publishes: one
            quiet introduction under the header that names it. */}
          <div className="space-y-2">
            {space.description && (
              <p className="text-sm leading-6 whitespace-pre-line text-muted-foreground sm:text-[15px]">
                {space.description}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
              <span className={fact}>
                <HomeIcon className={factIcon} aria-hidden />
                <span className="sr-only">Location: </span>
                {home.label}
              </span>
              <span className={fact}>
                {space.publishing === "direct" ? (
                  <Send className={factIcon} aria-hidden />
                ) : (
                  <ShieldCheck className={factIcon} aria-hidden />
                )}
                {space.publishing === "direct"
                  ? "Direct publishing"
                  : "Reviewed publishing"}
              </span>
              {space.accessMode === "restricted" && (
                <StatusChip tone="attention" icon={<Lock />}>
                  Restricted
                </StatusChip>
              )}
              {level && (
                <span className={fact}>
                  <span className="sr-only">Your access: </span>
                  <span>{levelLabels[level]}</span>
                </span>
              )}
            </p>
          </div>
          {/* The pages beside what changed lately and who changed it, so a
            space reads as a living place on a wide screen, not a short list
            in an empty canvas. */}
          <div className="mt-7 grid gap-x-8 gap-y-10 sm:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
            <div className="min-w-0">
              <section aria-labelledby="space-pages">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
                  <h2 id="space-pages" className="text-sm font-semibold">
                    Pages{" "}
                    <span className="ml-0.5 font-normal text-muted-foreground tabular-nums">
                      {active.length}
                    </span>
                  </h2>
                  {active.length > 1 && (
                    <PageFinder value={query} onChange={setQuery} />
                  )}
                </div>
                {pages.length === 0 ? (
                  <div className="rounded-2xl bg-card shadow-(--shadow-border)">
                    <EmptyState
                      illustration="knowledge"
                      title="No pages yet"
                      action={
                        canEdit ? (
                          <Button onClick={() => createPage(null)}>
                            <Plus className="size-3.5" aria-hidden /> New page
                          </Button>
                        ) : undefined
                      }
                    >
                      {canEdit
                        ? "Start with the page people ask about most: a runbook, a decision record or how the team works."
                        : "Nothing has been written here yet. Editors of this space can add the first page."}
                    </EmptyState>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-transparent bg-card p-1.5 shadow-(--shadow-border)">
                    {needle ? (
                      <FoundPages
                        pages={found}
                        byId={byId}
                        query={query.trim()}
                        onClear={() => setQuery("")}
                      />
                    ) : (
                      <PageTree variant="home" />
                    )}
                  </div>
                )}
                {space.archivedAt && (
                  <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                    <Archive className="size-3.5" aria-hidden /> Pages of an
                    archived space can be read but not changed.
                  </p>
                )}
              </section>
              {/* Project and team spaces: the work their pages mention. */}
              {space.projectId && <SpaceLinkedWork spaceId={space.id} />}
            </div>
            {active.length > 0 && (
              <section aria-labelledby="space-recent" className="min-w-0">
                <h2
                  id="space-recent"
                  className="mb-2 flex min-h-8 items-center px-1 text-sm font-semibold"
                >
                  Recently updated
                </h2>
                <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-transparent bg-card shadow-(--shadow-border)">
                  {recent.map((page) => (
                    <RecentPage key={page.id} page={page} byId={byId} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// "Payments service · in Architecture", then who published what.
function RecentPage({
  page,
  byId,
}: {
  page: SpacePage;
  byId: ReadonlyMap<string, SpacePage>;
}) {
  const space = useSpace();
  const { organization } = useWorkspace();
  const parent = page.parentId ? byId.get(page.parentId) : undefined;
  const who = page.publishedById ?? page.createdById;
  const created =
    page.publishedMessage == null && page.createdAt === page.updatedAt;
  const what = page.publishedMessage
    ? page.publishedMessage.replace(/^Merge pull request: /, "")
    : created
      ? "Created the page"
      : "Published a new version";
  return (
    <li>
      <Link
        href={paths.spacePage(organization.slug, space.slug, page.id)}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-2.5 text-[13px] focus-ring-inset outline-none hover:bg-muted/60"
      >
        <FileText
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium">{page.title}</span>
          {parent && (
            <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">
              in {parent.title}
            </span>
          )}
        </span>
        <time
          dateTime={page.updatedAt}
          title={absoluteTime(page.updatedAt)}
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {relativeTime(page.updatedAt)}
        </time>
        <span className="col-start-2 col-end-4 mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Actor
            userId={who}
            size={16}
            className="shrink-0 text-foreground/80"
          />
          <span aria-hidden>·</span>
          <span className="truncate">{what}</span>
        </span>
      </Link>
    </li>
  );
}

// A search box over the page titles of this space. Enter opens the first
// match; Escape clears.
function PageFinder({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-56">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <InputPrimitive
        type="search"
        aria-label="Find a page"
        placeholder="Find a page"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
          if (e.key === "Enter") {
            e.preventDefault();
            document
              .querySelector<HTMLAnchorElement>("[data-found-page]")
              ?.click();
          }
        }}
        className="h-8 w-full min-w-0 rounded-full border border-input bg-card pr-8 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:ring-3 focus-visible:ring-ring/15 max-sm:h-10 touch:h-10 touch:text-base [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

// Pages whose title matches, wherever they sit, each with its path.
function FoundPages({
  pages,
  byId,
  query,
  onClear,
}: {
  pages: readonly SpacePage[];
  byId: ReadonlyMap<string, SpacePage>;
  query: string;
  onClear: () => void;
}) {
  const space = useSpace();
  const { organization } = useWorkspace();
  return (
    <>
      <p role="status" className="sr-only">
        {pages.length === 1 ? "1 page matches" : `${pages.length} pages match`}
      </p>
      {pages.length === 0 ? (
        <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
          No pages match “{query}”.{" "}
          <button
            type="button"
            onClick={onClear}
            className="rounded-sm font-medium text-foreground underline-offset-2 focus-ring outline-none hover:underline"
          >
            Clear
          </button>
        </p>
      ) : (
        <ul aria-label="Matching pages">
          {pages.map((page) => {
            const path = ancestorsOf(byId, page.id)
              .map((p) => p.title)
              .join(" › ");
            return (
              <li key={page.id}>
                <Link
                  data-found-page
                  href={paths.spacePage(organization.slug, space.slug, page.id)}
                  className="flex min-h-[30px] items-center gap-2 rounded-md px-2 py-1 text-[13px] focus-ring-inset outline-none hover:bg-muted/70 max-sm:min-h-11 touch:min-h-11"
                >
                  <FileText
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">
                    <Highlighted text={page.title} query={query} />
                  </span>
                  {path && (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {path}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (at < 0 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-warning/20 text-inherit">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}
