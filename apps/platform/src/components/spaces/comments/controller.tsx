import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { MessageSquarePlus } from "lucide-react";
import type {
  PageThreadAnchor,
  StoredPageThreadAnchor,
} from "@lictory/core/contracts/protocol";
import { toast } from "@lictory/ui/toast";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { DiscussionSheet } from "@lictory/platform/components/discussions/presentation";
import type { FileContext } from "@lictory/platform/components/items/file-upload";
import {
  blockIndex,
  type Range,
} from "@lictory/platform/components/spaces/comments/anchors";
import {
  showHighlights,
  type Highlight,
} from "@lictory/platform/components/spaces/comments/highlights";
import {
  CommentsPanel,
  type CommentActions,
  type PendingComment,
  type ThreadPlacement,
  type ThreadView,
} from "@lictory/platform/components/spaces/comments/sidebar";
import type {
  Discussions,
  PageThread,
} from "@lictory/platform/components/spaces/comments/store";
import type { OtherLine } from "@lictory/platform/components/spaces/comments/line-threads";
import {
  SelectionWorkAction,
  useSelectionWorkAvailable,
} from "@lictory/platform/components/spaces/work/selection-actions";

// The live editor's Mod+Alt+M and toolbar ask for a comment on the selection.
export const COMMENT_SELECTION_EVENT = "lictory:comment-selection";

// Connects an editor (the read-only reader or a live draft) with the page's
// discussions: where each thread's text is now, highlights, the "Comment"
// action on a selection and the panel beside the document (a sheet on
// narrow frames).

export type Anchoring = {
  // The line new threads are written on.
  branchId: string | undefined;
  create: (
    state: EditorState,
    from: number,
    to: number,
  ) => PageThreadAnchor | null;
  resolve: (
    state: EditorState,
    anchor: StoredPageThreadAnchor,
    index: ReadonlyMap<string, number>,
  ) => { range: Range | null; placement: ThreadPlacement };
};

type Located = {
  thread: PageThread;
  range: Range | null;
  placement: ThreadPlacement;
};

function locate(
  state: EditorState,
  threads: readonly PageThread[],
  anchoring: Anchoring,
): Located[] {
  const index = blockIndex(state.doc);
  const located = threads.map((thread) => {
    if (thread.anchor.kind === "page")
      return { thread, range: null, placement: "page" as const };
    if (thread.anchor.kind === "detached")
      return { thread, range: null, placement: "detached" as const };
    return { thread, ...anchoring.resolve(state, thread.anchor, index) };
  });
  const rank: Record<ThreadPlacement, number> = {
    here: 0,
    changed: 1,
    draft: 1,
    otherDraft: 1,
    detached: 2,
    page: 3,
  };
  return located.sort(
    (a, b) =>
      rank[a.placement] - rank[b.placement] ||
      (a.range && b.range ? a.range.from - b.range.from : 0) ||
      a.thread.createdAt.localeCompare(b.thread.createdAt),
  );
}

// The editor once its view is in the document (Tiptap creates the editor
// before EditorContent mounts it; its view throws until then, and again
// once it is unmounted, which happens when a live draft is replaced by a
// new epoch). Effects check it again: the editor this render saw may have
// been unmounted by the time they run.
function hasView(editor: Editor) {
  try {
    return !editor.isDestroyed && Boolean(editor.view.dom);
  } catch {
    return false;
  }
}
function useMountedEditor(editor: Editor | null) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!editor) return () => undefined;
      editor.on("mount", listener);
      editor.on("unmount", listener);
      editor.on("destroy", listener);
      return () => {
        editor.off("mount", listener);
        editor.off("unmount", listener);
        editor.off("destroy", listener);
      };
    },
    [editor],
  );
  return useSyncExternalStore(subscribe, () =>
    editor && hasView(editor) ? editor : null,
  );
}

type Selected = { from: number; to: number; top: number; left: number };

