"use client";
import { useState } from "react";
import { Archive, ArchiveRestore, Flag } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  formatDate,
  milestoneStatusMeta,
  type Label,
  type Milestone,
} from "~/lib/work-items";
import {
  labelColors,
  milestoneStatuses,
  type LabelColor,
  type MilestoneStatus,
} from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SectionLabel } from "~/components/ui/primitives";
import { Popover, Picker } from "~/components/ui/popover";
import { ColorDot } from "~/components/items/labels";
import { useWorkspace } from "./provider";

// Product-scoped labels and milestones. Archiving is reversible and keeps every
// historical assignment; nothing here deletes.
export function LabelsAndMilestones() {
  const { products, labels, milestones, mutate, items } = useWorkspace();
  const [productId, setProductId] = useState(products[0]?.id);
  const product = products.find((p) => p.id === productId) ?? products[0];
  if (!product) return null;
  const productLabels = labels.filter((l) => l.productId === product.id);
  const productMilestones = milestones.filter(
    (m) => m.productId === product.id,
  );
  const usage = (predicate: (i: (typeof items)[number]) => boolean) =>
    items.filter((i) => !i.archivedAt && predicate(i)).length;
  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2">
        <SectionLabel>Labels & milestones</SectionLabel>
        {products.length > 1 && (
          <select
            value={product.id}
            onChange={(e) => setProductId(e.target.value)}
            aria-label="Product"
            className="ml-auto h-7 rounded-md border bg-card px-2 text-xs"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-medium">Labels</p>
        <div className="divide-y rounded-lg border">
          {productLabels.length === 0 && (
            <p className="p-3 text-[13px] text-muted-foreground">
              No labels yet.
            </p>
          )}
          {productLabels.map((l) => (
            <LabelRow
              key={l.id}
              label={l}
              count={usage((i) => i.labelIds.includes(l.id))}
              update={(patch) =>
                mutate({
                  type: "updateLabel",
                  productId: product.id,
                  labelId: l.id,
                  ...patch,
                })
              }
            />
          ))}
        </div>
        <NewLabel productId={product.id} />
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-medium">Milestones</p>
        <div className="divide-y rounded-lg border">
          {productMilestones.length === 0 && (
            <p className="p-3 text-[13px] text-muted-foreground">
              No milestones yet.
            </p>
          )}
          {productMilestones.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              count={usage((i) => i.milestoneId === m.id)}
              update={(patch) =>
                mutate({
                  type: "updateMilestone",
                  productId: product.id,
                  milestoneId: m.id,
                  ...patch,
                })
              }
            />
          ))}
        </div>
        <NewMilestone productId={product.id} />
      </div>
    </section>
  );
}

function LabelRow({
  label,
  count,
  update,
}: {
  label: Label;
  count: number;
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
        "flex items-center gap-2 px-3 py-1.5 text-[13px]",
        label.archivedAt && "opacity-60",
      )}
    >
      <Popover
        width={200}
        trigger={(props) => (
          <button
            {...props}
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
        className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 outline-none hover:bg-muted focus:bg-muted"
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {count} item{count === 1 ? "" : "s"}
      </span>
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
    </div>
  );
}

function NewLabel({ productId }: { productId: string }) {
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
            productId,
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
            className="grid size-8 place-items-center rounded-md border bg-card hover:bg-muted"
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
        className="h-8 text-sm"
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
  update,
}: {
  milestone: Milestone;
  count: number;
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
        "flex flex-wrap items-center gap-2 px-3 py-1.5 text-[13px]",
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
        className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 outline-none hover:bg-muted focus:bg-muted"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => void update({ targetDate: e.target.value || null })}
        aria-label={`Target date for ${milestone.name}`}
        className="h-7 rounded-md border bg-card px-1 text-xs"
        title={
          milestone.targetDate
            ? formatDate(milestone.targetDate)
            : "No target date"
        }
      />
      <select
        value={milestone.status}
        onChange={(e) =>
          void update({ status: e.target.value as MilestoneStatus })
        }
        aria-label={`Status for ${milestone.name}`}
        className="h-7 rounded-md border bg-card px-1 text-xs"
      >
        {milestoneStatuses.map((s) => (
          <option key={s} value={s}>
            {milestoneStatusMeta[s]}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count} item{count === 1 ? "" : "s"}
      </span>
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
    </div>
  );
}

function NewMilestone({ productId }: { productId: string }) {
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
            productId,
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
        className="h-8 flex-1 text-sm"
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
        className="h-8 rounded-md border bg-card px-2 text-sm"
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
