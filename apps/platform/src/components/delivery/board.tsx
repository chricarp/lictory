import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { dropdownItemClass } from "@lictory/ui/dropdown";
import { Checkbox } from "@lictory/ui/checkbox";
import { ContextControl } from "@lictory/platform/components/knowledge/context";
import { Link } from "@lictory/platform/lib/navigation";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  KanbanSquare,
  ListFilter,
  Plus,
  Repeat,
  Rows3,
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
import { LittoLauncher } from "@lictory/platform/components/intelligence/dock/launcher";
import {
  useAgents,
  useLiveClaims,
} from "@lictory/platform/components/claims/claims";
import { useOpenPullRequestsByItem } from "@lictory/platform/components/code/store";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { ScrollStrip } from "@lictory/platform/components/shell/scroll-strip";
import { ExternalProjectNotice } from "@lictory/platform/components/delivery/external-notice";
import { StatusChip, StatusDot } from "@lictory/ui/status-chip";

type Lane = "none" | "assignee" | "parent" | "priority";
const laneLabel: Record<Lane, string> = {
  none: "No swimlanes",
  assignee: "Assignee",
  parent: "Parent",
  priority: "Priority",
};
const choiceRowClass = cn(
  dropdownItemClass,
  "data-checked:font-medium data-checked:text-primary",
);
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

