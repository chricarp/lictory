"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarRange,
  ChevronLeft,
  Plus,
  ShieldCheck,
  Shapes,
  Users,
  Workflow,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  activeStatuses,
  categoryMeta,
  categoryOrder,
  labelColorClasses,
} from "~/lib/work-items";
import {
  labelColors,
  type Command,
  type LabelColor,
  type StatusCategory,
  type Team,
  type WorkItemType,
} from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, Picker } from "~/components/ui/popover";
import { PeoplePicker } from "~/components/ui/people-picker";
import { Avatar } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsGroup,
  SettingsList,
  SettingsSection,
} from "~/components/workspace/settings-section";
import { StatusIcon } from "~/components/items/status";
import { TypeIcon } from "~/components/items/icons";
import { ColorDot } from "~/components/items/labels";
import { useTeam } from "./team-gate";

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Commands fail with an actionable server message; show it where it happened.
function useCommand() {
  const { mutate } = useWorkspace();
  const [error, setError] = useState<string>();
  const run = async (command: Command) => {
    setError(undefined);
    try {
      await mutate(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change was not saved.");
    }
  };
  return { run, error };
}

export function TeamSettings() {
  const team = useTeam();
  const { organization, isAdmin } = useWorkspace();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <div>
          <Link
            href={paths.board(organization.slug, team.id)}
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> {team.name} board
          </Link>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">
            {team.name} settings
          </h1>
          <p className="text-[13px] text-muted-foreground">
            How this team delivers work. Defaults work for most teams; change
            only what you need.
            {!isAdmin && " Read-only: ask an administrator to change."}
          </p>
        </div>
        <SettingsGroup title="Delivery">
          <DeliverySection team={team} canEdit={isAdmin} />
          <WorkflowSection team={team} canEdit={isAdmin} />
          <PlanningSection team={team} canEdit={isAdmin} />
          <TeamTypesSection team={team} canEdit={isAdmin} />
        </SettingsGroup>
        <SettingsGroup title="People">
          <MembersSection team={team} canEdit={isAdmin} />
        </SettingsGroup>
      </div>
    </div>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string; description?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg px-3 py-2 text-left text-[13px] shadow-[var(--shadow-border)] disabled:cursor-default",
            value === o.value
              ? "bg-primary/6 ring-1 ring-primary/40"
              : "hover:bg-muted/60",
          )}
        >
          <span className="font-medium">{o.label}</span>
          {o.description && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {o.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium">{label}</p>
      {children}
    </div>
  );
}

function DeliverySection({ team, canEdit }: { team: Team; canEdit: boolean }) {
  const { run, error } = useCommand();
  return (
    <SettingsSection
      id="delivery"
      icon={<ShieldCheck />}
      title="Delivery and readiness"
      description="Where delivery is tracked, and whether a specification must be ready before work starts."
    >
      <SettingsBody className="space-y-5">
        <Field label="Delivery tracked in">
          <Choice
            value={team.deliveryMode}
            disabled={!canEdit}
            onChange={(deliveryMode) =>
              void run({ type: "updateTeam", teamId: team.id, deliveryMode })
            }
            options={[
              {
                value: "native",
                label: "Lictory",
                description: "Boards, backlog and sprints here.",
              },
              {
                value: "external",
                label: "External tool",
                description: "Refine here, export ready work to Jira.",
              },
            ]}
          />
        </Field>
        <Field label="Starting work before the specification is ready">
          <Choice
            value={team.readinessPolicy}
            disabled={!canEdit}
            onChange={(readinessPolicy) =>
              void run({ type: "updateTeam", teamId: team.id, readinessPolicy })
            }
            options={[
              {
                value: "off",
                label: "Allow",
                description: "Readiness is informative only.",
              },
              {
                value: "warn",
                label: "Warn",
                description: "Allowed, and recorded in activity.",
              },
              {
                value: "block",
                label: "Block",
                description: "Only ready specifications can start.",
              },
            ]}
          />
        </Field>
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}

function WorkflowSection({ team, canEdit }: { team: Team; canEdit: boolean }) {
  const { run, error } = useCommand();
  const statuses = activeStatuses(team);
  const [adding, setAdding] = useState<StatusCategory>();
  const [name, setName] = useState("");
  return (
    <SettingsSection
      id="workflow"
      icon={<Workflow />}
      title="Workflow"
      description="Statuses belong to fixed categories, so boards, reports and readiness mean the same thing in every team. Any transition is allowed."
    >
      <div className="divide-y">
        {categoryOrder.map((category) => {
          const rows = statuses.filter((s) => s.category === category);
          return (
            <div key={category} className="px-5 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {categoryMeta[category].label}
                </p>
                {canEdit && (
                  <button
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setAdding(category);
                      setName("");
                    }}
                  >
                    <Plus className="inline size-3" /> Add
                  </button>
                )}
              </div>
              <ul className="space-y-1">
                {rows.map((s) => (
                  <StatusRow
                    key={s.id}
                    team={team}
                    status={s}
                    canEdit={canEdit}
                    run={run}
                    index={statuses.indexOf(s)}
                    statuses={statuses}
                  />
                ))}
              </ul>
              {adding === category && (
                <form
                  className="mt-2 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!name.trim()) return;
                    void run({
                      type: "createStatus",
                      teamId: team.id,
                      statusId: crypto.randomUUID(),
                      name: name.trim(),
                      color: category === "done" ? "green" : "gray",
                      category,
                    });
                    setAdding(undefined);
                  }}
                >
                  <Input
                    autoFocus
                    className="h-8 max-w-xs text-sm"
                    placeholder="Status name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="New status name"
                  />
                  <Button size="sm" type="submit" disabled={!name.trim()}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => setAdding(undefined)}
                  >
                    Cancel
                  </Button>
                </form>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <div className="border-t px-5 py-3">
          <InlineError>{error}</InlineError>
        </div>
      )}
    </SettingsSection>
  );
}

