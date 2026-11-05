import type {
  EstimateScale,
  IterationReport,
} from "@lictory/core/contracts/protocol";

// Points burn down only when some of the iteration's work is estimated; an
// unestimated iteration would otherwise draw a flat line at zero while its
// items are still open. Items are always a meaningful unit.
export function burndownUsesPoints(
  report: Pick<IterationReport, "series" | "totals">,
  scale: EstimateScale,
) {
  if (scale === "none") return false;
  const t = report.totals;
  return (
    t.atStart.points > 0 ||
    t.addedAfterStart.points > 0 ||
    report.series.some((p) => p.scope > 0)
  );
}

// The chart spans the whole iteration, so the ideal pace reaches zero on the
// last day of the iteration rather than at the latest sample.
export function burndownFrame(
  samples: { at: Date; scope: number; remaining: number }[],
  iteration?: { startsAt: string; endsAt: string },
) {
  const first = samples[0]!.at.getTime();
  const last = samples.at(-1)!.at.getTime();
  const start = iteration
    ? Math.min(first, new Date(iteration.startsAt).getTime())
    : first;
  const end = iteration
    ? Math.max(last, new Date(iteration.endsAt).getTime())
    : last;
  const max = Math.max(
    1,
    ...samples.map((p) => Math.max(p.scope, p.remaining)),
  );
  // A small scale (max 1) would repeat a tick.
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  return { start, end, max, ticks };
}
