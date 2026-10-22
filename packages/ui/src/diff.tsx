import { cn } from "@lictory/core/lib/utils";
import { diffLines, type DiffLine } from "@lictory/core/contracts/diff";

export {
  diffLines,
  diffStats,
  type DiffLine,
} from "@lictory/core/contracts/diff";

// Unified view with collapsed unchanged context, GitHub style.
export function RevisionDiff({
  before,
  after,
  context = 3,
  className,
}: {
  before: string;
  after: string;
  context?: number;
  className?: string;
}) {
  const lines = diffLines(before, after);
  const changed = lines.map((l) => l.kind !== "same");
  if (!changed.some(Boolean))
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        No text changes between these revisions.
      </p>
    );
  const visible = lines.map((_, i) => {
    for (let d = -context; d <= context; d++) if (changed[i + d]) return true;
    return false;
  });
  const rows: (DiffLine | { kind: "skip"; count: number })[] = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (visible[i]) {
      if (skipped) rows.push({ kind: "skip", count: skipped });
      skipped = 0;
      rows.push(line);
    } else skipped++;
  });
  if (skipped) rows.push({ kind: "skip", count: skipped });
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border font-mono text-[12.5px] leading-6",
        className,
      )}
    >
      {rows.map((row, i) =>
        row.kind === "skip" ? (
          <div
            key={i}
            className="bg-muted/40 px-3 text-center text-[11px] text-muted-foreground select-none"
          >
            ··· {row.count} unchanged line{row.count === 1 ? "" : "s"} ···
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              "flex whitespace-pre-wrap",
              row.kind === "added" &&
                "bg-emerald-500/12 text-emerald-900 dark:text-emerald-200",
              row.kind === "removed" &&
                "bg-red-500/10 text-red-900 line-through decoration-red-900/30 dark:text-red-200",
            )}
          >
            <span className="w-6 shrink-0 text-center text-muted-foreground select-none">
              {row.kind === "added" ? "+" : row.kind === "removed" ? "−" : ""}
            </span>
            <span className="min-w-0 flex-1 pr-3">{row.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}
