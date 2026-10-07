"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Repeat, Users, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  canParent,
  enabledTypes,
  identifier,
  segmentOf,
  typeOf,
} from "~/lib/work-items";
import {
  estimateOptions,
  iterationLabel,
  type RelationKind,
  type WorkItem,
} from "~/sync/shared/protocol";
import { Popover, Picker } from "~/components/ui/popover";
import { SectionLabel } from "~/components/ui/primitives";
import { Button } from "~/components/ui/button";
import { useDelivery, useWorkspace } from "~/components/workspace/provider";
import { TypeIcon } from "./icons";
import { IssueStatus } from "./status";

const trigger =
  "inline-flex h-7 max-w-full items-center gap-1.5 truncate rounded-md px-1.5 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none";

export function TypePicker({
  item,
  onChange,
}: {
  item: WorkItem;
  onChange?: (typeId: string) => void;
}) {
  const delivery = useDelivery();
  const { items } = useWorkspace();
  const type = typeOf(delivery, item);
  const parent = item.parentId
    ? items.find((i) => i.id === item.parentId)
    : undefined;
  const childLevels = items
    .filter((i) => i.parentId === item.id && !i.archivedAt)
    .map((i) => typeOf(delivery, i).level);
  // Only offer types that keep the hierarchy valid; the server enforces it too.
  const options = enabledTypes(
    delivery,
    delivery.teams.get(item.teamId),
  ).filter(
    (t) =>
      (!parent || canParent(typeOf(delivery, parent), t)) &&
      childLevels.every((level) => level < t.level),
  );
  const content = (
    <>
      <TypeIcon type={type} />
      <span className="truncate">{type.name}</span>
    </>
  );
  if (!onChange) return <span className={trigger}>{content}</span>;
  return (
    <Popover
      width={220}
      trigger={(props) => (
        <button
          {...props}
          aria-label={`Type: ${type.name}`}
          className={trigger}
        >
          {content}
        </button>
      )}
    >
      <Picker
        title="Type"
        options={options.map((t) => ({
          value: t.id,
          label: t.name,
          icon: <TypeIcon type={t} />,
          hint: t.hasSpecification ? "Specification" : undefined,
        }))}
        value={item.typeId}
        onSelect={onChange}
      />
    </Popover>
  );
}

export function TeamPicker({
  teamId,
  projectId,
  onChange,
}: {
  teamId: string;
  projectId?: string;
  onChange?: (teamId: string) => void;
}) {
  const delivery = useDelivery();
  const team = delivery.teams.get(teamId);
  const content = (
    <>
      <Users className="size-3.5 text-muted-foreground" />
      <span className="truncate">{team?.name ?? "No team"}</span>
    </>
  );
  if (!onChange) return <span className={trigger}>{content}</span>;
  return (
    <Popover
      width={220}
      trigger={(props) => (
        <button
          {...props}
          aria-label={`Team: ${team?.name}`}
          className={trigger}
        >
          {content}
        </button>
      )}
    >
      <Picker
        title="Move to team"
        options={[...delivery.teams.values()]
          .filter(
            (t) =>
              !t.archivedAt &&
              (!t.projectIds || t.projectIds.includes(projectId ?? "")),
          )
          .map((t) => ({ value: t.id, label: t.name }))}
        value={teamId}
        onSelect={onChange}
        footer={
          <p className="px-3 py-2 text-xs text-muted-foreground">
            The identifier stays the same. The status moves to the matching
            category in the new team&apos;s workflow.
          </p>
        }
      />
    </Popover>
  );
}

export function IterationPicker({
  item,
  onChange,
}: {
  item: WorkItem;
  onChange?: (iterationId: string | null) => void;
}) {
  const delivery = useDelivery();
  const team = delivery.teams.get(item.teamId);
  const current = item.iterationId
    ? delivery.iterations.get(item.iterationId)
    : undefined;
  if (!team || team.iterationMode === "off") return null;
  const options = [...delivery.iterations.values()]
    .filter((i) => i.teamId === team.id && i.state !== "completed")
    .sort((a, b) => a.number - b.number);
  const content = (
    <>
      <Repeat className="size-3.5 text-muted-foreground" />
      <span className={cn("truncate", !current && "text-muted-foreground")}>
        {current ? iterationLabel(current) : "Backlog"}
      </span>
    </>
  );
  if (!onChange || current?.state === "completed")
    return <span className={trigger}>{content}</span>;
  return (
    <Popover
      width={240}
      trigger={(props) => (
        <button {...props} aria-label="Iteration" className={trigger}>
          {content}
        </button>
      )}
    >
      <Picker
        title={team.iterationMode === "automatic" ? "Cycle" : "Sprint"}
        options={[
          { value: "none", label: "Backlog" },
          ...options.map((i) => ({
            value: i.id,
            label: iterationLabel(i),
            hint: i.state === "active" ? "Active" : shortRange(i),
          })),
        ]}
        value={item.iterationId ?? "none"}
        onSelect={(v) => onChange(v === "none" ? null : v)}
      />
    </Popover>
  );
}

