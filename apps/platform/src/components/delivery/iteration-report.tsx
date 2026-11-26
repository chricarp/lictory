import { IterationContext } from "@lictory/platform/components/knowledge/context";
import { LoadingState } from "@lictory/ui/spinner";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import { identifier, typeOf } from "@lictory/core/lib/work-items";
import { StatusIcon } from "@lictory/platform/components/items/status";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { BarChart3 } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import {
  iterationLabel,
  type IterationReport,
} from "@lictory/core/contracts/protocol";
import { MissingState } from "@lictory/ui/status-page";
import { StatusChip } from "@lictory/ui/status-chip";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { shortRange } from "@lictory/platform/components/items/delivery-properties";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { useIterationReport } from "@lictory/platform/components/delivery/backlog";
import {
  burndownFrame,
  burndownUsesPoints,
} from "@lictory/platform/lib/burndown";

export function IterationReportPage() {
  const project = useProject();
  const { iteration: iterationId } = useParams<{ iteration: string }>();
  const { delivery, organization, view } = useWorkspace();
  const found = iterationId ? delivery.iterations.get(iterationId) : undefined;
  const iteration = found?.projectId === project.id ? found : undefined;
  // Refetch when anything synchronizes, so an open report follows progress.
  const { report, error } = useIterationReport(
    organization.id,
    iterationId,
    view.cursor,
  );
  const scaled = project.estimateScale !== "none";
  const usePoints = report
    ? burndownUsesPoints(report, project.estimateScale)
    : scaled;
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
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          iteration
            ? iterationLabel(iteration, project?.iterationMode)
            : "Iteration"
        }
        icon={<BarChart3 />}
        back={{
          label: `Back to the ${project.name} backlog`,
          href: paths.backlog(organization.slug, project.key),
        }}
        meta={
          iteration ? (
            <>
              <span className="tabular-nums">{shortRange(iteration)}</span>
              <StatusChip
                tone={
                  iteration.state === "active"
                    ? "success"
                    : iteration.state === "completed"
                      ? "neutral"
                      : "info"
                }
              >
                {iteration.state === "active"
                  ? "Active"
                  : iteration.state === "completed"
                    ? "Completed"
                    : "Planned"}
              </StatusChip>
            </>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-6 max-sm:px-3">
          {iteration && (
            // On phones the header's meta is hidden: the dates stay here.
            <p className="text-[13px] text-muted-foreground sm:hidden">
              {shortRange(iteration)}
            </p>
          )}
          {iteration?.goal && (
            <p className="text-[13px] text-muted-foreground">
              Goal: {iteration.goal}
            </p>
          )}
          {iteration && project.deliveryMode === "native" && (
            <IterationContext project={project} iteration={iteration} />
          )}
          {!report ? (
            <LoadingState label="Loading report" />
          ) : (
            <>
              <Totals report={report} usePoints={usePoints} />
              <section className="rounded-xl bg-card p-4 shadow-(--shadow-border)">
                <h2 className="mb-3 text-sm font-semibold">Burndown</h2>
                <Burndown
                  report={report}
                  usePoints={usePoints}
                  iteration={iteration}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Remaining {usePoints ? "points" : "items"} per day, replayed
                  from recorded changes.
                  {report.totals.atStart.count === 0 &&
                    " Nothing was committed when it started, so the ideal pace starts from the first work added."}
                  {scaled &&
                    !usePoints &&
                    " Nothing in this iteration is estimated yet, so it burns down in items."}
                </p>
              </section>
              {iteration && <IterationItems iterationId={iteration.id} />}
              {report.velocity.length > 0 && scaled && (
                <section className="rounded-xl bg-card p-4 shadow-(--shadow-border)">
                  <h2 className="mb-3 text-sm font-semibold">Velocity</h2>
                  <Velocity report={report} />
                </section>
              )}
            </>
          )}
        </div>
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
    usePoints
      ? `${x.points} pts · ${x.count}`
      : `${x.count} ${x.count === 1 ? "item" : "items"}`;
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
  iteration,
}: {
  report: IterationReport;
  usePoints: boolean;
  iteration?: { startsAt: string; endsAt: string };
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
  const { start: t0, end: t1, max, ticks } = burndownFrame(series, iteration);
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
  // The ideal pace starts from the committed scope, or from the first work
  // added when the iteration started empty (a line along zero says nothing).
  const start = series.find((p) => p.scope > 0) ?? series[0]!;
  // Iterations end at the start of `endsAt`; label the last working day.
  const lastDay = new Date(t1 - (iteration ? 86_400_000 : 0));
  return (
    <>
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
          x2={x(new Date(t1))}
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
        {[new Date(t0), lastDay].map((at, i) => (
          <text
            key={i}
            x={i ? W - pad.r : pad.l}
            y={H - 6}
            textAnchor={i ? "end" : "start"}
            className="fill-muted-foreground text-[10px]"
          >
            {at.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              ...(iteration ? { timeZone: "UTC" } : {}),
            })}
          </text>
        ))}
      </svg>
      <ul
        aria-hidden
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        <li className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-primary" /> Remaining
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-amber-500" /> Scope
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-muted-foreground/50" />{" "}
          Ideal pace
        </li>
      </ul>
    </>
  );
}

// The iteration's work as it stands now, so the report has its items
// beside it (the totals above are replayed history).
function IterationItems({ iterationId }: { iterationId: string }) {
  const project = useProject();
  const { items, delivery, organization } = useWorkspace();
  const planned = items
    .filter(
      (i) =>
        i.iterationId === iterationId &&
        i.projectId === project.id &&
        !i.archivedAt,
    )
    .map((i) => ({ item: i, status: delivery.statuses.get(i.statusId) }))
    .sort(
      (a, b) =>
        Number(a.status?.category === "done") -
          Number(b.status?.category === "done") ||
        a.item.number - b.item.number,
    );
  const points = planned.reduce((sum, p) => sum + (p.item.estimate ?? 0), 0);
  return (
    <section
      aria-labelledby="iteration-items"
      className="rounded-xl bg-card shadow-(--shadow-border)"
    >
      <h2
        id="iteration-items"
        className="flex items-baseline gap-2 px-4 pt-4 pb-2 text-sm font-semibold"
      >
        Items
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {planned.length} {planned.length === 1 ? "item" : "items"}
          {points > 0 && ` · ${points} pts`}
        </span>
      </h2>
      {planned.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted-foreground">
          Nothing is planned in this iteration.
        </p>
      ) : (
        <ul className="divide-y border-t">
          {planned.map(({ item, status }) => {
            const key = identifier(project, item.number);
            return (
              <li key={item.id}>
                <Link
                  href={paths.item(organization.slug, project.key, key)}
                  className="flex items-center gap-2.5 px-4 py-2 text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
                >
                  {status && (
                    <span title={status.name} className="shrink-0">
                      <StatusIcon
                        category={status.category}
                        color={status.color}
                      />
                    </span>
                  )}
                  <TypeIcon type={typeOf(delivery, item)} />
                  <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                    {key}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {status && (
                    <span className="shrink-0 text-xs text-muted-foreground max-sm:hidden">
                      {status.name}
                    </span>
                  )}
                  {item.estimate != null && (
                    <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {item.estimate} pts
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
