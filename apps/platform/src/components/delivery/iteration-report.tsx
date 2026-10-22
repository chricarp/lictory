"use client";
import { LoadingState } from "@lictory/ui/spinner";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BarChart3, ChevronLeft } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { iterationLabel, type IterationReport } from "@lictory/core/contracts/protocol";
import { MissingState } from "@lictory/ui/status-page";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { shortRange } from "@lictory/platform/components/items/delivery-properties";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { useIterationReport } from "@lictory/platform/components/delivery/backlog";

export function IterationReportPage() {
  const project = useProject();
  const { iteration: iterationId } = useParams<{ iteration: string }>();
  const { delivery, organization, view } = useWorkspace();
  const found = delivery.iterations.get(iterationId);
  const iteration = found?.projectId === project.id ? found : undefined;
  // Refetch when anything synchronizes, so an open report follows progress.
  const { report, error } = useIterationReport(
    organization.id,
    iterationId,
    view.cursor,
  );
  const usePoints = project.estimateScale !== "none";
  if (error)
    return (
      <MissingState
        illustration="planning"
        icon={BarChart3}
        title="Report unavailable"
      >
        {error} The iteration may belong to another project or be older than the
        synchronized history.
      </MissingState>
    );
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
        <Link
          href={paths.backlog(organization.slug, project.key)}
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> {project.name} backlog
        </Link>
        <header>
          <h1 className="text-lg font-semibold tracking-tight">
            {iteration ? iterationLabel(iteration) : "Iteration"}
            {iteration && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {shortRange(iteration)} ·{" "}
                {iteration.state === "active"
                  ? "Active"
                  : iteration.state === "completed"
                    ? "Completed"
                    : "Planned"}
              </span>
            )}
          </h1>
          {iteration?.goal && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Goal: {iteration.goal}
            </p>
          )}
        </header>
        {!report ? (
          <LoadingState label="Loading report" />
        ) : (
          <>
            <Totals report={report} usePoints={usePoints} />
            <section className="rounded-xl bg-card p-4 shadow-(--shadow-border)">
              <h2 className="mb-3 text-sm font-semibold">Burndown</h2>
              <Burndown report={report} usePoints={usePoints} />
              <p className="mt-2 text-xs text-muted-foreground">
                Remaining {usePoints ? "points" : "items"} per day, replayed
                from recorded changes. The dashed line is the ideal pace from
                the committed scope; the upper line shows scope changes.
              </p>
            </section>
            {report.velocity.length > 0 && usePoints && (
              <section className="rounded-xl bg-card p-4 shadow-(--shadow-border)">
                <h2 className="mb-3 text-sm font-semibold">Velocity</h2>
                <Velocity report={report} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Totals({
  report,
  usePoints,
}: {
  report: IterationReport;
  usePoints: boolean;
}) {
  const t = report.totals;
  const v = (x: { count: number; points: number }) =>
    usePoints ? `${x.points} pts · ${x.count}` : `${x.count}`;
  const cells = [
    ["Committed at start", v(t.atStart)],
    ["Completed", v(t.completed)],
    ["Added after start", v(t.addedAfterStart)],
    ["Removed after start", v(t.removedAfterStart)],
    ...(report.summary
      ? [["Carried over", v(report.summary.carriedOver)] as const]
      : []),
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cells.map(([label, value]) => (
        <div
          key={label}
          className="rounded-xl bg-card px-3 py-2.5 shadow-(--shadow-border)"
        >
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Small dependency-free SVG chart; the series is at most a few dozen points.
function Burndown({
  report,
  usePoints,
}: {
  report: IterationReport;
  usePoints: boolean;
}) {
  const W = 640;
  const H = 220;
  const pad = { l: 32, r: 12, t: 10, b: 24 };
  const series = report.series.map((p) => ({
    at: new Date(p.at),
    scope: usePoints ? p.scope : p.scopeCount,
    remaining: usePoints ? p.remaining : p.remainingCount,
  }));
  if (series.length < 2)
    return (
      <p className="text-[13px] text-muted-foreground">
        The chart appears once the iteration has started.
      </p>
    );
  const max = Math.max(1, ...series.map((p) => Math.max(p.scope, p.remaining)));
  const t0 = series[0]!.at.getTime();
  const t1 = series.at(-1)!.at.getTime();
  const x = (d: Date) =>
    pad.l + ((d.getTime() - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (key: "scope" | "remaining") =>
    series
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p[key]).toFixed(1)}`,
      )
      .join(" ");
  const start = series[0]!;
  const ticks = [0, Math.round(max / 2), max];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Burndown: ${series.at(-1)!.remaining} of ${series.at(-1)!.scope} ${usePoints ? "points" : "items"} remaining`}
      className="w-full"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(t)}
            y2={y(t)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={pad.l - 6}
            y={y(t) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {t}
          </text>
        </g>
      ))}
      <line
        x1={x(start.at)}
        y1={y(start.scope)}
        x2={x(series.at(-1)!.at)}
        y2={y(0)}
        className="stroke-muted-foreground/50"
        strokeDasharray="4 4"
        strokeWidth={1.5}
      />
      <path
        d={path("scope")}
        fill="none"
        className="stroke-amber-500"
        strokeWidth={1.5}
      />
      <path
        d={path("remaining")}
        fill="none"
        className="stroke-primary"
        strokeWidth={2}
      />
      {[series[0]!, series.at(-1)!].map((p, i) => (
        <text
          key={i}
          x={x(p.at)}
          y={H - 6}
          textAnchor={i ? "end" : "start"}
          className="fill-muted-foreground text-[10px]"
        >
          {p.at.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </text>
      ))}
    </svg>
  );
}

function Velocity({ report }: { report: IterationReport }) {
  const max = Math.max(
    1,
    ...report.velocity.map((v) => Math.max(v.committed, v.completed)),
  );
  return (
    <ul className="flex h-40 items-end gap-3">
      {report.velocity.map((v) => (
        <li
          key={v.iterationId}
          className="flex h-full flex-1 flex-col items-center justify-end gap-1"
        >
          <div className="flex h-full w-full items-end justify-center gap-1">
            <span
              className="w-3 rounded-t bg-muted-foreground/25"
              style={{ height: `${(v.committed / max) * 100}%` }}
              title={`Committed ${v.committed} pts`}
            />
            <span
              className="w-3 rounded-t bg-primary"
              style={{ height: `${(v.completed / max) * 100}%` }}
              title={`Completed ${v.completed} pts`}
            />
          </div>
          <span className="truncate text-[11px] text-muted-foreground">
            {v.name ?? `#${v.number}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