export function EstimatePicker({
  item,
  onChange,
}: {
  item: WorkItem;
  onChange?: (estimate: number | null) => void;
}) {
  const delivery = useDelivery();
  const scale = delivery.teams.get(item.teamId)?.estimateScale ?? "none";
  if (scale === "none") return null;
  const options = estimateOptions[scale];
  const label =
    item.estimate === null
      ? "No estimate"
      : (options.find((o) => o.value === item.estimate)?.label ??
        String(item.estimate));
  const content = (
    <span className={cn(item.estimate === null && "text-muted-foreground")}>
      {label}
      {item.estimate !== null && scale !== "tshirt" && " pts"}
    </span>
  );
  if (!onChange) return <span className={trigger}>{content}</span>;
  return (
    <Popover
      width={180}
      trigger={(props) => (
        <button
          {...props}
          aria-label={`Estimate: ${label}`}
          className={trigger}
        >
          {content}
        </button>
      )}
    >
      <Picker
        title="Estimate"
        hideSearch
        options={[
          { value: "none", label: "No estimate" },
          ...options.map((o) => ({ value: String(o.value), label: o.label })),
        ]}
        value={item.estimate === null ? "none" : String(item.estimate)}
        onSelect={(v) => onChange(v === "none" ? null : Number(v))}
      />
    </Popover>
  );
}

export function shortRange(i: { startsAt: string; endsAt: string }) {
  const f = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  // Iterations end at the start of `endsAt`; show the last working day.
  return `${f(i.startsAt)} – ${f(new Date(new Date(i.endsAt).getTime() - 86_400_000).toISOString())}`;
}

const relationLabel = (kind: RelationKind, outgoing: boolean) =>
  kind === "blocks"
    ? outgoing
      ? "Blocks"
      : "Blocked by"
    : kind === "duplicates"
      ? outgoing
        ? "Duplicates"
        : "Duplicated by"
      : "Related to";

// Relations are directed rows; inverse labels are derived for display.
export function Relations({
  item,
  canChange,
}: {
  item: WorkItem;
  canChange: boolean;
}) {
  const { relations, items, projects, organization, mutate } = useWorkspace();
  const delivery = useDelivery();
  const [adding, setAdding] = useState<RelationKind>();
  const mine = useMemo(
    () =>
      relations
        .filter((r) => r.fromId === item.id || r.toId === item.id)
        .map((r) => {
          const outgoing = r.fromId === item.id;
          const other = items.find(
            (i) => i.id === (outgoing ? r.toId : r.fromId),
          );
          return { relation: r, outgoing, other };
        })
        .filter((x) => x.other),
    [relations, items, item.id],
  );
  const groups = new Map<string, typeof mine>();
  for (const x of mine) {
    const label = relationLabel(x.relation.kind, x.outgoing);
    groups.set(label, [...(groups.get(label) ?? []), x]);
  }
  const candidates = items
    .filter(
      (i) =>
        i.id !== item.id &&
        !i.archivedAt &&
        !mine.some((m) => m.other?.id === i.id),
    )
    .slice(0, 500);
  const projectOf = (i: WorkItem) => projects.find((p) => p.id === i.projectId);
  if (!mine.length && !canChange) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Relations</SectionLabel>
        {canChange && (
          <Popover
            width={300}
            align="end"
            trigger={(props) => (
              <Button {...props} variant="ghost" size="sm" className="ml-auto">
                <Plus className="size-3.5" /> Link
              </Button>
            )}
          >
            {(close) =>
              adding ? (
                <Picker
                  title={`${relationLabel(adding, true)}…`}
                  placeholder="Search by title or identifier"
                  options={candidates.map((i) => ({
                    value: i.id,
                    label: i.title,
                    hint: identifier(projectOf(i), i.number),
                    icon: <TypeIcon type={typeOf(delivery, i)} />,
                  }))}
                  onSelect={(toId) => {
                    void mutate({
                      type: "addRelation",
                      workItemId: item.id,
                      relationId: crypto.randomUUID(),
                      toId,
                      kind: adding,
                    });
                    setAdding(undefined);
                    close();
                  }}
                />
              ) : (
                <Picker
                  title="Relation"
                  hideSearch
                  options={(["blocks", "relates", "duplicates"] as const).map(
                    (k) => ({ value: k, label: relationLabel(k, true) }),
                  )}
                  onSelect={(k) => setAdding(k)}
                />
              )
            }
          </Popover>
        )}
      </div>
      {mine.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No blockers, duplicates or related work.
        </p>
      ) : (
        <div className="space-y-3">
          {[...groups.entries()].map(([label, rows]) => (
            <div key={label}>
              <p className="mb-1 text-xs text-muted-foreground">{label}</p>
              <ul className="overflow-hidden rounded-md border">
                {rows.map(({ relation, other }) => {
                  const project = projectOf(other!);
                  return (
                    <li
                      key={relation.id}
                      className="group relative flex h-9 items-center gap-2 border-b px-2 text-[13px] last:border-b-0 hover:bg-muted/50"
                    >
                      <IssueStatus
                        teamId={other!.teamId}
                        statusId={other!.statusId}
                        compact
                      />
                      <TypeIcon type={typeOf(delivery, other!)} />
                      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                        {identifier(project, other!.number)}
                      </span>
                      {project && (
                        <Link
                          href={paths.item(
                            organization.slug,
                            project.key,
                            segmentOf(typeOf(delivery, other!)),
                            identifier(project, other!.number),
                          )}
                          className="min-w-0 flex-1 truncate after:absolute after:inset-0"
                        >
                          {other!.title}
                        </Link>
                      )}
                      {canChange && (
                        <button
                          aria-label="Remove relation"
                          className="relative z-10 grid size-6 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                          onClick={() =>
                            void mutate({
                              type: "removeRelation",
                              workItemId: item.id,
                              relationId: relation.id,
                            })
                          }
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
