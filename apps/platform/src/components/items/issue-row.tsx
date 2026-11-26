import { Actor } from "@lictory/platform/components/identity/actor";
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
  hasReviewSignal,
} from "@lictory/platform/components/items/signals";
import { TypeIcon, epicGlyph } from "@lictory/platform/components/items/icons";
import {
  LabelChip,
  MilestoneBadge,
} from "@lictory/platform/components/items/labels";
import type { Label, Milestone } from "@lictory/core/lib/work-items";
import { PageCount } from "@lictory/platform/components/knowledge/page-count";
import type { ItemPreviewTarget } from "@lictory/platform/components/items/item-preview";

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
  onUpdate,
  onFocus,
  onBlur,
  externalLink,
  deliveryTool = "your delivery tool",
  hint,
  preview,
  pages,
  showEstimate = true,
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
  // Kept for callers; avatars look people up themselves.
  memberName?: (id: string | null) => string;
  // Absent when the viewer's roles cannot change properties.
  onUpdate?: (patch: {
    statusId?: string;
    priority?: WorkItem["priority"];
    assigneeId?: string | null;
  }) => void;
  // Pointer entering and leaving the row moves and hides the list's cursor.
  onFocus: () => void;
  onBlur: () => void;
  externalLink?: ExternalLink;
  // Names the tool an external project delivers in, for row copy.
  deliveryTool?: string;
  hint?: string;
  // Compact rows preview the item on hover and keyboard focus.
  preview?: ItemPreviewTarget;
  // Readable pages about the item (knowledge links).
  pages?: number;
  // The list shows an estimate column (some item in it is estimated).
  showEstimate?: boolean;
}) {
  const delivery = useDelivery();
  const type = typeOf(delivery, item);
  const externalStatus =
    project?.deliveryMode === "external" ? (
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
    ) : undefined;
  if (compact)
    // Beside an open item the list is narrow: the title gets the whole first
    // line (and a second when it needs one), the identifier and signals sit
    // underneath, and hovering previews the rest.
    return (
      <li
        data-item-row
        data-focused={focused || undefined}
        className={cn(
          "group relative border-b px-3 py-1.5 text-[13px] last:border-b-0",
          selected
            ? "bg-card shadow-(--shadow-border)"
            : focused
              ? "bg-muted/70"
              : "hover:bg-muted/50",
        )}
        onMouseEnter={onFocus}
        onMouseLeave={onBlur}
        onPointerEnter={
          preview &&
          ((event) => {
            if (event.pointerType === "mouse" && !selected)
              preview.show(item.id, event.currentTarget);
          })
        }
        onPointerLeave={preview?.hide}
        onPointerDown={preview?.hide}
      >
        <Link
          href={href}
          className="line-clamp-2 leading-snug font-medium break-words outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-primary"
          aria-current={selected ? "page" : undefined}
          onFocus={
            preview &&
            ((event) => {
              const row = event.currentTarget.closest("li");
              if (
                !selected &&
                row &&
                event.currentTarget.matches(":focus-visible")
              )
                preview.show(item.id, row);
            })
          }
          onBlur={preview?.hide}
        >
          {item.title}
        </Link>
        <div className="mt-0.5 flex h-6 items-center gap-1.5">
          {/* Above the row link's hit area, so the status stays a control. */}
          <span className="relative -ml-1.5 inline-flex">
            {externalStatus ?? (
              <IssueStatus
                projectId={item.projectId}
                statusId={item.statusId}
                compact
                onChange={onUpdate && ((statusId) => onUpdate({ statusId }))}
              />
            )}
          </span>
          <TypeIcon type={type} />
          <IssueIdentifier project={project} number={item.number} />
          {/* A phone's row (no preview card) says the next step here. */}
          {hint && !preview && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {hint}
            </span>
          )}
          <ReviewSignal item={item} compact className="ml-auto shrink-0" />
          {project?.deliveryMode !== "external" && item.assigneeId && (
            // Initials, not a bare dot: the owner is told apart by more
            // than color.
            <Actor userId={item.assigneeId} label="none" size={20} />
          )}
        </div>
      </li>
    );
  return (
    <li
      data-item-row
      data-focused={focused || undefined}
      className={cn(
        "group relative flex items-center gap-2 border-b px-3 text-[13px] last:border-b-0",
        hint ? "min-h-14" : "h-10",
        selected
          ? "bg-card shadow-(--shadow-border)"
          : focused
            ? "bg-muted/70"
            : "hover:bg-muted/50",
      )}
      onMouseEnter={onFocus}
      onMouseLeave={onBlur}
    >
      <IssuePriority
        priority={item.priority}
        compact
        onChange={onUpdate && ((priority) => onUpdate({ priority }))}
      />
      {externalStatus ?? (
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
        className="w-18"
      />
      <Link
        href={href}
        className="min-w-0 flex-1 truncate py-2 font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-primary"
        aria-current={selected ? "page" : undefined}
      >
        <span className="block truncate">{item.title}</span>
        {hint && (
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </Link>
      {labels.length > 0 && (
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
      {milestone && (
        <span className="hidden @min-[65rem]/frame:inline-flex">
          <MilestoneBadge milestone={milestone} />
        </span>
      )}
      {parent && (
        <span
          className="hidden max-w-45 items-center gap-1 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground @min-[81rem]/frame:inline-flex"
          title={parent.title}
        >
          <TypeIcon
            type={delivery.types.get(parent.typeId) ?? epicGlyph}
            className="size-3 rounded-[3px]"
          />
          <span className="truncate">{identifier(project, parent.number)}</span>
        </span>
      )}
      {isTopLevel(type) && item.childCount > 0 && (
        <span
          className="text-xs text-muted-foreground tabular-nums"
          title={`${item.childDoneCount} of ${item.childCount} children done, ${item.childReadyCount} specifications ready`}
        >
          {item.childDoneCount}/{item.childCount} done
        </span>
      )}
      <PageCount
        count={pages}
        itemHref={href}
        className="hidden sm:inline-flex"
      />
      {project?.deliveryMode !== "external" && showEstimate && (
        <span className="inline-flex shrink-0 justify-center md:w-7">
          {item.estimate !== null && (
            <span
              className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums"
              title={`Estimate: ${item.estimate}`}
            >
              <span aria-hidden>{item.estimate}</span>
              <span className="sr-only">Estimate {item.estimate}</span>
            </span>
          )}
        </span>
      )}
      {hasReviewSignal(item) ? (
        <ReviewSignal
          item={item}
          className="md:mr-3 md:w-36 md:shrink-0 md:justify-start md:whitespace-nowrap @min-[65rem]/frame:w-52"
        />
      ) : (
        // No review and no discussion: the slot stays empty and aligned.
        <span
          aria-hidden
          className="hidden md:mr-3 md:inline md:w-36 md:shrink-0 @min-[65rem]/frame:w-52"
        />
      )}
      {/* A fixed slot keeps assignee and time aligned on rows without checks. */}
      <span className="hidden w-16 shrink-0 md:inline-flex @min-[65rem]/frame:w-24">
        <ReadinessBar item={item} labelled />
      </span>
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
      ) : (
        // Nobody assigned: no placeholder face on every row; the picker
        // shows on hover and focus for people who assign.
        <span
          className={cn(
            "inline-flex",
            !item.assigneeId &&
              (onUpdate
                ? "opacity-0 group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100"
                : "invisible"),
          )}
        >
          <AssigneePicker
            assigneeId={item.assigneeId}
            compact
            onChange={onUpdate && ((assigneeId) => onUpdate({ assigneeId }))}
          />
        </span>
      )}
      <time
        className="hidden w-14 text-right text-xs text-muted-foreground tabular-nums sm:block"
        dateTime={item.updatedAt}
        title={new Date(item.updatedAt).toLocaleString()}
      >
        {relativeTime(item.updatedAt)}
      </time>
    </li>
  );
});
