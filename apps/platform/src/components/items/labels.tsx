import { useState } from "react";
import { Flag, Plus, Tag } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import {
  formatDate,
  labelColorClasses,
  milestoneStatusMeta,
  type Label,
  type Milestone,
} from "@lictory/core/lib/work-items";
import { labelColors, type LabelColor } from "@lictory/core/contracts/protocol";
import { Popover, Picker } from "@lictory/ui/popover";
import { Button } from "@lictory/ui/button";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

export function LabelChip({
  label,
  onRemove,
}: {
  label: Label;
  onRemove?: () => void;
}) {
  const color = labelColorClasses[label.color];
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium whitespace-nowrap",
        color.chip,
      )}
    >
      <span className={cn("size-1.5 rounded-full", color.dot)} />
      {label.name}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove label ${label.name}`}
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function ColorDot({
  color,
  className,
}: {
  color: LabelColor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block size-2.5 rounded-full",
        labelColorClasses[color].dot,
        className,
      )}
    />
  );
}

// Multi-select label picker with inline creation for the current project.
export function LabelPicker({
  projectId,
  labelIds,
  onChange,
  compact = false,
}: {
  projectId: string;
  labelIds: string[];
  onChange: (labelIds: string[]) => void;
  compact?: boolean;
}) {
  const { labels, mutate } = useWorkspace();
  const available = labels.filter(
    (l) => l.projectId === projectId && !l.archivedAt,
  );
  const selected = available.filter((l) => labelIds.includes(l.id));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("blue");
  const toggle = (id: string) =>
    onChange(
      labelIds.includes(id)
        ? labelIds.filter((x) => x !== id)
        : [...labelIds, id],
    );
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const labelId = crypto.randomUUID();
    await mutate({
      type: "createLabel",
      projectId,
      labelId,
      name: trimmed,
      color,
    });
    onChange([...labelIds, labelId]);
    setName("");
    setCreating(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {!compact &&
        selected.map((l) => (
          <LabelChip key={l.id} label={l} onRemove={() => toggle(l.id)} />
        ))}
      <Popover
        width={260}
        trigger={(props) => (
          <button
            {...props}
            aria-label="Labels"
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
              compact && "h-7 w-7 justify-center px-0",
            )}
          >
            <Tag className="size-3.5" />
            {!compact && (selected.length ? "Edit" : "Add label")}
            {compact && selected.length > 0 && (
              <span className="text-[10px]">{selected.length}</span>
            )}
          </button>
        )}
      >
        {creating ? (
          <form
            className="space-y-2 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Label name"
              aria-label="Label name"
              className="h-8 w-full rounded-md border bg-card px-2 text-sm outline-none focus:border-primary/60 touch:text-base"
            />
            <div
              className="flex flex-wrap gap-1"
              role="radiogroup"
              aria-label="Color"
            >
              {labelColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "grid size-6 place-items-center rounded-md hover:bg-muted",
                    color === c && "ring-2 ring-ring/60",
                  )}
                >
                  <ColorDot color={c} />
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Back
              </Button>
              <Button type="submit" size="sm" disabled={!name.trim()}>
                Create label
              </Button>
            </div>
          </form>
        ) : (
          <Picker
            multiple
            title="Labels"
            options={available.map((l) => ({
              value: l.id,
              label: l.name,
              icon: <ColorDot color={l.color} />,
            }))}
            value={labelIds}
            onSelect={toggle}
            emptyText="No labels in this project yet."
            footer={
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              >
                <Plus className="size-3.5 text-muted-foreground" /> New label
              </button>
            }
          />
        )}
      </Popover>
    </div>
  );
}

export function MilestonePicker({
  projectId,
  milestoneId,
  onChange,
}: {
  projectId: string;
  milestoneId: string | null;
  onChange: (milestoneId: string | null) => void;
}) {
  const { milestones, mutate } = useWorkspace();
  const available = milestones.filter(
    (m) => m.projectId === projectId && !m.archivedAt,
  );
  const current = available.find((m) => m.id === milestoneId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    const id = crypto.randomUUID();
    await mutate({
      type: "createMilestone",
      projectId,
      milestoneId: id,
      name: name.trim(),
      targetDate: date || null,
    });
    onChange(id);
    setName("");
    setDate("");
    setCreating(false);
  };
  return (
    <Popover
      width={280}
      trigger={(props) => (
        <button
          {...props}
          aria-label={`Milestone: ${current?.name ?? "None"}`}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Flag
            className={cn(
              "size-3.5 shrink-0",
              current ? "text-foreground" : "text-muted-foreground",
            )}
          />
          {current ? (
            <span className="truncate">
              {current.name}
              {current.targetDate && (
                <span className="text-muted-foreground">
                  {" "}
                  · {formatDate(current.targetDate)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">No milestone</span>
          )}
        </button>
      )}
    >
      {creating ? (
        <form
          className="space-y-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Milestone name"
            aria-label="Milestone name"
            className="h-8 w-full rounded-md border bg-card px-2 text-sm outline-none focus:border-primary/60 touch:text-base"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Target date"
            className="h-8 w-full rounded-md border bg-card px-2 text-sm outline-none focus:border-primary/60 touch:text-base"
          />
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCreating(false)}
            >
              Back
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Create milestone
            </Button>
          </div>
        </form>
      ) : (
        <Picker
          title="Milestone"
          options={[
            { value: "none", label: "No milestone" },
            ...available.map((m) => ({
              value: m.id,
              label: m.name,
              hint: m.targetDate
                ? formatDate(m.targetDate)
                : milestoneStatusMeta[m.status],
              icon: <Flag className="size-3.5" />,
            })),
          ]}
          value={milestoneId ?? "none"}
          onSelect={(v) => onChange(v === "none" ? null : v)}
          footer={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            >
              <Plus className="size-3.5 text-muted-foreground" /> New milestone
            </button>
          }
        />
      )}
    </Popover>
  );
}

export function MilestoneBadge({ milestone }: { milestone: Milestone }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded bg-muted px-1.5 text-[11px] whitespace-nowrap text-muted-foreground"
      title={
        milestone.targetDate
          ? `Target ${formatDate(milestone.targetDate)}`
          : undefined
      }
    >
      <Flag className="size-3" />
      {milestone.name}
    </span>
  );
}
