import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Doc } from "yjs";
import { Extension, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Placeholder } from "@tiptap/extensions";
import {
  CircleAlert,
  Copy,
  ListPlus,
  Loader,
  RefreshCw,
  X,
} from "lucide-react";
import type { Command, EntityOf } from "@lictory/core/contracts/protocol";
import { cn } from "@lictory/core/lib/utils";
import { markdownExtensions } from "@lictory/core/editor/schema";
import {
  blockKey,
  parseMarkdown,
  serializeMarkdown,
  type MarkdownJSON,
} from "@lictory/core/editor/markdown";
import {
  hasConflicts,
  mergeBlocks,
  resolveMerge,
  type MergeChunk,
} from "@lictory/core/editor/block-merge";
import { draftStateToMarkdown } from "@lictory/core/editor/draft-state";
import {
  DRAFT_UPDATE_BYTES,
  SPECIFICATION_CLOSE_REASONS,
} from "@lictory/core/spaces/collaboration-protocol";
import { Button } from "@lictory/ui/button";
import { RevisionDiff } from "@lictory/ui/diff";
import { toast } from "@lictory/ui/toast";
import { MutationRejected } from "@lictory/platform/data/mutations";
import { useAttachmentsAvailable } from "@lictory/platform/lib/session";
import {
  ACCEPT_FILES,
  type FileContext,
} from "@lictory/platform/components/items/file-upload";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useReferences } from "@lictory/platform/components/references/data";
import { withNodeViews } from "@lictory/platform/components/editor/node-views";
import {
  MenuStore,
  SuggestionMenu,
  suggestionExtension,
} from "@lictory/platform/components/editor/suggestions";
import {
  insertFiles,
  pageItems,
  slashItems,
  workItemItems,
} from "@lictory/platform/components/editor/commands";
import { Toolbar } from "@lictory/platform/components/editor/toolbar";
import { DecisionPicker } from "@lictory/platform/components/editor/decision-picker";
import { personColor } from "@lictory/platform/components/spaces/editor/colors";
import { RemoteSelection } from "@lictory/platform/components/spaces/editor/remote-selection";
import {
  DraftSession,
  saveStateOf,
  type SessionSnapshot,
} from "@lictory/platform/components/spaces/editor/session";
import {
  caretElement,
  Editors,
  SaveFailedNotice,
  SaveIndicator,
} from "@lictory/platform/components/spaces/editor/live-editor";
import {
  insertableSpecificationBlocks,
  keptSpecificationText,
  replacedSpecificationText,
  specDraftRecoveryKey,
  specDraftRecoveryStore,
} from "@lictory/platform/components/items/spec-draft-recovery";
import type {
  DraftRecoveryStore,
  RecoveredDraft,
} from "@lictory/platform/components/spaces/editor/recovery";
import "@lictory/platform/components/editor/document.css";

// The live draft of a specification line
// (docs/internals/specification-drafts.md): everyone allowed to edit the
// line types into one Yjs document of the Markdown editor's schema, through
// the same collaboration service, session and save semantics as page drafts
// of Lictory Spaces. Markdown stays what is stored: the editor never sends
// content; "Save revision" (main) or "Commit" (a branch) asks the server to
// seal the cut it has stored. Synchronized item state never replaces the
// mounted document; a new epoch (a new document name) remounts it.

export type LiveSpecificationLine = {
  draft: EntityOf<"specDraft">;
  // The line's head: what the draft's saved state is.
  headTitle: string;
  headMarkdown: string;
  // "revision 3", "the latest commit": what the draft is based on.
  basedOn: string;
  isMain: boolean;
  branchName?: string;
};

export type LiveControls = {
  editable: boolean;
  // Stored or local edits beyond the last saved cut, or Markdown edited as
  // text and not applied yet.
  uncommitted: boolean;
  // Applies Markdown edited as text, waits for "Draft saved", names the
  // stored cut and sends the command it builds. "nothing" when the edits
  // cancelled out. Refused while the Markdown overlaps someone's changes
  // (the editor asks which to keep).
  seal: (
    build: (expectedSequence: number) => Command,
  ) => Promise<"saved" | "nothing">;
  // Leaves the editor, applying Markdown edited as text first (or asking,
  // when it overlaps someone's changes).
  close: () => void;
  // Starts the draft again from the line's head, for everyone.
  discard: () => Promise<void>;
};

