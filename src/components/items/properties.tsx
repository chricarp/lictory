"use client";
import { PriorityIcon } from "./icons";
export { PriorityIcon } from "./icons";
export { AssigneePicker } from "~/components/ui/people-picker";
import { cn } from "~/lib/utils";
import { priorityMeta, priorityOrder, type Product } from "~/lib/work-items";
import type { WorkItemPriority } from "~/sync/shared/protocol";
import { Popover, Picker } from "~/components/ui/popover";
import { useWorkspace } from "~/components/workspace/provider";

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
