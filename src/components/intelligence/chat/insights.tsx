"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, type PointerEvent } from "react";
import type {
  InsightCard,
  Insights,
  Segment,
  Tone,
} from "~/intelligence/insights";
import { cn } from "~/lib/utils";
import { useLookup } from "./use-lookup";

// Insight cards: figures the workspace computed (getInsights), paged one card
// at a time so a report never takes over the conversation. Adapted from
// Beautiful UI's Insight Cards (MIT, beautifului.dev).

const fill: Record<Tone, string> = {
  neutral: "bg-muted-foreground/25",
  muted: "bg-muted-foreground/55",
  primary: "bg-primary",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-destructive",
};
const ink: Record<Tone, string> = {
  neutral: "text-muted-foreground/45",
  muted: "text-muted-foreground",
  primary: "text-primary",
  warning: "text-warning",
  success: "text-success",
  danger: "text-destructive",
};

const percent = (value: number, total: number) =>
  total ? Math.round((value / total) * 100) : 0;

// Every report of one stretch of work shares a panel; each page shows the
// headline of the report it belongs to.
export function InsightCards({ reports }: { reports: Insights[] }) {
  const reduce = useReducedMotion();
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(1);
  const pages = reports.flatMap((report) =>
    report.cards.map((card) => ({ report, card })),
  );
  const current = pages[Math.min(page, pages.length - 1)];
  if (!current) return null;
  const { report, card } = current;
  const go = (to: number) => {
    setDirection(to > page ? 1 : -1);
    setPage(to);
  };
  const scope = [report.scope.projectName, report.scope.teamName]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      aria-label="Insights"
      className="activity-enter max-w-xl overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_var(--border),0_8px_24px_-16px_oklch(0_0_0/0.2)]"
    >
      <header className="flex items-center gap-2 px-3.5 pt-3">
        <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="text-[12px] font-medium">Insights</span>
        <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
          {pages.length}
        </span>
        {scope && (
          <span className="min-w-0 truncate text-[12px] text-muted-foreground">
            {scope}
          </span>
        )}
        {pages.length > 1 && (
          <span className="ml-auto flex items-center gap-0.5">
            <PageButton
              label="Previous insight"
              disabled={page === 0}
              onClick={() => go(page - 1)}
            >
              <ChevronLeft className="size-3.5" />
            </PageButton>
            <span className="w-9 text-center text-[11px] text-muted-foreground tabular-nums">
              {page + 1} / {pages.length}
            </span>
            <PageButton
              label="Next insight"
              disabled={page === pages.length - 1}
              onClick={() => go(page + 1)}
            >
              <ChevronRight className="size-3.5" />
            </PageButton>
          </span>
        )}
      </header>
      <p
        key={report.headline}
        className="activity-enter px-3.5 pt-1.5 text-[13px] leading-5"
      >
        {report.headline}
      </p>
      <div className="relative overflow-hidden px-3.5 pt-3 pb-3.5">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={`${page}-${card.id}`}
            custom={direction}
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, x: 16 * direction }
            }
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16 * direction }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          >
            <Card card={card} />
          </motion.div>
        </AnimatePresence>
      </div>
      {pages.length > 1 && (
        <div className="flex justify-center gap-1 pb-3" aria-hidden>
          {pages.map((p, i) => (
            <span
              key={i}
              className={cn(
                "h-1 rounded-full transition-[width,background-color] duration-200",
                i === page
                  ? "w-3 bg-foreground/60"
                  : "w-1 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-100 enabled:hover:bg-muted enabled:hover:text-foreground enabled:active:scale-[0.94] disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Card({ card }: { card: InsightCard }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3 shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-medium text-muted-foreground">
          {card.title}
        </h3>
        {card.kind !== "distribution" && (
          <span className="truncate text-[11px] text-muted-foreground/80">
            {card.caption}
          </span>
        )}
      </div>
      {card.kind === "distribution" ? (
        <Distribution card={card} />
      ) : card.kind === "breakdown" ? (
        <Breakdown card={card} />
      ) : card.kind === "trend" ? (
        <Trend card={card} />
      ) : (
        <Attention card={card} />
      )}
    </div>
  );
}

function StackedBar({
  segments,
  total,
  className,
}: {
  segments: Segment[];
  total: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex h-2 gap-0.5 overflow-hidden rounded-full", className)}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span
            key={s.key}
            title={`${s.label}: ${s.value}`}
            className={cn("h-full rounded-full", fill[s.tone])}
            style={{ width: `${(s.value / Math.max(total, 1)) * 100}%` }}
          />
        ))}
    </div>
  );
}

function Distribution({
  card,
}: {
  card: Extract<InsightCard, { kind: "distribution" }>;
}) {
  const total = card.segments.reduce((n, s) => n + s.value, 0);
  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-[22px] leading-none font-semibold tracking-tight tabular-nums">
          {card.value}
        </span>
        <span className="text-[13px] font-medium">{card.unit}</span>
        <span className="text-[12px] text-muted-foreground">
          {card.caption}
        </span>
      </p>
      {total > 0 ? (
        <StackedBar segments={card.segments} total={total} className="mt-3" />
      ) : (
        <div className="mt-3 h-2 rounded-full bg-muted" />
      )}
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {card.segments.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className={cn("size-2 shrink-0 rounded-full", fill[s.tone])}
            />
            <dt className="min-w-0 truncate text-muted-foreground">
              {s.label}
            </dt>
            <dd className="ml-auto tabular-nums">
              {s.value}
              <span className="ml-1.5 text-muted-foreground/70">
                {percent(s.value, total)}%
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Breakdown({
  card,
}: {
  card: Extract<InsightCard, { kind: "breakdown" }>;
}) {
  const max = Math.max(
    1,
    ...card.rows.map((r) => r.segments.reduce((n, s) => n + s.value, 0)),
  );
  return (
    <div>
      {card.legend.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {card.legend.map((l) => (
            <span key={l.key} className="flex items-center gap-1">
              <span className={cn("size-2 rounded-full", fill[l.tone])} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <ul className="max-h-56 space-y-1.5 overflow-y-auto overscroll-contain">
        {card.rows.map((row) => {
          const total = row.segments.reduce((n, s) => n + s.value, 0);
          return (
            <li
              key={row.id}
              className="grid grid-cols-[7rem_1fr_auto] items-center gap-2.5 text-[12px]"
            >
              <span className="truncate">{row.label}</span>
              <span className="block">
                <span
                  className="block min-w-1 transition-[width] duration-500 ease-out"
                  style={{ width: `${(total / max) * 100}%` }}
                >
                  <StackedBar segments={row.segments} total={total} />
                </span>
              </span>
              <span className="text-right text-[11px] text-muted-foreground tabular-nums">
                {row.note}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const W = 300;
const H = 96;

function Trend({ card }: { card: Extract<InsightCard, { kind: "trend" }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = card.labels.length;
  const max = Math.max(1, ...card.series.flatMap((s) => s.values));
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 6);
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const progress = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width),
    );
    setHover(
      card.style === "bars"
        ? Math.min(n - 1, Math.floor(progress * n))
        : Math.round(progress * (n - 1)),
    );
  };
  const at = hover ?? n - 1;
  const group = W / Math.max(n, 1);
  const bar = Math.min(18, (group * 0.7) / card.series.length);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {card.series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", fill[s.tone])} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">
              {s.values[at] ?? 0}
            </span>
          </span>
        ))}
        <span className="ml-auto text-muted-foreground tabular-nums">
          {card.labels[at]}
        </span>
      </div>
      <div
        className="relative touch-none"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-28 w-full overflow-visible"
          role="img"
          aria-label={`${card.title}: ${card.series
            .map((s) => `${s.label} ${s.values.at(-1) ?? 0} ${card.unit}`)
            .join(", ")}`}
        >
          <line
            x1={0}
            x2={W}
            y1={H}
            y2={H}
            className="stroke-border"
            vectorEffect="non-scaling-stroke"
          />
          {card.style === "line"
            ? card.series.map((s, si) => {
                const points = s.values.map((v, i) => `${x(i)},${y(v)}`);
                const last = si === card.series.length - 1;
                return (
                  <g key={s.key} className={ink[s.tone]}>
                    {last && (
                      <polygon
                        points={`0,${H} ${points.join(" ")} ${x(n - 1)},${H}`}
                        className="fill-current opacity-10"
                      />
                    )}
                    <polyline
                      points={points.join(" ")}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={last ? 2 : 1.5}
                      strokeDasharray={last ? undefined : "4 3"}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })
            : card.series.map((s, si) =>
                s.values.map((v, i) => (
                  <rect
                    key={`${s.key}-${i}`}
                    x={
                      i * group +
                      group / 2 -
                      (bar * card.series.length) / 2 +
                      si * bar
                    }
                    y={y(v)}
                    width={Math.max(bar - 2, 2)}
                    height={H - y(v)}
                    rx={2}
                    className={cn(
                      "fill-current transition-opacity duration-150",
                      ink[s.tone],
                      hover !== null && hover !== i && "opacity-40",
                    )}
                  />
                )),
              )}
          {card.style === "line" && hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={0}
              y2={H}
              className="stroke-foreground/30"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground/80 tabular-nums">
        <span>{card.labels[0]}</span>
        <span>{card.unit}</span>
        <span>{card.labels.at(-1)}</span>
      </div>
    </div>
  );
}

function Attention({
  card,
}: {
  card: Extract<InsightCard, { kind: "attention" }>;
}) {
  const lookup = useLookup();
  return (
    <ul className="-mx-1 space-y-0.5 text-[12px]">
      {card.items.map((item) => {
        const href = lookup.item({ id: item.id })?.href;
        const body = (
          <>
            <span
              className={cn("size-1.5 shrink-0 rounded-full", fill[item.tone])}
            />
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {item.key}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className={cn("shrink-0 text-[11px]", ink[item.tone])}>
              {item.reason}
            </span>
          </>
        );
        const className = "flex h-7 items-center gap-2 rounded-md px-1";
        return (
          <li key={item.id}>
            {href ? (
              <Link href={href} className={cn(className, "hover:bg-muted")}>
                {body}
              </Link>
            ) : (
              <span className={className}>{body}</span>
            )}
          </li>
        );
      })}
      {card.more > 0 && (
        <li className="px-1 pt-1 text-[11px] text-muted-foreground">
          and {card.more} more
        </li>
      )}
    </ul>
  );
}
