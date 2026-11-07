import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  CircleAlert,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  PenLine,
} from "lucide-react";
import { relativeTime } from "@lictory/core/lib/work-items";
import { cn } from "@lictory/core/lib/utils";
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
import {
  SpecificationDraftEditor,
  useSpecificationDraft,
} from "@lictory/platform/components/items/specification-draft";
import type { LiveControls } from "@lictory/platform/components/items/live-specification";
import { SPECIFICATION_CLOSE_REASONS } from "@lictory/core/spaces/collaboration-protocol";

type Mode = "read" | "edit";

export function Specification({
  mode,
  setMode,
  onQuote,
  onSuggest,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  onQuote: (quote: string, section: string) => void;
  // Starts a branch to change the selected text (reviewable specifications).
  onSuggest?: (quote: string) => void;
}) {
  const { current, readOnly, canEdit, memberName, reviewable } = useItem();
  const mainDraft = useSpecificationDraft();
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
            {/* Stored edits in main's live draft that no revision holds
                yet: only people who may edit main see (and open) them. */}
            {canEdit && reviewable && mainDraft?.uncommittedChanges && (
              <button
                type="button"
                onClick={() => setMode("edit")}
                title="Edits in the live draft are saved but not yet a revision. Open the editor to review and save them."
                className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warning/10 px-2.5 text-xs font-medium text-warning outline-none hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-warning"
                />
                Unsaved draft changes
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
function sectionFor(node: Node | null): string {
  let element: Element | null =
    node instanceof Element ? node : (node?.parentElement ?? null);
  while (element && !element.parentElement?.classList.contains("spec-prose"))
    element = element.parentElement;
  while (element) {
    const heading = element.getAttribute("data-heading");
    if (heading) return heading;
    element = element.previousElementSibling;
  }
  return "";
}

function Reader({
  onQuote,
  onSuggest,
  onEdit,
}: {
  onQuote: (quote: string, section: string) => void;
  onSuggest?: (quote: string) => void;
  onEdit: () => void;
}) {
  const { item, current, threads, readOnly, canEdit, reviewable } = useItem();
  const dock = useDock();
  const { directory } = useWorkspace();
  const canAsk = !!dock && directory.ai.available && directory.ai.enabled;
  const canComment = !readOnly && reviewable;
  const rootRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    x: number;
    y: number;
    quote: string;
    section: string;
  }>();
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
      const sel = window.getSelection();
      if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0)
        return setSelection(undefined);
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer))
        return setSelection(undefined);
      const quote = sel
        .toString()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, CONTEXT_QUOTE_LIMIT);
      if (quote.length < 2) return setSelection(undefined);
      const rect = range.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      setSelection({
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top,
        quote,
        section: sectionFor(range.startContainer),
      });
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
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [layout, setLayout] = useState(0);
  // Highlight quoted text of open discussions where the browser supports the
  // CSS Custom Highlight API. Purely progressive: threads still show quotes.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const highlights = (
      globalThis as { CSS?: { highlights?: Map<string, unknown> } }
    ).CSS?.highlights;
    const HighlightCtor = (
      globalThis as { Highlight?: new (...ranges: Range[]) => unknown }
    ).Highlight;
    if (!root || !highlights || !HighlightCtor) return;
    // The bundler's CSS parser rejects ::highlight(), so the rules live next to
    // the feature check instead of in the stylesheet.
    if (!document.getElementById("lictory-highlights")) {
      const style = document.createElement("style");
      style.id = "lictory-highlights";
      style.textContent =
        "::highlight(lictory-anchor){background-color:oklch(0.85 0.15 85 / 0.35)}::highlight(lictory-anchor-blocking){background-color:oklch(0.7 0.19 25 / 0.28)}";
      document.head.append(style);
    }
    const open = threads.filter((t) => t.status === "open" && t.anchor?.quote);
    const blocking: Range[] = [];
    const normal: Range[] = [];
    const found: Marker[] = [];
    const origin = root.getBoundingClientRect().top;
    for (const thread of open) {
      const range = findRange(root, thread.anchor!.quote!);
      if (!range) continue;
      (thread.blocking ? blocking : normal).push(range);
      const line = range.getClientRects()[0];
      if (line)
        found.push({
          id: thread.id,
          top: line.top - origin + line.height / 2,
          blocking: thread.blocking,
          quote: thread.anchor!.quote!,
        });
    }
    setMarkers(found);
    highlights.set("lictory-anchor", new HighlightCtor(...normal));
    highlights.set("lictory-anchor-blocking", new HighlightCtor(...blocking));
    return () => {
      highlights.delete("lictory-anchor");
      highlights.delete("lictory-anchor-blocking");
    };
  }, [threads, content, layout]);
  // Markers follow the text when the column reflows.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    let width = root.clientWidth;
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === width) return;
      width = root.clientWidth;
      setLayout((n) => n + 1);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [isEmpty]);
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
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- reads the text selection after a mouse selection; see the known gaps in docs/internals/accessibility.md.
        <div
          ref={rootRef}
          data-spec-root
          onMouseUp={onMouseUp}
          className="relative"
        >
          <Markdown source={content} />
          {/* Each highlighted sentence gets a marker in the gutter that opens
              its discussion, so the highlight never needs explaining. */}
          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              aria-label={`${marker.blocking ? "Blocking discussion" : "Discussion"} on “${marker.quote}”`}
              title={marker.blocking ? "Blocking discussion" : "Discussion"}
              style={{ top: marker.top }}
              onClick={() => {
                const target = document.querySelector<HTMLElement>(
                  `[data-thread-id="${marker.id}"]`,
                );
                target?.scrollIntoView({ block: "center", behavior: "smooth" });
                target?.focus({ preventScroll: true });
              }}
              className={cn(
                "absolute -left-7 hidden size-5 -translate-y-1/2 place-items-center rounded-full shadow-(--shadow-border) transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 lg:grid",
                marker.blocking
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {marker.blocking ? (
                <CircleAlert aria-hidden className="size-3" />
              ) : (
                <MessageSquare aria-hidden className="size-3" />
              )}
            </button>
          ))}
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
                    onQuote(selection.quote, selection.section);
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

