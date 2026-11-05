import { Link } from "@lictory/platform/lib/navigation";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Repeat,
  Rows3,
  Send,
  Settings2,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  activeStatuses,
  byRank,
  enabledTypes,
  isClosedCategory,
  isTopLevel,
  priorityMeta,
  priorityOrder,
  identifier,
  projectTeams,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  iterationLabel,
  type WorkItem,
  type WorkItemPriority,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Popover, Picker } from "@lictory/ui/popover";
import { PeoplePicker } from "@lictory/platform/components/ui/people-picker";
import { EmptyState } from "@lictory/ui/primitives";
import { MissingState } from "@lictory/ui/status-page";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { useShell } from "@lictory/platform/components/workspace/shell";
import { StatusIcon } from "@lictory/platform/components/items/status";
import {
  PriorityIcon,
  TypeIcon,
} from "@lictory/platform/components/items/icons";
import { shortRange } from "@lictory/platform/components/items/delivery-properties";
import {
  ItemCard,
  startBlocker,
} from "@lictory/platform/components/delivery/card";
import {
  ItemPeek,
  useItemPeek,
} from "@lictory/platform/components/delivery/item-peek";
import { projectDeliveryTool } from "@lictory/platform/components/delivery/provider-name";
import { LittoLauncher } from "@lictory/platform/components/intelligence/dock/launcher";

type Lane = "none" | "assignee" | "parent" | "priority";
const laneLabel: Record<Lane, string> = {
  none: "No swimlanes",
  assignee: "Assignee",
  parent: "Parent",
  priority: "Priority",
};
// Closed work drops off the board after two weeks; history stays in lists.
const DONE_WINDOW = 14 * 86_400_000;

// Board and backlog are project views; `?team=` narrows them to one team of
// the project, or to work without a team ("none").
export function useTeamFilter(project: Project) {
  const { delivery } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const all = projectTeams(delivery, project.id);
  const raw = params.get("team");
  const team = raw ? all.find((t) => t.id === raw) : undefined;
  const value: string | undefined = raw === "none" ? "none" : team?.id;
  const setParam = (key: string, next: string | undefined) => {
    const query = new URLSearchParams(params);
    if (next) query.set(key, next);
    else query.delete(key);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, {
      scroll: false,
    });
  };
  return {
    // undefined: all teams; "none": work without a team; otherwise a team id.
    value,
    team,
    teams: all
      .filter((t) => !t.archivedAt || t.id === value)
      .sort((a, b) => a.name.localeCompare(b.name)),
    teamName: (id: string | null) =>
      id ? delivery.teams.get(id)?.name : undefined,
    matches: (teamId: string | null) =>
      !value || (value === "none" ? !teamId : teamId === value),
    setTeam: (next: string | undefined) => setParam("team", next),
    setParam,
    params,
  };
}

export function TeamFilterPicker({
  filter,
}: {
  filter: ReturnType<typeof useTeamFilter>;
}) {
  if (!filter.teams.length && !filter.value) return null;
  return (
    <Popover
      width={220}
      trigger={(props) => (
        <Button {...props} variant="ghost" size="sm">
          <Users className="size-3.5" />
          {filter.value === "none"
            ? "No team"
            : (filter.team?.name ?? "All teams")}
        </Button>
      )}
    >
      <Picker
        title="Team"
        options={[
          { value: "all", label: "All teams" },
          ...filter.teams.map((t) => ({ value: t.id, label: t.name })),
          { value: "none", label: "No team" },
        ]}
        value={filter.value ?? "all"}
        onSelect={(v) => filter.setTeam(v === "all" ? undefined : v)}
      />
    </Popover>
  );
}

