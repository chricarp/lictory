import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus, Pencil, PenLine } from "lucide-react";
import { relativeTime } from "@lictory/core/lib/work-items";
import { occurrenceIn } from "@lictory/core/editor/markdown-text";
import { CONTEXT_QUOTE_LIMIT } from "@lictory/core/intelligence/chat/shared";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { useDock } from "@lictory/platform/components/intelligence/dock/store";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Button } from "@lictory/ui/button";
import { MarkdownEditor } from "@lictory/platform/components/editor/markdown-editor";
import { Kbd, SectionLabel } from "@lictory/ui/primitives";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { RevisionDiff } from "@lictory/ui/diff";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useSpecDiscussions } from "@lictory/platform/components/review/spec-discussions";
import { threadMarks } from "@lictory/platform/components/review/markdown-marks";

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
  // Starts a branch to change the selected text (reviewable specifications).
  onSuggest?: (quote: string) => void;
}) {
  const { current, readOnly, canEdit, memberName, reviewable } = useItem();
  if (!current) return null;
  // Plain work (tasks, bugs) has a description that is edited directly; only
  // specifications are reviewed through suggestions and anchored discussions.
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>
          {reviewable ? "Specification" : "Description"}
        </SectionLabel>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          Revision {current.number} · {memberName(current.authorId)} ·{" "}
          {relativeTime(current.createdAt)}
        </span>
        {mode === "read" && !readOnly && (
          <div className="ml-auto flex items-center gap-1">
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

type Selected = QuoteDraft & { x: number; y: number };

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
  if (heading) before.setStartBefore(heading);
  else before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const rect = range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  return {
    x: rect.left - rootRect.left + rect.width / 2,
    y: rect.top - rootRect.top,
    quote,
    section: heading?.getAttribute("data-heading") ?? "",
    occurrence: occurrenceIn(before.toString() + text, quote),
  };
}

type QuoteDraft = { quote: string; section: string; occurrence: number };

// The thread under a pointer event, from the marks of discussed passages.
const threadAt = (target: EventTarget | null) =>
  (target as HTMLElement | null)
    ?.closest?.("mark[data-threads]")
    ?.getAttribute("data-threads")
    ?.split(" ")[0] ?? null;

function Reader({
  onQuote,
  onSuggest,
  onEdit,
}: {
  onQuote: (draft: QuoteDraft) => void;
  onSuggest?: (quote: string) => void;
  onEdit: () => void;
}) {
  const { item, current, readOnly, canEdit, reviewable } = useItem();
  const discussions = useSpecDiscussions();
  const dock = useDock();
  const { directory } = useWorkspace();
  const canAsk = !!dock && directory.ai.available && directory.ai.enabled;
  const canComment = !readOnly && reviewable;
  const rootRef = useRef<HTMLDivElement>(null);
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
    return ranges.length ? [threadMarks(ranges)] : undefined;
  }, [located]);
  // The selected thread and the one pointed at read stronger, here and in
  // the panel.
  const tinted = [discussions?.active, discussions?.hovered].filter(
    (id): id is string => Boolean(id),
  );
  const setHovered = discussions?.setHovered;
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
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- reads the text selection after a mouse selection and opens a marked passage's discussion; the panel offers both from the keyboard (docs/internals/accessibility.md).
        <div
          ref={rootRef}
          data-spec-root
          onMouseUp={onMouseUp}
          onClick={(event) => {
            const id = threadAt(event.target);
            if (!id || !discussions) return;
            if (!window.getSelection()?.isCollapsed) return;
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
          className="relative"
        >
          {tinted.length > 0 && (
            <style>
              {tinted
                .map(
                  (id) =>
                    `[data-spec-root] mark[data-threads~="${id}"]{background-color:color-mix(in oklch,var(--warning) 34%,transparent);box-shadow:0 1px 0 0 var(--warning)}[data-spec-root] mark.spec-anchor-blocking[data-threads~="${id}"]{background-color:color-mix(in oklch,var(--destructive) 24%,transparent);box-shadow:0 1px 0 0 var(--destructive)}`,
                )
                .join("")}
            </style>
          )}
          <Markdown source={content} marks={marks} />
          {selection && (canComment || canAsk || onSuggest) && (
            <div
              role="toolbar"
              aria-label="Selection actions"
              style={{ left: selection.x, top: selection.y - 40 }}
              className="absolute z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-(--shadow-panel)"
            >
              {canComment && (
                <Button
                  size="sm"
                  variant="ghost"
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
                </Button>
              )}
              {onSuggest && (
                <Button
                  size="sm"
                  variant="ghost"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSuggest(selection.quote);
                    setSelection(undefined);
                    window.getSelection()?.removeAllRanges();
                  }}
                >
                  <PenLine className="size-3.5" /> Suggest a change
                </Button>
              )}
              {canAsk && (
                <Button
                  size="sm"
                  variant="ghost"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => dock.open()}
                >
                  <IntelligenceMark className="size-3.5 text-primary" /> Ask
                  Litto
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Edits and suggestions share the editor. Saving creates a revision against the
// exact base; if the base moved while typing the user sees a diff, never a merge.
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
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What changed? (optional)"
          aria-label="Change summary"
          className="h-9 w-full rounded-md border bg-card px-3 text-sm outline-none focus:border-primary/60 touch:text-base"
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
