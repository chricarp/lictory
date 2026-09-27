"use client";
import { EpicPicker } from "./epic-picker";
import { PriorityIcon } from "./icons";
export { PriorityIcon } from "./icons";
export { AssigneePicker } from "~/components/ui/people-picker";
import { cn } from "~/lib/utils";
import {
  type Project,
  isTopLevel,
  priorityMeta,
  priorityOrder,
  typeOf,
} from "~/lib/work-items";
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
  projectId,
  onChange,
  project,
}: {
  parentId: string | null;
  projectId: string;
  project?: Project;
  onChange: (parentId: string | null) => void;
}) {
  const { items, delivery } = useWorkspace();
  const epics = items.filter(
    (i) =>
      isTopLevel(typeOf(delivery, i)) &&
      i.projectId === projectId &&
      !i.archivedAt,
  );
  const parent = epics.find((e) => e.id === parentId);
  return (
    <EpicPicker
      parentId={parentId}
      projectId={projectId}
      projectKey={project?.key}
      selected={
        parent
          ? {
              id: parent.id,
              projectId: parent.projectId,
              number: parent.number,
              title: parent.title,
            }
          : undefined
      }
      onChange={onChange}
      className="h-7 border-transparent bg-transparent px-1.5 focus-within:bg-muted focus-within:ring-ring/60 hover:border-transparent hover:bg-muted"
    />
  );
}
