"use client";
import { canConfigure } from "~/sync/shared/configuration-access";
import { LoadingState } from "~/components/ui/spinner";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, CirclePlay, Flag, Plus, Repeat } from "lucide-react";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  byRank,
  categoryOf,
  identifier,
  isClosedCategory,
  isTopLevel,
  segmentOf,
  typeOf,
} from "~/lib/work-items";
import {
  iterationLabel,
  iterationReportSchema,
  type Iteration,
  type IterationReport,
  type WorkItem,
} from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, Picker } from "~/components/ui/popover";
import { Avatar, EmptyState } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { useShell } from "~/components/workspace/shell";
import { RefinementIcon, StatusIcon } from "~/components/items/status";
import { TypeIcon } from "~/components/items/icons";
import { shortRange } from "~/components/items/delivery-properties";
import { useTeam } from "./team-gate";
import { estimateLabel } from "./card";

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// Reports are read on demand (they replay recorded events on the server).
export function useIterationReport(
  organizationId: string,
  iterationId: string | undefined,
  refreshKey?: unknown,
) {
  const [report, setReport] = useState<IterationReport>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!iterationId) return;
    let cancelled = false;
    const query = new URLSearchParams({
      iteration: "1",
      organizationId,
      iterationId,
    });
    fetch(`/api/sync?${query}`, { cache: "no-store" })
      .then(async (r) => {
        const body: unknown = await r.json();
        if (!r.ok) throw new Error("The report could not be loaded.");
        return iterationReportSchema.parse(body);
      })
      .then((r) => !cancelled && setReport(r))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : "Report unavailable."),
      );
    return () => {
      cancelled = true;
    };
  }, [organizationId, iterationId, refreshKey]);
  return { report, error };
}