// External projects deliver in another tool: Lictory shows the hand-off instead of a
// board, backlog or iterations.
export function ExternalProjectNotice({
  project,
  surface,
}: {
  project: Project;
  surface: string;
}) {
  const { organization, directory } = useWorkspace();
  const tool = projectDeliveryTool(directory, project.id);
  return (
    <MissingState
      illustration="planning"
      icon={Send}
      title={`${project.name} delivers in ${tool.name}`}
      action={
        <Link
          href={paths.handoff(organization.slug, project.key)}
          className="contents"
        >
          <Button variant="secondary">Open hand-off</Button>
        </Link>
      }
    >
      Statuses, sprints and estimates for this project are owned by {tool.name},
      so there is no {surface} in Lictory. The hand-off shows what is ready,
      what changed since it was handed off and what {tool.name} reports back.
    </MissingState>
  );
}

export function Board() {
  const project = useProject();
  if (project.deliveryMode === "external")
    return <ExternalProjectNotice project={project} surface="board" />;
  return <ProjectBoard project={project} />;
}

function ProjectBoard({ project }: { project: Project }) {
  const {
    items,
    projects,
    delivery,
    organization,
    memberName,
    mutate,
    capabilitiesIn,
    canManage,
    view,
  } = useWorkspace();
  const capabilities = capabilitiesIn(project.id);
  const { openCreate, toast } = useShell();
  const teamFilter = useTeamFilter(project);
  const { params, setParam } = teamFilter;
  const peek = useItemPeek();
  const iterations = [...delivery.iterations.values()]
    .filter((i) => i.projectId === project.id && i.state !== "completed")
    .sort((a, b) => a.number - b.number);
  const active = iterations.find((i) => i.state === "active");
  const usesIterations = project.iterationMode !== "off";
  const iterationParam = params.get("iteration");
  const iterationId =
    iterationParam === "all"
      ? undefined
      : (iterationParam ?? (usesIterations ? active?.id : undefined));
  const iteration = iterationId
    ? delivery.iterations.get(iterationId)
    : undefined;
  const lane = (params.get("lanes") as Lane | null) ?? "none";
  const assignees = params.get("assignee")?.split(",").filter(Boolean) ?? [];
  const typeFilter = params.get("type")?.split(",").filter(Boolean) ?? [];
  const statuses = activeStatuses(delivery, project.id);
  const [showCanceled, setShowCanceled] = useState(false);
  const columns = statuses.filter(
    (s) => showCanceled || s.category !== "canceled",
  );
  // Fixed per mount: the done window needs day precision, not live updates.
  const [now] = useState(() => Date.now());
  const scoped = useMemo(
    () =>
      items
        .filter((i) => {
          if (i.projectId !== project.id || i.archivedAt) return false;
          if (!teamFilter.matches(i.teamId)) return false;
          // Higher-level types group delivery work; plan their children here.
          if (isTopLevel(typeOf(delivery, i))) return false;
          if (iterationId && i.iterationId !== iterationId) return false;
          const category = delivery.statuses.get(i.statusId)?.category;
          if (
            !iterationId &&
            isClosedCategory(category) &&
            now - new Date(i.updatedAt).getTime() > DONE_WINDOW
          )
            return false;
          if (
            assignees.length &&
            !assignees.includes(i.assigneeId ?? "unassigned")
          )
            return false;
          if (typeFilter.length && !typeFilter.includes(i.typeId)) return false;
          return true;
        })
        .sort(byRank),
    // Filters are read from `params`; listing it covers each of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, project.id, iterationId, delivery, params, now],
  );
  const lanes = useMemo(() => {
    if (lane === "none") return [{ key: "all", label: "", items: scoped }];
    const keyOf = (i: WorkItem) =>
      lane === "assignee"
        ? (i.assigneeId ?? "none")
        : lane === "parent"
          ? (i.parentId ?? "none")
          : i.priority;
    const keys =
      lane === "priority"
        ? priorityOrder.filter((p) => scoped.some((i) => i.priority === p))
        : [...new Set(scoped.map(keyOf))].sort((a, b) =>
            a === "none" ? 1 : b === "none" ? -1 : 0,
          );
    return keys.map((key) => ({
      key,
      label:
        lane === "assignee"
          ? key === "none"
            ? "Unassigned"
            : memberName(key)
          : lane === "parent"
            ? key === "none"
              ? "No parent"
              : (items.find((i) => i.id === key)?.title ?? "Parent")
            : priorityMeta[key as WorkItemPriority].label,
      items: scoped.filter((i) => keyOf(i) === key),
    }));
  }, [lane, scoped, items, memberName]);
  const [drag, setDrag] = useState<string>();
  const [over, setOver] = useState<{
    lane: string;
    statusId: string;
    index: number;
  }>();
  const canMove = capabilities.changeProperties;
  const projectOf = (i: WorkItem) => projects.find((p) => p.id === i.projectId);
  const drop = (laneKey: string, statusId: string, index: number) => {
    const item = scoped.find((i) => i.id === drag);
    setDrag(undefined);
    setOver(undefined);
    if (!item) return;
    const laneItems = lanes.find((l) => l.key === laneKey)?.items ?? scoped;
    const column = laneItems.filter(
      (i) => i.statusId === statusId && i.id !== item.id,
    );
    const blocker = startBlocker(delivery, project, item, statusId);
    const label = identifier(projectOf(item), item.number);
    if (blocker?.policy === "block") {
      toast(
        `${label} is not ready to start: ${blocker.detail}. ${project.name} requires a ready specification.`,
      );
      return;
    }
    const patch: {
      statusId?: string;
      assigneeId?: string | null;
      priority?: WorkItemPriority;
    } = {};
    if (item.statusId !== statusId) patch.statusId = statusId;
    if (lane === "assignee") {
      const assigneeId = laneKey === "none" ? null : laneKey;
      if (assigneeId !== item.assigneeId) patch.assigneeId = assigneeId;
    } else if (lane === "priority" && laneKey !== item.priority)
      patch.priority = laneKey as WorkItemPriority;
    if (Object.keys(patch).length)
      void mutate({
        type: "updateWorkItem",
        workItemId: item.id,
        ...patch,
      });
    const after = column[index - 1]?.id ?? null;
    const before = column[index]?.id ?? null;
    const current = laneItems.filter((i) => i.statusId === statusId);
    const at = current.findIndex((i) => i.id === item.id);
    const unchanged =
      at !== -1 &&
      current[at - 1]?.id === (after ?? undefined) &&
      current[at + 1]?.id === (before ?? undefined);
    if (!unchanged && (after || before))
      void mutate({
        type: "rankWorkItem",
        workItemId: item.id,
        afterId: after,
        beforeId: before,
      });
    if (blocker?.policy === "warn")
      toast(
        `${label} started before its specification is ready (${blocker.detail}).`,
      );
  };
  const indexAt = (e: React.DragEvent<HTMLElement>) => {
    const cards = [
      ...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]"),
    ].filter((c) => c.dataset.card !== drag);
    const index = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    return index === -1 ? cards.length : index;
  };
  const canCreate =
    capabilities.editSpecifications || capabilities.changeProperties;
  const createTeamId =
    teamFilter.value && teamFilter.value !== "none" ? teamFilter.value : null;
  const filtered = Boolean(
    assignees.length || typeFilter.length || teamFilter.value,
  );
  const points = scoped.reduce((sum, i) => sum + (i.estimate ?? 0), 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="truncate text-sm font-semibold">{project.name}</h1>
        <span className="text-xs text-muted-foreground">Board</span>
        <TeamFilterPicker filter={teamFilter} />
        {usesIterations && (
          <Popover
            width={260}
            trigger={(props) => (
              <Button {...props} variant="ghost" size="sm">
                <Repeat className="size-3.5" />
                {iteration
                  ? iterationLabel(iteration, project?.iterationMode)
                  : "All work"}
                {iteration?.state === "active" && (
                  <span className="inline-flex h-5 items-center gap-1 rounded-full bg-success/8 px-2 font-mono text-[10.5px] font-medium tracking-[0.06em] text-success uppercase ring-1 ring-success/20 ring-inset">
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-success"
                    />
                    Active
                  </span>
                )}
              </Button>
            )}
          >
            <Picker
              title={project.iterationMode === "automatic" ? "Cycle" : "Sprint"}
              options={[
                { value: "all", label: "All work" },
                ...iterations.map((i) => ({
                  value: i.id,
                  label: iterationLabel(i, project?.iterationMode),
                  hint: i.state === "active" ? "Active" : shortRange(i),
                })),
              ]}
              value={iterationId ?? "all"}
              onSelect={(v) => setParam("iteration", v)}
            />
          </Popover>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {scoped.length} items
          {project.estimateScale !== "none" && points > 0 && ` · ${points} pts`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Popover
            width={260}
            align="end"
            trigger={(props) => (
              <Button {...props} variant="ghost" size="sm">
                <UserRound className="size-3.5" />
                {assignees.length ? `${assignees.length} people` : "Anyone"}
              </Button>
            )}
          >
            <PeoplePicker
              multiple
              title="Assignee"
              none={{ value: "unassigned", label: "Unassigned" }}
              value={assignees}
              onSelect={(v) =>
                setParam(
                  "assignee",
                  (assignees.includes(v)
                    ? assignees.filter((x) => x !== v)
                    : [...assignees, v]
                  ).join(","),
                )
              }
            />
          </Popover>
          <Popover
            width={220}
            align="end"
            trigger={(props) => (
              <Button {...props} variant="ghost" size="sm">
                {typeFilter.length ? `${typeFilter.length} types` : "All types"}
              </Button>
            )}
          >
            <Picker
              multiple
              title="Types"
              options={enabledTypes(delivery, project.id)
                .filter((t) => !isTopLevel(t))
                .map((t) => ({
                  value: t.id,
                  label: t.name,
                  icon: <TypeIcon type={t} />,
                }))}
              value={typeFilter}
              onSelect={(v) =>
                setParam(
                  "type",
                  (typeFilter.includes(v)
                    ? typeFilter.filter((x) => x !== v)
                    : [...typeFilter, v]
                  ).join(","),
                )
              }
            />
          </Popover>
          <Popover
            width={220}
            align="end"
            trigger={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="sm"
                aria-label="Board options"
              >
                <Rows3 className="size-3.5" />
              </Button>
            )}
          >
            <div className="p-1">
              <p className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
                Swimlanes
              </p>
              {(Object.keys(laneLabel) as Lane[]).map((key) => (
                <button
                  key={key}
                  onClick={() =>
                    setParam("lanes", key === "none" ? undefined : key)
                  }
                  className={cn(
                    "flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                    lane === key && "font-medium text-primary",
                  )}
                >
                  {laneLabel[key]}
                </button>
              ))}
              <div className="my-1 border-t" />
              <label className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={showCanceled}
                  onChange={(e) => setShowCanceled(e.target.checked)}
                />
                Show canceled column
              </label>
            </div>
          </Popover>
          {canManage(project.id) && (
            <Link
              href={paths.projectSettings(
                organization.slug,
                project.key,
                "workflow",
              )}
              className="contents"
            >
              <Button
                variant="ghost"
                size="icon"
                aria-label="Workflow settings"
                title="Workflow settings"
              >
                <Settings2 className="size-3.5" />
              </Button>
            </Link>
          )}
          <span aria-hidden className="mx-1 h-4 w-px bg-border max-lg:hidden" />
          <LittoLauncher />
        </div>
      </header>
      {usesIterations && iterationParam !== "all" && !iteration ? (
        <EmptyState
          illustration="planning"
          title={`No active ${project.iterationMode === "automatic" ? "cycle" : "sprint"}`}
          action={
            <Link
              href={paths.backlog(
                organization.slug,
                project.key,
                teamFilter.value,
              )}
              className="contents"
            >
              <Button variant="secondary">Plan in the backlog</Button>
            </Link>
          }
        >
          {project.iterationMode === "automatic"
            ? "The next cycle starts automatically. Plan work in the backlog, or view all work on the board."
            : "Start a sprint from the backlog, or view all work on the board."}
        </EmptyState>
      ) : (
        <BoardScroller>
          <div
            className={cn(
              "inline-flex min-h-full min-w-full flex-col gap-3 p-3 pr-4",
              // Room to scroll the last column and cards out from under the
              // docked preview.
              peek.peeked && "pb-[60dvh] sm:pr-[400px] sm:pb-3 2xl:pr-[440px]",
            )}
          >
            {lanes.map((l) => (
              <section
                key={l.key}
                aria-label={l.label || "Board"}
                className={cn(lanes.length === 1 && "flex flex-1 flex-col")}
              >
                {lane !== "none" && (
                  <h2 className="sticky left-3 mb-1.5 inline-flex items-center gap-2 text-xs font-medium">
                    {lane === "priority" && (
                      <PriorityIcon priority={l.key as WorkItemPriority} />
                    )}
                    {l.label}
                    <span className="text-muted-foreground tabular-nums">
                      {l.items.length}
                    </span>
                  </h2>
                )}
                <div
                  className={cn("flex gap-2.5", lanes.length === 1 && "flex-1")}
                >
                  {columns.map((status) => {
                    const cards = l.items.filter(
                      (i) => i.statusId === status.id,
                    );
                    const target =
                      over?.lane === l.key && over.statusId === status.id;
                    const columnPoints = cards.reduce(
                      (sum, i) => sum + (i.estimate ?? 0),
                      0,
                    );
                    return (
                      <div
                        key={status.id}
                        data-board-column={status.id}
                        className={cn(
                          "flex max-w-[340px] min-w-[224px] flex-1 basis-0 flex-col rounded-[1.125rem] bg-tray p-1.5 ring-1 ring-border/60 ring-inset",
                          target && "bg-primary/8 ring-1 ring-primary/30",
                        )}
                        onDragOver={(e) => {
                          if (!drag) return;
                          e.preventDefault();
                          const index = indexAt(e);
                          if (
                            over?.lane !== l.key ||
                            over.statusId !== status.id ||
                            over.index !== index
                          )
                            setOver({
                              lane: l.key,
                              statusId: status.id,
                              index,
                            });
                        }}
                        onDragLeave={(e) => {
                          if (
                            !e.currentTarget.contains(
                              e.relatedTarget as Node | null,
                            )
                          )
                            setOver(undefined);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          drop(l.key, status.id, indexAt(e));
                        }}
                      >
                        {l.key === lanes[0]!.key && (
                          <ColumnHeader
                            status={status}
                            count={cards.length}
                            points={
                              project.estimateScale !== "none"
                                ? columnPoints
                                : undefined
                            }
                            onCreate={
                              canCreate
                                ? () =>
                                    openCreate({
                                      intent: "work",
                                      projectId: project.id,
                                      teamId: createTeamId,
                                      statusId: status.id,
                                      iterationId: iterationId ?? null,
                                    })
                                : undefined
                            }
                          />
                        )}
                        <div className="flex min-h-12 flex-col gap-1.5">
                          {cards.map((item, index) => (
                            <div key={item.id}>
                              {target && over.index === index && <DropLine />}
                              <ItemCard
                                item={item}
                                project={projectOf(item)}
                                teamName={
                                  teamFilter.value
                                    ? undefined
                                    : teamFilter.teamName(item.teamId)
                                }
                                delivery={delivery}
                                orgSlug={organization.slug}
                                memberName={memberName}
                                dragging={drag === item.id}
                                draggable={canMove}
                                selected={
                                  peek.peeked ===
                                  identifier(project, item.number)
                                }
                                onOpen={peek.onLinkClick}
                                onDragStart={(e) => {
                                  setDrag(item.id);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", item.id);
                                }}
                                onDragEnd={() => {
                                  setDrag(undefined);
                                  setOver(undefined);
                                }}
                              />
                            </div>
                          ))}
                          {target &&
                            over.index >=
                              cards.filter((c) => c.id !== drag).length && (
                              <DropLine />
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          {!scoped.length && view.status !== "hydrating" && (
            <EmptyState
              illustration={filtered ? "search" : "planning"}
              title={
                filtered ? "No matching work" : "No work on this board yet"
              }
            >
              {filtered
                ? "Adjust the filters to see more work."
                : "Accept a ready specification for delivery, or create a task when the work needs no specification."}
            </EmptyState>
          )}
        </BoardScroller>
      )}
      <ItemPeek project={project} peek={peek} />
    </div>
  );
}

function DropLine() {
  return <div className="my-0.5 h-0.5 rounded-full bg-primary" aria-hidden />;
}

function ColumnHeader({
  status,
  count,
  points,
  onCreate,
}: {
  status: ReturnType<typeof activeStatuses>[number];
  count: number;
  points?: number;
  onCreate?: () => void;
}): ReactNode {
  return (
    <div className="flex h-8 items-center gap-1.5 px-1.5 text-xs font-medium">
      <StatusIcon category={status.category} color={status.color} />
      <span className="truncate">{status.name}</span>
      <span className="text-muted-foreground tabular-nums">{count}</span>
      {points !== undefined && points > 0 && (
        <span className="text-muted-foreground tabular-nums">
          · {points} pts
        </span>
      )}
      {onCreate && (
        <button
          onClick={onCreate}
          aria-label={`New item in ${status.name}`}
          className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// The board scrolls sideways when its columns outgrow the frame (Litto open
// on a laptop). A fade on the edge that has more columns says so, instead of
// the last column looking cut off.
function BoardScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((m) =>
        m.left === left && m.right === right ? m : { left, right },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);
  // Steps to the next column that is partly out of view, aligning its edge
  // with the board's, so repeated presses never stop mid-column.
  const step = (side: "left" | "right") => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const edges = [...el.querySelectorAll<HTMLElement>("[data-board-column]")]
      .map((column) => {
        const r = column.getBoundingClientRect();
        return {
          left: r.left - box.left + el.scrollLeft,
          right: r.right - box.left + el.scrollLeft,
        };
      })
      .sort((a, b) => a.left - b.left);
    const view = { left: el.scrollLeft, right: el.scrollLeft + el.clientWidth };
    const gutter = 12;
    const target =
      side === "right"
        ? edges.find((c) => c.right > view.right + 1)
        : edges.findLast((c) => c.left < view.left - 1);
    const left = target
      ? side === "right"
        ? target.right - el.clientWidth + gutter
        : target.left - gutter
      : side === "right"
        ? el.scrollWidth
        : 0;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} className="h-full [scrollbar-width:thin] overflow-auto">
        {children}
      </div>
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          className={cn(
            "pointer-events-none absolute inset-y-0 flex items-center transition-opacity duration-150",
            side === "left"
              ? "left-0 w-12 justify-start bg-linear-to-r pl-1.5"
              : "right-0 w-16 justify-end bg-linear-to-l pr-1.5",
            "from-background to-transparent",
            more[side] ? "opacity-100" : "opacity-0",
          )}
        >
          {/* More columns that way: one press scrolls by a column. */}
          <button
            type="button"
            tabIndex={more[side] ? 0 : -1}
            aria-hidden={!more[side] || undefined}
            aria-label={
              side === "left"
                ? "Scroll to earlier columns"
                : "Scroll to later columns"
            }
            onClick={() => step(side)}
            className={cn(
              "grid size-8 place-items-center rounded-full bg-card text-muted-foreground shadow-(--shadow-border) transition-[color,transform] duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.95]",
              more[side] && "pointer-events-auto",
            )}
          >
            {side === "left" ? (
              <ChevronLeft className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
