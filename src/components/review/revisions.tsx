"use client";
import { ArrowRight, GitCompareArrows, History } from "lucide-react";
import { relativeTime } from "~/lib/work-items";
import { Button } from "~/components/ui/button";
import { Popover, Picker } from "~/components/ui/popover";
import { SectionLabel } from "~/components/ui/primitives";
import { RevisionDiff, diffStats } from "~/components/items/diff";
import { Markdown } from "~/components/items/markdown";
import { useItem } from "~/components/items/item-context";

export function RevisionPanel({
  onCompare,
}: {
  onCompare: (from: string, to: string) => void;
}) {
  const { revisions, current, memberName, approvals, userId } = useItem();
  if (!current) return null;
  // "Since my last approval" is the most useful starting point for a reviewer.
  const myLast = approvals
    .filter((a) => a.reviewerId === userId && a.revisionId !== current.id)
    .map((a) => revisions.find((r) => r.id === a.revisionId))
    .filter(Boolean)
    .sort((a, b) => b!.number - a!.number)[0];
  const previous = revisions[1];
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Revision</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {current.number} of {revisions.length}
        </span>
      </div>
      <p className="text-[13px]">
        <span className="font-medium">Revision {current.number}</span>
        <span className="text-muted-foreground">
          {" "}
          · {memberName(current.authorId)} · {relativeTime(current.createdAt)}
        </span>
      </p>
      {current.changeSummary && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {current.changeSummary}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {previous && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onCompare(previous.id, current.id)}
          >
            <GitCompareArrows className="size-3.5" /> vs. revision{" "}
            {previous.number}
          </Button>
        )}
        {myLast && myLast.id !== previous?.id && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onCompare(myLast.id, current.id)}
          >
            Since my approval (r{myLast.number})
          </Button>
        )}
        <Popover
          width={300}
          trigger={(props) => (
            <Button
              {...props}
              size="sm"
              variant="ghost"
              aria-label="Revision history"
            >
              <History className="size-3.5" /> History
            </Button>
          )}
        >
          <Picker
            title="Compare with current"
            options={revisions.map((r) => ({
              value: r.id,
              label: `Revision ${r.number}${r.id === current.id ? " (current)" : ""}`,
              hint: `${memberName(r.authorId)} · ${relativeTime(r.createdAt)}`,
              keywords: r.changeSummary ?? "",
            }))}
            value={current.id}
            onSelect={(id) => id !== current.id && onCompare(id, current.id)}
          />
        </Popover>
      </div>
    </section>
  );
}

export function CompareRevisions({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const { revisions, memberName } = useItem();
  const a = revisions.find((r) => r.id === from);
  const b = revisions.find((r) => r.id === to);
  if (!a || !b) return null;
  const stats = diffStats(a.content, b.content);
  const options = revisions.map((r) => ({
    value: r.id,
    label: `Revision ${r.number}`,
    hint: relativeTime(r.createdAt),
  }));
  const select = (value: string, set: (id: string) => void) => (
    <Popover
      width={220}
      trigger={(props) => (
        <button
          {...props}
          className="inline-flex h-7 items-center rounded-md border bg-card px-2 text-[13px] font-medium hover:bg-muted"
        >
          Revision {revisions.find((r) => r.id === value)?.number}
        </button>
      )}
    >
      <Picker options={options} value={value} onSelect={set} />
    </Popover>
  );
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SectionLabel>Changes</SectionLabel>
        {select(from, (id) => onChange(id, to))}
        <ArrowRight className="size-3.5 text-muted-foreground" />
        {select(to, (id) => onChange(from, id))}
        <span className="text-xs tabular-nums">
          <span className="text-emerald-700">+{stats.added}</span>{" "}
          <span className="text-red-700">−{stats.removed}</span> lines
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {memberName(b.authorId)} · {relativeTime(b.createdAt)}
          {b.changeSummary ? ` · ${b.changeSummary}` : ""}
        </span>
      </div>
      {a.title !== b.title && (
        <p className="mb-2 text-[13px]">
          Title: <span className="text-red-700 line-through">{a.title}</span> →{" "}
          <span className="text-emerald-700">{b.title}</span>
        </p>
      )}
      <RevisionDiff before={a.content} after={b.content} />
      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Read revision {b.number} in full
        </summary>
        <div className="mt-3 rounded-md border p-4">
          <Markdown source={b.content} />
        </div>
      </details>
    </section>
  );
}
