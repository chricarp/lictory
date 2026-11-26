import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input } from "@ui-sdk/react/input";
import { Toolbar, ToolbarButton } from "@ui-sdk/react/toolbar";
import { MessageSquarePlus, Pencil, PenLine } from "lucide-react";
import { byType, relativeTime } from "@lictory/core/lib/work-items";
import { occurrenceIn } from "@lictory/core/editor/markdown-text";
import { CONTEXT_QUOTE_LIMIT } from "@lictory/core/intelligence/chat/shared";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { useDock } from "@lictory/platform/components/intelligence/dock/store";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Button, buttonClass } from "@lictory/ui/button";
import { MarkdownEditor } from "@lictory/platform/components/editor/markdown-editor";
import { Kbd, SectionLabel } from "@lictory/ui/primitives";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { RevisionDiff } from "@lictory/ui/diff";
import { useItem } from "@lictory/platform/components/items/item-context";
import {
  SpecificationDraftEditor,
  useSpecificationDraft,
} from "@lictory/platform/components/items/specification-draft";
import type { LiveControls } from "@lictory/platform/components/items/live-specification";
import { SPECIFICATION_CLOSE_REASONS } from "@lictory/core/spaces/collaboration-protocol";
import { useSpecDiscussions } from "@lictory/platform/components/review/spec-discussions";
import {
  suggestionMarks,
  threadMarks,
} from "@lictory/platform/components/review/markdown-marks";
import {
  suggestionRanges,
  useOpenSuggestions,
} from "@lictory/platform/components/review/inline-suggestions";
import {
  commentShortcut,
  keyboardSelect,
  keyboardSelectionHint,
} from "@lictory/platform/lib/keyboard-selection";

type Mode = "read" | "edit";

export function Specification({
  mode,
  setMode,
  onQuote,
  onSuggest,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  // Starts a discussion on the selected passage.
  onQuote: (draft: QuoteDraft) => void;
  // Suggests a change of the selected text (reviewable specifications).
  onSuggest?: (draft: QuoteDraft) => void;
}) {
  const { current, readOnly, canEdit, memberName, reviewable, entities } =
    useItem();
  const mainDraft = useSpecificationDraft();
  if (!current) return null;
  // A revision a pull request's merge published: its text is the pull
  // request author's; the revision's author merged it.
  const mergedFrom = byType(entities, "pullRequest").find(
    (p) =>
      p.status === "merged" &&
      byType(entities, "specCommit").some(
        (c) => c.id === p.mergedCommitId && c.revisionId === current.id,
      ),
  );
  // Plain work (tasks, bugs) has a description that is edited directly; only
  // specifications are reviewed through suggestions and anchored discussions.
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>
          {reviewable ? "Specification" : "Description"}
        </SectionLabel>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          Revision {current.number} ·{" "}
          {mergedFrom && mergedFrom.authorId !== current.authorId
            ? `${memberName(mergedFrom.authorId)}'s proposed change, applied by ${memberName(current.authorId)}`
            : memberName(current.authorId)}{" "}
          · {relativeTime(current.createdAt)}
        </span>
        {mode === "read" && !readOnly && (
          <div className="ml-auto flex items-center gap-1">
            {/* Stored edits in main's live draft that no revision holds
                yet: only people who may edit main see (and open) them. */}
            {canEdit && reviewable && mainDraft?.uncommittedChanges && (
              <button
                type="button"
                onClick={() => setMode("edit")}
                title="Edits in the shared draft are saved but not saved as a revision yet. Open the editor to review and save them."
                className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warning/10 px-2.5 text-xs font-medium text-warning outline-none hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-warning"
                />
                Draft not saved as a revision
              </button>
            )}
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setMode("edit")}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
          </div>
        )}
      </div>
      {mode === "read" ? (
        <Reader
          onQuote={onQuote}
          onSuggest={reviewable && !readOnly ? onSuggest : undefined}
          onEdit={() => canEdit && setMode("edit")}
        />
      ) : reviewable ? (
        <LiveEditor onDone={() => setMode("read")} />
      ) : (
        <Editor mode={mode} onDone={() => setMode("read")} />
      )}
    </section>
  );
}

// Nearest heading above the selection: climb to the block inside the rendered
// document, then walk back through previous siblings.
function headingFor(node: Node | null): Element | null {
  let element: Element | null =
    node instanceof Element ? node : (node?.parentElement ?? null);
  while (element && !element.parentElement?.classList.contains("spec-prose"))
    element = element.parentElement;
  while (element) {
    if (element.getAttribute("data-heading")) return element;
    element = element.previousElementSibling;
  }
  return null;
}

