import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useState } from "react";
import { Archive, ArchiveRestore, Flag, Tags } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import {
  formatDate,
  milestoneStatusMeta,
  type Label,
  type Milestone,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  labelColors,
  milestoneStatuses,
  type LabelColor,
  type MilestoneStatus,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Popover, Picker } from "@lictory/ui/popover";
import { ColorDot } from "@lictory/platform/components/items/labels";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsList,
  SettingsSection,
  SettingsSubheading,
} from "@lictory/platform/components/workspace/settings-section";

// Project-scoped labels and milestones. Archiving is reversible and keeps every
// historical assignment; nothing here deletes.
export function LabelsAndMilestones({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { labels, milestones, mutate, items } = useWorkspace();
  const [error, setError] = useState<string>();
  const projectLabels = labels.filter((l) => l.projectId === project.id);
  const projectMilestones = milestones.filter(
    (m) => m.projectId === project.id,
  );
  const usage = (predicate: (i: (typeof items)[number]) => boolean) =>
    items.filter(
      (i) => i.projectId === project.id && !i.archivedAt && predicate(i),
    ).length;
  const save = async (command: Parameters<typeof mutate>[0]) => {
    setError(undefined);
    try {
      await mutate(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change was not saved.");
    }
  };
  return (
    <SettingsSection
      id="labels"
      icon={<Tags />}
      title="Labels & milestones"
      description={`Used to group and plan work in ${project.name}. Archiving keeps every historical assignment; nothing here deletes.`}
    >
      <SettingsSubheading>Labels</SettingsSubheading>
      <SettingsList isEmpty={projectLabels.length === 0} empty="No labels yet.">
        {projectLabels.map((l) => (
          <LabelRow
            key={l.id}
            label={l}
            canEdit={canEdit}
            count={usage((i) => i.labelIds.includes(l.id))}
            update={(patch) =>
              save({
                type: "updateLabel",
                projectId: project.id,
                labelId: l.id,
                ...patch,
              })
            }
          />
        ))}
      </SettingsList>
      {canEdit && (
        <div className="px-5 pt-2 pb-4">
          <NewLabel projectId={project.id} />
        </div>
      )}

      <div className="border-t border-border">
        <SettingsSubheading>Milestones</SettingsSubheading>
        <SettingsList
          isEmpty={projectMilestones.length === 0}
          empty="No milestones yet."
        >
          {projectMilestones.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              canEdit={canEdit}
              count={usage((i) => i.milestoneId === m.id)}
              update={(patch) =>
                save({
                  type: "updateMilestone",
                  projectId: project.id,
                  milestoneId: m.id,
                  ...patch,
                })
              }
            />
          ))}
        </SettingsList>
        {canEdit && (
          <div className="px-5 pt-2 pb-4">
            <NewMilestone projectId={project.id} />
          </div>
        )}
      </div>
      {error && (
        <div className="border-t border-border px-5 py-3">
          <InlineError>{error}</InlineError>
        </div>
      )}
    </SettingsSection>
  );
}