// The text selected inside the editor (DOM selection, so read-only views
// work too), with where to show the "Comment" action.
function useEditorSelection(editor: Editor | null) {
  const [selected, setSelected] = useState<Selected | null>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (!hasView(editor)) return;
      const view = editor.view;
      const selection = document.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        !selection.anchorNode ||
        !selection.focusNode ||
        !view.dom.contains(selection.anchorNode) ||
        !view.dom.contains(selection.focusNode)
      )
        return setSelected(null);
      try {
        const a = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
        const b = view.posAtDOM(selection.focusNode, selection.focusOffset);
        const from = Math.min(a, b);
        const to = Math.max(a, b);
        // Only text can be commented on (not an image or a block alone).
        if (from >= to || !editor.state.doc.textBetween(from, to, " ").trim())
          return setSelected(null);
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        setSelected({
          from,
          to,
          top: rect.top,
          left: rect.left + rect.width / 2,
        });
      } catch {
        setSelected(null);
      }
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [editor]);
  return selected;
}

export function PageComments({
  editor: created,
  pageId,
  discussions,
  anchoring,
  canComment,
  open,
  onOpenChange,
  slot,
  wide,
  fileContext,
  versionHref,
  blockingEffect,
  lineName,
  otherLines,
}: {
  editor: Editor | null;
  pageId: string;
  // Already narrowed to the threads of the line on screen.
  discussions: Discussions;
  anchoring: Anchoring;
  canComment: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: HTMLElement | null;
  // The slot beside the page is laid out (otherwise: a sheet).
  wide: boolean;
  fileContext: FileContext;
  versionHref: (commitId: string) => { href: string; label: string } | null;
  // What an open blocking discussion holds back on this page.
  blockingEffect: string;
  // The line on screen, and the page's other lines with open discussions.
  lineName: string;
  otherLines: readonly OtherLine[];
}) {
  const { mutateConfirmed } = useWorkspace();
  const editor = useMountedEditor(created);
  const [located, setLocated] = useState<Located[]>([]);
  const [active, setActive] = useState<string | null>(null);
  // The thread under the pointer, in the panel or in the text.
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingComment | null>(null);
  // A comment being written on a selection belongs to the line it was
  // selected on: switching lines discards it rather than posting it on the
  // next line (new threads are written on the line on screen).
  const [pendingLine, setPendingLine] = useState(anchoring.branchId);
  if (pendingLine !== anchoring.branchId) {
    setPendingLine(anchoring.branchId);
    setPending(null);
  }
  const anchoringRef = useRef(anchoring);
  useEffect(() => {
    anchoringRef.current = anchoring;
  }, [anchoring]);

  // Locate threads and refresh highlights after document changes (remote
  // edits included), at most once per frame.
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    // Undefined until the first pass, so an empty list (a line without
    // threads) still replaces what the previous line showed.
    let lastKey: string | undefined;
    const run = () => {
      frame = 0;
      if (!hasView(editor)) return;
      const next = locate(
        editor.state,
        discussions.threads,
        anchoringRef.current,
      );
      const highlights: Highlight[] = next
        .filter((l) => l.range && l.thread.status === "open")
        .map((l) => ({
          threadId: l.thread.id,
          from: l.range!.from,
          to: l.range!.to,
          blocking: l.thread.blocking,
        }));
      showHighlights(editor.view, highlights, active, hovered);
      const key = next.map((l) => `${l.thread.id}:${l.placement}`).join();
      if (key !== lastKey) {
        lastKey = key;
        setLocated(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    run();
    editor.on("update", schedule);
    return () => {
      editor.off("update", schedule);
      cancelAnimationFrame(frame);
    };
  }, [editor, discussions.threads, active, hovered]);

  // Clicking highlighted text opens its thread.
  useEffect(() => {
    if (!editor || !hasView(editor)) return;
    const dom = editor.view.dom;
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.(
        "[data-thread]",
      );
      const id = target?.getAttribute("data-thread");
      if (id) {
        setActive(id);
        onOpenChange(true);
      }
    };
    // Pointing at highlighted text marks its thread in the panel.
    const onOver = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.(
        "[data-thread]",
      );
      setHovered(target?.getAttribute("data-thread") ?? null);
    };
    const onLeave = () => setHovered(null);
    dom.addEventListener("click", onClick);
    dom.addEventListener("mouseover", onOver);
    dom.addEventListener("mouseleave", onLeave);
    return () => {
      dom.removeEventListener("click", onClick);
      dom.removeEventListener("mouseover", onOver);
      dom.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, onOpenChange]);

  const views = useMemo<ThreadView[]>(
    () =>
      located.map(({ thread, placement }) => ({
        thread,
        placement,
        messages: discussions.messages.get(thread.id) ?? [],
        quote: "quote" in thread.anchor ? thread.anchor.quote : null,
      })),
    [located, discussions.messages],
  );

  const selection = useEditorSelection(editor);
  const workAction = useSelectionWorkAvailable(editor);
  const startComment = useCallback(
    (range: { from: number; to: number } | null) => {
      if (!editor || !range) return;
      const anchor = anchoringRef.current.create(
        editor.state,
        range.from,
        range.to,
      );
      if (!anchor) {
        toast.add({
          title: "Select text to comment on",
          description:
            "Comments attach to text in a paragraph, heading, list item or table cell.",
          timeout: 5000,
        });
        return;
      }
      setPending({ anchor, quote: "quote" in anchor ? anchor.quote : null });
      onOpenChange(true);
    },
    [editor, onOpenChange],
  );
  // The editor's keyboard shortcut and toolbar ask to comment on the
  // selection with an event on the editor's element.
  useEffect(() => {
    if (!editor || !canComment || !hasView(editor)) return;
    const dom = editor.view.dom;
    const onRequest = () => {
      const { from, to } = editor.state.selection;
      startComment(from < to ? { from, to } : null);
    };
    dom.addEventListener(COMMENT_SELECTION_EVENT, onRequest);
    return () => dom.removeEventListener(COMMENT_SELECTION_EVENT, onRequest);
  }, [editor, canComment, startComment]);

  const activate = useCallback(
    (threadId: string) => {
      setActive(threadId);
      const target = located.find((l) => l.thread.id === threadId)?.range;
      if (!editor || !target || !hasView(editor)) return;
      const dom = editor.view.domAtPos(target.from).node;
      const element = dom instanceof HTMLElement ? dom : dom.parentElement;
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [editor, located],
  );

  const actions = useMemo<CommentActions>(
    () => ({
      create: async (anchor, body, blocking) => {
        const threadId = crypto.randomUUID();
        const branchId = anchoringRef.current.branchId;
        await mutateConfirmed({
          type: "createPageThread",
          pageId,
          threadId,
          messageId: crypto.randomUUID(),
          anchor,
          body,
          blocking,
          ...(branchId ? { branchId } : {}),
        });
        setActive(threadId);
      },
      reply: async (threadId, body) => {
        await mutateConfirmed({
          type: "replyToPageThread",
          threadId,
          messageId: crypto.randomUUID(),
          body,
        });
      },
      resolve: async (threadId, resolved) => {
        await mutateConfirmed(
          resolved
            ? { type: "resolvePageThread", threadId }
            : { type: "reopenPageThread", threadId },
        );
      },
      setBlocking: async (threadId, blocking) => {
        await mutateConfirmed({
          type: "setPageThreadBlocking",
          threadId,
          blocking,
        });
      },
    }),
    [mutateConfirmed, pageId],
  );

  const panel = (
    <CommentsPanel
      threads={views}
      canComment={canComment}
      pending={pending}
      onCancelPending={() => setPending(null)}
      activeId={active}
      hoveredId={hovered}
      onHover={setHovered}
      onActivate={activate}
      actions={actions}
      fileContext={fileContext}
      versionHref={versionHref}
      onClose={() => onOpenChange(false)}
      blockingEffect={blockingEffect}
      lineName={lineName}
      otherLines={otherLines}
      hint={
        canComment
          ? `No open discussions on ${lineName}. Select text to comment on it, or comment on the whole page.`
          : `No open discussions on ${lineName}.`
      }
    />
  );

  return (
    <>
      {(canComment || workAction) &&
        selection &&
        editor &&
        createPortal(
          // What can be done with the selected text: comment on it, or
          // (on the published page) create work from it.
          <div
            role="group"
            aria-label="Selected text"
            style={{
              top: Math.max(8, selection.top - 40),
              left: selection.left,
            }}
            className="fixed z-40 flex -translate-x-1/2 items-center gap-1.5"
          >
            {canComment && (
              <button
                type="button"
                // Keeps the selection: the button acts on what is selected.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => startComment(selection)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <MessageSquarePlus className="size-3.5" aria-hidden /> Comment
              </button>
            )}
            <SelectionWorkAction editor={editor} range={selection} />
          </div>,
          document.body,
        )}
      {wide && slot && open && createPortal(panel, slot)}
      {!wide && open && (
        <DiscussionSheet label="Comments" onClose={() => onOpenChange(false)}>
          {panel}
        </DiscussionSheet>
      )}
    </>
  );
}