// Where the selection's actions sit: x is the centre, y the top edge.
type Selected = QuoteDraft & { x: number; y: number };
// The actions' height and their distance from the selected lines (px).
const SELECTION_BAR = 34;
const SELECTION_GAP = 6;

// The selected passage as an anchor: its quote, the heading it is under and
// which copy of those words under that heading it is (so repeated words
// never point at another passage).
function selectedPassage(root: HTMLElement): Selected | undefined {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const text = sel.toString();
  const quote = text.replace(/\s+/g, " ").trim().slice(0, CONTEXT_QUOTE_LIMIT);
  if (quote.length < 2) return;
  const heading = headingFor(range.startContainer);
  const before = document.createRange();
  // Counted from the text itself: the selection actions sit before it.
  if (heading) before.setStartBefore(heading);
  else before.setStart(root.querySelector(".spec-prose") ?? root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const rect = range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  // The actions open under the selection, so the passage and the lines
  // that lead to it stay readable while the reader decides; above it only
  // when the window has no room below.
  const below =
    rect.bottom + SELECTION_GAP + SELECTION_BAR < window.innerHeight;
  return {
    x: rect.left - rootRect.left + rect.width / 2,
    y: below
      ? rect.bottom - rootRect.top + SELECTION_GAP
      : rect.top - rootRect.top - SELECTION_GAP - SELECTION_BAR,
    quote,
    section: heading?.getAttribute("data-heading") ?? "",
    occurrence: occurrenceIn(before.toString() + text, quote),
  };
}

export type QuoteDraft = { quote: string; section: string; occurrence: number };

// The thread under a pointer event, from the marks of discussed passages.
const selectionAction = buttonClass({ variant: "ghost", size: "sm" });

const threadAt = (target: EventTarget | null) =>
  (target as HTMLElement | null)
    ?.closest?.("mark[data-threads]")
    ?.getAttribute("data-threads")
    ?.split(" ")[0] ?? null;

const suggestionAt = (target: EventTarget | null) =>
  (target as HTMLElement | null)
    ?.closest?.("mark[data-suggestions]")
    ?.getAttribute("data-suggestions")
    ?.split(" ")[0] ?? null;

function Reader({
  onQuote,
  onSuggest,
  onEdit,
}: {
  onQuote: (draft: QuoteDraft) => void;
  onSuggest?: (draft: QuoteDraft) => void;
  onEdit: () => void;
}) {
  const { item, current, readOnly, canEdit, reviewable } = useItem();
  const suggestions = useOpenSuggestions();
  const discussions = useSpecDiscussions();
  const dock = useDock();
  const { directory } = useWorkspace();
  const canAsk = !!dock && directory.ai.available && directory.ai.enabled;
  const canComment = !readOnly && reviewable;
  const rootRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [selection, setSelection] = useState<Selected>();
  const content = current?.content ?? "";
  const isEmpty = !content.trim();
  // The dock follows the selection so it can offer to explain it.
  useEffect(() => {
    if (!dock) return;
    dock.setSelection(
      selection
        ? {
            itemId: item.id,
            quote: selection.quote,
            section: selection.section,
          }
        : null,
    );
  }, [dock, item.id, selection]);
  useEffect(() => () => dock?.setSelection(null), [dock]);
  const onMouseUp = useCallback(() => {
    // Defer so the browser has finalized the selection.
    requestAnimationFrame(() => {
      const root = rootRef.current;
      setSelection(root ? selectedPassage(root) : undefined);
    });
  }, []);
  useEffect(() => {
    const clear = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSelection(undefined);
    };
    document.addEventListener("selectionchange", clear);
    return () => document.removeEventListener("selectionchange", clear);
  }, []);
  // Mod+Alt+M comments on the selected text, as in the page editor; without
  // a selection it opens the discussions at the composer.
  useEffect(() => {
    if (!canComment) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      if (event.code !== "KeyM") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[contenteditable=true], input, textarea")) return;
      const root = rootRef.current;
      const passage = root ? selectedPassage(root) : undefined;
      event.preventDefault();
      if (passage) {
        const { quote, section, occurrence } = passage;
        onQuote({ quote, section, occurrence });
        setSelection(undefined);
        window.getSelection()?.removeAllRanges();
        return;
      }
      discussions?.setPanelOpen(true);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            '[data-discussions] [role="textbox"][aria-label="Start a discussion"], [data-discussions] textarea[aria-label="Start a discussion"]',
          )
          ?.focus(),
      );
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canComment, onQuote, discussions]);
  // Open discussions whose passage is on screen, marked in the text.
  const located = discussions?.located;
  const marks = useMemo(() => {
    const ranges = (located ?? [])
      .filter((l) => l.placement === "here" && l.thread.status === "open")
      .map((l) => ({
        from: l.from!,
        to: l.to!,
        data: { threadId: l.thread.id, blocking: l.thread.blocking },
      }));
    // Passages a suggested change rewrites (reviewable specifications).
    const suggested = reviewable
      ? suggestionRanges(
          content,
          current?.id,
          suggestions.filter((x) => x.status === "open"),
        )
      : [];
    const plugins = [
      ...(ranges.length ? [threadMarks(ranges)] : []),
      ...(suggested.length ? [suggestionMarks(suggested)] : []),
    ];
    return plugins.length ? plugins : undefined;
  }, [located, reviewable, content, current?.id, suggestions]);
  // The selected thread and the one pointed at read stronger, here and in
  // the panel.
  const tinted = [discussions?.active, discussions?.hovered].filter(
    (id): id is string => Boolean(id),
  );
  const setHovered = discussions?.setHovered;
  // The selection actions stay inside the text's column (a discussions
  // column or the window edge would cut them off), also while it resizes.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const selectionX = selection?.x;
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const column = toolbar?.parentElement;
    if (!toolbar || !column || selectionX === undefined) return;
    const place = () => {
      const half = toolbar.offsetWidth / 2;
      const max = column.clientWidth - half;
      toolbar.style.left = `${Math.max(half, Math.min(selectionX, max))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(column);
    return () => observer.disconnect();
  }, [selectionX]);
  return (
    <div className="relative">
      {isEmpty ? (
        <button
          type="button"
          onClick={onEdit}
          disabled={readOnly}
          className="w-full rounded-md border border-dashed px-4 py-8 text-left text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:pointer-events-none"
        >
          <PenLine className="mb-2 size-4" />
          {canEdit
            ? "Describe the intent, the expected behavior and what is out of scope. Markdown is supported. Click to start writing."
            : "Nothing written yet. Click to propose a first draft for review."}
        </button>
      ) : (
        // The text is one tab stop: arrow keys select words in it (Shift
        // extends), Tab reaches the selection actions, Mod+Alt+M comments
        // and Enter on a marked passage opens its discussion
        // (lib/keyboard-selection.ts, docs/internals/accessibility.md).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keyboard path is onKeyDown below; clicks read a mouse selection or open a marked passage's discussion.
        <div
          ref={rootRef}
          data-spec-root
          role="document"
          aria-label={reviewable ? "Specification text" : "Description text"}
          aria-describedby={hintId}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a document the arrow keys select text in (onKeyDown below).
          tabIndex={0}
          onKeyDown={(event) => {
            const root = rootRef.current;
            if (!root) return;
            if (keyboardSelect(root, event.nativeEvent)) {
              event.preventDefault();
              setSelection(selectedPassage(root));
              return;
            }
            // Enter on a marked passage opens its discussion.
            if (event.key !== "Enter" || event.target !== root) return;
            const node = window.getSelection()?.anchorNode;
            const id = threadAt(
              node instanceof Element ? node : (node?.parentElement ?? null),
            );
            if (!id || !discussions) return;
            event.preventDefault();
            discussions.setActive(id);
            discussions.setPanelOpen(true);
          }}
          onMouseUp={onMouseUp}
          onClick={(event) => {
            if (!discussions) return;
            if (!window.getSelection()?.isCollapsed) return;
            const suggestion = suggestionAt(event.target);
            if (suggestion) {
              discussions.setActiveSuggestion(suggestion);
              discussions.setPanelOpen(true);
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLElement>(
                    `[data-suggestion-id="${CSS.escape(suggestion)}"]`,
                  )
                  ?.focus(),
              );
              return;
            }
            const id = threadAt(event.target);
            if (!id) return;
            discussions.setActive(id);
            discussions.setPanelOpen(true);
          }}
          // Pointing at a passage marks its thread; keyboard users select
          // threads in the panel, which marks the passage too.
          // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
          onMouseOver={
            setHovered
              ? (event) => setHovered(threadAt(event.target))
              : undefined
          }
          onMouseLeave={setHovered ? () => setHovered(null) : undefined}
          className="group/reader relative rounded-sm focus-ring outline-none"
        >
          {tinted.length > 0 && (
            <style>
              {tinted
                .map(
                  (id) =>
                    `[data-spec-root] mark[data-threads~="${id}"]{background-color:color-mix(in oklch,var(--warning) 34%,transparent);box-shadow:inset 0 -3px 0 var(--warning)}[data-spec-root] mark.spec-anchor-blocking[data-threads~="${id}"]{background-color:color-mix(in oklch,var(--destructive) 24%,transparent);box-shadow:inset 0 -3px 0 var(--destructive)}`,
                )
                .join("")}
            </style>
          )}
          {discussions?.activeSuggestion && (
            <style>
              {`[data-spec-root] mark[data-suggestions~="${CSS.escape(discussions.activeSuggestion)}"]{background-color:color-mix(in oklch,var(--primary) 12%,transparent)}`}
            </style>
          )}
          {/* Before the text, so Tab from a keyboard selection reaches
              it first; placed under the selection (selectedPassage). */}
          {selection && (canComment || canAsk || onSuggest) && (
            <Toolbar
              ref={toolbarRef}
              aria-label="Selection actions"
              data-selection-skip
              style={{ left: selection.x, top: selection.y }}
              className="absolute z-10 flex max-w-none -translate-x-1/2 flex-nowrap items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-(--shadow-panel)"
            >
              {canComment && (
                <ToolbarButton
                  className={selectionAction}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const { quote, section, occurrence } = selection;
                    onQuote({ quote, section, occurrence });
                    setSelection(undefined);
                    window.getSelection()?.removeAllRanges();
                  }}
                >
                  <MessageSquarePlus className="size-3.5" /> Comment on
                  selection
                </ToolbarButton>
              )}
              {onSuggest && (
                <ToolbarButton
                  className={selectionAction}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const { quote, section, occurrence } = selection;
                    onSuggest({ quote, section, occurrence });
                    setSelection(undefined);
                    window.getSelection()?.removeAllRanges();
                  }}
                >
                  <PenLine className="size-3.5" /> Suggest a change
                </ToolbarButton>
              )}
              {canAsk && (
                <ToolbarButton
                  className={selectionAction}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => dock.open()}
                >
                  <IntelligenceMark className="size-3.5 text-primary" /> Ask
                  Litto
                </ToolbarButton>
              )}
            </Toolbar>
          )}
          <Markdown source={content} marks={marks} />
          <p
            id={hintId}
            data-selection-skip
            className="mt-3 hidden text-xs leading-4 text-muted-foreground group-focus-visible/reader:block"
          >
            {keyboardSelectionHint} Tab reaches the selection actions,{" "}
            {commentShortcut} comments on the selection, Enter on a marked
            passage opens its discussion.
          </p>
        </div>
      )}
    </div>
  );
}

// Main's live draft (docs/internals/specification-drafts.md): everyone who
// may edit main types into one shared draft, saved as they type; "Save
// revision" seals what is stored into the next revision. "Close editor"
// leaves the draft saved.
function LiveEditor({ onDone }: { onDone: () => void }) {
  const { current, revisions, item, canEdit } = useItem();
  const submitRef = useRef<(() => void) | null>(null);
  // Editing ended while the editor was open: main became protected, or my
  // disciplines no longer edit specifications.
  if (!canEdit)
    return (
      <div
        role="alert"
        className="space-y-2 rounded-md border border-dashed px-4 py-6 text-sm"
      >
        <p>
          {item.mainProtected
            ? "This specification is ready, so it is protected: changes are proposed and reviewed before they apply. Open Proposed changes to start one."
            : SPECIFICATION_CLOSE_REASONS.revoked}
        </p>
        <Button size="sm" variant="secondary" onClick={onDone}>
          Back to the specification
        </Button>
      </div>
    );
  return (
    <SpecificationDraftEditor
      line={{
        headTitle: current?.title ?? item.title,
        headMarkdown: current?.content ?? "",
        basedOn: `revision ${current?.number ?? 1}`,
        isMain: true,
      }}
      label="Specification"
      placeholder="Why this matters and for whom, the expected behavior, failure behavior and acceptance criteria. Type / for headings, lists and references."
      fileContext={{ organizationId: item.organizationId, workItemId: item.id }}
      onClose={onDone}
      onSubmit={() => submitRef.current?.()}
      footer={(controls) => (
        <SaveRevision
          controls={controls}
          next={(revisions[0]?.number ?? 0) + 1}
          submitRef={submitRef}
          onDone={onDone}
        />
      )}
    />
  );
}

function SaveRevision({
  controls,
  next,
  submitRef,
  onDone,
}: {
  controls: LiveControls;
  next: number;
  submitRef: { current: (() => void) | null };
  onDone: () => void;
}) {
  const { base } = useItem();
  const draft = useSpecificationDraft();
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<"saving" | "discarding" | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async () => {
    if (!draft || pending) return;
    setPending("saving");
    setError(undefined);
    try {
      await controls.seal((expectedSequence) => ({
        type: "commitSpecificationDraft",
        workItemId: base.workItemId,
        draftId: draft.id,
        epoch: draft.epoch,
        expectedSequence,
        ...(summary.trim() ? { message: summary.trim() } : {}),
      }));
      // Someone who went elsewhere meanwhile stays there.
      if (mounted.current) onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(null);
    }
  };
  useEffect(() => {
    submitRef.current = () => void save();
    return () => {
      submitRef.current = null;
    };
  });
  return (
    <div className="space-y-3">
      <Input
        value={summary}
        onValueChange={setSummary}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
        }}
        placeholder="What changed? (optional)"
        aria-label="Change summary"
        maxLength={500}
        className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary/60 touch:text-base"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {controls.uncommitted &&
          (confirmDiscard ? (
            <span className="mr-auto inline-flex flex-wrap items-center gap-2 text-xs">
              Discard the unsaved changes for everyone editing?
              <Button
                variant="ghost"
                size="sm"
                disabled={pending !== null}
                onClick={() => {
                  setPending("discarding");
                  setError(undefined);
                  void controls
                    .discard()
                    .catch((e: unknown) =>
                      setError(
                        e instanceof Error ? e.message : "Could not discard.",
                      ),
                    )
                    .finally(() => {
                      setPending(null);
                      setConfirmDiscard(false);
                    });
                }}
              >
                Discard changes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep them
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => setConfirmDiscard(true)}
            >
              Discard changes…
            </Button>
          ))}
        <Button
          variant="ghost"
          size="md"
          title="Back to the specification. The shared draft stays saved; it is not a revision until someone saves one."
          onClick={controls.close}
        >
          Close editor
        </Button>
        <Button
          size="md"
          onClick={() => void save()}
          disabled={pending !== null || !controls.editable || !draft}
        >
          {pending === "saving"
            ? `Saving revision ${next}…`
            : `Save revision ${next}`}
          <Kbd>⌘↵</Kbd>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Edits are saved to the shared draft as you type (“Draft saved”) and
        everyone editing sees them, but they are not part of the specification’s
        history until someone saves a revision. Saving revision {next} makes it
        immutable: existing approvals are marked outdated and reviews are
        re-requested.
      </p>
    </div>
  );
}

// Plain work items (no specification): the description is edited directly.
// Saving creates a revision against the exact base; if the base moved while
// typing the user sees a diff, never a merge.
function Editor({ mode, onDone }: { mode: "edit"; onDone: () => void }) {
  const { current, mutate, base, revisions, item } = useItem();
  const [baseRevision] = useState(current!);
  const [content, setContent] = useState(current?.content ?? "");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const conflicted = current && current.id !== baseRevision.id;
  const submit = async () => {
    if (!current) return;
    setPending(true);
    setError(undefined);
    try {
      await mutate({
        type: "updateSpecification",
        workItemId: base.workItemId,
        baseRevisionId: baseRevision.id,
        title: baseRevision.title,
        content,
        summary: summary.trim() || undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-3">
      {conflicted && (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[13px]">
          <p>
            Revision {current.number} was saved while you were editing revision{" "}
            {baseRevision.number}. Your text is kept; review the difference
            before saving.
          </p>
          <RevisionDiff before={content} after={current.content} />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setContent(current.content);
              onDone();
            }}
          >
            Discard my edits and load revision {current.number}
          </Button>
        </div>
      )}
      <MarkdownEditor
        fileContext={{
          organizationId: item.organizationId,
          workItemId: item.id,
        }}
        autoFocus
        value={content}
        onValueChange={setContent}
        onSubmit={() => void submit()}
        onEscape={onDone}
        aria-label="Specification"
        placeholder="Why this matters and for whom, the expected behavior, failure behavior and acceptance criteria. Type / for headings, lists and references."
        minHeight="20rem"
      />
      {mode === "edit" && (
        <Input
          value={summary}
          onValueChange={setSummary}
          placeholder="What changed? (optional)"
          aria-label="Change summary"
          className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary/60 touch:text-base"
        />
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="md"
          onClick={() => void submit()}
          disabled={pending || conflicted}
        >
          {`Save revision ${(revisions[0]?.number ?? 0) + 1}`}
          <Kbd>⌘↵</Kbd>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {mode === "edit"
          ? "Saving creates an immutable revision. Existing approvals are marked outdated and reviews are re-requested."
          : "Reviewers see the proposal as a diff, discuss it and approve it; an assigned reviewer then merges it as the next revision."}
      </p>
    </div>
  );
}
