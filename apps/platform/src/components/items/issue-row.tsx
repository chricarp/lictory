import { Link } from "@lictory/platform/lib/navigation";
import { memo } from "react";
import { cn } from "@lictory/core/lib/utils";
import {
  identifier,
  isTopLevel,
  relativeTime,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import { useDelivery } from "@lictory/platform/components/workspace/provider";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import {
  deliveryCategory,
  type ExternalLink,
} from "@lictory/core/lib/lifecycle";
import { Avatar } from "@lictory/ui/primitives";
import {
  IssueStatus,
  StatusIcon,
} from "@lictory/platform/components/items/status";
import {
  AssigneePicker,
  IssuePriority,
} from "@lictory/platform/components/items/properties";
import { IssueIdentifier } from "@lictory/platform/components/items/identifier";
import {
  ReadinessBar,
  ReviewSignal,
} from "@lictory/platform/components/items/signals";
import { TypeIcon, epicGlyph } from "@lictory/platform/components/items/icons";
import {
  LabelChip,
  MilestoneBadge,
} from "@lictory/platform/components/items/labels";
import type { Label, Milestone } from "@lictory/core/lib/work-items";

export const IssueRow = memo(function IssueRow({
  item,
  project,
  parent,
  labels,
  milestone,
  href,
  selected,
  focused,
  compact,
  memberName,
  onUpdate,
  onFocus,
  externalLink,
  deliveryTool = "your delivery tool",
  hint,
}: {
  item: WorkItem;
  project: Project | undefined;
  parent?: WorkItem;
  labels: Label[];
  milestone?: Milestone;
  href: string;
  selected: boolean;
  focused: boolean;
  compact: boolean;
  memberName: (id: string | null) => string;
  // Absent when the viewer's roles cannot change properties.
  onUpdate?: (patch: {
    statusId?: string;
    priority?: WorkItem["priority"];
    assigneeId?: string | null;
  }) => void;
  onFocus: () => void;
  externalLink?: ExternalLink;
  // Names the tool an external project delivers in, for row copy.
  deliveryTool?: string;
  hint?: string;
}) {
  const delivery = useDelivery();
  const type = typeOf(delivery, item);
  return (
    <li
      data-item-row
      data-focused={focused || undefined}
      className={cn(
        "group relative flex items-center gap-2 border-b px-3 text-[13px] last:border-b-0",
        compact ? "h-9" : hint ? "min-h-14" : "h-10",
        selected
          ? "bg-primary/6"
          : focused
            ? "bg-muted/70"
            : "hover:bg-muted/50",
      )}
      onMouseEnter={onFocus}
    >
      {!compact && (
        <IssuePriority
          priority={item.priority}
          compact
          onChange={onUpdate && ((priority) => onUpdate({ priority }))}
        />
      )}
      {project?.deliveryMode === "external" ? (
        <span
          title={
            externalLink?.externalKey
              ? `${externalLink.externalStatus ?? "Status unavailable"} in ${deliveryTool}`
              : `Not handed off to ${deliveryTool}`
          }
        >
          <StatusIcon
            category={deliveryCategory(item, project, delivery, externalLink)}
          />
        </span>
      ) : (
        <IssueStatus
          projectId={item.projectId}
          statusId={item.statusId}
          compact
          onChange={onUpdate && ((statusId) => onUpdate({ statusId }))}
        />
      )}
      <TypeIcon type={type} />
      <IssueIdentifier
        project={project}
        number={item.number}
        className={compact ? "w-12" : "w-18"}
      />
      <Link
        href={href}
        className="min-w-0 flex-1 truncate py-2 font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-primary"
        aria-current={selected ? "page" : undefined}
      >
        <span className="block truncate">{item.title}</span>
        {hint && !compact && (
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </Link>
      {!compact && labels.length > 0 && (
        <span className="hidden items-center gap-1 lg:inline-flex">
          {labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {labels.length > 3 && (
            <span className="text-[11px] text-muted-foreground">
              +{labels.length - 3}
            </span>
          )}
        </span>
      )}
      {!compact && milestone && (
        <span className="hidden xl:inline-flex">
          <MilestoneBadge milestone={milestone} />
        </span>
      )}
      {!compact && parent && (
        <span
          className="hidden max-w-45 items-center gap-1 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground 2xl:inline-flex"
          title={parent.title}
        >
          <TypeIcon
            type={delivery.types.get(parent.typeId) ?? epicGlyph}
            className="size-3 rounded-[3px]"
          />
          <span className="truncate">{identifier(project, parent.number)}</span>
        </span>
      )}
      {isTopLevel(type) && item.childCount > 0 && !compact && (
        <span
          className="text-xs text-muted-foreground tabular-nums"
          title={`${item.childDoneCount} of ${item.childCount} children done, ${item.childReadyCount} specifications ready`}
        >
          {item.childDoneCount}/{item.childCount} done
        </span>
      )}
      {!compact && project?.deliveryMode !== "external" && (
        <span className="inline-flex w-7 shrink-0 justify-center">
          {item.estimate !== null && (
            <span
              className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums"
              title="Estimate"
            >
              {item.estimate}
            </span>
          )}
        </span>
      )}
      <ReviewSignal
        item={item}
        compact={compact}
        className={compact ? undefined : "min-w-28 justify-end"}
      />
      {!compact && (
        // A fixed slot keeps assignee and time aligned on rows without checks.
        <span className="hidden w-16 shrink-0 md:inline-flex">
          <ReadinessBar item={item} />
        </span>
      )}
      {project?.deliveryMode === "external" ? (
        <span
          className="hidden max-w-28 truncate text-xs text-muted-foreground sm:block"
          title={`Assignee in ${deliveryTool}`}
        >
          {externalLink?.externalKey
            ? externalLink.externalAssignee?.length
              ? externalLink.externalAssignee
              : `Unassigned in ${deliveryTool}`
            : "Not handed off"}
        </span>
      ) : !compact ? (
        <AssigneePicker
          assigneeId={item.assigneeId}
          compact
          onChange={onUpdate && ((assigneeId) => onUpdate({ assigneeId }))}
        />
      ) : (
        // Compact rows give the title the room; the assignee shows on wide
        // screens only.
        item.assigneeId && (
          <Avatar
            userId={item.assigneeId}
            name={memberName(item.assigneeId)}
            size="xs"
            className="hidden 2xl:inline-grid"
          />
        )
      )}
      {!compact && (
        <time
          className="hidden w-14 text-right text-xs text-muted-foreground tabular-nums sm:block"
          dateTime={item.updatedAt}
          title={new Date(item.updatedAt).toLocaleString()}
        >
          {relativeTime(item.updatedAt)}
        </time>
      )}
    </li>
  );
});
