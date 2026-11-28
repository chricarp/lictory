import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Archive,
  ArchiveRestore,
  FileQuestion,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Bone } from "@lictory/ui/skeleton";
import { MissingState } from "@lictory/ui/status-page";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import { usePanelCollapsed } from "@lictory/platform/lib/panel-preference";
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
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { SpaceIcon } from "@lictory/platform/components/spaces/space-meta";
import { ArchivedSpaceNotice } from "@lictory/platform/components/spaces/archived-notice";
import { usePageLine } from "@lictory/platform/components/spaces/editor/line";
import { useLineDiscussions } from "@lictory/platform/components/spaces/comments/store";
import { useLaidOut } from "@lictory/platform/components/spaces/editor/layout";
import { SurfaceBoundary } from "@lictory/platform/components/spaces/editor/boundary";
import {
  CommentsToggle,
  EditButton,
  ReviewedNotice,
} from "@lictory/platform/components/spaces/editor/line-actions";
import { PageWorkProvider } from "@lictory/platform/components/spaces/work/page-work-actions";
import { PageWorkPanel } from "@lictory/platform/components/spaces/work/page-work";
import { BlockInsertHost } from "@lictory/platform/components/spaces/blocks/insert-host";
import {
  LineSwitcher,
  PageMoreMenu,
  PageStatement,
} from "@lictory/platform/components/spaces/page-header";

// The reader, the live editor and the discussions load on demand: the space
// home and the tree never pay for them.
const PageSurface = lazy(
  () => import("@lictory/platform/components/spaces/editor/page-surface"),
);

// One page: the tree of its space beside it (on wide frames), the page
// under the shell's one `PageHeader` (Spaces › space › parent pages, the
// title, and the page's toolbar), its title and what is on screen at the
// top of the text, and its discussions in a column of their own beside it. Widths come
// from the frame: the comments column shows from 48rem (narrower frames
// open a sheet) and the tree from 56rem. The tree can be put away (the
// choice is remembered in this browser), and while comments are open it
// steps aside below 80rem so the text keeps a readable measure; "Pages"
// brings it back on request.
export function PageView() {
  const { page: pageId } = useParams<{ page: string }>();
  const space = useSpace();
  const { organization } = useWorkspace();
  const pages = useSpacePages(space.id);
  const page = pages.find((p) => p.id === pageId);
  const [commentsSlot, setCommentsSlot] = useState<HTMLElement | null>(null);
  const [roomyProbe, setRoomyProbe] = useState<HTMLElement | null>(null);
  const [treeProbe, setTreeProbe] = useState<HTMLElement | null>(null);
  const [besideProbe, setBesideProbe] = useState<HTMLElement | null>(null);
  const commentsWide = useLaidOut(commentsSlot);
  const roomy = useLaidOut(roomyProbe);
  const treeFits = useLaidOut(treeProbe);
  const treeFitsBeside = useLaidOut(besideProbe);
  // Until someone chooses, comments are open beside a page whose line on
  // screen has open discussions when everything fits; once open by default
  // they stay open (resolving the last thread does not fold the panel away
  // under the reader).
  const [choice, setChoice] = useState<{ pageId: string; open: boolean }>();
  const [openedFor, setOpenedFor] = useState<string>();
  const [discussedFor, setDiscussedFor] = useState<string>();
  if (page && roomy && discussedFor === page.id && openedFor !== page.id)
    setOpenedFor(page.id);
  const onLineDiscussed = useCallback(
    (id: string, discussed: boolean) =>
      setDiscussedFor((current) =>
        discussed ? id : current === id ? undefined : current,
      ),
    [],
  );
  const commentsOpen = page
    ? choice?.pageId === page.id
      ? choice.open
      : openedFor === page.id
    : false;
  const setCommentsOpen = useCallback(
    (open: boolean) => {
      if (pageId) setChoice({ pageId, open });
    },
    [pageId],
  );
  const column = commentsOpen && commentsWide;
  const [treeAway, , setTreeAway] = usePanelCollapsed(
    organization.id,
    "space-page-tree",
  );
  // Asked for while comments leave it little room: shown anyway.
  const [treeAsked, setTreeAsked] = useState(false);
  const treeShown = !treeAway && (!column || treeFitsBeside || treeAsked);
  // One toggle in the page header puts the tree away and brings it back.
  const treeToggle = treeFits
    ? treeShown
      ? {
          shown: true,
          toggle: () => {
            setTreeAway(true);
            setTreeAsked(false);
          },
        }
      : {
          shown: false,
          toggle: () => {
            setTreeAway(false);
            setTreeAsked(true);
          },
        }
    : undefined;
  return (
    <div className="flex h-full min-h-0">
      <span
        ref={setRoomyProbe}
        aria-hidden
        className="hidden @min-[72rem]/frame:block"
      />
      <span
        ref={setTreeProbe}
        aria-hidden
        className="hidden @min-[56rem]/frame:block"
      />
      <span
        ref={setBesideProbe}
        aria-hidden
        className="hidden @min-[80rem]/frame:block"
      />
      <aside
        aria-label={`${space.name} pages`}
        className={cn(
          "hidden w-60 shrink-0 flex-col border-r",
          treeShown && "@min-[56rem]/frame:flex",
        )}
      >
        <SpacePaneHeader
          onHide={treeToggle?.shown ? treeToggle.toggle : undefined}
        />
        <PageTree variant="pane" activePageId={page?.id} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {page ? (
          <PageArticle
            key={page.id}
            page={page}
            pages={pages}
            commentsOpen={commentsOpen}
            onCommentsOpenChange={setCommentsOpen}
            commentsSlot={commentsSlot}
            commentsWide={commentsWide}
            onLineDiscussed={onLineDiscussed}
            treeToggle={treeToggle}
          />
        ) : (
          <PageNotFound />
        )}
      </div>
      {/* The discussions beside the text, scrolling on their own; narrower
          frames open them as a sheet. */}
      <div
        ref={setCommentsSlot}
        role={column ? "complementary" : undefined}
        aria-label={column ? "Page comments" : undefined}
        className={cn(
          "hidden min-h-0 shrink-0 flex-col overflow-y-auto overscroll-contain @min-[48rem]/frame:flex",
          column ? "w-80 border-l px-4 pb-6" : "w-0",
        )}
      />
    </div>
  );
}

