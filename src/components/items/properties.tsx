"use client";
import { Minus, UserRound } from "lucide-react";
import { cn } from "~/lib/utils";
import { priorityMeta, priorityOrder, type Product } from "~/lib/work-items";
import type { WorkItemPriority } from "~/sync/shared/protocol";
import { Popover, Picker } from "~/components/ui/popover";
import { Avatar } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";

export function PriorityIcon({
  priority,
  className,
}: {
  priority: WorkItemPriority;
  className?: string;
}) {
  if (priority === "none")
    return (
      <Minus
        className={cn("size-3.5 text-muted-foreground/60", className)}
        aria-hidden
      />
    );
  const bars = { low: 1, medium: 2, high: 3, urgent: 3 }[priority];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-3.5 w-3.5 items-end justify-center gap-px",
        priority === "urgent" ? "text-red-600" : "text-foreground/80",
        className,
      )}
    >
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            "w-[3px] rounded-[1px]",
            n <= bars ? "bg-current" : "bg-current/25",
          )}
          style={{ height: `${4 + n * 3}px` }}
        />
      ))}
    </span>
  );
}

export function IssuePriority({
  priority,
  onChange,
  compact = false,
}: {
  priority: WorkItemPriority;
  onChange?: (priority: WorkItemPriority) => void;
  compact?: boolean;
}) {
  const content = (
    <>
      <PriorityIcon priority={priority} />
      {!compact && <span>{priorityMeta[priority].label}</span>}
    </>
  );
  if (!onChange)
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[13px]"
        title={priorityMeta[priority].label}
      >
        {content}
      </span>
    );
  return (
    <Popover
      width={200}
      trigger={(props) => (
        <button
          {...props}

          aria-label={`Priority: ${priorityMeta[priority].label}`}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
            compact ? "w-7 justify-center" : "px-1.5",
          )}
        >
          {content}
        </button>
      )}
    >
      <Picker
        title="Set priority"
        options={priorityOrder.map((p) => ({
          value: p,
          label: priorityMeta[p].label,
          icon: <PriorityIcon priority={p} />,
        }))}
        value={priority}
        onSelect={onChange}
      />
    </Popover>
  );
}

export function AssigneePicker({
  assigneeId,
  onChange,
  compact = false,
}: {
  assigneeId: string | null;
  onChange?: (assigneeId: string | null) => void;
  compact?: boolean;
}) {
  const { directory, memberName, userId } = useWorkspace();
  const name = assigneeId ? memberName(assigneeId) : null;
  const content = (
    <>
      {name ? (
        <Avatar name={name} size="sm" />
      ) : (
        <span className="grid size-5 place-items-center rounded-full border border-dashed text-muted-foreground">
          <UserRound className="size-3" />
        </span>
      )}
      {!compact && (
        <span className={cn(!name && "text-muted-foreground")}>
          {name ?? "Unassigned"}
        </span>
      )}
    </>
  );
  if (!onChange)
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[13px]"
        title={name ?? "Unassigned"}
      >
        {content}
      </span>
    );
  const options = [
    {
      value: "none",
      label: "Unassigned",
      icon: <UserRound className="size-3.5" />,
    },
    ...directory.members
      .slice()
      .sort((a, b) =>
        a.id === userId
          ? -1
          : b.id === userId
            ? 1
            : a.name.localeCompare(b.name),
      )
      .map((m) => ({
        value: m.id,
        label: m.id === userId ? `${m.name} (me)` : m.name,
        hint: m.email,
        icon: <Avatar name={m.name} size="xs" />,
      })),
  ];
  return (
    <Popover
      width={260}
      trigger={(props) => (
        <button
          {...props}

          aria-label={`Assignee: ${name ?? "Unassigned"}`}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
            compact ? "w-7 justify-center" : "px-1.5",
          )}
        >
          {content}
        </button>
      )}
    >
      <Picker
        title="Assign to"
        options={options}
        value={assigneeId ?? "none"}
        onSelect={(v) => onChange(v === "none" ? null : v)}
      />
    </Popover>
  );
}

export function ParentPicker({
  parentId,
  productId,
  onChange,
  product,
}: {
  parentId: string | null;
  productId: string;
  product?: Product;
  onChange: (parentId: string | null) => void;
}) {
  const { items } = useWorkspace();
  const epics = items.filter(
    (i) => i.kind === "epic" && i.productId === productId && !i.archivedAt,
  );
  const parent = epics.find((e) => e.id === parentId);
  return (
    <Popover
      width={320}
      trigger={(props) => (
        <button
          {...props}

          aria-label={`Epic: ${parent?.title ?? "None"}`}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {parent ? (
            <>
              <span className="font-mono text-xs text-muted-foreground">
                {product?.key}-{parent.number}
              </span>
              <span className="truncate">{parent.title}</span>
            </>
          ) : (
            <span className="text-muted-foreground">No epic</span>
          )}
        </button>
      )}
    >
      <Picker
        title="Move to epic"
        options={[
          { value: "none", label: "No epic" },
          ...epics.map((e) => ({
            value: e.id,
            label: e.title,
            hint: `${product?.key}-${e.number}`,
          })),
        ]}
        value={parentId ?? "none"}
        onSelect={(v) => onChange(v === "none" ? null : v)}
      />
    </Popover>
  );
}