function StatusRow({
  team,
  status,
  statuses,
  index,
  canEdit,
  run,
}: {
  team: Team;
  status: Team["statuses"][number];
  statuses: Team["statuses"];
  index: number;
  canEdit: boolean;
  run: (c: Command) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(status.name);
  const others = statuses.filter((s) => s.id !== status.id);
  return (
    <li className="group flex h-8 items-center gap-2 text-[13px]">
      <StatusIcon category={status.category} color={status.color} />
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== status.name)
              void run({
                type: "updateStatus",
                teamId: team.id,
                statusId: status.id,
                name: name.trim(),
              });
            setEditing(false);
          }}
        >
          <Input
            autoFocus
            className="h-7 max-w-xs text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Status name"
          />
          <Button size="sm" type="submit">
            Save
          </Button>
        </form>
      ) : (
        <span className="flex-1 truncate">{status.name}</span>
      )}
      {canEdit && !editing && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <Popover
            width={180}
            align="end"
            trigger={(props) => (
              <button
                {...props}
                aria-label="Color"
                className="grid size-7 place-items-center rounded hover:bg-muted"
              >
                <ColorDot color={status.color} />
              </button>
            )}
          >
            <Picker
              title="Color"
              hideSearch
              options={labelColors.map((c) => ({
                value: c,
                label: c[0]!.toUpperCase() + c.slice(1),
                icon: <ColorDot color={c} />,
              }))}
              value={status.color}
              onSelect={(color: LabelColor) =>
                void run({
                  type: "updateStatus",
                  teamId: team.id,
                  statusId: status.id,
                  color,
                })
              }
            />
          </Popover>
          <button
            aria-label="Move up"
            disabled={index === 0}
            className="grid size-7 place-items-center rounded hover:bg-muted disabled:opacity-30"
            onClick={() =>
              void run({
                type: "updateStatus",
                teamId: team.id,
                statusId: status.id,
                beforeId: statuses[index - 1]!.id,
              })
            }
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            aria-label="Move down"
            disabled={index === statuses.length - 1}
            className="grid size-7 place-items-center rounded hover:bg-muted disabled:opacity-30"
            onClick={() =>
              void run({
                type: "updateStatus",
                teamId: team.id,
                statusId: status.id,
                beforeId: statuses[index + 2]?.id ?? null,
              })
            }
          >
            <ArrowDown className="size-3.5" />
          </button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Popover
            width={260}
            align="end"
            trigger={(props) => (
              <Button {...props} size="sm" variant="ghost">
                Archive
              </Button>
            )}
          >
            {(close) => (
              <Picker
                title={`Move ${status.name} items to`}
                hideSearch
                options={others.map((s) => ({
                  value: s.id,
                  label: s.name,
                  icon: <StatusIcon category={s.category} color={s.color} />,
                  hint: categoryMeta[s.category].label,
                }))}
                onSelect={(replacementId) => {
                  void run({
                    type: "archiveStatus",
                    teamId: team.id,
                    statusId: status.id,
                    replacementId,
                  });
                  close();
                }}
                footer={
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Items move explicitly and the change is recorded in their
                    activity.
                  </p>
                }
              />
            )}
          </Popover>
        </div>
      )}
    </li>
  );
}