type Marker = { id: string; top: number; blocking: boolean; quote: string };

// Finds the first occurrence of `text` in the rendered document as a Range,
// tolerating whitespace differences produced by rendering.
function findRange(root: HTMLElement, text: string): Range | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let full = "";
  const offsets: number[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    offsets.push(full.length);
    full += (n as Text).data;
  }
  const normalized = full.replace(/\s+/g, " ");
  const map: number[] = [];
  let j = 0;
  for (let i = 0; i < full.length; i++) {
    if (
      /\s/.test(full[i]!) &&
      j > 0 &&
      normalized[j - 1] === " " &&
      /\s/.test(full[i - 1] ?? "")
    )
      continue;
    map[j++] = i;
  }
  const start = normalized.indexOf(text.replace(/\s+/g, " "));
  if (start === -1) return undefined;
  const end = start + text.replace(/\s+/g, " ").length - 1;
  const locate = (index: number) => {
    const raw = map[index] ?? full.length - 1;
    let k = nodes.length - 1;
    while (k > 0 && offsets[k]! > raw) k--;
    return { node: nodes[k]!, offset: raw - offsets[k]! };
  };
  const from = locate(start);
  const to = locate(end);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, Math.min(to.node.data.length, to.offset + 1));
  return range;
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
            ? "This specification is ready, so main is protected. Changes go through a branch and a reviewed pull request."
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
      <input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
        }}
        placeholder="What changed? (optional)"
        aria-label="Change summary"
        maxLength={500}
        className="h-9 w-full rounded-md border bg-card px-3 text-sm outline-none focus:border-primary/60 touch:text-base"
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
          title="Back to the specification. The draft stays saved."
          onClick={onDone}
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
        Saving creates an immutable revision. Existing approvals are marked
        outdated and reviews are re-requested. Until then your edits are shared
        with everyone editing, never a revision.
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