export type LiveSpecificationProps = {
  line: LiveSpecificationLine;
  // The textbox's accessible name ("Specification", "Branch specification").
  label: string;
  // Branch drafts carry the working title (Y.Text "title").
  titleLabel?: string;
  placeholder?: string;
  minHeight?: string;
  fileContext?: FileContext;
  view?: "document" | "changes";
  onClose: () => void;
  // Mod+Enter.
  onSubmit?: () => void;
  footer: (controls: LiveControls) => ReactNode;
  // Text this person kept in this browser before the line had a live draft
  // (a branch edit that was never committed): offered back like unsaved
  // text, once.
  legacyText?: { title: string; content: string } | null;
  onLegacyKept?: () => void;
};

export default function LiveSpecificationDraft(props: LiveSpecificationProps) {
  const { userId, memberName, organization } = useWorkspace();
  const { item } = useItem();
  const { documentName, branchId } = props.line.draft;
  const recoveryKey = specDraftRecoveryKey(
    userId,
    organization.id,
    item.id,
    branchId ?? "main",
  );
  const [session, setSession] = useState<DraftSession | null>(null);
  // Reopening (after the service refused an edit) starts a new session.
  const [opening, setOpening] = useState(0);
  // What a closing session compares its kept text with, updated before
  // passive effects clean up: the newest document name and head, and the
  // head its own epoch was last based on.
  const headTitle = props.line.headTitle;
  const latest = useRef({
    documentName,
    head: props.line.headMarkdown,
    epochHead: props.line.headMarkdown,
    headTitle,
  });
  useLayoutEffect(() => {
    const same = latest.current.documentName === documentName;
    latest.current = {
      documentName,
      head: props.line.headMarkdown,
      epochHead: same ? props.line.headMarkdown : latest.current.epochHead,
      headTitle,
    };
  });
  // Set while this tab discards the draft's changes (a new epoch it asked
  // for: nothing of the old one is kept).
  const discarding = useRef(false);
  const { legacyText, onLegacyKept } = props;
  useEffect(() => {
    if (!legacyText) return;
    const blocks = parseMarkdown(legacyText.content).doc.content ?? [];
    specDraftRecoveryStore(recoveryKey).put({
      // Stable, so a repeated mount keeps one entry.
      id: `legacy:${branchId ?? "main"}`,
      documentName: LEGACY_DOCUMENT,
      keptAt: Date.now(),
      title:
        legacyText.title !== props.line.headTitle ? legacyText.title : null,
      blocks,
      markdown: legacyText.content,
    });
    onLegacyKept?.();
    // Once per kept text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyText, recoveryKey]);
  const name = memberName(userId);
  useEffect(() => {
    const next = new DraftSession(documentName, {
      userId,
      name,
      color: personColor(userId),
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the session is an external connection created by this effect
    setSession(next);
    return () => {
      const store = specDraftRecoveryStore(recoveryKey);
      const replaced = latest.current.documentName !== documentName;
      const discarded = discarding.current;
      discarding.current = false;
      if (replaced) {
        // A new epoch (the line's head moved from outside this draft, or
        // someone discarded its changes) refuses this epoch's edits: the
        // draft's text that neither its old base nor the new head contains
        // is kept on this device, stored or not. Unless I discarded it.
        if (!discarded)
          try {
            const kept = replacedSpecificationText(
              next.doc,
              documentName,
              latest.current.epochHead,
              latest.current.head,
              latest.current.headTitle,
            );
            if (kept) store.put(kept);
          } catch {
            // Keeping is best effort; closing must still happen.
          }
        next.destroy();
      } else
        // Leaving the editor: what the service never stored is kept.
        void next.retire((doc, storedClock) => {
          const kept = keptSpecificationText(doc, storedClock, documentName);
          if (kept) store.put(kept);
        });
      setSession(null);
    };
    // The person's name is set once per connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentName, userId, recoveryKey, opening]);
  if (!session)
    return (
      <p aria-busy="true" className="text-xs text-muted-foreground">
        Opening the live draft…
      </p>
    );
  return (
    <DraftEditor
      key={`${documentName}:${opening}`}
      {...props}
      session={session}
      recovery={specDraftRecoveryStore(recoveryKey)}
      reopened={opening > 0}
      onReopen={() => setOpening((n) => n + 1)}
      onDiscarding={(active) => {
        discarding.current = active;
      }}
    />
  );
}

// Kept text that came from a browser draft of the line, not a session.
const LEGACY_DOCUMENT = "browser-draft";
// Kept Markdown edited as text and never applied.
const SOURCE_ENTRY = "source:";

type SourceEdit = {
  // The draft's top-level blocks when "Edit as Markdown" opened.
  base: MarkdownJSON[];
  // The Markdown it showed then, and what it says now.
  initial: string;
  text: string;
};

const markdownOfBlocks = (blocks: MarkdownJSON[]) =>
  serializeMarkdown({ type: "doc", content: blocks });

// The blocks the Markdown changed or added, to keep on this device.
function keptSourceText(
  edit: SourceEdit,
  id: string,
  documentName: string,
): RecoveredDraft | null {
  const base = new Set(edit.base.map(blockKey));
  let blocks: MarkdownJSON[];
  try {
    blocks = (parseMarkdown(edit.text).doc.content ?? []).filter(
      (block) => !base.has(blockKey(block)),
    );
  } catch {
    blocks = [
      { type: "paragraph", content: [{ type: "text", text: edit.text }] },
    ];
  }
  blocks = blocks.filter((block) => markdownOfBlocks([block]).trim());
  if (!blocks.length) return null;
  return {
    id,
    documentName,
    keptAt: Date.now(),
    title: null,
    blocks,
    markdown: markdownOfBlocks(blocks),
  };
}

// Markdown edited as text overlaps changes someone made to the same blocks
// meanwhile: nothing is applied until the person chooses.
function SourceConflict({
  chunks,
  onChoose,
  onKeepEditing,
  onDiscard,
}: {
  chunks: MergeChunk<MarkdownJSON>[];
  onChoose: (choice: "mine" | "theirs") => void;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const conflicts = chunks.filter((c) => c.kind === "conflict");
  return (
    <div
      role="alert"
      className="m-3 space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-[13px]"
    >
      <p>
        <span className="font-medium">
          Someone changed the same part of the specification while you edited
          the Markdown.
        </span>{" "}
        <span className="text-muted-foreground">
          Your other edits apply as they are. For{" "}
          {conflicts.length === 1
            ? "this part"
            : `these ${conflicts.length} parts`}
          , choose which version to keep: their current text (left) or your
          Markdown (right).
        </span>
      </p>
      {conflicts.map((c, i) => (
        <RevisionDiff
          key={i}
          before={markdownOfBlocks(c.theirs)}
          after={markdownOfBlocks(c.mine)}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onChoose("mine")}>
          Keep my version
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChoose("theirs")}
        >
          Keep their version
        </Button>
        <Button size="sm" variant="ghost" onClick={onKeepEditing}>
          Keep editing Markdown
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onDiscard}
        >
          Discard my Markdown edits
        </Button>
      </div>
    </div>
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

// Mod+Enter, Escape, files dropped or pasted, and pasted plain text read as
// Markdown (as in every Markdown field).
const SpecificationEditing = Extension.create<{
  submit: () => boolean;
  escape: () => boolean;
  upload: (editor: Editor, files: File[], at?: number) => boolean;
}>({
  name: "specificationEditing",
  priority: 1000,
  addOptions: () => ({
    submit: () => false,
    escape: () => false,
    upload: () => false,
  }),
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.options.submit(),
      Escape: () => this.options.escape(),
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
          handlePaste: (view, event) => {
            const files = [...(event.clipboardData?.files ?? [])];
            if (files.length) return options.upload(editor, files);
            const html = event.clipboardData?.getData("text/html");
            const text = event.clipboardData?.getData("text/plain");
            if (
              html ||
              !text ||
              view.state.selection.$from.parent.type.spec.code
            )
              return false;
            const { doc } = parseMarkdown(text, view.state.schema);
            const fragment = Fragment.fromJSON(view.state.schema, doc.content);
            view.dispatch(
              view.state.tr
                .replaceSelection(Slice.maxOpen(fragment))
                .scrollIntoView(),
            );
            return true;
          },
        },
      }),
    ];
  },
});

// Replaces only the top-level blocks that differ between the document and
// `next`, so the rest of the shared draft (and other people's carets in it)
// is untouched.
function replaceBlocks(editor: Editor, next: MarkdownJSON[]) {
  const { schema, doc } = editor.state;
  const current: PMNode[] = [];
  doc.forEach((node) => current.push(node));
  const keys = current.map((node) => blockKey(node.toJSON() as MarkdownJSON));
  const nextKeys = next.map(blockKey);
  let start = 0;
  while (
    start < keys.length &&
    start < nextKeys.length &&
    keys[start] === nextKeys[start]
  )
    start += 1;
  let end = 0;
  while (
    end < keys.length - start &&
    end < nextKeys.length - start &&
    keys[keys.length - 1 - end] === nextKeys[nextKeys.length - 1 - end]
  )
    end += 1;
  if (start === keys.length && start === nextKeys.length) return;
  let from = 0;
  for (let i = 0; i < start; i++) from += current[i]!.nodeSize;
  let to = from;
  for (let i = start; i < keys.length - end; i++) to += current[i]!.nodeSize;
  const nodes = next
    .slice(start, nextKeys.length - end)
    .map((json) => schema.nodeFromJSON(json));
  const replacement =
    nodes.length || current.length - (keys.length - start - end) > 0
      ? nodes
      : [schema.nodes.paragraph!.create()];
  editor.view.dispatch(editor.state.tr.replaceWith(from, to, replacement));
}

// The working title of a branch draft (Y.Text "title"): empty until someone
// changes it, then saved with the content and sealed at the cut.
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
  return [stored || fallback, set] as const;
}

// Re-renders on document changes while `active` (the Markdown views), at
// most once per frame.
function useDocumentVersion(doc: Doc, active: boolean) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVersion((n) => n + 1));
    };
    doc.on("update", bump);
    return () => {
      cancelAnimationFrame(frame);
      doc.off("update", bump);
    };
  }, [doc, active]);
  return version;
}

