import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { Doc } from "yjs";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Placeholder } from "@tiptap/extensions";
import {
  Check,
  CircleAlert,
  CloudOff,
  CloudUpload,
  Copy,
  ListPlus,
  Loader,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Avatar } from "@lictory/ui/primitives";
import { toast } from "@lictory/ui/toast";
import { useAttachmentsAvailable } from "@lictory/platform/lib/session";
import { ACCEPT_FILES } from "@lictory/platform/components/items/file-upload";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  Link,
  usePathname,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import type { SpacePage } from "@lictory/platform/data/spaces";
import { documentExtensions } from "@lictory/platform/components/spaces/editor/document";
import { personColor } from "@lictory/platform/components/spaces/editor/colors";
import { RemoteSelection } from "@lictory/platform/components/spaces/editor/remote-selection";
import { touchTarget } from "@lictory/platform/components/spaces/touch";
import {
  DraftSession,
  saveStateOf,
  shownSaveState,
  type SessionSnapshot,
} from "@lictory/platform/components/spaces/editor/session";
import {
  draftRecoveryKey,
  draftRecoveryStore,
  insertableBlocks,
  recoveredDraft,
  recoveredText,
  type DraftRecoveryStore,
} from "@lictory/platform/components/spaces/editor/recovery";
import {
  MenuStore,
  SuggestionMenu,
  suggestionExtension,
} from "@lictory/platform/components/spaces/editor/suggestions";
import {
  insertImages,
  pageItems,
  slashItems,
  workItemItems,
} from "@lictory/platform/components/spaces/editor/commands";
import { Toolbar } from "@lictory/platform/components/spaces/editor/toolbar";
import {
  PublishButton,
  type PublishOutcome,
  type PublishTarget,
} from "@lictory/platform/components/spaces/editor/publish";
import {
  versionOf,
  type PageHistory,
  type PageLine,
} from "@lictory/platform/components/spaces/editor/line";
import { identifier } from "@lictory/core/lib/work-items";
import {
  COMMENT_SELECTION_EVENT,
  type Anchoring,
} from "@lictory/platform/components/spaces/comments/controller";
import {
  draftAnchorFor,
  resolveDraftAnchor,
} from "@lictory/platform/components/spaces/comments/draft-anchors";
import { resolveCommitAnchor } from "@lictory/platform/components/spaces/comments/anchors";
import {
  Fact,
  StateDot,
} from "@lictory/platform/components/spaces/page-header";

// Threads on a live draft: new ones anchor to relative positions of this
// epoch; those of another epoch show their quote; commit anchors find
// their block (ids survive in the draft) while the text is unchanged.
function draftAnchoring(
  draft: { id: string; epoch: number },
  branchId: string | undefined,
): Anchoring {
  return {
    branchId,
    create: (state, from, to) => draftAnchorFor(state, from, to, draft),
    resolve: (state, anchor, index) => {
      if (anchor.kind === "draft") {
        if (anchor.draftId !== draft.id || anchor.epoch !== draft.epoch)
          return { range: null, placement: "otherDraft" };
        const range = resolveDraftAnchor(state, anchor);
        return { range, placement: range ? "here" : "changed" };
      }
      if (anchor.kind === "commit") {
        const range = resolveCommitAnchor(state.doc, index, anchor);
        return { range, placement: range ? "here" : "changed" };
      }
      return { range: null, placement: "detached" };
    },
  };
}

// The live draft of a line: everyone allowed to edit it types into one Yjs
// document through the collaboration service, with their carets visible.
// The editor is bound to the document once; synchronized page state never
// replaces its content (that would move carets and lose selections). A new
// epoch (restore, merge into the line) is a new document name and remounts
// it with a fresh document.

export type LiveDraftProps = {
  page: SpacePage;
  line: PageLine & { draft: NonNullable<PageLine["draft"]> };
  history: PageHistory;
  onDone?: () => void;
  onEditor: (editor: Editor | null, anchoring: Anchoring | null) => void;
  canComment: boolean;
  // The page header's toolbar, where Close editor and Publish go.
  actionsSlot?: HTMLElement | null;
};