// The tree's own bar, level with the page header: the space, a new page,
// and putting the tree away.
function SpacePaneHeader({ onHide }: { onHide?: () => void }) {
  const space = useSpace();
  const { organization } = useWorkspace();
  const { canEdit, createPage } = usePageActions();
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-b px-2">
      <Link
        href={paths.space(organization.slug, space.slug)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <SpaceIcon space={space} />
        <span className="truncate">{space.name}</span>
      </Link>
      {onHide && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide pages"
          title="Hide pages"
          className="text-muted-foreground"
          onClick={onHide}
        >
          <PanelLeftClose className="size-4" aria-hidden />
        </Button>
      )}
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
  commentsOpen,
  onCommentsOpenChange,
  commentsSlot,
  commentsWide,
  onLineDiscussed,
  treeToggle,
}: {
  page: SpacePage;
  pages: readonly SpacePage[];
  commentsOpen: boolean;
  onCommentsOpenChange: (open: boolean) => void;
  commentsSlot: HTMLElement | null;
  commentsWide: boolean;
  // Whether the line on screen has open discussions (opens the comments
  // by default).
  onLineDiscussed: (pageId: string, discussed: boolean) => void;
  // Puts the page tree away or brings it back (frames wide enough for it).
  treeToggle?: { shown: boolean; toggle: () => void };
}) {
  const space = useSpace();
  const { canEdit, restorePage } = usePageActions();
  const history = usePageHistory(page.id);
  const line = usePageLine(space, page, history);
  // The line's discussions: the toggle counts them, the panel lists them.
  const discussions = useLineDiscussions(page.id, line, history.branches);
  const discussed = discussions.counts.open > 0;
  useEffect(
    () => onLineDiscussed(page.id, discussed),
    [onLineDiscussed, page.id, discussed],
  );
  const lineName = line.branch?.name ?? "main";
  const ancestors = useMemo(
    () => ancestorsOf(new Map(pages.map((p) => [p.id, p])), page.id),
    [pages, page.id],
  );
  const archived = Boolean(page.archivedAt);
  const parentArchived = ancestors.some((a) => a.archivedAt);
  // Main opens as published; Edit switches to its live draft. A branch I
  // write to opens in its draft directly.
  const [editingMain, setEditingMain] = useState(false);
  const editing =
    line.writable && (!line.isMain || editingMain) && !line.viewed;
  // Where the live draft puts Close editor and Publish: the toolbar, the
  // same place Edit takes while reading.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  // The toolbar sits in the header where it fits, else in a row under the
  // title (phones).
  const [wideProbe, setWideProbe] = useState<HTMLElement | null>(null);
  const wide = useLaidOut(wideProbe);
  const { organization } = useWorkspace();
  const org = organization.slug;
  const title = line.isMain ? page.title : (line.head?.title ?? page.title);
  const toolbar = (
    <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full max-sm:gap-2 touch:gap-2">
      <LineSwitcher
        page={page}
        history={history}
        discussions={discussions.counts}
      />
      <CommentsToggle
        space={space}
        lineName={lineName}
        counts={discussions.counts}
        open={commentsOpen}
        onToggle={() => onCommentsOpenChange(!commentsOpen)}
      />
      <PageMoreMenu page={page} history={history} />
      <div className="flex items-center gap-1.5 max-sm:ml-auto max-sm:gap-2 touch:gap-2">
        {editing ? (
          <span ref={setActionsSlot} className="contents" />
        ) : (
          !archived && (
            <EditButton line={line} onEdit={() => setEditingMain(true)} />
          )
        )}
      </div>
    </div>
  );
  return (
    <>
      <PageHeader
        title={title || "Untitled"}
        breadcrumbs={[
          { label: "Spaces", href: paths.spaces(org) },
          { label: space.name, href: paths.space(org, space.slug) },
          ...ancestors.map((a) => ({
            label: a.title || "Untitled",
            href: paths.spacePage(org, space.slug, a.id),
          })),
        ]}
        actions={
          <>
            {treeToggle && !treeToggle.shown && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Show pages"
                title="Show pages"
                className="text-muted-foreground"
                onClick={treeToggle.toggle}
              >
                <PanelLeftOpen className="size-4" aria-hidden />
              </Button>
            )}
            {wide && toolbar}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <span
          ref={setWideProbe}
          aria-hidden
          className="hidden @min-[40rem]/frame:block"
        />
        <article className="mx-auto w-full max-w-3xl min-w-0 px-4 pt-4 pb-24 sm:px-8 sm:pt-8">
          {/* The title (the header names it as the page's heading) and one
          line saying what is on screen; phones put the toolbar under that
          line. The live editor shows the title as a field and its own
          status line. */}
          {(!editing || !wide) && (
            <header className="flex flex-col gap-3">
              {!editing && (
                <div>
                  <p className="text-[1.75rem] leading-tight font-semibold tracking-tight break-words">
                    {title}
                  </p>
                  <div className="mt-2.5 text-[13px] text-muted-foreground">
                    <PageStatement
                      space={space}
                      page={page}
                      line={line}
                      history={history}
                    />
                  </div>
                </div>
              )}
              {!wide && toolbar}
            </header>
          )}
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
          <ReviewedNotice line={line} page={page} branches={history.branches} />
          <PageWorkProvider
            space={space}
            page={page}
            line={line}
            history={history}
            editing={editing}
            onEdit={() => setEditingMain(true)}
          >
            <SurfaceBoundary>
              <Suspense
                fallback={
                  <div className="mt-8">
                    <PageDocument
                      commit={line.viewed ?? line.head}
                      loading={!history.loaded}
                    />
                  </div>
                }
              >
                <PageSurface
                  space={space}
                  page={page}
                  history={history}
                  line={line}
                  discussions={discussions}
                  editing={editing}
                  onStopEditing={() => setEditingMain(false)}
                  commentsOpen={commentsOpen}
                  onCommentsOpenChange={onCommentsOpenChange}
                  commentsSlot={commentsSlot}
                  commentsWide={commentsWide}
                  actionsSlot={actionsSlot}
                />
              </Suspense>
            </SurfaceBoundary>
          </PageWorkProvider>
          {/* The work this page knows about, under the published page. */}
          {line.isMain && !editing && !line.viewed && (
            <PageWorkPanel pageId={page.id} />
          )}
          <BlockInsertHost defaultProjectId={space.projectId} />
        </article>
      </div>
    </>
  );
}

// A commit's derived Markdown: what readers see while the page surface
// (the Tiptap reader of the canonical content) loads.
export function PageDocument({
  commit,
  loading,
}: {
  commit: PageCommit | undefined;
  loading: boolean;
}) {
  if (!commit)
    return loading ? (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading page"
        className="space-y-3"
      >
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

function PageNotFound() {
  const space = useSpace();
  const { organization } = useWorkspace();
  return (
    <MissingState
      illustration="search"
      icon={FileQuestion}
      title="This page was not found"
      action={
        <Button
          variant="secondary"
          render={<Link href={paths.space(organization.slug, space.slug)} />}
        >
          Back to {space.name}
        </Button>
      }
    >
      Check the address, or choose a page from {space.name}.
    </MissingState>
  );
}
