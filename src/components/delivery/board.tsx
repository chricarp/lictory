"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Plus, Repeat, Rows3, Settings2, UserRound } from "lucide-react";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  activeStatuses,
  byRank,
  isClosedCategory,
  isTopLevel,
  priorityMeta,
  priorityOrder,
  identifier,
  typeOf,
} from "~/lib/work-items";
import {
  iterationLabel,
  type WorkItem,
  type WorkItemPriority,
} from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Popover, Picker } from "~/components/ui/popover";
import { PeoplePicker } from "~/components/ui/people-picker";
import { EmptyState } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { useShell } from "~/components/workspace/shell";
import { StatusIcon } from "~/components/items/status";
import { PriorityIcon, TypeIcon } from "~/components/items/icons";
import { shortRange } from "~/components/items/delivery-properties";
import { useTeam } from "./team-gate";
import { ItemCard, startBlocker } from "./card";

type Lane = "none" | "assignee" | "parent" | "priority";
const laneLabel: Record<Lane, string> = {
  none: "No swimlanes",
  assignee: "Assignee",
  parent: "Epic",
  priority: "Priority",
};
// Closed work drops off the board after two weeks; history stays in lists.
const DONE_WINDOW = 14 * 86_400_000;

export function Board() {
  const team = useTeam();
  const {
    items,
    projects,
    delivery,
    organization,
    memberName,
    mutate,
    capabilities,
  } = useWorkspace();
  const { openCreate, toast } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };
  const iterations = [...delivery.iterations.values()]
    .filter((i) => i.teamId === team.id && i.state !== "completed")
    .sort((a, b) => a.number - b.number);
  const active = iterations.find((i) => i.state === "active");
  const usesIterations = team.iterationMode !== "off";
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
  const statuses = activeStatuses(team);
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
          if (i.teamId !== team.id || i.archivedAt) return false;
          // Epics are containers; the board shows the work inside them.
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
    [items, team.id, iterationId, delivery, params, now],
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
              ? "No epic"
              : (items.find((i) => i.id === key)?.title ?? "Epic")
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
    const blocker = startBlocker(delivery, team, item, statusId);
    const label = identifier(projectOf(item), item.number);
    if (blocker?.policy === "block") {
      toast(
        `${label} is not ready to start: ${blocker.detail}. ${team.name} requires a ready specification.`,
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
  const defaultProject =
    projects.find((p) => p.defaultTeamId === team.id) ?? projects[0];
  const points = scoped.reduce((sum, i) => sum + (i.estimate ?? 0), 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="truncate text-sm font-semibold">{team.name}</h1>
        <span className="text-xs text-muted-foreground">Board</span>
        {usesIterations && (
          <Popover
            width={260}
            trigger={(props) => (
              <Button {...props} variant="ghost" size="sm">
                <Repeat className="size-3.5" />
                {iteration ? iterationLabel(iteration) : "All work"}
                {iteration?.state === "active" && (
                  <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                    Active
                  </span>
                )}
              </Button>
            )}
          >
            <Picker
              title={team.iterationMode === "automatic" ? "Cycle" : "Sprint"}
              options={[
                { value: "all", label: "All work" },
                ...iterations.map((i) => ({
                  value: i.id,
                  label: iterationLabel(i),
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
          {team.estimateScale !== "none" && points > 0 && ` · ${points} pts`}
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
              options={[...delivery.types.values()]
                .filter((t) => team.typeIds.includes(t.id) && !t.archivedAt)
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
          <Link
            href={paths.teamSettings(organization.slug, team.id)}
            className="contents"
          >
            <Button variant="ghost" size="icon" aria-label="Team settings">
              <Settings2 className="size-3.5" />
            </Button>
          </Link>
        </div>
      </header>
      {team.deliveryMode === "external" && (
        <p className="border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200">
          {team.name} tracks delivery in an external tool. This board is a
          read-mostly view; export ready work to Jira from each item instead of
          moving it here.
        </p>
      )}
      {usesIterations && iterationParam !== "all" && !iteration ? (
        <EmptyState
          title="No active iteration"
          action={
            <Link
              href={paths.backlog(organization.slug, team.id)}
              className="contents"
            >
              <Button variant="secondary">Plan in the backlog</Button>
            </Link>
          }
        >
          Start a sprint from the backlog, or view all work on the board.
        </EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="inline-flex min-w-full flex-col gap-3 p-3">
            {lanes.map((l) => (
              <section key={l.key} aria-label={l.label || "Board"}>
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
                <div className="flex gap-3">
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
                        className={cn(
                          "flex w-[272px] shrink-0 flex-col rounded-xl bg-muted/50 p-1.5",
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
                              team.estimateScale !== "none"
                                ? columnPoints
                                : undefined
                            }
                            onCreate={
                              capabilities.editSpecifications && defaultProject
                                ? () =>
                                    openCreate({
                                      projectId: defaultProject.id,
                                      teamId: team.id,
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
                                team={team}
                                delivery={delivery}
                                orgSlug={organization.slug}
                                memberName={memberName}
                                dragging={drag === item.id}
                                draggable={canMove}
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
        </div>
      )}
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
