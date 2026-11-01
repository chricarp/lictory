import { Link } from "@lictory/platform/lib/navigation";
import { useMemo, useState } from "react";
import { useParams } from "@lictory/platform/lib/navigation";
import {
  ArrowDownToLine,
  CalendarClock,
  Inbox,
  KanbanSquare,
  ListTodo,
  Plus,
  Settings2,
  Undo2,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  byRank,
  categoryOf,
  identifier,
  isClosedCategory,
  isTopLevel,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  iterationLabel,
  type Team,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Popover, Picker } from "@lictory/ui/popover";
import { Avatar, EmptyState } from "@lictory/ui/primitives";
import { MissingState } from "@lictory/ui/status-page";
import { LoadingState } from "@lictory/ui/spinner";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { useShell } from "@lictory/platform/components/workspace/shell";
import { shortRange } from "@lictory/platform/components/items/delivery-properties";
import { estimateLabel } from "@lictory/platform/components/delivery/card";
import { BacklogRow } from "@lictory/platform/components/delivery/backlog";
import {
  ItemPeek,
  useItemPeek,
} from "@lictory/platform/components/delivery/item-peek";

// A team's own backlog: the work it has taken on but not yet planned (into an
// iteration, or for external projects, handed off), ranked by the team, plus
// the project's unclaimed work it can take. Teams own no configuration; the
// project's workflow and cadence apply.
export function TeamBacklog() {
  const project = useProject();
  const { delivery, organization } = useWorkspace();
  const params = useParams<{ team: string }>();
  const team = delivery.teams.get(decodeURIComponent(params.team ?? ""));
  if (team?.projectId !== project.id)
    return (
      <MissingState
        illustration="search"
        icon={ListTodo}
        title="This team was not found"
        action={
          <Link
            href={paths.projectSettings(
              organization.slug,
              project.key,
              "teams",
            )}
            className="contents"
          >
            <Button variant="secondary">See the project&apos;s teams</Button>
          </Link>
        }
      >
        It may belong to another project, or the link is out of date.
      </MissingState>
    );
  return <TeamBacklogView project={project} team={team} />;
}

