import { LoadingState } from "@lictory/ui/spinner";
import { Link } from "@lictory/platform/lib/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CircleAlert,
  CirclePlay,
  Flag,
  Plus,
  Repeat,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  byRank,
  categoryOf,
  identifier,
  isClosedCategory,
  isTopLevel,
  refinementMeta,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import { iterationReport } from "@lictory/platform/data/lookups";
import {
  iterationLabel,
  type Iteration,
  type IterationReport,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Popover, Picker } from "@lictory/ui/popover";
import { Avatar, EmptyState } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { useShell } from "@lictory/platform/components/workspace/shell";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { shortRange } from "@lictory/platform/components/items/delivery-properties";
import { estimateLabel } from "@lictory/platform/components/delivery/card";
import {
  ItemPeek,
  useItemPeek,
} from "@lictory/platform/components/delivery/item-peek";
import {
  ExternalProjectNotice,
  TeamFilterPicker,
  useTeamFilter,
} from "@lictory/platform/components/delivery/board";
import { LittoLauncher } from "@lictory/platform/components/intelligence/dock/launcher";

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
    iterationReport(organizationId, iterationId)
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
  const project = useProject();
  if (project.deliveryMode === "external")
    return <ExternalProjectNotice project={project} surface="backlog" />;
  return <ProjectBacklog project={project} />;
}