export function Backlog() {
  const team = useTeam();
  const {
    items,
    projects,
    delivery,
    organization,
    memberName,
    mutate,
    capabilities,
    directory,
    userId,
    isAdmin,
    view,
  } = useWorkspace();
  const { openCreate, toast } = useShell();
  const canPlan =
    capabilities.changeProperties ||
    canConfigure(
      directory,
      userId,
      isAdmin,
      { scope: "team", scopeId: team.id },
      "teamIterations",
    );
  const iterations = [...delivery.iterations.values()]
    .filter((i) => i.teamId === team.id)
    .sort((a, b) => a.number - b.number);
  const open = iterations.filter((i) => i.state !== "completed");
  const lastCompleted = iterations
    .filter((i) => i.state === "completed")
    .at(-1);
  const { report: velocityReport } = useIterationReport(
    organization.id,
    lastCompleted?.id,
  );
  const velocity = velocityReport?.velocity ?? [];
  const averageVelocity = velocity.length
    ? Math.round(
        velocity.reduce((sum, v) => sum + v.completed, 0) / velocity.length,
      )
    : undefined;
  const teamItems = useMemo(
    () =>
      items
        // Epics group work across iterations; they are planned via children.
        .filter(
          (i) =>
            i.teamId === team.id &&
            !i.archivedAt &&
            !isTopLevel(typeOf(delivery, i)),
        )
        .sort(byRank),
    [items, team.id, delivery],
  );
  const backlog = teamItems.filter(
    (i) => !i.iterationId && !isClosedCategory(categoryOf(delivery, i)),
  );
  const [drag, setDrag] = useState<string>();
  const [over, setOver] = useState<{ section: string; index: number }>();
  const projectOf = (i: WorkItem) => projects.find((p) => p.id === i.projectId);
  const move = (sectionId: string, rows: WorkItem[], index: number) => {
    const item = teamItems.find((i) => i.id === drag);
    setDrag(undefined);
    setOver(undefined);
    if (!item) return;
    const iterationId = sectionId === "backlog" ? null : sectionId;
    if (item.iterationId !== iterationId)
      void mutate({
        type: "updateWorkItem",
        workItemId: item.id,
        iterationId,
      });
    const others = rows.filter((r) => r.id !== item.id);
    const after = others[index - 1]?.id ?? null;
    const before = others[index]?.id ?? null;
    if (after || before)
      void mutate({
        type: "rankWorkItem",
        workItemId: item.id,
        afterId: after,
        beforeId: before,
      });
  };
  const createSprint = () => {
    const last = open.at(-1) ?? iterations.at(-1);
    const today = new Date(isoDate(new Date()));
    const start =
      last && new Date(last.endsAt) > today ? new Date(last.endsAt) : today;
    void mutate({
      type: "createIteration",
      teamId: team.id,
      iterationId: crypto.randomUUID(),
      name: null,
      goal: null,
      startsAt: isoDate(start),
      endsAt: isoDate(
        new Date(start.getTime() + team.iterationWeeks * 7 * DAY),
      ),
    });
  };
  const defaultProject =
    projects.find((p) => p.defaultTeamId === team.id) ?? projects[0];
  const section = (
    id: string,
    rows: WorkItem[],
    header: React.ReactNode,
    empty: string,
  ) => (
    <section
      key={id}
      aria-label={id === "backlog" ? "Backlog" : "Iteration"}
      className={cn(
        "rounded-xl bg-card shadow-(--shadow-border)",
        over?.section === id && "ring-1 ring-primary/40",
      )}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        const rowsEls = [
          ...e.currentTarget.querySelectorAll<HTMLElement>("[data-row]"),
        ].filter((r) => r.dataset.row !== drag);
        const index = rowsEls.findIndex((r) => {
          const rect = r.getBoundingClientRect();
          return e.clientY < rect.top + rect.height / 2;
        });
        const at = index === -1 ? rowsEls.length : index;
        if (over?.section !== id || over.index !== at)
          setOver({ section: id, index: at });
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver(undefined);
      }}
      onDrop={(e) => {
        e.preventDefault();
        move(id, rows, over?.section === id ? over.index : rows.length);
      }}
    >
      {header}
      {rows.length === 0 ? (
        <p className="border-t px-4 py-4 text-[13px] text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="border-t">
          {rows.map((item, index) => (
            <li key={item.id}>
              {over?.section === id && over.index === index && drag && (
                <div className="h-0.5 bg-primary" aria-hidden />
              )}
              <BacklogRow
                item={item}
                label={identifier(projectOf(item), item.number)}
                href={
                  projectOf(item)
                    ? paths.item(
                        organization.slug,
                        projectOf(item)!.key,
                        segmentOf(typeOf(delivery, item)),
                        identifier(projectOf(item), item.number),
                      )
                    : "#"
                }
                estimate={estimateLabel(team, item.estimate)}
                memberName={memberName}
                draggable={capabilities.changeProperties}
                dragging={drag === item.id}
                onDragStart={() => setDrag(item.id)}
                onDragEnd={() => {
                  setDrag(undefined);
                  setOver(undefined);
                }}
              />
            </li>
          ))}
          {over?.section === id && over.index >= rows.length && drag && (
            <div className="h-0.5 bg-primary" aria-hidden />
          )}
        </ul>
      )}
    </section>
  );
  const points = (rows: WorkItem[]) =>
    rows.reduce((sum, i) => sum + (i.estimate ?? 0), 0);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {team.name} · Backlog
          </h1>
          {averageVelocity !== undefined && team.estimateScale !== "none" && (
            <span
              className="text-xs text-muted-foreground"
              title="Average completed points of recent iterations"
            >
              Velocity {averageVelocity} pts
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {canPlan && team.iterationMode === "manual" && (
              <Button variant="secondary" size="sm" onClick={createSprint}>
                <Plus className="size-3.5" /> New sprint
              </Button>
            )}
            {capabilities.editSpecifications && defaultProject && (
              <Button
                size="sm"
                onClick={() =>
                  openCreate({
                    projectId: defaultProject.id,
                    teamId: team.id,
                    iterationId: null,
                  })
                }
              >
                <Plus className="size-3.5" /> New item
              </Button>
            )}
          </div>
        </header>
        {team.iterationMode === "off" && (
          <p className="text-[13px] text-muted-foreground">
            {team.name} works without iterations. Rank the backlog by dragging;
            enable sprints or cycles in{" "}
            <Link
              className="underline"
              href={paths.teamSettings(organization.slug, team.id)}
            >
              team settings
            </Link>
            .
          </p>
        )}
        {team.iterationMode === "automatic" && (
          <p className="text-[13px] text-muted-foreground">
            Cycles of {team.iterationWeeks} week
            {team.iterationWeeks > 1 ? "s" : ""} start and complete
            automatically; unfinished work rolls into the next cycle.
          </p>
        )}
        {view.status === "hydrating" && teamItems.length === 0 ? (
          <LoadingState label="Opening backlog" />
        ) : (
          <>
            {open.map((it) => {
              const rows = teamItems.filter((i) => i.iterationId === it.id);
              return section(
                it.id,
                rows,
                <IterationHeader
                  iteration={it}
                  rows={rows}
                  points={points(rows)}
                  capacity={averageVelocity}
                  showPoints={team.estimateScale !== "none"}
                  canPlan={canPlan && team.iterationMode === "manual"}
                  hasActive={open.some((o) => o.state === "active")}
                  nextPlanned={open.find(
                    (o) => o.state === "planned" && o.id !== it.id,
                  )}
                  unfinished={
                    rows.filter(
                      (i) => !isClosedCategory(categoryOf(delivery, i)),
                    ).length
                  }
                  reportHref={paths.iteration(
                    organization.slug,
                    team.id,
                    it.id,
                  )}
                  onStart={() =>
                    void mutate({
                      type: "startIteration",
                      teamId: team.id,
                      iterationId: it.id,
                    })
                  }
                  onComplete={(carryOverTo) => {
                    void mutate({
                      type: "completeIteration",
                      teamId: team.id,
                      iterationId: it.id,
                      carryOverTo,
                    });
                    toast(`${iterationLabel(it)} completed`, {
                      label: "View report",
                      href: paths.iteration(organization.slug, team.id, it.id),
                    });
                  }}
                  onRename={(name, goal) =>
                    void mutate({
                      type: "updateIteration",
                      teamId: team.id,
                      iterationId: it.id,
                      name,
                      goal,
                    })
                  }
                />,
                "Drag items here to plan them.",
              );
            })}
            {section(
              "backlog",
              backlog,
              <div className="flex items-center gap-2 px-4 py-3">
                <h2 className="text-sm font-semibold">Backlog</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {backlog.length} items
                  {team.estimateScale !== "none" && ` · ${points(backlog)} pts`}
                </span>
              </div>,
              "The backlog is empty.",
            )}
            {iterations.some((i) => i.state === "completed") && (
              <div>
                <h2 className="mb-2 px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Completed
                </h2>
                <ul className="space-y-1">
                  {iterations
                    .filter((i) => i.state === "completed")
                    .reverse()
                    .map((i) => (
                      <li key={i.id}>
                        <Link
                          href={paths.iteration(
                            organization.slug,
                            team.id,
                            i.id,
                          )}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted"
                        >
                          <BarChart3 className="size-3.5 text-muted-foreground" />
                          {iterationLabel(i)}
                          <span className="text-xs text-muted-foreground">
                            {shortRange(i)}
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </>
        )}
        {!teamItems.length && view.status !== "hydrating" && (
          <EmptyState illustration="planning" title="Nothing planned yet">
            Create items for {team.name}, or move items to this team from their
            detail page.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function IterationHeader({
  iteration,
  rows,
  points,
  capacity,
  showPoints,
  canPlan,
  hasActive,
  nextPlanned,
  unfinished,
  reportHref,
  onStart,
  onComplete,
  onRename,
}: {
  iteration: Iteration;
  rows: WorkItem[];
  points: number;
  capacity?: number;
  showPoints: boolean;
  canPlan: boolean;
  hasActive: boolean;
  nextPlanned?: Iteration;
  unfinished: number;
  reportHref: string;
  onStart: () => void;
  onComplete: (carryOverTo: string | null) => void;
  onRename: (name: string | null, goal: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(iteration.name ?? "");
  const [goal, setGoal] = useState(iteration.goal ?? "");
  const over = capacity !== undefined && showPoints && points > capacity;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Repeat className="size-3.5 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{iterationLabel(iteration)}</h2>
        {iteration.state === "active" && (
          <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
            Active
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {shortRange(iteration)}
        </span>
        <span
          className={cn(
            "text-xs tabular-nums",
            over
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground",
          )}
          title={
            capacity !== undefined
              ? `Recent average velocity: ${capacity} pts`
              : undefined
          }
        >
          {rows.length} items
          {showPoints &&
            ` · ${points}${capacity !== undefined ? ` / ~${capacity}` : ""} pts`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {iteration.state === "active" && (
            <Link href={reportHref} className="contents">
              <Button variant="ghost" size="sm">
                <BarChart3 className="size-3.5" /> Report
              </Button>
            </Link>
          )}
          {canPlan && !editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {canPlan && iteration.state === "planned" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={hasActive}
              title={
                hasActive
                  ? "Complete the active sprint before starting another."
                  : undefined
              }
              onClick={onStart}
            >
              <CirclePlay className="size-3.5" /> Start
            </Button>
          )}
          {canPlan && iteration.state === "active" && (
            <Popover
              width={300}
              align="end"
              trigger={(props) => (
                <Button {...props} variant="secondary" size="sm">
                  <Flag className="size-3.5" /> Complete
                </Button>
              )}
            >
              {(close) =>
                unfinished === 0 ? (
                  <div className="space-y-2 p-3 text-[13px]">
                    <p>All work in this sprint is done.</p>
                    <Button
                      size="sm"
                      onClick={() => {
                        onComplete(null);
                        close();
                      }}
                    >
                      Complete sprint
                    </Button>
                  </div>
                ) : (
                  <Picker
                    title={`Move ${unfinished} unfinished item${unfinished > 1 ? "s" : ""} to`}
                    hideSearch
                    options={[
                      ...(nextPlanned
                        ? [
                            {
                              value: nextPlanned.id,
                              label: iterationLabel(nextPlanned),
                              hint: shortRange(nextPlanned),
                            },
                          ]
                        : []),
                      { value: "backlog", label: "Backlog" },
                    ]}
                    onSelect={(v) => {
                      onComplete(v === "backlog" ? null : v);
                      close();
                    }}
                    footer={
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        Completed work stays in this sprint&apos;s report.
                      </p>
                    }
                  />
                )
              }
            </Popover>
          )}
        </div>
      </div>
      {editing ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(name.trim() || null, goal.trim() || null);
            setEditing(false);
          }}
        >
          <Input
            className="h-8 w-48 text-sm"
            placeholder={`Iteration ${iteration.number}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Sprint name"
          />
          <Input
            className="h-8 min-w-60 flex-1 text-sm"
            placeholder="Sprint goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            aria-label="Sprint goal"
          />
          <Button size="sm" type="submit">
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        iteration.goal && (
          <p className="mt-1 text-[13px] text-muted-foreground">
            Goal: {iteration.goal}
          </p>
        )
      )}
    </div>
  );
}

function BacklogRow({
  item,
  label,
  href,
  estimate,
  memberName,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  item: WorkItem;
  label: string;
  href: string;
  estimate: string | null;
  memberName: (id: string | null) => string;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { delivery } = useWorkspace();
  const status = delivery.statuses.get(item.statusId);
  return (
    <div
      data-row={item.id}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "relative flex h-9 items-center gap-2 border-b px-4 text-[13px] last:border-b-0 hover:bg-muted/50",
        draggable && "cursor-grab",
        dragging && "opacity-40",
      )}
    >
      <TypeIcon type={typeOf(delivery, item)} />
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
        {label}
      </span>
      <Link
        href={href}
        draggable={false}
        className="min-w-0 flex-1 truncate after:absolute after:inset-0"
      >
        {item.title}
      </Link>
      {item.refinementState && item.refinementState !== "ready" && (
        <span title="Specification not ready">
          <RefinementIcon state={item.refinementState} />
        </span>
      )}
      <StatusIcon category={status?.category} color={status?.color} />
      {estimate && (
        <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
          {estimate}
        </span>
      )}
      {item.assigneeId ? (
        <Avatar name={memberName(item.assigneeId)} size="xs" />
      ) : (
        <span className="size-4" />
      )}
    </div>
  );
}
