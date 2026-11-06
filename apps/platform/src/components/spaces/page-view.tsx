import { useMemo } from "react";
import {
  Archive,
  ArchiveRestore,
  CornerDownRight,
  FileQuestion,
  Info,
  MoveRight,
  Plus,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Popover } from "@lictory/ui/popover";
import { Bone } from "@lictory/ui/skeleton";
import { MissingState } from "@lictory/ui/status-page";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import {
  ancestorsOf,
  type PageCommit,
  type SpacePage,
} from "@lictory/platform/data/spaces";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  usePageHistory,
  useSpacePages,
} from "@lictory/platform/components/spaces/store";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { PageTree } from "@lictory/platform/components/spaces/page-tree";
import { SpaceBreadcrumbs } from "@lictory/platform/components/spaces/breadcrumbs";
import { SpaceIcon } from "@lictory/platform/components/spaces/space-meta";
import { ArchivedSpaceNotice } from "@lictory/platform/components/spaces/archived-notice";

// One page as published: the tree of its space beside it (on wide frames),
// breadcrumbs, title, who published it and when, and main's latest content.
export function PageView() {
  const { page: pageId } = useParams<{ page: string }>();
  const space = useSpace();
  const pages = useSpacePages(space.id);
  const page = pages.find((p) => p.id === pageId);
  return (
    <div className="flex h-full min-h-0">
      <aside
        aria-label={`${space.name} pages`}
        className="hidden w-64 shrink-0 flex-col border-r @min-[56rem]/frame:flex"
      >
        <SpacePaneHeader />
        <PageTree variant="pane" activePageId={page?.id} />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {page ? <PageArticle page={page} pages={pages} /> : <PageNotFound />}
      </div>
    </div>
  );
}

function SpacePaneHeader() {
  const space = useSpace();
  const { organization } = useWorkspace();
  const { canEdit, createPage } = usePageActions();
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-3">
      <Link
        href={paths.space(organization.slug, space.slug)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <SpaceIcon space={space} />
        <span className="truncate">{space.name}</span>
      </Link>
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="New page"
          title="New page"
          onClick={() => createPage(null)}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}

function PageArticle({
  page,
  pages,
}: {
  page: SpacePage;
  pages: readonly SpacePage[];
}) {
  const space = useSpace();
  const { memberName } = useWorkspace();
  const { canEdit, createPage, movePage, archivePage, restorePage } =
    usePageActions();
  const history = usePageHistory(page.id);
  const ancestors = useMemo(
    () => ancestorsOf(new Map(pages.map((p) => [p.id, p])), page.id),
    [pages, page.id],
  );
  const archived = Boolean(page.archivedAt);
  const parentArchived = ancestors.some((a) => a.archivedAt);
  const head = history.head;
  return (
    <article className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <SpaceBreadcrumbs space={space} ancestors={ancestors} page={page} />
      {space.archivedAt && <ArchivedSpaceNotice space={space} />}
      {archived && !space.archivedAt && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-muted px-4 py-3 text-[13px] ring-1 ring-foreground/8 ring-inset">
          <Archive
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <p className="min-w-0 flex-1 basis-56">
            <span className="font-medium">This page is archived.</span>{" "}
            <span className="text-muted-foreground">
              {parentArchived
                ? "It was archived with a page above it; restore that page to bring it back."
                : "It is hidden from the space until it is restored."}
            </span>
          </p>
          {canEdit && !parentArchived && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => restorePage(page)}
            >
              <ArchiveRestore className="size-3.5" aria-hidden /> Restore
            </Button>
          )}
        </div>
      )}
      <header className="mt-5">
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {page.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          <p>
            {head ? (
              <>
                Published by {memberName(head.authorId)}{" "}
                <time
                  dateTime={head.createdAt}
                  title={absoluteTime(head.createdAt)}
                >
                  {relativeTime(head.createdAt)}
                </time>
              </>
            ) : (
              <>
                Published{" "}
                <time
                  dateTime={page.updatedAt}
                  title={absoluteTime(page.updatedAt)}
                >
                  {relativeTime(page.updatedAt)}
                </time>
              </>
            )}
          </p>
          <PageInfo page={page} history={history} />
          {canEdit && !archived && (
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {/* The page editor (live drafts) adds its "Edit" action here. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => createPage(page.id)}
              >
                <CornerDownRight className="size-3.5" aria-hidden /> New subpage
              </Button>
              <Button variant="ghost" size="sm" onClick={() => movePage(page)}>
                <MoveRight className="size-3.5" aria-hidden /> Move…
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => archivePage(page)}
              >
                <Archive className="size-3.5" aria-hidden /> Archive
              </Button>
            </div>
          )}
        </div>
      </header>
      <div className="mt-6">
        <PageDocument commit={head} loading={!history.loaded && !head} />
      </div>
    </article>
  );
}

// The published content of a page: main's latest commit, read-only. The
// page editor (Tiptap reader and live drafts) replaces this component; until
// then the commit's derived Markdown is rendered.
export function PageDocument({
  commit,
  loading,
}: {
  commit: PageCommit | undefined;
  loading: boolean;
}) {
  if (!commit)
    return loading ? (
      <div aria-busy="true" aria-label="Loading page" className="space-y-3">
        <Bone className="h-4 w-11/12" />
        <Bone className="h-4 w-10/12" />
        <Bone className="h-4 w-8/12" />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">
        This page’s content is not available right now.
      </p>
    );
  if (!commit.markdown.trim())
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing has been published on this page yet.
      </p>
    );
  return <Markdown source={commit.markdown} />;
}

function PageInfo({
  page,
  history,
}: {
  page: SpacePage;
  history: ReturnType<typeof usePageHistory>;
}) {
  const { memberName } = useWorkspace();
  const branches = history.branches.filter((b) => !b.isMain).length;
  const versions = history.commits.length;
  return (
    <Popover
      width={260}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-full px-2 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Info className="size-3.5" aria-hidden /> Page info
        </button>
      )}
    >
      <div className="p-3 text-[13px]">
        <p className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
          Page info
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-muted-foreground">Created</dt>
          <dd>
            {memberName(page.createdById)},{" "}
            <time
              dateTime={page.createdAt}
              title={absoluteTime(page.createdAt)}
            >
              {relativeTime(page.createdAt)}
            </time>
          </dd>
          <dt className="text-muted-foreground">Versions</dt>
          <dd>
            {history.loaded || versions
              ? versions === 1
                ? "1 published version"
                : `${versions} published versions`
              : "Loading…"}
          </dd>
          <dt className="text-muted-foreground">Branches</dt>
          <dd>
            {branches === 0
              ? "None"
              : branches === 1
                ? "1 branch"
                : `${branches} branches`}
          </dd>
        </dl>
      </div>
    </Popover>
  );
}

function PageNotFound() {
  const space = useSpace();
  const { organization } = useWorkspace();
  return (
    <MissingState
      illustration="search"
      icon={FileQuestion}
      title="This page was not found"
      action={
        <Link
          href={paths.space(organization.slug, space.slug)}
          className="contents"
        >
          <Button variant="secondary">Back to {space.name}</Button>
        </Link>
      }
    >
      Check the address, or choose a page from {space.name}.
    </MissingState>
  );
}
