import { useMemo } from "react";
import {
  Archive,
  Building2,
  FileText,
  FolderKanban,
  GitPullRequest,
  Lock,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Badge, EmptyState } from "@lictory/ui/primitives";
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
  const HomeIcon =
    home.kind === "organization"
      ? Building2
      : home.kind === "project"
        ? FolderKanban
        : Users;
  const fact = "inline-flex items-center gap-1.5 whitespace-nowrap";
  const factIcon = "size-3.5 shrink-0 text-muted-foreground/80";
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-5 pb-16 sm:px-8 sm:pt-7">
        <SpaceBreadcrumbs space={space} />
        {space.archivedAt && <ArchivedSpaceNotice space={space} />}
        <header className="mt-6 flex flex-wrap items-start gap-x-4 gap-y-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-muted shadow-(--shadow-border)">
            <SpaceIcon space={space} className="size-7 text-2xl" />
          </div>
          <div className="min-w-0 flex-1 basis-60">
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight break-words">
              {space.name}
            </h1>
            {space.description && (
              <p className="mt-1.5 text-[15px] leading-6 whitespace-pre-line text-muted-foreground">
                {space.description}
              </p>
            )}
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
              <span className={fact}>
                <HomeIcon className={factIcon} aria-hidden />
                <span className="sr-only">Home: </span>
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
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {space.publishing === "reviewed" && (
              <Link
                href={`${paths.space(organization.slug, space.slug)}/pull-requests`}
                className="contents"
              >
                <Button variant="secondary" size="sm">
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
                >
                  <Settings2 className="size-3.5" aria-hidden />
                </Button>
              </Link>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => createPage(null)}>
                <Plus className="size-3.5" aria-hidden /> New page
              </Button>
            )}
          </div>
        </header>
        <section aria-labelledby="space-pages" className="mt-10">
          <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 id="space-pages" className="text-sm font-semibold">
              Pages
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {active.length === 1 ? "1 page" : `${active.length} pages`}
            </span>
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
              <PageTree variant="home" />
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

function RecentPage({
  page,
  byId,
}: {
  page: SpacePage;
  byId: ReadonlyMap<string, SpacePage>;
}) {
  const space = useSpace();
  const { organization } = useWorkspace();
  const path = ancestorsOf(byId, page.id)
    .map((p) => p.title)
    .join(" › ");
  return (
    <li>
      <Link
        href={paths.spacePage(organization.slug, space.slug, page.id)}
        className="flex min-h-11 items-center gap-3 px-3.5 py-2 text-[13px] outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
      >
        <FileText
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{page.title}</span>
          {path && (
            <span className="block truncate text-xs text-muted-foreground">
              {path}
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
      </Link>
    </li>
  );
}
