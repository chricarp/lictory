import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { History } from "lucide-react";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { Bone } from "@lictory/ui/skeleton";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";
import {
  Link,
  usePathname,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { PageReader } from "@lictory/platform/components/spaces/editor/document";
import { ReferencesProvider } from "@lictory/platform/components/spaces/editor/references";
import {
  versionOf,
  type PageHistory,
  type PageLine,
} from "@lictory/platform/components/spaces/editor/line";
import {
  commitAnchorFor,
  resolveCommitAnchor,
} from "@lictory/platform/components/spaces/comments/anchors";
import {
  PageComments,
  type Anchoring,
} from "@lictory/platform/components/spaces/comments/controller";
import type { LineDiscussions } from "@lictory/platform/components/spaces/comments/store";
import { blockingEffect } from "@lictory/platform/components/spaces/space-meta";

// The page's content with its discussions: a published (or selected)
// commit rendered read-only, or the line's live draft for the people who
// edit it. Loaded on demand, so the space home and tree stay light; the
// live editor (Yjs, the collaboration socket) is a further chunk that only
// editors load.

const LiveDraft = lazy(() =>
  import("@lictory/platform/components/spaces/editor/live-editor").then(
    (m) => ({ default: m.LiveDraft }),
  ),
);

export type PageSurfaceProps = {
  space: Space;
  page: SpacePage;
  history: PageHistory;
  line: PageLine;
  // The line's discussions, the same ones the header's toggle counts.
  discussions: LineDiscussions;
  editing: boolean;
  onStopEditing?: () => void;
  commentsOpen: boolean;
  onCommentsOpenChange: (open: boolean) => void;
  commentsSlot: HTMLElement | null;
  commentsWide: boolean;
  // Where the live draft puts Close editor and Publish (the page header's toolbar).
  actionsSlot?: HTMLElement | null;
};

function commitAnchoring(
  commitId: string,
  branchId: string | undefined,
): Anchoring {
  return {
    branchId,
    create: (state, from, to) => commitAnchorFor(state.doc, from, to, commitId),
    resolve: (state, anchor, index) => {
      if (anchor.kind === "commit") {
        const range = resolveCommitAnchor(state.doc, index, anchor);
        return { range, placement: range ? "here" : "changed" };
      }
      if (anchor.kind === "draft") return { range: null, placement: "draft" };
      return { range: null, placement: "detached" };
    },
  };
}

export default function PageSurface(props: PageSurfaceProps) {
  return (
    <ReferencesProvider>
      <Surface {...props} />
    </ReferencesProvider>
  );
}

function Surface({
  space,
  page,
  history,
  line,
  discussions,
  editing,
  onStopEditing,
  commentsOpen,
  onCommentsOpenChange,
  commentsSlot,
  commentsWide,
  actionsSlot,
}: PageSurfaceProps) {
  const { organization } = useWorkspace();
  const pathname = usePathname();
  const params = useSearchParams();
  const [bound, setBound] = useState<{
    editor: Editor | null;
    anchoring: Anchoring | null;
  }>({ editor: null, anchoring: null });

  const live = editing && line.writable && line.draft !== null;
  const shown = line.viewed ?? line.head;
  const onLiveEditor = useCallback(
    (editor: Editor | null, anchoring: Anchoring | null) =>
      setBound({ editor, anchoring }),
    [],
  );
  const onReader = useCallback(
    (editor: Editor | null) =>
      setBound({
        editor,
        anchoring:
          editor && shown ? commitAnchoring(shown.id, line.branchId) : null,
      }),
    [shown, line.branchId],
  );
  const versionHref = useCallback(
    (commitId: string) => {
      const n = versionOf(history.commits, commitId);
      const next = new URLSearchParams(params);
      next.set("commit", commitId);
      return {
        href: `${pathname}?${next}`,
        label: n ? `version ${n}` : "an earlier version",
      };
    },
    [history.commits, params, pathname],
  );
  const fileContext = useMemo(
    () => ({ organizationId: organization.id, pageId: page.id }),
    [organization.id, page.id],
  );

  let content;
  if (live)
    content = (
      <Suspense fallback={<LoadingDocument label="Opening the live draft" />}>
        <LiveDraft
          page={page}
          line={line as PageLine & { draft: NonNullable<PageLine["draft"]> }}
          history={history}
          onDone={line.isMain ? onStopEditing : undefined}
          onEditor={onLiveEditor}
          canComment={line.canComment}
          actionsSlot={actionsSlot}
        />
      </Suspense>
    );
  else if (!shown)
    content = history.loaded ? (
      <p className="mt-6 text-sm text-muted-foreground">
        This page’s content is not available right now.
      </p>
    ) : (
      <LoadingDocument label="Loading page" />
    );
  else
    content = (
      <div className="mt-8">
        {line.viewed && (
          <ViewedVersion
            version={versionOf(history.commits, line.viewed.id)}
            createdAt={line.viewed.createdAt}
          />
        )}
        {!shown.markdown.trim() && (
          <p className="mb-4 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {line.isMain
              ? "Nothing has been published on this page yet."
              : "This branch has no content yet."}
          </p>
        )}
        <PageReader
          key={shown.id}
          content={shown.content}
          label={`${shown.title} content`}
          onEditor={onReader}
        />
      </div>
    );

  return (
    <>
      {content}
      {bound.anchoring && (
        <PageComments
          editor={bound.editor}
          pageId={page.id}
          discussions={discussions}
          lineName={line.branch?.name ?? "main"}
          otherLines={discussions.counts.others}
          anchoring={bound.anchoring}
          canComment={line.canComment}
          open={commentsOpen}
          onOpenChange={onCommentsOpenChange}
          slot={commentsSlot}
          wide={commentsWide}
          fileContext={fileContext}
          versionHref={versionHref}
          blockingEffect={blockingEffect(space)}
        />
      )}
    </>
  );
}

function LoadingDocument({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="mt-6 space-y-3">
      <Bone className="h-4 w-11/12" />
      <Bone className="h-4 w-10/12" />
      <Bone className="h-4 w-8/12" />
    </div>
  );
}

function ViewedVersion({
  version,
  createdAt,
}: {
  version: number | undefined;
  createdAt: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const next = new URLSearchParams(params);
  next.delete("commit");
  const query = next.toString();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2 text-[13px]">
      <History className="size-4 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1">
        You are reading {version ? `version ${version}` : "an earlier version"}{" "}
        from{" "}
        <time dateTime={createdAt} title={absoluteTime(createdAt)}>
          {relativeTime(createdAt)}
        </time>
        .
      </p>
      <Link
        href={query ? `${pathname}?${query}` : pathname}
        className="text-[13px] font-medium underline underline-offset-2"
      >
        Back to the latest
      </Link>
    </div>
  );
}