function ProjectBacklog({ project }: { project: Project }) {
  const {
    items,
    delivery,
    organization,
    memberName,
    mutate,
    capabilitiesIn,
    canManage,
    view,
  } = useWorkspace();
  const { openCreate, toast } = useShell();
  const capabilities = capabilitiesIn(project.id);
  const canPlan = canManage(project.id) || capabilities.changeProperties;
  const teamFilter = useTeamFilter(project);
  const peek = useItemPeek();
  const iterations = [...delivery.iterations.values()]
    .filter((i) => i.projectId === project.id)
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
  const teamValue = teamFilter.value;
  const teamItems = useMemo(
    () =>
      items
        // Higher-level types group work across iterations; plan their children.
        .filter(
          (i) =>
            i.projectId === project.id &&
            !i.archivedAt &&
            (!teamValue ||
              (teamValue === "none" ? !i.teamId : i.teamId === teamValue)) &&
            !isTopLevel(typeOf(delivery, i)),
        )
        .sort(byRank),
    [items, project.id, teamValue, delivery],
  );
  const backlog = teamItems.filter(
    (i) => !i.iterationId && !isClosedCategory(categoryOf(delivery, i)),
  );
  const [drag, setDrag] = useState<string>();
  const [over, setOver] = useState<{ section: string; index: number }>();
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
      projectId: project.id,
      iterationId: crypto.randomUUID(),
      name: null,
      goal: null,
      startsAt: isoDate(start),
      endsAt: isoDate(
        new Date(start.getTime() + project.iterationWeeks * 7 * DAY),
      ),
    });
  };
  const canCreate =
    capabilities.editSpecifications || capabilities.changeProperties;
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
        <>
          <BacklogColumns />
          <ul className="border-t sm:border-t-0">
            {rows.map((item, index) => (
              <li key={item.id}>
                {over?.section === id && over.index === index && drag && (
                  <div className="h-0.5 bg-primary" aria-hidden />
                )}
                <BacklogRow
                  item={item}
                  label={identifier(project, item.number)}
                  href={paths.item(
                    organization.slug,
                    project.key,
                    identifier(project, item.number),
                  )}
                  teamName={
                    teamFilter.value
                      ? undefined
                      : teamFilter.teamName(item.teamId)
                  }
                  estimate={estimateLabel(project, item.estimate)}
                  memberName={memberName}
                  draggable={capabilities.changeProperties}
                  dragging={drag === item.id}
                  selected={peek.peeked === identifier(project, item.number)}
                  onOpen={peek.onLinkClick}
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
        </>
      )}
    </section>
  );
  const points = (rows: WorkItem[]) =>
    rows.reduce((sum, i) => sum + (i.estimate ?? 0), 0);
  return (
    <div
      className={cn(
        "h-full overflow-y-auto",
        // Wide screens keep the list clear of the docked preview.
        peek.peeked && "2xl:pr-[452px]",
      )}
    >
      <div
        className={cn(
          "mx-auto max-w-4xl space-y-4 px-6 py-6",
          peek.peeked && "pb-[60dvh]",
        )}
      >
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {project.name} · Backlog
          </h1>
          <TeamFilterPicker filter={teamFilter} />
          {averageVelocity !== undefined &&
            project.estimateScale !== "none" && (
              <span
                className="text-xs text-muted-foreground"
                title="Average completed points of recent iterations"
              >
                Velocity {averageVelocity} pts
              </span>
            )}
          <div className="ml-auto flex items-center gap-1">
            {canPlan && project.iterationMode === "manual" && (
              <Button variant="secondary" size="sm" onClick={createSprint}>
                <Plus className="size-3.5" /> New sprint
              </Button>
            )}
            {canCreate && (
              <Button
                size="sm"
                onClick={() =>
                  openCreate({
                    intent: "work",
                    projectId: project.id,
                    teamId:
                      teamFilter.value && teamFilter.value !== "none"
                        ? teamFilter.value
                        : null,
                    iterationId: null,
                  })
                }
              >
                <Plus className="size-3.5" /> New item
              </Button>
            )}
            <LittoLauncher className="ml-1" />
          </div>
        </header>
        <p className="text-[13px] text-muted-foreground">
          Rank work and plan when to take it on. Iteration planning stays
          tentative until the delivery scope is accepted.{" "}
          <Link
            href={`${paths.refinement(organization.slug, project.key)}?stage=ready`}
            className="font-medium text-primary hover:underline"
          >
            Choose ready work →
          </Link>
        </p>
        {project.iterationMode === "off" && (
          <p className="text-[13px] text-muted-foreground">
            {project.name} works without iterations. Rank the backlog by
            dragging
            {canManage(project.id) ? (
              <>
                ; enable sprints or cycles in{" "}
                <Link
                  className="underline"
                  href={paths.projectSettings(
                    organization.slug,
                    project.key,
                    "planning",
                  )}
                >
                  project settings
                </Link>
              </>
            ) : null}
            .
          </p>
        )}
        {project.iterationMode === "automatic" && (
          <p className="text-[13px] text-muted-foreground">
            Cycles of {project.iterationWeeks} week
            {project.iterationWeeks > 1 ? "s" : ""} start and complete
            automatically; unfinished work rolls into the next cycle.
            {canManage(project.id) && (
              <>
                {" "}
                <Link
                  className="underline"
                  href={paths.projectSettings(
                    organization.slug,
                    project.key,
                    "planning",
                  )}
                >
                  Planning settings
                </Link>
              </>
            )}
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
                  // Velocity is the whole project's; it is no capacity for
                  // one team.
                  capacity={teamFilter.value ? undefined : averageVelocity}
                  showPoints={project.estimateScale !== "none"}
                  canPlan={canPlan && project.iterationMode === "manual"}
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
                    project.key,
                    it.id,
                  )}
                  onStart={() =>
                    void mutate({
                      type: "startIteration",
                      projectId: project.id,
                      iterationId: it.id,
                    })
                  }
                  onComplete={(carryOverTo) => {
                    void mutate({
                      type: "completeIteration",
                      projectId: project.id,
                      iterationId: it.id,
                      carryOverTo,
                    });
                    toast(`${iterationLabel(it)} completed`, {
                      label: "View report",
                      href: paths.iteration(
                        organization.slug,
                        project.key,
                        it.id,
                      ),
                    });
                  }}
                  onRename={(name, goal) =>
                    void mutate({
                      type: "updateIteration",
                      projectId: project.id,
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
                <span className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase tabular-nums">
                  {backlog.length} items
                  {project.estimateScale !== "none" &&
                    ` · ${points(backlog)} pts`}
                </span>
              </div>,
              "The backlog is empty.",
            )}
            {iterations.some((i) => i.state === "completed") && (
              <div>
                <h2 className="mb-2 px-1 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
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
                            project.key,
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
          <EmptyState
            illustration={teamFilter.value ? "search" : "planning"}
            title={
              teamFilter.value ? "No work for this team" : "Nothing planned yet"
            }
          >
            {teamFilter.value === "none"
              ? "Every item of this project belongs to a team."
              : teamFilter.team
                ? `Create items for ${teamFilter.team.name}, or set the team on an item from its detail page.`
                : `Create work items in ${project.name} to plan them here.`}
          </EmptyState>
        )}
      </div>
      <ItemPeek project={project} peek={peek} />
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
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-success/8 px-2 font-mono text-[10.5px] font-medium tracking-[0.06em] text-success uppercase ring-1 ring-success/20 ring-inset">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Active
          </span>
        )}
        <span className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase">
          {shortRange(iteration)}
        </span>
        <span aria-hidden className="text-muted-foreground/50">
          ·
        </span>
        <span
          className={cn(
            "font-mono text-[11px] tracking-[0.04em] uppercase tabular-nums",
            over ? "text-warning" : "text-muted-foreground",
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

// Names the row's state columns once per list, so refinement ("In review")
// and delivery ("In Progress") never have to be told apart by icon alone.
// The cells carry the same meaning in their titles for assistive technology.
export function BacklogColumns() {
  return (
    <div
      aria-hidden
      className="hidden h-7 items-center gap-2 border-t border-b bg-muted/30 px-4 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:flex"
    >
      <span className="min-w-0 flex-1">Item</span>
      <span className="w-36 shrink-0">Specification</span>
      <span className="size-3.5 shrink-0 @min-[65rem]/frame:hidden" />
      <span className="hidden w-24 shrink-0 @min-[65rem]/frame:inline">
        Delivery
      </span>
      <span className="w-7 shrink-0 text-center">Est.</span>
      <span className="size-4 shrink-0" />
    </div>
  );
}

export function BacklogRow({
  item,
  label,
  href,
  teamName,
  estimate,
  memberName,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  actions,
  selected,
  onOpen,
}: {
  item: WorkItem;
  label: string;
  href: string;
  teamName?: string;
  estimate: string | null;
  memberName: (id: string | null) => string;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  // Row-level actions sit above the row link.
  actions?: React.ReactNode;
  // The row is open in the item preview.
  selected?: boolean;
  // Plain clicks preview the item instead of following the link.
  onOpen?: (event: React.MouseEvent, id: string) => void;
}) {
  const { delivery } = useWorkspace();
  const status = delivery.statuses.get(item.statusId);
  return (
    <div
      data-row={item.id}
      data-peek-item
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
        selected &&
          "bg-primary/8 shadow-[inset_2px_0_0_var(--color-primary)] hover:bg-primary/10",
      )}
    >
      <TypeIcon type={typeOf(delivery, item)} />
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
        {label}
      </span>
      <Link
        href={href}
        draggable={false}
        aria-current={selected ? true : undefined}
        onClick={onOpen ? (e) => onOpen(e, label) : undefined}
        className="min-w-0 flex-1 truncate after:absolute after:inset-0"
      >
        {item.title}
      </Link>
      {teamName && (
        <span className="max-w-28 shrink-0 truncate rounded bg-muted px-1.5 text-xs text-muted-foreground">
          {teamName}
        </span>
      )}
      {/* Fixed slots keep the columns aligned from row to row. */}
      <span className="inline-flex w-4 shrink-0 items-center gap-2 text-xs text-muted-foreground sm:w-36">
        {/* Every row says where its specification stands: a blank cell read
            as missing data. Plain work has no specification. */}
        {item.refinementState ? (
          <span
            title={
              item.refinementState === "ready"
                ? "Specification ready"
                : "Specification not ready"
            }
            className="inline-flex items-center gap-1"
          >
            <RefinementIcon state={item.refinementState} />
            <span className="hidden sm:inline">
              {refinementMeta[item.refinementState].label}
            </span>
          </span>
        ) : (
          <span
            title="Plain work, without a specification"
            className="hidden text-muted-foreground/60 sm:inline"
          >
            —
          </span>
        )}
        {item.blockingThreads > 0 && (
          <span
            title={`${item.blockingThreads} blocking discussion${item.blockingThreads === 1 ? "" : "s"}`}
            className="hidden items-center gap-1 font-medium text-destructive sm:inline-flex"
          >
            <CircleAlert aria-hidden className="size-3.5" />
            {item.blockingThreads} blocker
            {item.blockingThreads === 1 ? "" : "s"}
          </span>
        )}
      </span>
      {/* Delivery status, named where there is room so it is never mistaken
          for the specification's refinement state. */}
      <span
        className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground @min-[65rem]/frame:w-24"
        title={status ? `Delivery status: ${status.name}` : undefined}
      >
        <StatusIcon category={status?.category} color={status?.color} />
        <span className="hidden truncate @min-[65rem]/frame:inline">
          {status?.name}
        </span>
      </span>
      <span className="inline-flex w-7 shrink-0 justify-center">
        {estimate && (
          <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {estimate}
          </span>
        )}
      </span>
      {item.assigneeId ? (
        <Avatar
          userId={item.assigneeId}
          name={memberName(item.assigneeId)}
          size="xs"
        />
      ) : (
        <span className="size-4" />
      )}
      {actions && (
        <span className="relative z-10 flex items-center gap-1">{actions}</span>
      )}
    </div>
  );
}