function TeamBacklogView({ project, team }: { project: Project; team: Team }) {
  const {
    items,
    delivery,
    organization,
    memberName,
    mutate,
    capabilitiesIn,
    canManage,
    view,
    directory,
  } = useWorkspace();
  const { openCreate } = useShell();
  const capabilities = capabilitiesIn(project.id);
  const canTriage = capabilities.changeProperties;
  const canCreate =
    capabilities.editSpecifications || capabilities.changeProperties;
  const native = project.deliveryMode === "native";
  const usesIterations = native && project.iterationMode !== "off";
  const org = organization.slug;
  // External projects plan by handing work off; a synced link means it is in
  // the delivery tool.
  const handedOff = useMemo(() => {
    const ids = new Set<string>();
    for (const e of Object.values(view.entities))
      if (
        e.type === "externalLink" &&
        e.projectId === project.id &&
        e.externalKey
      )
        ids.add(e.workItemId);
    return ids;
  }, [view.entities, project.id]);
  const open = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.projectId === project.id &&
            !i.archivedAt &&
            // Epics group work; teams plan their children.
            !isTopLevel(typeOf(delivery, i)) &&
            !isClosedCategory(categoryOf(delivery, i)),
        )
        .sort(byRank),
    [items, project.id, delivery],
  );
  const planned = (i: WorkItem) =>
    native ? Boolean(i.iterationId) : handedOff.has(i.id);
  const backlog = open.filter((i) => i.teamId === team.id && !planned(i));
  const intake = open.filter((i) => !i.teamId && !planned(i));
  const iterations = [...delivery.iterations.values()]
    .filter((i) => i.projectId === project.id && i.state !== "completed")
    .sort((a, b) => a.number - b.number);
  const inIterations = iterations
    .map((it) => ({
      iteration: it,
      rows: open.filter((i) => i.teamId === team.id && i.iterationId === it.id),
    }))
    .filter((x) => x.rows.length);
  const handedOffRows = native
    ? []
    : open.filter((i) => i.teamId === team.id && handedOff.has(i.id));
  const members = team.memberIds
    .map((id) => directory.members.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  const [drag, setDrag] = useState<string>();
  const [over, setOver] = useState<number>();
  const peek = useItemPeek();
  const peekProps = (item: WorkItem) => ({
    selected: peek.peeked === identifier(project, item.number),
    onOpen: peek.onLinkClick,
  });
  const hrefOf = (item: WorkItem) =>
    paths.item(org, project.key, identifier(project, item.number));
  const update = (
    item: WorkItem,
    patch: { teamId?: string | null; iterationId?: string | null },
  ) => void mutate({ type: "updateWorkItem", workItemId: item.id, ...patch });
  // The team ranks its own work: a move lands between its neighbours in the
  // team's list, which also orders it within the project.
  const drop = (index: number) => {
    const item = open.find((i) => i.id === drag);
    setDrag(undefined);
    setOver(undefined);
    if (!item) return;
    if (item.teamId !== team.id) update(item, { teamId: team.id });
    const others = backlog.filter((r) => r.id !== item.id);
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
  const points = (rows: WorkItem[]) =>
    rows.reduce((sum, i) => sum + (i.estimate ?? 0), 0);
  const showPoints = native && project.estimateScale !== "none";
  const planPicker = (item: WorkItem) =>
    usesIterations &&
    project.iterationMode === "manual" &&
    iterations.length ? (
      <Popover
        width={240}
        align="end"
        trigger={(props) => (
          <Button
            {...props}
            variant="ghost"
            size="sm"
            aria-label={`Plan ${identifier(project, item.number)}`}
            title="Plan into a sprint"
          >
            <CalendarClock className="size-3.5" />
          </Button>
        )}
      >
        {(close) => (
          <Picker
            title="Plan into"
            hideSearch
            options={iterations.map((it) => ({
              value: it.id,
              label: iterationLabel(it),
              hint: it.state === "active" ? "Active" : shortRange(it),
            }))}
            onSelect={(iterationId) => {
              update(item, { iterationId });
              close();
            }}
          />
        )}
      </Popover>
    ) : null;

  return (
    <div
      className={cn("h-full overflow-y-auto", peek.peeked && "2xl:pr-[452px]")}
    >
      <div
        className={cn(
          "mx-auto max-w-4xl space-y-4 px-6 py-6",
          peek.peeked && "pb-[60dvh]",
        )}
      >
        <header className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
          >
            {team.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {team.name}
            </h1>
            <p className="truncate text-[13px] text-muted-foreground">
              {project.name} team
              {team.description ? ` · ${team.description}` : ""}
            </p>
          </div>
          {members.length > 0 && (
            <div
              className="flex -space-x-1.5"
              aria-label={`${members.length} ${members.length === 1 ? "member" : "members"}`}
            >
              {members.slice(0, 6).map((m) => (
                <span
                  key={m.id}
                  title={m.name}
                  className="rounded-full ring-2 ring-background"
                >
                  <Avatar image={m.image} name={m.name} size="sm" />
                </span>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            {native && (
              <Link
                href={paths.board(org, project.key, team.id)}
                className="contents"
              >
                <Button variant="ghost" size="sm">
                  <KanbanSquare className="size-3.5" /> Board
                </Button>
              </Link>
            )}
            {canManage(project.id) && (
              <Link
                href={paths.projectSettings(org, project.key, "teams")}
                className="contents"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Team settings"
                  title="Team settings"
                >
                  <Settings2 className="size-3.5" />
                </Button>
              </Link>
            )}
            {canCreate && (
              <Button
                size="sm"
                onClick={() =>
                  openCreate({
                    projectId: project.id,
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

        {view.status === "hydrating" && open.length === 0 ? (
          <LoadingState label="Opening team backlog" />
        ) : (
          <>
            <section
              aria-label="Team backlog"
              className={cn(
                "rounded-xl bg-card shadow-(--shadow-border)",
                over !== undefined && "ring-1 ring-primary/40",
              )}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const rows = [
                  ...e.currentTarget.querySelectorAll<HTMLElement>(
                    "[data-row]",
                  ),
                ].filter((r) => r.dataset.row !== drag);
                const index = rows.findIndex((r) => {
                  const rect = r.getBoundingClientRect();
                  return e.clientY < rect.top + rect.height / 2;
                });
                const at = index === -1 ? rows.length : index;
                if (over !== at) setOver(at);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setOver(undefined);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(over ?? backlog.length);
              }}
            >
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <ListTodo className="size-3.5 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Backlog</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {backlog.length} items
                  {showPoints && ` · ${points(backlog)} pts`}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {native
                    ? usesIterations
                      ? "Taken on, not yet in a sprint or cycle"
                      : "Taken on, ranked by priority"
                    : "Taken on, not yet handed off"}
                </span>
              </div>
              {backlog.length === 0 ? (
                <p className="border-t px-4 py-4 text-[13px] text-muted-foreground">
                  {intake.length && canTriage
                    ? "Nothing waiting. Take work from the project below, or create an item for the team."
                    : "Nothing waiting for this team."}
                </p>
              ) : (
                <ul className="border-t">
                  {backlog.map((item, index) => (
                    <li key={item.id}>
                      {over === index && drag && (
                        <div className="h-0.5 bg-primary" aria-hidden />
                      )}
                      <BacklogRow
                        item={item}
                        {...peekProps(item)}
                        label={identifier(project, item.number)}
                        href={hrefOf(item)}
                        estimate={estimateLabel(project, item.estimate)}
                        memberName={memberName}
                        draggable={canTriage}
                        dragging={drag === item.id}
                        onDragStart={() => setDrag(item.id)}
                        onDragEnd={() => {
                          setDrag(undefined);
                          setOver(undefined);
                        }}
                        actions={
                          canTriage ? (
                            <>
                              {planPicker(item)}
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Release ${identifier(project, item.number)} to the project`}
                                title="Release to the project (no team)"
                                onClick={() => update(item, { teamId: null })}
                              >
                                <Undo2 className="size-3.5" />
                              </Button>
                            </>
                          ) : undefined
                        }
                      />
                    </li>
                  ))}
                  {over !== undefined && over >= backlog.length && drag && (
                    <div className="h-0.5 bg-primary" aria-hidden />
                  )}
                </ul>
              )}
            </section>

            {(inIterations.length > 0 || handedOffRows.length > 0) && (
              <section className="rounded-xl bg-card shadow-(--shadow-border)">
                <div className="flex items-center gap-2 px-4 py-3">
                  <CalendarClock className="size-3.5 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">
                    {native ? "Planned" : "Handed off"}
                  </h2>
                  {native && (
                    <Link
                      href={paths.backlog(org, project.key, team.id)}
                      className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Plan sprints
                    </Link>
                  )}
                  {!native && (
                    <Link
                      href={paths.handoff(org, project.key)}
                      className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Open hand-off
                    </Link>
                  )}
                </div>
                <ul className="border-t">
                  {inIterations.map(({ iteration, rows }) => (
                    <li
                      key={iteration.id}
                      className="flex items-center gap-2 border-b px-4 py-2 text-[13px] last:border-b-0"
                    >
                      <span className="font-medium">
                        {iterationLabel(iteration)}
                      </span>
                      {iteration.state === "active" && (
                        <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                          Active
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {shortRange(iteration)}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        {rows.length} items
                        {showPoints && ` · ${points(rows)} pts`}
                      </span>
                    </li>
                  ))}
                  {handedOffRows.length > 0 && (
                    <li className="px-4 py-2 text-[13px] text-muted-foreground">
                      {handedOffRows.length} items are in the delivery tool.
                    </li>
                  )}
                </ul>
              </section>
            )}

            <section
              aria-label="Unassigned project work"
              className="rounded-xl bg-card shadow-(--shadow-border)"
            >
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <Inbox className="size-3.5 text-muted-foreground" />
                <h2 className="text-sm font-semibold">No team yet</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {intake.length} items
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {project.name} work no team has taken
                </span>
              </div>
              {intake.length === 0 ? (
                <p className="border-t px-4 py-4 text-[13px] text-muted-foreground">
                  Every open item of {project.name} belongs to a team or is
                  planned.
                </p>
              ) : (
                <ul className="border-t">
                  {intake.map((item) => (
                    <li key={item.id}>
                      <BacklogRow
                        item={item}
                        {...peekProps(item)}
                        label={identifier(project, item.number)}
                        href={hrefOf(item)}
                        estimate={estimateLabel(project, item.estimate)}
                        memberName={memberName}
                        draggable={canTriage}
                        dragging={drag === item.id}
                        onDragStart={() => setDrag(item.id)}
                        onDragEnd={() => {
                          setDrag(undefined);
                          setOver(undefined);
                        }}
                        actions={
                          canTriage ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={`Take ${identifier(project, item.number)} into ${team.name}`}
                              onClick={() => update(item, { teamId: team.id })}
                            >
                              <ArrowDownToLine className="size-3.5" /> Take
                            </Button>
                          ) : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {!canTriage && (
              <p className="text-xs text-muted-foreground">
                Ranking, taking and planning work needs a discipline in{" "}
                {project.name} that can change properties.
              </p>
            )}
          </>
        )}
        {!open.length && view.status !== "hydrating" && (
          <EmptyState illustration="planning" title="No open work yet">
            Create items for {team.name}, or take them from {project.name} as
            they come in.
          </EmptyState>
        )}
      </div>
      <ItemPeek project={project} peek={peek} />
    </div>
  );
}