function LabelRow({
  label,
  count,
  canEdit,
  update,
}: {
  label: Label;
  count: number;
  canEdit: boolean;
  update: (patch: {
    name?: string;
    color?: LabelColor;
    archived?: boolean;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState(label.name);
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-5 py-1.5 text-[13px]",
        label.archivedAt && "opacity-60",
      )}
    >
      <Popover
        width={200}
        disabled={!canEdit}
        trigger={(props) => (
          <button
            {...props}
            disabled={!canEdit}
            aria-label={`Color: ${label.color}`}
            className="grid size-6 place-items-center rounded-md hover:bg-muted"
          >
            <ColorDot color={label.color} />
          </button>
        )}
      >
        <Picker
          title="Color"
          options={labelColors.map((c) => ({
            value: c,
            label: c,
            icon: <ColorDot color={c} />,
          }))}
          value={label.color}
          onSelect={(color) => void update({ color })}
        />
      </Popover>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() =>
          name.trim() &&
          name.trim() !== label.name &&
          void update({ name: name.trim() })
        }
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={`Label name ${label.name}`}
        disabled={!canEdit}
        className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 outline-none focus:bg-muted enabled:hover:bg-muted touch:text-base"
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {count} item{count === 1 ? "" : "s"}
      </span>
      {canEdit && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={label.archivedAt ? "Restore label" : "Archive label"}
          onClick={() => void update({ archived: !label.archivedAt })}
        >
          {label.archivedAt ? (
            <ArchiveRestore className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}

function NewLabel({ projectId }: { projectId: string }) {
  const { mutate } = useWorkspace();
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("blue");
  const [error, setError] = useState<string>();
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setError(undefined);
        try {
          await mutate({
            type: "createLabel",
            projectId,
            labelId: crypto.randomUUID(),
            name: name.trim(),
            color,
          });
          setName("");
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not create label.",
          );
        }
      }}
    >
      <Popover
        width={200}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label={`Color: ${color}`}
            className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-card hover:bg-muted"
          >
            <ColorDot color={color} />
          </button>
        )}
      >
        <Picker
          title="Color"
          options={labelColors.map((c) => ({
            value: c,
            label: c,
            icon: <ColorDot color={c} />,
          }))}
          value={color}
          onSelect={setColor}
        />
      </Popover>
      <Input
        className="h-8 max-w-xs rounded-md text-sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New label"
        aria-label="New label name"
      />
      <Button type="submit" variant="secondary" disabled={!name.trim()}>
        Add label
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </form>
  );
}

function MilestoneRow({
  milestone,
  count,
  canEdit,
  update,
}: {
  milestone: Milestone;
  count: number;
  canEdit: boolean;
  update: (patch: {
    name?: string;
    targetDate?: string | null;
    status?: MilestoneStatus;
    archived?: boolean;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState(milestone.name);
  const date = milestone.targetDate ? milestone.targetDate.slice(0, 10) : "";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 px-5 py-1.5 text-[13px]",
        milestone.archivedAt && "opacity-60",
      )}
    >
      <Flag className="size-3.5 text-muted-foreground" />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() =>
          name.trim() &&
          name.trim() !== milestone.name &&
          void update({ name: name.trim() })
        }
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={`Milestone name ${milestone.name}`}
        disabled={!canEdit}
        className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 outline-none focus:bg-muted enabled:hover:bg-muted touch:text-base"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => void update({ targetDate: e.target.value || null })}
        aria-label={`Target date for ${milestone.name}`}
        disabled={!canEdit}
        className="h-7 rounded-md border bg-card px-1 text-xs touch:text-base"
        title={
          milestone.targetDate
            ? formatDate(milestone.targetDate)
            : "No target date"
        }
      />
      <DropdownSelect
        value={milestone.status}
        onValueChange={(value) =>
          void update({ status: value as MilestoneStatus })
        }
        aria-label={`Status for ${milestone.name}`}
        disabled={!canEdit}
        size="sm"
      >
        {milestoneStatuses.map((s) => (
          <DropdownSelectOption key={s} value={s}>
            {milestoneStatusMeta[s]}
          </DropdownSelectOption>
        ))}
      </DropdownSelect>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count} item{count === 1 ? "" : "s"}
      </span>
      {canEdit && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={
            milestone.archivedAt ? "Restore milestone" : "Archive milestone"
          }
          onClick={() => void update({ archived: !milestone.archivedAt })}
        >
          {milestone.archivedAt ? (
            <ArchiveRestore className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}

function NewMilestone({ projectId }: { projectId: string }) {
  const { mutate } = useWorkspace();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string>();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setError(undefined);
        try {
          await mutate({
            type: "createMilestone",
            projectId,
            milestoneId: crypto.randomUUID(),
            name: name.trim(),
            targetDate: date || null,
          });
          setName("");
          setDate("");
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not create milestone.",
          );
        }
      }}
    >
      <Input
        className="h-8 flex-1 rounded-md text-sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New milestone (e.g. Q3 release)"
        aria-label="New milestone name"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="New milestone target date"
        className="h-8 rounded-md border bg-card px-2 text-sm touch:text-base"
      />
      <Button type="submit" variant="secondary" disabled={!name.trim()}>
        Add milestone
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </form>
  );
}