export function LiveDraft(props: LiveDraftProps) {
  const { userId, memberName, organization } = useWorkspace();
  const documentName = props.line.draft.documentName;
  const recoveryKey = draftRecoveryKey(
    userId,
    organization.id,
    props.page.id,
    props.line.draft.id,
  );
  const [session, setSession] = useState<DraftSession | null>(null);
  const name = memberName(userId);
  useEffect(() => {
    // The session is a connection to the collaboration service, opened and
    // closed with the effect (StrictMode-safe).
    const next = new DraftSession(documentName, {
      userId,
      name,
      color: personColor(userId),
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the session is an external connection created by this effect
    setSession(next);
    return () => {
      // A new epoch (or leaving the editor) closes this session; text the
      // service never stored is kept on this device and offered again.
      void next.retire((doc, storedClock) => {
        const kept = recoveredDraft(doc, storedClock, documentName);
        if (kept) draftRecoveryStore(recoveryKey).put(kept);
      });
      setSession(null);
    };
    // The person's name is set once per connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentName, userId, recoveryKey]);
  if (!session) return <ConnectingPlaceholder />;
  return (
    <DraftEditor
      key={documentName}
      session={session}
      recovery={draftRecoveryStore(recoveryKey)}
      {...props}
    />
  );
}

class Latest<T> {
  constructor(private value: T) {}
  get() {
    return this.value;
  }
  set(value: T) {
    this.value = value;
  }
}

function caretElement(user: Record<string, unknown>) {
  const caret = document.createElement("span");
  caret.className = "collaboration-carets__caret";
  caret.setAttribute("aria-hidden", "true");
  caret.style.borderColor = String(user.color);
  const label = document.createElement("span");
  label.className = "collaboration-carets__label";
  label.style.backgroundColor = String(user.color);
  label.textContent = String(user.name);
  caret.append(label);
  return caret;
}

// Editing behavior beyond the schema: images dropped or pasted become
// page files, and Mod+Alt+M asks the comments controller to comment on
// the selection (an event on the editor's element, which the controller
// listens to).
const PageEditing = Extension.create<{
  upload: (editor: Editor, files: File[], at?: number) => boolean;
}>({
  name: "pageEditing",
  addOptions: () => ({ upload: () => false }),
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-m": () => {
        this.editor.view.dom.dispatchEvent(
          new CustomEvent(COMMENT_SELECTION_EVENT),
        );
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new Plugin({
        props: {
          handleDrop: (view, event, _slice, moved) => {
            if (moved || !event.dataTransfer?.files.length) return false;
            const at = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })?.pos;
            const handled = options.upload(
              editor,
              [...event.dataTransfer.files],
              at,
            );
            if (handled) event.preventDefault();
            return handled;
          },
          handlePaste: (_view, event) => {
            const files = [...(event.clipboardData?.files ?? [])];
            return files.length > 0 && options.upload(editor, files);
          },
        },
      }),
    ];
  },
});

function ConnectingPlaceholder() {
  return (
    <div aria-busy="true" className="mt-6 space-y-3">
      <p className="text-xs text-muted-foreground">Opening the live draft…</p>
    </div>
  );
}

// The working title lives in the draft (Y.Text "title") so every editor
// sees the same one and it is saved like the content; commits take it from
// the editor. An empty title shows the line's committed title.
function useDraftTitle(doc: Doc, fallback: string) {
  const text = useMemo(() => doc.getText("title"), [doc]);
  const read = useCallback(() => text.toJSON(), [text]);
  const subscribe = useCallback(
    (listener: () => void) => {
      text.observe(listener);
      return () => text.unobserve(listener);
    },
    [text],
  );
  const stored = useSyncExternalStore(subscribe, read);
  const set = useCallback(
    (next: string) => {
      const current = text.toJSON();
      if (current === next) return;
      // Replace only what changed, so concurrent edits elsewhere survive.
      let start = 0;
      while (
        start < current.length &&
        start < next.length &&
        current[start] === next[start]
      )
        start += 1;
      let end = 0;
      while (
        end < current.length - start &&
        end < next.length - start &&
        current[current.length - 1 - end] === next[next.length - 1 - end]
      )
        end += 1;
      doc.transact(() => {
        text.delete(start, current.length - start - end);
        text.insert(start, next.slice(start, next.length - end));
      });
    },
    [doc, text],
  );
  return [stored || fallback, set, stored.length > 0] as const;
}