export function Board() {
  const project = useProject();
  if (project.deliveryMode === "external")
    return (
      <ExternalProjectNotice
        project={project}
        surface="board"
        title="Board"
        icon={<KanbanSquare />}
      />
    );
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
  // Agent claims, as a compact mark on each claimed card.
  const claims = useLiveClaims();
  const agentById = useAgents();
  // Open pull requests, as a chip on each card they deliver.
  const pullRequests = useOpenPullRequestsByItem();
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
  // Board work without a team, for the hint when a team's board is empty.
  const teamless = items.filter(
    (i) =>
      i.projectId === project.id &&
      !i.archivedAt &&
      !i.teamId &&
      !isTopLevel(typeOf(delivery, i)) &&
      (iterationId
        ? i.iterationId === iterationId
        : !isClosedCategory(delivery.statuses.get(i.statusId)?.category) ||
          now - new Date(i.updatedAt).getTime() <= DONE_WINDOW),
  ).length;
  const assigneeSummary = assignees.length
    ? `${assignees.length} ${assignees.length === 1 ? "person" : "people"}`
    : "Anyone";
  const typeSummary = typeFilter.length
    ? `${typeFilter.length} ${typeFilter.length === 1 ? "type" : "types"}`
    : "All types";
  const toggle = (key: string, list: string[], v: string) =>
    setParam(
      key,
      (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(","),
    );
  const assigneePicker = (
    <PeoplePicker
      multiple
      title="Assignee"
      none={{ value: "unassigned", label: "Unassigned" }}
      value={assignees}
      onSelect={(v) => toggle("assignee", assignees, v)}
    />
  );
  const typePicker = (
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
      onSelect={(v) => toggle("type", typeFilter, v)}
    />
  );
  const teamPicker = (
    <Picker
      title="Team"
      options={[
        { value: "all", label: "All teams" },
        ...teamFilter.teams.map((t) => ({ value: t.id, label: t.name })),
        { value: "none", label: "No team" },
      ]}
      value={teamFilter.value ?? "all"}
      onSelect={(v) => teamFilter.setTeam(v === "all" ? undefined : v)}
    />
  );
  const boardOptions = (
    <div className="p-1">
      <p className="px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground">
        Swimlanes
      </p>
      <RadioGroup<Lane>
        aria-label="Swimlanes"
        value={lane}
        onValueChange={(next) => {
          if (next) setParam("lanes", next === "none" ? undefined : next);
        }}
        className="flex flex-col gap-0"
      >
        {(Object.keys(laneLabel) as Lane[]).map((key) => (
          <Radio key={key} value={key} className={choiceRowClass}>
            {laneLabel[key]}
          </Radio>
        ))}
      </RadioGroup>
      <div className="my-1 border-t" />
      <label className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
        <Checkbox
          checked={showCanceled}
          onCheckedChange={(checked) => setShowCanceled(checked === true)}
        />
        Show canceled column
      </label>
    </div>
  );
  // Phones show one column per screen: start at the first one with work,
  // not at an empty Backlog.
  const firstFilled = columns.find((c) =>
    scoped.some((i) => i.statusId === c.id),
  )?.id;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Board"
        icon={<KanbanSquare />}
        breadcrumbs={[
          {
            label: project.name,
            href: paths.project(organization.slug, project.key),
          },
        ]}
        meta={
          // Counts per column sit in the column headers; this is the total.
          <span className="tabular-nums">
            {scoped.length} {scoped.length === 1 ? "item" : "items"}
            {project.estimateScale !== "none" &&
              points > 0 &&
              ` · ${points} pts`}
          </span>
        }
        actions={
          <>
            {usesIterations && (
              <Popover
                width={260}
                align="end"
                trigger={(props) => (
                  <Button
                    {...props}
                    variant="ghost"
                    size="sm"
                    // Room for the sprint's name beside the Active chip.
                    className="max-w-72 max-sm:max-w-40"
                  >
                    <Repeat className="size-3.5" />
                    <span className="min-w-0 truncate">
                      {iteration
                        ? iterationLabel(iteration, project?.iterationMode)
                        : "All work"}
                    </span>
                    {iteration?.state === "active" && (
                      <StatusChip
                        tone="success"
                        icon={<StatusDot />}
                        className="shrink-0 max-sm:hidden"
                      >
                        Active
                      </StatusChip>
                    )}
                  </Button>
                )}
              >
                <Picker
                  title={
                    project.iterationMode === "automatic" ? "Cycle" : "Sprint"
                  }
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
            {/* Phones: one button for every filter. */}
            <div className="sm:hidden">
              <BoardFilters
                active={
                  assignees.length +
                  typeFilter.length +
                  (lane !== "none" ? 1 : 0) +
                  (teamFilter.value ? 1 : 0)
                }
                views={{
                  ...(teamFilter.teams.length || teamFilter.value
                    ? {
                        team: {
                          label: "Team",
                          value:
                            teamFilter.value === "none"
                              ? "No team"
                              : (teamFilter.team?.name ?? "All teams"),
                          content: teamPicker,
                        },
                      }
                    : {}),
                  assignee: {
                    label: "Assignee",
                    value: assigneeSummary,
                    content: assigneePicker,
                  },
                  type: {
                    label: "Types",
                    value: typeSummary,
                    content: typePicker,
                  },
                  options: {
                    label: "Swimlanes",
                    value: laneLabel[lane],
                    content: boardOptions,
                  },
                }}
              />
            </div>
            <div className="flex items-center gap-1 max-sm:hidden">
              <TeamFilterPicker filter={teamFilter} />
              <ContextControl
                project={project}
                lists={[
                  { label: project.name },
                  ...(createTeamId
                    ? [
                        {
                          label:
                            delivery.teams.get(createTeamId)?.name ?? "Team",
                          teamId: createTeamId,
                        },
                      ]
                    : []),
                  ...(iteration
                    ? [
                        {
                          label: iterationLabel(
                            iteration,
                            project.iterationMode,
                          ),
                          iterationId: iteration.id,
                          iteration,
                        },
                      ]
                    : []),
                ]}
              />
              <Popover
                width={260}
                align="end"
                trigger={(props) => (
                  <Button {...props} variant="ghost" size="sm">
                    <UserRound className="size-3.5" />
                    {assigneeSummary}
                  </Button>
                )}
              >
                {assigneePicker}
              </Popover>
              <Popover
                width={220}
                align="end"
                trigger={(props) => (
                  <Button {...props} variant="ghost" size="sm">
                    {typeSummary}
                  </Button>
                )}
              >
                {typePicker}
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
                {boardOptions}
              </Popover>
              {canManage(project.id) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Workflow settings"
                  title="Workflow settings"
                  render={
                    <Link
                      href={paths.projectSettings(
                        organization.slug,
                        project.key,
                        "workflow",
                      )}
                    />
                  }
                >
                  <Settings2 className="size-3.5" />
                </Button>
              )}
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              <LittoLauncher />
            </div>
          </>
        }
      />
      {usesIterations && iterationParam !== "all" && !iteration ? (
        <EmptyState
          illustration="planning"
          title={`No active ${project.iterationMode === "automatic" ? "cycle" : "sprint"}`}
          action={
            <Button
              variant="secondary"
              render={
                <Link
                  href={paths.backlog(
                    organization.slug,
                    project.key,
                    teamFilter.value,
                  )}
                />
              }
            >
              Plan in the backlog
            </Button>
          }
        >
          {project.iterationMode === "automatic"
            ? "The next cycle starts automatically. Plan work in the backlog, or view all work on the board."
            : "Start a sprint from the backlog, or view all work on the board."}
        </EmptyState>
      ) : (
        <BoardScroller
          startAt={firstFilled}
          columns={columns.map((c) => ({
            status: c,
            count: scoped.filter((i) => i.statusId === c.id).length,
          }))}
        >
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
                          // Phones: one column per screen, snapping, with
                          // the next one showing at the edge so the flow
                          // reads as a row of columns.
                          "max-sm:max-w-none max-sm:min-w-[calc(100vw-5.5rem)] max-sm:snap-start",
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
                                dragging={drag === item.id}
                                draggable={canMove}
                                selected={
                                  peek.peeked ===
                                  identifier(project, item.number)
                                }
                                onOpen={peek.onLinkClick}
                                claim={claims.get(item.id)}
                                pullRequests={pullRequests.get(item.id)}
                                claimAgent={agentById.get(
                                  claims.get(item.id)?.agentId ?? "",
                                )}
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
              {teamFilter.team && !assignees.length && !typeFilter.length
                ? teamless > 0
                  ? `No work on this board belongs to ${teamFilter.team.name}. ${teamless} ${teamless === 1 ? "item has" : "items have"} no team yet: choose “No team” to see ${teamless === 1 ? "it" : "them"}, and set the team on the item.`
                  : `No work on this board belongs to ${teamFilter.team.name} yet.`
                : filtered
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
          className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// The board scrolls sideways when its columns outgrow the frame (Litto open
// on a laptop). A fade on the edge that has more columns says so, instead of
// the last column looking cut off. Phones show one column per screen and,
// above it, every column by name and count: the whole flow at a glance, and
// a press on a name brings that column into view (no arrows over cards).
function BoardScroller({
  children,
  startAt,
  columns,
}: {
  children: ReactNode;
  // The column phones open at (one column fills the screen there).
  startAt?: string;
  columns: readonly {
    status: ReturnType<typeof activeStatuses>[number];
    count: number;
  }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  // On a phone (also one the window narrows to), open at the first column
  // that holds work instead of an empty one, once, unless the person has
  // already scrolled.
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !startAt) return;
    const phone = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      if (started.current || !phone.matches || el.scrollLeft > 0) return;
      const column = el.querySelector<HTMLElement>(
        `[data-board-column="${CSS.escape(startAt)}"]`,
      );
      if (!column) return;
      started.current = true;
      el.scrollLeft =
        column.getBoundingClientRect().left -
        el.getBoundingClientRect().left -
        12;
    };
    apply();
    phone.addEventListener("change", apply);
    return () => phone.removeEventListener("change", apply);
  }, [startAt]);
  const [more, setMore] = useState({ left: false, right: false });
  const [inView, setInView] = useState<string | undefined>(startAt);
  const show = (id: string) => {
    const el = ref.current;
    const column = el?.querySelector<HTMLElement>(
      `[data-board-column="${CSS.escape(id)}"]`,
    );
    if (!el || !column) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({
      left:
        column.getBoundingClientRect().left -
        el.getBoundingClientRect().left +
        el.scrollLeft -
        12,
      behavior: reduce ? "auto" : "smooth",
    });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((m) =>
        m.left === left && m.right === right ? m : { left, right },
      );
      // The column nearest the board's start edge is the one in view.
      const box = el.getBoundingClientRect();
      let nearest: string | undefined;
      let distance = Infinity;
      for (const column of el.querySelectorAll<HTMLElement>(
        "[data-board-column]",
      )) {
        const d = Math.abs(column.getBoundingClientRect().left - box.left);
        if (d < distance) {
          distance = d;
          nearest = column.dataset.boardColumn;
        }
      }
      setInView(nearest);
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScrollStrip className="shrink-0 border-b sm:hidden">
        <ul
          aria-label="Board columns"
          className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-3 py-1.5"
        >
          {columns.map(({ status, count }) => (
            <li key={status.id}>
              <button
                type="button"
                aria-pressed={inView === status.id}
                onClick={() => show(status.id)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] whitespace-nowrap text-muted-foreground focus-ring-inset outline-none",
                  inView === status.id &&
                    "bg-muted font-medium text-foreground",
                )}
              >
                <StatusIcon category={status.category} color={status.color} />
                {status.name}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollStrip>
      <div
        ref={ref}
        className="min-h-0 flex-1 [scrollbar-width:thin] overflow-auto max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-3"
      >
        {children}
      </div>
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          className={cn(
            // Wider screens only: phones step with the column names above.
            "pointer-events-none absolute inset-y-0 flex items-center transition-opacity duration-150 max-sm:hidden",
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
              "grid size-8 place-items-center rounded-full bg-card text-muted-foreground shadow-(--shadow-border) focus-ring transition-[color,transform] duration-150 outline-none hover:text-foreground active:scale-[0.95]",
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

type FilterView = { label: string; value: string; content: ReactNode };

// Every board filter behind one button, for phones: a list of what is
// filtered, each opening its picker in place, with a way back.
function BoardFilters({
  views,
  active,
}: {
  views: Record<string, FilterView>;
  // How many filters are set.
  active: number;
}) {
  const [shown, setShown] = useState<string>();
  const view = shown ? views[shown] : undefined;
  return (
    <Popover
      width={280}
      align="end"
      onOpenChange={(open) => !open && setShown(undefined)}
      trigger={(props) => (
        <Button
          {...props}
          variant="ghost"
          size="icon"
          aria-label={active ? `Filters (${active} set)` : "Filters"}
          className="relative"
        >
          <ListFilter className="size-4" />
          {active > 0 && (
            <span
              aria-hidden
              className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
            />
          )}
        </Button>
      )}
    >
      {view ? (
        <div className="flex max-h-[70dvh] min-h-0 flex-col">
          <button
            type="button"
            onClick={() => setShown(undefined)}
            className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2.5 text-[13px] text-muted-foreground focus-ring-inset outline-none hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            Filters
          </button>
          <div className="min-h-0 overflow-y-auto">{view.content}</div>
        </div>
      ) : (
        <ul aria-label="Filters" className="p-1">
          {Object.entries(views).map(([key, v]) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => setShown(key)}
                className="flex h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] focus-ring-inset outline-none hover:bg-muted"
              >
                <span className="font-medium">{v.label}</span>
                <span className="ml-auto truncate text-muted-foreground">
                  {v.value}
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
