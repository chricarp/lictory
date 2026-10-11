"use client";
import Link from "next/link";
import { memo } from "react";
import { cn } from "~/lib/utils";
import {
  identifier,
  isTopLevel,
  relativeTime,
  typeOf,
  type Project,
} from "~/lib/work-items";
import { useDelivery } from "~/components/workspace/provider";
import type { WorkItem } from "~/sync/shared/protocol";
import { Avatar } from "~/components/ui/primitives";
import { IssueStatus } from "./status";
import { AssigneePicker, IssuePriority } from "./properties";
import { IssueIdentifier } from "./identifier";
import { ReadinessBar, ReviewSignal } from "./signals";
import { TypeIcon, epicGlyph } from "./icons";
import { LabelChip, MilestoneBadge } from "./labels";
import type { Label, Milestone } from "~/lib/work-items";

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
}) {
  const delivery = useDelivery();
  const type = typeOf(delivery, item);
  return (
    <li
      data-item-row
      data-focused={focused || undefined}
      className={cn(
        "group relative flex items-center gap-2 border-b px-3 text-[13px] last:border-b-0",
        compact ? "h-9" : "h-10",
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
      <IssueStatus
        projectId={item.projectId}
        statusId={item.statusId}
        compact
        onChange={onUpdate && ((statusId) => onUpdate({ statusId }))}
      />
      <TypeIcon type={type} />
      <IssueIdentifier
        project={project}
        number={item.number}
        className="w-18"
      />
      <Link
        href={href}
        className="min-w-0 flex-1 truncate py-2 font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-primary"
        aria-current={selected ? "page" : undefined}
      >
        {item.title}
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
          className="hidden max-w-45 items-center gap-1 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground xl:inline-flex"
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
      {!compact && item.estimate !== null && (
        <span
          className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums"
          title="Estimate"
        >
          {item.estimate}
        </span>
      )}
      <ReviewSignal item={item} />
      {!compact && (
        <ReadinessBar item={item} className="hidden md:inline-flex" />
      )}
      {!compact ? (
        <AssigneePicker
          assigneeId={item.assigneeId}
          compact
          onChange={onUpdate && ((assigneeId) => onUpdate({ assigneeId }))}
        />
      ) : (
        item.assigneeId && (
          <Avatar
            userId={item.assigneeId}
            name={memberName(item.assigneeId)}
            size="xs"
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
