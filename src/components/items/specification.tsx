"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MessageSquarePlus, Pencil, PenLine, Plus } from "lucide-react";
import { cn } from "~/lib/utils";
import { relativeTime } from "~/lib/work-items";
import {
  appendAcceptanceCriterion,
  parseAcceptanceCriteria,
  splitSpecification,
} from "~/sync/shared/specification";
import { Button } from "~/components/ui/button";
import { MarkdownEditor } from "~/components/ui/markdown-editor";
import { Kbd, SectionLabel } from "~/components/ui/primitives";
import { Markdown } from "./markdown";
import { RevisionDiff } from "./diff";
import { useItem } from "./item-context";

type Mode = "read" | "edit";

export function Specification({
  mode,
  setMode,
  onQuote,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  onQuote: (quote: string, section: string) => void;
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
        <Reader onQuote={onQuote} onEdit={() => canEdit && setMode("edit")} />
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
  onEdit,
}: {
  onQuote: (quote: string, section: string) => void;
  onEdit: () => void;
}) {
  const { current, threads, readOnly, canEdit, mutate, base, reviewable } =
    useItem();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    x: number;
    y: number;
    quote: string;
    section: string;
  }>();
  const content = current?.content ?? "";
  const { body } = splitSpecification(content);
  const { criteria } = parseAcceptanceCriteria(content);
  const isEmpty = !content.trim();
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
      const quote = sel.toString().replace(/\s+/g, " ").trim().slice(0, 2000);
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
    for (const thread of open) {
      const range = findRange(root, thread.anchor!.quote!);
      if (range) (thread.blocking ? blocking : normal).push(range);
    }
    highlights.set("lictory-anchor", new HighlightCtor(...normal));
    highlights.set("lictory-anchor-blocking", new HighlightCtor(...blocking));
    return () => {
      highlights.delete("lictory-anchor");
      highlights.delete("lictory-anchor-blocking");
    };
  }, [threads, content]);
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
        <div
          ref={rootRef}
          data-spec-root
          onMouseUp={onMouseUp}
          className="relative"
        >
          <Markdown source={body} />
          {selection && !readOnly && reviewable && (
            <div
              role="toolbar"
              aria-label="Selection actions"
              style={{ left: selection.x, top: selection.y - 40 }}
              className="absolute z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-(--shadow-panel)"
            >
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
                <MessageSquarePlus className="size-3.5" /> Comment on selection
              </Button>
            </div>
          )}
        </div>
      )}
      <AcceptanceCriteria
        criteria={criteria}
        readOnly={!canEdit}
        onAdd={(text) =>
          current
            ? mutate({
                type: "updateSpecification",
                ...base,
                title: current.title,
                content: appendAcceptanceCriterion(current.content, text),
                summary: "Added acceptance criterion",
              })
            : Promise.resolve("")
        }
      />
    </div>
  );
}

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

function AcceptanceCriteria({
  criteria,
  readOnly,
  onAdd,
}: {
  criteria: { text: string; checked: boolean }[];
  readOnly: boolean;
  onAdd: (text: string) => Promise<unknown>;
}) {
  const { type, reviewable } = useItem();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  // Criteria are a readiness check for specifications below the top level.
  if ((!reviewable || type.level >= 2) && criteria.length === 0) return null;
  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Acceptance criteria</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {criteria.length}
        </span>
      </div>
      {criteria.length === 0 && !adding && (
        <p className="mb-2 text-[13px] text-muted-foreground">
          None yet. Criteria make the {type.name.toLowerCase()} testable and are
          a readiness check.
        </p>
      )}
      <ul className="space-y-1">
        {criteria.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-[15px] leading-7">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 grid size-4 shrink-0 place-items-center rounded border text-[10px]",
                c.checked
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-muted-foreground/50",
              )}
            >
              {c.checked && "✓"}
            </span>
            <span
              className={cn(c.checked && "text-muted-foreground line-through")}
            >
              {c.text}
            </span>
          </li>
        ))}
      </ul>
      {!readOnly &&
        (adding ? (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!value.trim()) return;
              setSaving(true);
              try {
                await onAdd(value.trim());
                setValue("");
              } finally {
                setSaving(false);
              }
            }}
          >
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              placeholder="Given…, when…, then… (Enter to add)"
              aria-label="New acceptance criterion"
              className="h-8 flex-1 rounded-md border bg-card px-2 text-sm outline-none focus:border-primary/60"
            />
            <Button type="submit" size="sm" disabled={saving || !value.trim()}>
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Done
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" /> Add criterion
          </button>
        ))}
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
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[13px]">
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
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") onDone();
        }}
        spellCheck
        aria-label="Specification"
        placeholder={
          "# Intent\n\nWhy this matters and for whom.\n\n## Behavior\n\n…\n\n## Acceptance criteria\n\n- [ ] …"
        }
        className="min-h-[320px] px-4 pt-4 font-mono"
        previewClassName="min-h-[320px] px-4 pt-4"
        style={{ fieldSizing: "content" }}
      />
      {mode === "edit" && (
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What changed? (optional)"
          aria-label="Change summary"
          className="h-9 w-full rounded-md border bg-card px-3 text-sm outline-none focus:border-primary/60"
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