function PlanningSection({ team, canEdit }: { team: Team; canEdit: boolean }) {
  const { run, error } = useCommand();
  const update = (
    patch: Omit<Extract<Command, { type: "updateTeam" }>, "type" | "teamId">,
  ) => void run({ type: "updateTeam", teamId: team.id, ...patch });
  return (
    <SettingsSection
      id="planning"
      icon={<CalendarRange />}
      title="Planning"
      description="Sprints are planned and started by hand; cycles start and complete on a schedule and roll unfinished work forward."
    >
      <SettingsBody className="space-y-5">
        <Field label="Iterations">
          <Choice
            value={team.iterationMode}
            disabled={!canEdit}
            onChange={(iterationMode) => update({ iterationMode })}
            options={[
              { value: "off", label: "None", description: "A ranked backlog." },
              {
                value: "manual",
                label: "Sprints",
                description: "Plan, start and complete by hand.",
              },
              {
                value: "automatic",
                label: "Cycles",
                description: "Scheduled, with automatic rollover.",
              },
            ]}
          />
        </Field>
        {team.iterationMode !== "off" && (
          <div className="flex flex-wrap gap-4">
            <label className="text-[13px]">
              <span className="font-medium">Length</span>
              <select
                disabled={!canEdit}
                className="mt-1 block h-8 rounded-md border bg-background px-2 text-sm"
                value={team.iterationWeeks}
                onChange={(e) =>
                  update({ iterationWeeks: Number(e.target.value) })
                }
              >
                {[1, 2, 3, 4, 6, 8].map((w) => (
                  <option key={w} value={w}>
                    {w} week{w > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
            {team.iterationMode === "automatic" && (
              <>
                <label className="text-[13px]">
                  <span className="font-medium">Starts on</span>
                  <select
                    disabled={!canEdit}
                    className="mt-1 block h-8 rounded-md border bg-background px-2 text-sm"
                    value={team.iterationStartDay}
                    onChange={(e) =>
                      update({ iterationStartDay: Number(e.target.value) })
                    }
                  >
                    {weekdays.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[13px]">
                  <span className="font-medium">Upcoming cycles</span>
                  <select
                    disabled={!canEdit}
                    className="mt-1 block h-8 rounded-md border bg-background px-2 text-sm"
                    value={team.upcomingIterations}
                    onChange={(e) =>
                      update({ upcomingIterations: Number(e.target.value) })
                    }
                  >
                    {[0, 1, 2, 3, 4, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        )}
        <Field label="Estimates">
          <select
            disabled={!canEdit}
            className="block h-8 rounded-md border bg-background px-2 text-sm"
            value={team.estimateScale}
            onChange={(e) =>
              update({
                estimateScale: e.target.value as Team["estimateScale"],
              })
            }
          >
            <option value="none">No estimates</option>
            <option value="fibonacci">Points (0, 1, 2, 3, 5, 8, 13, 21)</option>
            <option value="linear">Points (0–8)</option>
            <option value="tshirt">T-shirt sizes (XS–XL)</option>
          </select>
        </Field>
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}

function TeamTypesSection({ team, canEdit }: { team: Team; canEdit: boolean }) {
  const { delivery } = useWorkspace();
  const { run, error } = useCommand();
  const types = [...delivery.types.values()]
    .filter((t) => !t.archivedAt)
    .sort((a, b) => b.level - a.level || a.position - b.position);
  return (
    <SettingsSection
      id="types"
      icon={<Shapes />}
      title="Work item types"
      description="Types this team uses. Types themselves are managed in organization settings."
    >
      <SettingsList isEmpty={types.length === 0} empty="No types.">
        {types.map((t) => (
          <label
            key={t.id}
            className="flex items-center gap-3 px-5 py-2.5 text-[13px]"
          >
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={team.typeIds.includes(t.id)}
              onChange={(e) =>
                void run({
                  type: "setTeamType",
                  teamId: team.id,
                  typeId: t.id,
                  enabled: e.target.checked,
                })
              }
            />
            <TypeIcon type={t} />
            <span className="flex-1 font-medium">{t.name}</span>
            <span className="text-xs text-muted-foreground">
              {t.hasSpecification ? "Specification" : "Plain work"}
            </span>
          </label>
        ))}
      </SettingsList>
      {error && (
        <div className="border-t px-5 py-3">
          <InlineError>{error}</InlineError>
        </div>
      )}
    </SettingsSection>
  );
}

function MembersSection({ team, canEdit }: { team: Team; canEdit: boolean }) {
  const { memberName } = useWorkspace();
  const { run, error } = useCommand();
  return (
    <SettingsSection
      id="members"
      icon={<Users />}
      title="Members"
      description="Team membership organizes people; it does not grant permissions. Roles do."
      action={
        canEdit ? (
          <Popover
            width={260}
            align="end"
            trigger={(props) => (
              <Button {...props} size="sm" variant="secondary">
                <Plus className="size-3.5" /> Add
              </Button>
            )}
          >
            <PeoplePicker
              multiple
              title="Team members"
              value={team.memberIds}
              onSelect={(userId) =>
                void run({
                  type: "setTeamMembership",
                  teamId: team.id,
                  userId,
                  member: !team.memberIds.includes(userId),
                })
              }
            />
          </Popover>
        ) : undefined
      }
    >
      <SettingsList
        isEmpty={team.memberIds.length === 0}
        empty="No members yet."
      >
        {team.memberIds.map((id) => (
          <div
            key={id}
            className="group flex items-center gap-3 px-5 py-2 text-[13px]"
          >
            <Avatar name={memberName(id)} size="sm" />
            <span className="flex-1">{memberName(id)}</span>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() =>
                  void run({
                    type: "setTeamMembership",
                    teamId: team.id,
                    userId: id,
                    member: false,
                  })
                }
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </SettingsList>
      {error && (
        <div className="border-t px-5 py-3">
          <InlineError>{error}</InlineError>
        </div>
      )}
    </SettingsSection>
  );
}

// Organization settings: teams and the type registry.
export function TeamsSection() {
  const { delivery, isAdmin, organization } = useWorkspace();
  const { run, error } = useCommand();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const teams = [...delivery.teams.values()];
  return (
    <SettingsSection
      id="teams"
      icon={<Users />}
      title="Teams"
      description="Teams own workflows, boards and sprints. Items keep their project key when they move between teams."
      action={
        isAdmin && !creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" /> Add team
          </Button>
        ) : undefined
      }
    >
      <SettingsList isEmpty={teams.length === 0} empty="No teams yet.">
        {teams.map((t) => (
          <div
            key={t.id}
            className="group flex items-center gap-3 px-5 py-2.5 text-[13px]"
          >
            <span
              className={cn(
                "flex-1 font-medium",
                t.archivedAt && "text-muted-foreground line-through",
              )}
            >
              {t.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {t.memberIds.length}{" "}
              {t.memberIds.length === 1 ? "member" : "members"} ·{" "}
              {t.iterationMode === "off"
                ? "No iterations"
                : t.iterationMode === "manual"
                  ? "Sprints"
                  : "Cycles"}
              {t.deliveryMode === "external" && " · External delivery"}
            </span>
            <Link
              href={paths.teamSettings(organization.slug, t.id)}
              className="contents"
            >
              <Button size="sm" variant="ghost">
                Configure
              </Button>
            </Link>
            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() =>
                  void run({
                    type: "updateTeam",
                    teamId: t.id,
                    archived: !t.archivedAt,
                  })
                }
              >
                {t.archivedAt ? "Restore" : "Archive"}
              </Button>
            )}
          </div>
        ))}
      </SettingsList>
      {creating && (
        <form
          className="flex items-center gap-2 border-t bg-muted/40 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void run({
              type: "createTeam",
              teamId: crypto.randomUUID(),
              name: name.trim(),
            });
            setName("");
            setCreating(false);
          }}
        >
          <Input
            autoFocus
            className="h-8 max-w-xs text-sm"
            placeholder="Team name, e.g. Platform"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Team name"
          />
          <Button size="sm" type="submit" disabled={!name.trim()}>
            Create
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setCreating(false)}
          >
            Cancel
          </Button>
        </form>
      )}
      {error && (
        <div className="border-t px-5 py-3">
          <InlineError>{error}</InlineError>
        </div>
      )}
    </SettingsSection>
  );
}

const icons: WorkItemType["icon"][] = [
  "epic",
  "story",
  "task",
  "bug",
  "subtask",
  "spike",
  "chore",
];
const levelLabel = [
  "Subtask level",
  "Work level",
  "Epic level",
  "Initiative level",
];

export function TypesSection() {
  const { delivery, isAdmin } = useWorkspace();
  const { run, error } = useCommand();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    icon: "task" as WorkItemType["icon"],
    color: "blue" as LabelColor,
    level: 1,
    hasSpecification: false,
  });
  const types = [...delivery.types.values()].sort(
    (a, b) => b.level - a.level || a.position - b.position,
  );
  return (
    <SettingsSection
      id="work-item-types"
      icon={<Shapes />}
      title="Work item types"
      description="Levels order the hierarchy: a parent sits above its children. Types with a specification are refined and reviewed; others are plain work."
      action={
        isAdmin && !creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" /> Add type
          </Button>
        ) : undefined
      }
    >
      <SettingsList isEmpty={types.length === 0} empty="No types.">
        {types.map((t) => (
          <div
            key={t.id}
            className="group flex items-center gap-3 px-5 py-2.5 text-[13px]"
          >
            <TypeIcon type={t} />
            <span
              className={cn(
                "flex-1 font-medium",
                t.archivedAt && "text-muted-foreground line-through",
              )}
            >
              {t.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {levelLabel[t.level]}
            </span>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={t.hasSpecification}
                onChange={(e) =>
                  void run({
                    type: "updateType",
                    typeId: t.id,
                    hasSpecification: e.target.checked,
                  })
                }
              />
              Specification
            </label>
            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() =>
                  void run({
                    type: "updateType",
                    typeId: t.id,
                    archived: !t.archivedAt,
                  })
                }
              >
                {t.archivedAt ? "Restore" : "Archive"}
              </Button>
            )}
          </div>
        ))}
      </SettingsList>
      {creating && (
        <form
          className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            void run({
              type: "createType",
              typeId: crypto.randomUUID(),
              ...draft,
              name: draft.name.trim(),
            });
            setCreating(false);
            setDraft({ ...draft, name: "" });
          }}
        >
          <Popover
            width={180}
            trigger={(props) => (
              <button
                {...props}
                type="button"
                aria-label="Icon and color"
                className="grid size-8 place-items-center rounded-md hover:bg-muted"
              >
                <TypeIcon type={{ ...draft, name: draft.name || "Type" }} />
              </button>
            )}
          >
            <div className="grid grid-cols-7 gap-1 p-2">
              {icons.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  aria-label={icon}
                  onClick={() => setDraft({ ...draft, icon })}
                  className={cn(
                    "grid size-7 place-items-center rounded hover:bg-muted",
                    draft.icon === icon && "bg-muted",
                  )}
                >
                  <TypeIcon type={{ icon, color: draft.color, name: icon }} />
                </button>
              ))}
              {labelColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  onClick={() => setDraft({ ...draft, color })}
                  className={cn(
                    "grid size-7 place-items-center rounded hover:bg-muted",
                    draft.color === color && "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "size-3 rounded-full",
                      labelColorClasses[color].dot,
                    )}
                  />
                </button>
              ))}
            </div>
          </Popover>
          <Input
            autoFocus
            className="h-8 w-44 text-sm"
            placeholder="Type name, e.g. Spike"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="Type name"
          />
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={draft.level}
            onChange={(e) =>
              setDraft({ ...draft, level: Number(e.target.value) })
            }
            aria-label="Level"
          >
            {levelLabel.map((l, i) => (
              <option key={l} value={i}>
                {l}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={draft.hasSpecification}
              onChange={(e) =>
                setDraft({ ...draft, hasSpecification: e.target.checked })
              }
            />
            Specification
          </label>
          <Button size="sm" type="submit" disabled={!draft.name.trim()}>
            Create
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setCreating(false)}
          >
            Cancel
          </Button>
        </form>
      )}
      {error && (
        <div className="border-t px-5 py-3">
          <InlineError>{error}</InlineError>
        </div>
      )}
    </SettingsSection>
  );
}