function DraftEditor({
  session,
  recovery,
  page,
  line,
  history,
  onDone,
  onEditor,
  canComment,
  actionsSlot,
}: LiveDraftProps & { session: DraftSession; recovery: DraftRecoveryStore }) {
  const { userId, memberName, organization, items, projects } = useWorkspace();
  const { index } = useSpaces();
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const attachments = useAttachmentsAvailable();
  const pathname = usePathname();
  const params = useSearchParams();
  const head = line.head;
  const [title, setTitle] = useDraftTitle(
    session.doc,
    head?.title ?? page.title,
  );
  const titleId = useId();
  const [uploading, setUploading] = useState(0);
  // The last publish result, with the stored sequence it was about: "No
  // changes to publish" disappears once there are new edits.
  const [outcome, setOutcome] = useState<
    (PublishOutcome & { at: number | null }) | null
  >(null);

  // Menus and uploads read the latest workspace data from a holder updated
  // after each render, so the editor is created once per session.
  const [data] = useState(
    () => new Latest({ items, projects, index, attachments }),
  );
  useEffect(() => {
    data.set({ items, projects, index, attachments });
  }, [data, items, projects, index, attachments]);
  const [menus] = useState(() => ({
    slash: new MenuStore(),
    items: new MenuStore(),
    pages: new MenuStore(),
  }));
  const fileContext = useMemo(
    () => ({ organizationId: organization.id, pageId: page.id }),
    [organization.id, page.id],
  );
  const upload = useCallback(
    (editor: Editor, files: File[], at?: number) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return false;
      if (!data.get().attachments) {
        toast.add({
          title: "Images are unavailable",
          description: "This installation has no file storage configured.",
          type: "error",
        });
        return true;
      }
      setUploading((n) => n + images.length);
      void insertImages(editor, images, fileContext, at)
        .catch((e: unknown) =>
          toast.add({
            title: "The image was not added",
            description:
              e instanceof Error ? e.message : "The upload failed. Try again.",
            type: "error",
            timeout: 8000,
          }),
        )
        .finally(() => setUploading((n) => n - images.length));
      return true;
    },
    [fileContext, data],
  );
  const fileInputId = `${titleId}-images`;
  const pickImage = useCallback(
    () => document.getElementById(fileInputId)?.click(),
    [fileInputId],
  );

  const user = useMemo(
    () => ({ userId, name: memberName(userId), color: personColor(userId) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId],
  );
  const { id: draftId, epoch } = line.draft;
  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      extensions: [
        ...documentExtensions({
          filterTransaction: (tr) => !isChangeOrigin(tr),
        }),
        Collaboration.configure({ document: session.doc, field: "default" }),
        RemoteSelection,
        CollaborationCaret.configure({
          provider: session.provider,
          user,
          render: caretElement,
        }),
        Placeholder.configure({
          placeholder: "Write, or type / for blocks, # for a work item",
        }),
        suggestionExtension("slashMenu", {
          char: "/",
          title: "Insert",
          empty: "No matching blocks",
          store: menus.slash,
          items: (query) =>
            slashItems(query, {
              image: data.get().attachments ? pickImage : undefined,
            }),
        }),
        suggestionExtension("workItemMenu", {
          char: "#",
          title: "Work items",
          empty: "No matching work items you can see",
          store: menus.items,
          items: (query) => {
            const { items: all, projects: list } = data.get();
            const byId = new Map(list.map((p) => [p.id, p]));
            return workItemItems(query, all, (item) =>
              identifier(byId.get(item.projectId), item.number),
            );
          },
        }),
        suggestionExtension("pageMenu", {
          char: "[[",
          allowSpaces: true,
          title: "Pages",
          empty: "No matching pages",
          store: menus.pages,
          items: (query) => {
            const { index: spaces } = data.get();
            return pageItems(
              query,
              [...spaces.pageById.values()]
                .filter((p) => !p.archivedAt)
                .map((p) => ({
                  id: p.id,
                  title: p.title,
                  space: spaces.spaceById.get(p.spaceId)?.name ?? "",
                })),
              page.id,
            );
          },
        }),
        PageEditing.configure({ upload }),
      ],
      editorProps: {
        attributes: {
          class: "page-document",
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": titleId,
          "aria-describedby": `${titleId}-state`,
        },
      },
    },
    [session],
  );
  useEffect(() => {
    for (const menu of [menus.slash, menus.items, menus.pages])
      menu.attach(editor);
    onEditor(editor, draftAnchoring({ id: draftId, epoch }, line.branchId));
    return () => onEditor(null, null);
  }, [editor, onEditor, menus, draftId, epoch, line.branchId]);

  const editable =
    snapshot.everSynced && !snapshot.readOnly && !snapshot.closed;
  useEffect(() => {
    if (!editor) return;
    // Until EditorContent mounts the view, Tiptap refuses view access; the
    // flag is applied again when it mounts.
    const apply = () => {
      try {
        if (!editor.isDestroyed && editor.isEditable !== editable)
          editor.setEditable(editable);
      } catch {
        // Not mounted yet.
      }
    };
    apply();
    editor.on("mount", apply);
    return () => {
      editor.off("mount", apply);
    };
  }, [editor, editable]);

  // Leaving with edits the service has not stored would lose them.
  useEffect(() => {
    if (!snapshot.unsynced) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [snapshot.unsynced]);

  const state = saveStateOf(snapshot);
  const draft = line.draft;
  const uncommitted =
    draft.uncommittedChanges ||
    snapshot.unsynced ||
    (snapshot.storedSequence ?? 0) > draft.committedSequence;
  const shownOutcome =
    outcome?.kind === "nothing" && outcome.at !== snapshot.storedSequence
      ? null
      : outcome;
  const target: PublishTarget | null = line.branch
    ? {
        pageId: page.id,
        branchId: line.branch.id,
        draft,
        isMain: line.isMain,
        headCommitId: line.branch.headCommitId,
      }
    : null;
  // The version the draft started from: a link to read it as published.
  const baseVersion = head ? versionOf(history.commits, head.id) : undefined;
  const versionLink = (() => {
    const next = new URLSearchParams(params);
    if (head) next.set("commit", head.id);
    return `${pathname}?${next}`;
  })();
  const publishedVersion =
    shownOutcome?.kind === "published"
      ? versionOf(history.commits, shownOutcome.commitId)
      : undefined;

  if (snapshot.closed && snapshot.closed !== "replaced")
    return <ClosedNotice snapshot={snapshot} onDone={onDone} />;
  return (
    <div className="mt-5">
      <label htmlFor={`${titleId}-input`} className="sr-only">
        Page title
      </label>
      <input
        id={`${titleId}-input`}
        value={title}
        maxLength={200}
        disabled={!editable}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (e.key === "ArrowDown" && editor)) {
            e.preventDefault();
            editor?.commands.focus("start");
          }
        }}
        className="w-full bg-transparent text-[1.75rem] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground disabled:opacity-100"
        placeholder="Untitled page"
      />
      <span id={titleId} className="sr-only">
        {title || "Untitled page"} content
      </span>
      {/* One status line: what this is (the live draft), whether it is
          saved and published, and who else is here. */}
      <div className="mt-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
          <StateDot tone="draft">
            {line.isMain
              ? "Live draft"
              : `Draft of ${line.branch?.name ?? "this branch"}`}
          </StateDot>
          {head && baseVersion && (
            <Fact>
              <span>
                based on{" "}
                <Link
                  href={versionLink}
                  title={`Read ${line.isMain ? "published " : ""}version ${baseVersion}`}
                  className="rounded-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  v{baseVersion}
                </Link>
              </span>
            </Fact>
          )}
          <Fact>
            <SaveIndicator
              id={`${titleId}-state`}
              snapshot={snapshot}
              uploading={uploading}
            />
          </Fact>
          <Fact>
            <span className={cn(uncommitted && "text-warning")}>
              {uncommitted
                ? line.isMain
                  ? "Unpublished changes"
                  : "Uncommitted changes"
                : line.isMain
                  ? "No unpublished changes"
                  : "All changes committed"}
            </span>
          </Fact>
          <Editors peers={snapshot.peers} />
          <span aria-live="polite" className="font-medium text-success">
            {shownOutcome?.kind === "published"
              ? `${line.isMain ? "Published" : "Committed"}${publishedVersion ? ` version ${publishedVersion}` : ""}`
              : shownOutcome?.kind === "nothing"
                ? line.isMain
                  ? "No changes to publish"
                  : "No changes to commit"
                : ""}
          </span>
        </div>
      </div>
      {actionsSlot &&
        createPortal(
          <>
            {onDone && (
              <Button
                variant="ghost"
                size="sm"
                className={touchTarget}
                title="Back to the published page. The draft stays saved."
                onClick={onDone}
              >
                Close editor
              </Button>
            )}
            {target && (
              <PublishButton
                session={session}
                target={target}
                title={title.trim() || (head?.title ?? page.title)}
                canPublish={editable}
                onOutcome={(result) => {
                  if (result.kind === "error")
                    toast.add({
                      title: "Not published",
                      description: result.message,
                      type: "error",
                    });
                  else
                    setOutcome({
                      ...result,
                      at: session.getSnapshot().storedSequence,
                    });
                }}
              />
            )}
          </>,
          actionsSlot,
        )}
      <RecoveredText
        store={recovery}
        editor={editor}
        editable={editable}
        documentName={line.draft.documentName}
      />
      {snapshot.closed === "replaced" && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground"
        >
          This draft was replaced (a version was restored or merged into it).
          Opening the current draft…
        </p>
      )}
      {state.kind === "unavailable" && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-muted px-3 py-2 text-[13px]"
        >
          <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 basis-60">
            <span className="font-medium">Live editing is unavailable.</span>{" "}
            <span className="text-muted-foreground">
              The collaboration service cannot be reached. Reading, history and
              comments keep working.
            </span>
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => location.reload()}
          >
            <RefreshCw className="size-3.5" aria-hidden /> Retry
          </Button>
          {onDone && (
            <Button size="sm" variant="ghost" onClick={onDone}>
              Read the published page
            </Button>
          )}
        </div>
      )}
      {editor && (
        <div className="sticky top-0 z-10 -mx-1 mt-4 bg-background/95 px-1 py-2 backdrop-blur">
          <Toolbar
            editor={editor}
            disabled={!editable}
            onImage={attachments ? pickImage : undefined}
            onComment={
              canComment
                ? () =>
                    editor.view.dom.dispatchEvent(
                      new CustomEvent(COMMENT_SELECTION_EVENT),
                    )
                : undefined
            }
          />
        </div>
      )}
      <div className={cn("mt-4", !snapshot.everSynced && "opacity-60")}>
        <EditorContent editor={editor} />
      </div>
      <input
        id={fileInputId}
        type="file"
        accept={ACCEPT_FILES.split(",")
          .filter((t) => t.startsWith("image/") || t.startsWith("."))
          .join(",")}
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (editor) upload(editor, files);
        }}
      />
      <SuggestionMenu store={menus.slash} />
      <SuggestionMenu store={menus.items} />
      <SuggestionMenu store={menus.pages} />
    </div>
  );
}