function DraftEditor({
  session,
  recovery,
  reopened,
  onReopen,
  onDiscarding,
  line,
  label,
  titleLabel,
  placeholder,
  minHeight = "20rem",
  fileContext: requestedFileContext,
  view = "document",
  onClose,
  onSubmit,
  footer,
}: LiveSpecificationProps & {
  session: DraftSession;
  recovery: DraftRecoveryStore;
  reopened: boolean;
  onReopen: () => void;
  onDiscarding: (active: boolean) => void;
}) {
  const { userId, memberName } = useWorkspace();
  const { item, mutateConfirmed } = useItem();
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const fileContext = useAttachmentsAvailable()
    ? requestedFileContext
    : undefined;
  const id = useId();
  const stateId = `${id}-state`;
  const [title, setTitle] = useDraftTitle(session.doc, line.headTitle);
  // "Edit as Markdown": the text, and the draft's blocks when it was
  // opened, so applying changes only what the text changed.
  const [source, setSource] = useState<SourceEdit | null>(null);
  const [conflict, setConflict] = useState<MergeChunk<MarkdownJSON>[] | null>(
    null,
  );
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const fileInputId = `${id}-files`;
  const references = useReferences();
  const [data] = useState(
    () => new Latest({ references, fileContext, onSubmit, onClose }),
  );
  useEffect(() => {
    data.set({ references, fileContext, onSubmit, onClose });
  });
  const [menus] = useState(() => ({
    slash: new MenuStore(),
    items: new MenuStore(),
    pages: new MenuStore(),
  }));
  const menuOpen = () =>
    Object.values(menus).some((m) => m.getSnapshot() !== null);
  const upload = useCallback(
    (editor: Editor, files: File[], at?: number) => {
      const context = data.get().fileContext;
      if (!context || !files.length) return false;
      setUploading((n) => n + files.length);
      void insertFiles(editor, files, context, at)
        .catch((e: unknown) =>
          toast.add({
            title: "The file was not added",
            description:
              e instanceof Error ? e.message : "The upload failed. Try again.",
            type: "error",
          }),
        )
        .finally(() => setUploading((n) => n - files.length));
      return true;
    },
    [data],
  );
  const pickFile = useCallback(
    () => document.getElementById(fileInputId)?.click(),
    [fileInputId],
  );
  const user = useMemo(
    () => ({ userId, name: memberName(userId), color: personColor(userId) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId],
  );
  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      extensions: [
        ...withNodeViews(markdownExtensions()),
        Collaboration.configure({ document: session.doc, field: "default" }),
        RemoteSelection,
        CollaborationCaret.configure({
          provider: session.provider,
          user,
          render: caretElement,
        }),
        Placeholder.configure({
          placeholder:
            placeholder ??
            "Write, or type / for blocks, # for a work item, [[ for a page",
        }),
        suggestionExtension("slashMenu", {
          char: "/",
          title: "Insert",
          empty: "No matching blocks",
          store: menus.slash,
          items: (query) =>
            slashItems(query, {
              file: data.get().fileContext ? pickFile : undefined,
              decision: data.get().references.organizationId
                ? () => setDecisionOpen(true)
                : undefined,
              mention: false,
            }),
        }),
        suggestionExtension("workItemMenu", {
          char: "#",
          title: "Work items",
          empty: "No matching work items you can see",
          store: menus.items,
          items: (query) => workItemItems(query, data.get().references.items()),
        }),
        suggestionExtension("pageMenu", {
          char: "[[",
          allowSpaces: true,
          title: "Pages",
          empty: "No matching pages you can read",
          store: menus.pages,
          items: (query) => pageItems(query, data.get().references.pages()),
        }),
        SpecificationEditing.configure({
          submit: () => {
            const submit = data.get().onSubmit;
            if (!submit || menuOpen()) return false;
            submit();
            return true;
          },
          escape: () => {
            if (menuOpen()) return false;
            data.get().onClose();
            return true;
          },
          upload,
        }),
      ],
      editorProps: {
        attributes: {
          id: `${id}-editor`,
          class: "page-document markdown-document outline-none",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": label,
          "aria-describedby": stateId,
          "data-markdown-editor": "",
        },
      },
    },
    [session],
  );
  useEffect(() => {
    for (const menu of Object.values(menus)) menu.attach(editor);
  }, [editor, menus]);

  const editable =
    snapshot.everSynced && !snapshot.readOnly && !snapshot.closed;
  useEffect(() => {
    if (!editor) return;
    const apply = () => {
      try {
        if (!editor.isDestroyed && editor.isEditable !== editable)
          editor.setEditable(editable);
      } catch {
        // Not mounted yet; applied again on mount.
      }
    };
    apply();
    editor.on("mount", apply);
    return () => {
      editor.off("mount", apply);
    };
  }, [editor, editable]);

  // The editor takes focus once it can be edited: when it opens, and again
  // after a reopen removed the focused button.
  const focusWhenEditable = useRef(true);
  useEffect(() => {
    if (!focusWhenEditable.current || !editor || !editable) return;
    const focus = () => {
      if (!focusWhenEditable.current || editor.isDestroyed) return;
      if (!editor.isInitialized || !editor.isEditable) return;
      focusWhenEditable.current = false;
      const active = document.activeElement;
      if (reopened ? !active || active === document.body : !titleLabel)
        editor.commands.focus("end", { scrollIntoView: false });
    };
    focus();
    editor.on("create", focus);
    editor.on("mount", focus);
    return () => {
      editor.off("create", focus);
      editor.off("mount", focus);
    };
  }, [editor, editable, reopened, titleLabel]);

  const sourceDirty = source !== null && source.text !== source.initial;
  // Leaving with edits the service has not stored, or Markdown not applied
  // yet, would lose them.
  const unsafeToLeave = snapshot.unsynced || sourceDirty;
  useEffect(() => {
    if (!unsafeToLeave) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsafeToLeave]);

  const markdownViews = view === "changes" || source !== null;
  useDocumentVersion(session.doc, markdownViews);
  const markdown = () => {
    try {
      return draftStateToMarkdown(session.doc, line.headMarkdown);
    } catch {
      return line.headMarkdown;
    }
  };
  const draft = line.draft;
  // Edits in the shared draft that no revision or commit has yet; and with
  // Markdown not applied yet.
  const draftUncommitted =
    draft.uncommittedChanges ||
    snapshot.unsynced ||
    (snapshot.storedSequence ?? 0) > draft.committedSequence;
  const uncommitted = draftUncommitted || sourceDirty;
  const state = saveStateOf(snapshot);

  // Markdown edited as text is kept on this device until it is applied or
  // discarded, so closing the tab, going offline or a replaced draft never
  // loses it (offered back like other unsaved text).
  const sourceEntryId = `source:${draft.documentName}`;
  const [sourceBox] = useState(() => new Latest<SourceEdit | null>(null));
  useLayoutEffect(() => {
    sourceBox.set(source);
  }, [source, sourceBox]);
  const keepSource = useCallback(
    (edit: SourceEdit | null) => {
      if (!edit || edit.text === edit.initial) {
        recovery.remove(sourceEntryId);
        return;
      }
      const kept = keptSourceText(edit, sourceEntryId, draft.documentName);
      if (kept) recovery.put(kept);
      else recovery.remove(sourceEntryId);
    },
    [recovery, sourceEntryId, draft.documentName],
  );
  useEffect(() => {
    const timer = setTimeout(() => keepSource(source), 400);
    return () => clearTimeout(timer);
  }, [source, keepSource]);
  useEffect(
    () => () => {
      // Leaving the editor (or a new epoch) with Markdown not applied.
      keepSource(sourceBox.get());
    },
    [keepSource, sourceBox],
  );

  // Applies the Markdown to the current draft: only the blocks it changed
  // since it was opened, keeping what others changed meanwhile. Overlapping
  // changes are not chosen silently: without a `choice` the editor asks.
  const applySource = useCallback(
    (choice?: "mine" | "theirs"): "applied" | "conflict" => {
      const edit = sourceBox.get();
      if (!edit || !editor) return "applied";
      if (edit.text !== edit.initial) {
        const { schema, doc } = editor.state;
        const mine = parseMarkdown(edit.text, schema).doc.content ?? [];
        const theirs: MarkdownJSON[] = [];
        doc.forEach((node) => theirs.push(node.toJSON() as MarkdownJSON));
        const chunks = mergeBlocks(edit.base, mine, theirs, blockKey);
        if (hasConflicts(chunks) && !choice) {
          setConflict(chunks);
          return "conflict";
        }
        replaceBlocks(editor, resolveMerge(chunks, choice ?? "mine"));
      }
      sourceBox.set(null);
      setSource(null);
      setConflict(null);
      recovery.remove(sourceEntryId);
      return "applied";
    },
    [editor, recovery, sourceEntryId, sourceBox],
  );
  const discardSource = useCallback(() => {
    sourceBox.set(null);
    setSource(null);
    setConflict(null);
    recovery.remove(sourceEntryId);
  }, [recovery, sourceEntryId, sourceBox]);

  const seal = useCallback<LiveControls["seal"]>(
    async (build) => {
      if (applySource() === "conflict")
        throw new Error(
          "Your Markdown edits overlap changes someone made meanwhile. Choose which to keep, then save again.",
        );
      await session.saved();
      const expectedSequence = await session.latestSequence();
      try {
        await mutateConfirmed(build(expectedSequence));
        return "saved";
      } catch (e) {
        if (
          e instanceof MutationRejected &&
          /^nothing to (save|commit)/i.test(e.message)
        )
          return "nothing";
        throw e;
      }
    },
    [session, mutateConfirmed, applySource],
  );
  const close = useCallback(() => {
    if (applySource() === "conflict") return;
    data.get().onClose();
  }, [applySource, data]);
  const discard = useCallback(async () => {
    discardSource();
    onDiscarding(true);
    try {
      await mutateConfirmed({
        type: "openSpecificationDraft",
        workItemId: item.id,
        ...(draft.branchId ? { branchId: draft.branchId } : {}),
        discardChanges: true,
      });
    } catch (error) {
      onDiscarding(false);
      throw error;
    }
  }, [mutateConfirmed, item.id, draft.branchId, onDiscarding, discardSource]);

  const toggleSource = () => {
    if (source !== null) {
      if (applySource() === "applied")
        requestAnimationFrame(() => editor?.commands.focus());
      return;
    }
    if (!editor) return;
    const base: MarkdownJSON[] = [];
    editor.state.doc.forEach((node) =>
      base.push(node.toJSON() as MarkdownJSON),
    );
    const text = markdown();
    setSource({ base, initial: text, text });
  };

  if (snapshot.closed && snapshot.closed !== "replaced")
    return <ClosedNotice snapshot={snapshot} onClose={onClose} />;
  return (
    <div className="space-y-3">
      {titleLabel && (
        <label className="block space-y-1 text-xs font-medium">
          {titleLabel}
          <input
            aria-label={titleLabel}
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            value={title}
            disabled={!editable}
            maxLength={240}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      )}
      {/* One status line: the live draft, what it is based on, whether it
          is saved, whether it holds unsaved changes and who else is here. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          {line.isMain
            ? "Live draft"
            : `Draft of ${line.branchName ?? "this branch"}`}
        </span>
        <span aria-hidden>·</span>
        <span>based on {line.basedOn}</span>
        <span aria-hidden>·</span>
        <SaveIndicator
          id={stateId}
          snapshot={snapshot}
          uploading={uploading}
          savedLabel="Draft saved"
          savedTitle="Every edit is stored in the shared draft. It becomes part of the specification's history only when someone saves a revision."
        />
        <span aria-hidden>·</span>
        <span className={cn(uncommitted && "text-warning")}>
          {sourceDirty
            ? "Markdown not applied yet"
            : uncommitted
              ? line.isMain
                ? "Not saved as a revision yet"
                : "Uncommitted changes"
              : line.isMain
                ? `Same as ${line.basedOn}`
                : "All changes committed"}
        </span>
        <Editors peers={snapshot.peers} />
      </div>
      <RecoveredText
        store={recovery}
        editor={editor}
        editable={editable}
        documentName={draft.documentName}
        hidden={source !== null ? sourceEntryId : undefined}
      />
      {snapshot.closed === "replaced" && (
        <p
          role="status"
          className="rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground"
        >
          This draft was replaced (a revision or commit was saved another way).
          Opening the current draft…
        </p>
      )}
      {state.kind === "failed" && (
        <SaveFailedNotice reason={snapshot.refused} onReopen={onReopen} />
      )}
      {state.kind === "unavailable" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 text-[13px]"
        >
          <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 basis-60">
            <span className="font-medium">Live editing is unavailable.</span>{" "}
            <span className="text-muted-foreground">
              The collaboration service cannot be reached. Reading, history,
              discussions and reviews keep working.
            </span>
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => location.reload()}
          >
            <RefreshCw className="size-3.5" aria-hidden /> Retry
          </Button>
        </div>
      )}
      {view === "changes" && sourceDirty && (
        <p className="text-[13px] text-muted-foreground">
          Markdown you edited as text is not shown until it is applied (switch
          back to formatted text in the document).
        </p>
      )}
      {view === "changes" ? (
        draftUncommitted ? (
          <RevisionDiff before={line.headMarkdown} after={markdown()} />
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No uncommitted edits. Everything in this draft is committed.
          </p>
        )
      ) : (
        <div
          className={cn(
            "relative flex min-w-0 flex-col rounded-lg border bg-card focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10",
            !snapshot.everSynced && "opacity-60",
          )}
        >
          <div className="sticky top-0 z-10 rounded-t-[inherit] border-b bg-card/95 backdrop-blur">
            {editor && (
              <Toolbar
                editor={editor}
                disabled={!editable}
                label={`${label} formatting`}
                onFile={fileContext ? pickFile : undefined}
                onDecision={
                  references.organizationId
                    ? () => setDecisionOpen(true)
                    : undefined
                }
                source={{ active: source !== null, toggle: toggleSource }}
                className="rounded-none border-0 bg-transparent px-1.5 py-1 shadow-none"
              />
            )}
          </div>
          {conflict && (
            <SourceConflict
              chunks={conflict}
              onChoose={(choice) => {
                if (applySource(choice) === "applied")
                  requestAnimationFrame(() => editor?.commands.focus());
              }}
              onKeepEditing={() => setConflict(null)}
              onDiscard={discardSource}
            />
          )}
          {source !== null ? (
            <textarea
              value={source.text}
              onChange={(e) => {
                const text = e.target.value;
                setSource((edit) => (edit ? { ...edit, text } : edit));
              }}
              aria-label={`${label} (Markdown)`}
              spellCheck
              disabled={!editable}
              style={{ minHeight }}
              className="w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-6 outline-none touch:text-base"
            />
          ) : (
            <div
              className="min-w-0 cursor-text overflow-y-auto px-4 py-3"
              style={{ minHeight }}
            >
              <EditorContent
                editor={editor}
                className="h-full min-h-[inherit]"
              />
            </div>
          )}
          {uploading > 0 && (
            <p
              role="status"
              className="flex items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground"
            >
              <Loader className="size-3.5 animate-spin" aria-hidden />{" "}
              Uploading…
            </p>
          )}
        </div>
      )}
      {fileContext && (
        <input
          id={fileInputId}
          type="file"
          multiple
          accept={ACCEPT_FILES}
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (editor) upload(editor, files);
          }}
        />
      )}
      {footer({ editable, uncommitted, seal, close, discard })}
      <SuggestionMenu store={menus.slash} />
      <SuggestionMenu store={menus.items} />
      <SuggestionMenu store={menus.pages} />
      {decisionOpen && editor && (
        <DecisionPicker
          editor={editor}
          onClose={() => setDecisionOpen(false)}
        />
      )}
    </div>
  );
}

// Text kept on this device from an earlier session of this draft: copy it,
// insert it at the end of the current draft (an ordinary edit, only when
// asked) or discard it.
function RecoveredText({
  store,
  editor,
  editable,
  documentName,
  hidden,
}: {
  store: DraftRecoveryStore;
  editor: Editor | null;
  editable: boolean;
  documentName: string;
  // The entry of Markdown being edited right now in this editor.
  hidden?: string;
}) {
  const all = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const entries = all.filter((entry) => entry.id !== hidden);
  if (!entries.length) return null;
  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const blocks = insertableSpecificationBlocks(entry);
        const text = [entry.title?.trim(), entry.markdown.trim()]
          .filter(Boolean)
          .join("\n\n");
        const tooLarge =
          !!blocks &&
          new TextEncoder().encode(JSON.stringify(blocks)).length >
            DRAFT_UPDATE_BYTES;
        return (
          <section
            key={entry.id}
            role="status"
            aria-label="Unsaved text kept on this device"
            className="flex flex-wrap items-start gap-3 rounded-lg bg-muted px-3 py-2 text-[13px]"
          >
            <CircleAlert
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden
            />
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-medium">
                {entry.id.startsWith(SOURCE_ENTRY)
                  ? "Markdown you edited as text was not applied to the draft. Your text is kept on this device."
                  : entry.documentName === LEGACY_DOCUMENT
                    ? "Edits you kept in this browser before live editing are kept on this device."
                    : entry.documentName !== documentName
                      ? "This draft was replaced while you had changes it did not keep. Your text is kept on this device."
                      : "The editor closed before some of your changes reached the shared draft. Your text is kept on this device."}
              </p>
              <p className="mt-1 line-clamp-3 break-words whitespace-pre-wrap text-muted-foreground">
                {text}
              </p>
              {tooLarge && (
                <p className="mt-1 text-muted-foreground">
                  It is too large to insert at once. Copy it and paste it in
                  smaller parts.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(text).then(
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
              {blocks && !tooLarge && (
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

function ClosedNotice({
  snapshot,
  onClose,
}: {
  snapshot: SessionSnapshot;
  onClose: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-4 py-3 text-[13px]"
    >
      <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <p className="min-w-0 flex-1 basis-60 font-medium">
        {snapshot.closed
          ? SPECIFICATION_CLOSE_REASONS[snapshot.closed]
          : "The live draft closed."}
      </p>
      {snapshot.closed === "signedOut" ? (
        <a
          href={`/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
          className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Sign in
        </a>
      ) : (
        <Button size="sm" variant="secondary" onClick={onClose}>
          Back to the specification
        </Button>
      )}
    </div>
  );
}
