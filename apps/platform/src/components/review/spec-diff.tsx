import { useMemo, useState } from "react";
import { cn } from "@lictory/core/lib/utils";
import {
  diffMarkdown,
  type BlockChange,
  type DiffBlock,
} from "@lictory/core/editor/markdown-diff";
import { changedWords, type TextRange } from "@lictory/core/editor/word-diff";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { wordMarks } from "@lictory/platform/components/review/markdown-marks";

// What changed between two specification texts, as people read them: the
// blocks that changed, before and after, with the changed words marked
// inside an edited block (the same presentation as page history). Long
// runs of unchanged text fold away; "Show full text" reads the whole
// result with the changes in place. Presentation only: revisions, merges
// and conflicts stay line based.

export type DiffView = "changes" | "full";

export function SpecDiff({
  before,
  after,
  beforeLabel = "Before",
  afterLabel = "After",
  view: controlled,
  onViewChange,
  className,
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  view?: DiffView;
  onViewChange?: (view: DiffView) => void;
  className?: string;
}) {
  const [own, setOwn] = useState<DiffView>("changes");
  const view = controlled ?? own;
  const setView = onViewChange ?? setOwn;
  const changes = useMemo(() => diffMarkdown(before, after), [before, after]);
  const count = changes.reduce(
    (sum, change) =>
      change.kind === "unchanged"
        ? sum
        : sum + (change.kind === "changed" ? 1 : change.blocks.length),
    0,
  );
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {count === 1 ? "1 block changed" : `${count} blocks changed`}
        </span>
        {count > 0 && controlled === undefined && (
          <DiffViewToggle view={view} onChange={setView} />
        )}
      </div>
      {count === 0 ? (
        <p className="rounded-lg bg-muted/50 p-5 text-sm text-muted-foreground">
          No text changes between these revisions.
        </p>
      ) : (
        changes.map((change, index) => (
          <Change
            key={index}
            change={change}
            view={view}
            first={index === 0}
            last={index === changes.length - 1}
            beforeLabel={beforeLabel}
            afterLabel={afterLabel}
          />
        ))
      )}
    </div>
  );
}

export function DiffViewToggle({
  view,
  onChange,
}: {
  view: DiffView;
  onChange: (view: DiffView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Changes or full text"
      className="flex rounded-full bg-muted p-0.5 text-xs"
    >
      {(
        [
          ["changes", "Show changes"],
          ["full", "Show full text"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-muted-foreground transition-[background-color,color] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            view === id &&
              "bg-card font-medium text-foreground shadow-(--shadow-border)",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Change({
  change,
  view,
  first,
  last,
  beforeLabel,
  afterLabel,
}: {
  change: BlockChange;
  view: DiffView;
  first: boolean;
  last: boolean;
  beforeLabel: string;
  afterLabel: string;
}) {
  if (change.kind === "unchanged") {
    // The full text reads straight through; changes keep one block of
    // context on each side and fold the rest (never a single block).
    const head = first ? [] : change.blocks.slice(0, 1);
    const tail = last ? [] : change.blocks.slice(-1);
    const folded = change.blocks.length - head.length - tail.length;
    if (view === "full" || folded < 2)
      return (
        <div className="px-4 py-1 text-foreground/80">
          <Markdown source={change.source} />
        </div>
      );
    return (
      <div className="space-y-2">
        {head.map((block, i) => (
          <Context key={`h${i}`} block={block} />
        ))}
        <details className="group rounded-lg border border-dashed text-sm">
          <summary className="min-h-9 cursor-pointer rounded-lg px-4 py-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            {folded === 1 ? "1 unchanged block" : `${folded} unchanged blocks`}
          </summary>
          <div className="px-4 pb-3">
            {change.blocks
              .slice(head.length, change.blocks.length - tail.length)
              .map((block, i) => (
                <Markdown key={i} source={block.source} />
              ))}
          </div>
        </details>
        {tail.map((block, i) => (
          <Context key={`t${i}`} block={block} />
        ))}
      </div>
    );
  }
  const label =
    change.kind === "changed"
      ? "Edited"
      : change.kind === "added"
        ? "Added"
        : "Removed";
  return (
    <section
      aria-label={`${label} text`}
      className="overflow-hidden rounded-xl ring-1 ring-foreground/10"
    >
      <div className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium">
        {label}
      </div>
      {change.kind === "changed" ? (
        <>
          <Side
            blocks={[change.before]}
            kind="removed"
            label={beforeLabel}
            ranges={change.words.before}
          />
          <Side
            blocks={[change.after]}
            kind="added"
            label={afterLabel}
            ranges={change.words.after}
          />
        </>
      ) : (
        <Side
          blocks={change.blocks}
          kind={change.kind}
          label={change.kind === "added" ? afterLabel : beforeLabel}
        />
      )}
    </section>
  );
}

function Context({ block }: { block: DiffBlock }) {
  return (
    <div className="px-4 py-1 text-foreground/80">
      <Markdown source={block.source} />
    </div>
  );
}

function Side({
  blocks,
  kind,
  label,
  ranges,
}: {
  blocks: DiffBlock[];
  kind: "added" | "removed";
  label: string;
  ranges?: TextRange[];
}) {
  const marks = useMemo(
    () => (ranges?.length ? [wordMarks(ranges, kind)] : undefined),
    [ranges, kind],
  );
  return (
    <div
      className={cn(
        "relative border-l-2 py-3 pr-5 pl-10",
        kind === "added"
          ? "border-l-success bg-success/5"
          : "border-l-destructive bg-destructive/5",
      )}
    >
      <span
        aria-hidden
        className="absolute top-3 left-3.5 font-mono text-sm text-muted-foreground"
      >
        {kind === "added" ? "+" : "−"}
      </span>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        {kind === "added" ? "After" : "Before"} · {label}
      </p>
      {blocks.map((block, i) => (
        <Markdown key={i} source={block.source} marks={marks} />
      ))}
    </div>
  );
}

// A title change with its changed words marked.
export function TitleDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const ranges = useMemo(() => changedWords(before, after), [before, after]);
  if (before === after) return null;
  const marked = (value: string, spans: TextRange[], Tag: "ins" | "del") => {
    const out = [];
    let offset = 0;
    for (const span of spans) {
      out.push(value.slice(offset, span.from));
      out.push(
        <Tag
          key={span.from}
          className={
            Tag === "ins"
              ? "rounded-[3px] bg-success/18 underline decoration-success underline-offset-3"
              : "rounded-[3px] bg-destructive/14 line-through decoration-destructive"
          }
        >
          {value.slice(span.from, span.to)}
        </Tag>,
      );
      offset = span.to;
    }
    out.push(value.slice(offset));
    return out;
  };
  return (
    <p className="text-[13px]">
      <span className="text-muted-foreground">Title: </span>
      {marked(before, ranges.before, "del")}
      <span className="mx-1.5 text-muted-foreground" aria-hidden>
        →
      </span>
      <span className="sr-only"> changed to </span>
      {marked(after, ranges.after, "ins")}
    </p>
  );
}