// Text this person typed into an earlier draft of this line that was never
// stored (the draft was replaced, or the editor closed while saving). Kept
// on this device until they copy, insert or discard it; inserting is an
// ordinary edit of the current draft, made only when they ask.
function RecoveredText({
  store,
  editor,
  editable,
  documentName,
}: {
  store: DraftRecoveryStore;
  editor: Editor | null;
  editable: boolean;
  documentName: string;
}) {
  const entries = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  if (!entries.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {entries.map((entry) => {
        const blocks = insertableBlocks(entry);
        const preview = recoveredText(entry);
        return (
          <section
            key={entry.id}
            role="status"
            aria-label="Unsaved text kept on this device"
            className="flex flex-wrap items-start gap-3 rounded-xl bg-muted px-3 py-2 text-[13px]"
          >
            <CircleAlert
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden
            />
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-medium">
                {entry.documentName !== documentName
                  ? "This page was replaced while you had unsaved changes. Your text is kept on this device."
                  : "The editor closed before some of your changes were saved. Your text is kept on this device."}
              </p>
              <p className="mt-1 line-clamp-3 break-words whitespace-pre-wrap text-muted-foreground">
                {preview}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(preview).then(
                    () => toast.add({ title: "Text copied", type: "success" }),
                    () =>
                      toast.add({
                        title: "The text could not be copied",
                        description:
                          "Select it in the notice and copy it by hand.",
                        type: "error",
                      }),
                  );
                }}
              >
                <Copy className="size-3.5" aria-hidden /> Copy text
              </Button>
              {blocks && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!editable || !editor}
                  onClick={() => {
                    if (!editor) return;
                    const inserted = editor
                      .chain()
                      .insertContentAt(editor.state.doc.content.size, blocks)
                      .run();
                    if (inserted) store.remove(entry.id);
                  }}
                >
                  <ListPlus className="size-3.5" aria-hidden /> Insert at end
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => store.remove(entry.id)}
              >
                <X className="size-3.5" aria-hidden /> Discard
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Shows when the shown save state changes on its own (a save turned slow,
// "Saved" settled): one timer at a time, none while nothing is pending.
function useShownSaveState(snapshot: SessionSnapshot) {
  // The session times its states on the same monotonic clock.
  const [now, setNow] = useState(() => performance.now());
  // A stale `now` only delays "slow" and "Saved", never shows them early.
  const shown = shownSaveState(snapshot, now);
  const { wakeAt } = shown;
  useEffect(() => {
    if (wakeAt === null) return;
    const timer = setTimeout(
      () => setNow(Math.max(performance.now(), wakeAt)),
      wakeAt - performance.now(),
    );
    return () => clearTimeout(timer);
  }, [wakeAt]);
  return shown;
}

function SaveIndicator({
  id,
  snapshot,
  uploading,
}: {
  id: string;
  snapshot: SessionSnapshot;
  uploading: number;
}) {
  const { state, slow, announcement } = useShownSaveState(snapshot);
  const icon =
    state.kind === "saved" ? (
      <Check className="size-3.5" aria-hidden />
    ) : state.kind === "offline" || state.kind === "unavailable" ? (
      <CloudOff className="size-3.5 text-warning" aria-hidden />
    ) : state.kind === "closed" ? (
      <CircleAlert className="size-3.5 text-destructive" aria-hidden />
    ) : state.kind === "saving" && !slow ? (
      <CloudUpload className="size-3.5" aria-hidden />
    ) : (
      <Loader className="size-3.5 motion-safe:animate-spin" aria-hidden />
    );
  return (
    <>
      {/* Read on demand (the editor is described by it), not announced:
          it changes with every pause in typing. */}
      <span
        id={id}
        data-testid="draft-save-state"
        title={
          state.kind === "offline"
            ? "Your edits stay in this tab and are saved when the connection returns. Keep the tab open."
            : state.kind === "saved"
              ? "Every edit is stored by the server."
              : undefined
        }
        className="inline-flex items-center gap-1"
      >
        {icon}
        {state.label}
        {uploading > 0 &&
          ` · Uploading ${uploading === 1 ? "image" : `${uploading} images`}…`}
      </span>
      <span role="status" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </>
  );
}

// Who else has this draft open (one avatar per person, whatever the
// number of tabs).
function Editors({ peers }: { peers: SessionSnapshot["peers"] }) {
  const { userId } = useWorkspace();
  const people = [
    ...new Map(
      peers
        .filter((p) => p.userId !== userId)
        .map((p) => [p.userId ?? String(p.clientId), p]),
    ).values(),
  ];
  if (!people.length) return null;
  const names = people.map((p) => p.name);
  const text =
    names.length === 1
      ? `${names[0]} is editing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are editing`
        : `${names[0]} and ${names.length - 1} others are editing`;
  return (
    <span className="inline-flex items-center gap-1.5" title={names.join(", ")}>
      <span aria-hidden className="text-muted-foreground/60">
        ·
      </span>
      <span className="flex -space-x-1">
        {people.slice(0, 4).map((p) => (
          <span
            key={p.clientId}
            className="rounded-full ring-2"
            style={{ ["--tw-ring-color" as string]: p.color }}
          >
            <Avatar userId={p.userId} name={p.name} size="xs" />
          </span>
        ))}
      </span>
      <span>{text}</span>
    </span>
  );
}

function ClosedNotice({
  snapshot,
  onDone,
}: {
  snapshot: SessionSnapshot;
  onDone?: () => void;
}) {
  const state = saveStateOf(snapshot);
  return (
    <div
      role="alert"
      className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-muted px-4 py-3 text-[13px]"
    >
      <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <p className="min-w-0 flex-1 basis-60 font-medium">
        {snapshot.closed === "signedOut"
          ? "Sign in again to keep editing this page."
          : snapshot.closed === "revoked"
            ? "You no longer have access to edit this draft."
            : state.label}
      </p>
      {snapshot.closed === "signedOut" ? (
        <a
          href={`/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
          className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Sign in
        </a>
      ) : (
        onDone && (
          <Button size="sm" variant="secondary" onClick={onDone}>
            Read the published page
          </Button>
        )
      )}
    </div>
  );
}
