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
import { Button } from "@lictory/ui/button";
import { Avatar, Badge, EmptyState } from "@lictory/ui/primitives";
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
import { SpaceBreadcrumbs } from "@lictory/platform/components/spaces/breadcrumbs";
import { ArchivedSpaceNotice } from "@lictory/platform/components/spaces/archived-notice";
import {
  touchIcon,
  touchTarget,
} from "@lictory/platform/components/spaces/touch";

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
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-16 sm:px-8 sm:pt-7">
        <SpaceBreadcrumbs space={space} />
        {space.archivedAt && <ArchivedSpaceNotice space={space} />}
        {/* One grid: on phones the icon sits beside the name and the
            description, facts and actions run full width below, so the
            pages start within the first screen; wider, the icon spans the
            text and the actions sit at the right. */}
        <header className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 sm:mt-6 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start sm:gap-x-4">
          <div className="grid size-10 place-items-center rounded-xl bg-muted shadow-(--shadow-border) sm:row-span-3 sm:size-12 sm:rounded-2xl">
            <SpaceIcon
              space={space}
              className="size-6 text-xl sm:size-7 sm:text-2xl"
            />
          </div>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight break-words sm:col-start-2 sm:row-start-1 sm:self-center sm:text-[1.75rem]">
            {space.name}
          </h1>
          {space.description && (
            <p className="col-span-2 mt-2 text-sm leading-6 whitespace-pre-line text-muted-foreground sm:col-span-1 sm:col-start-2 sm:mt-1 sm:text-[15px]">
              {space.description}
            </p>
          )}
          <p className="col-span-2 mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-2 sm:mt-3">
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
              <Badge tone="warning">
                <Lock className="size-3" aria-hidden />
                <span>Restricted</span>
              </Badge>
            )}
            {level && (
              <span className={fact}>
                <span className="sr-only">Your access: </span>
                <span>{levelLabels[level]}</span>
              </span>
            )}
          </p>
          <div className="col-span-2 mt-4 flex items-center gap-1.5 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-0">
            {space.publishing === "reviewed" && (
              <Link
                href={`${paths.space(organization.slug, space.slug)}/pull-requests`}
                className="contents"
              >
                <Button variant="secondary" size="sm" className={touchTarget}>
                  <GitPullRequest className="size-3.5" aria-hidden /> Pull
                  requests
                </Button>
              </Link>
            )}
            {(manage || level === "edit") && (
              <Link
                href={paths.spaceSettings(organization.slug, space.slug)}
                className="contents"
              >
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Space settings"
                  title="Space settings"
                  className={touchIcon}
                >
                  <Settings2 className="size-3.5" aria-hidden />
                </Button>
              </Link>
            )}
            {canEdit && (
              <Button
                size="sm"
                onClick={() => createPage(null)}
                className={touchTarget}
              >
                <Plus className="size-3.5" aria-hidden /> New page
              </Button>
            )}
          </div>
        </header>
        <section aria-labelledby="space-pages" className="mt-7 sm:mt-10">
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
              <Archive className="size-3.5" aria-hidden /> Pages of an archived
              space can be read but not changed.
            </p>
          )}
        </section>
        {active.length > 3 && (
          <section aria-labelledby="space-recent" className="mt-10">
            <h2 id="space-recent" className="mb-2 px-1 text-sm font-semibold">
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
  const { organization, memberName } = useWorkspace();
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
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-2.5 text-[13px] outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
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
          <Avatar userId={who} name={memberName(who)} size="xs" />
          <span className="shrink-0 text-foreground/80">{memberName(who)}</span>
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
      <input
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
        className="h-8 w-full min-w-0 rounded-full border border-foreground/15 bg-card pr-8 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:ring-3 focus-visible:ring-ring/15 max-sm:h-10 touch:h-10 touch:text-base [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
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
            className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
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
                  className="flex min-h-[30px] items-center gap-2 rounded-md px-2 py-1 text-[13px] outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset max-sm:min-h-11 touch:min-h-11"
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
