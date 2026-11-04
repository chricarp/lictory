"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  CircleAlert,
  MessageSquare,
  ShieldCheck,
  ShieldX,
  SquarePen,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import {
  identifier,
  priorityMeta,
  refinementMeta,
  relativeTime,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  iterationLabel,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import {
  deliveryCategory,
  type ExternalLink,
} from "@lictory/core/lib/lifecycle";
import { Avatar } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";
import {
  PriorityIcon,
  TypeIcon,
} from "@lictory/platform/components/items/icons";
import {
  LabelChip,
  MilestoneBadge,
} from "@lictory/platform/components/items/labels";
import { estimateLabel } from "@lictory/platform/components/delivery/card";

// Hovering a row waits this long before previewing it; once a preview is
// showing, moving to the next row swaps it at once.
const OPEN_DELAY = 450;
const WARM_FOR = 400;
const WIDTH = 320;

export type ItemPreviewTarget = {
  show: (itemId: string, anchor: HTMLElement) => void;
  hide: () => void;
};

// One preview per list: rows report hover and keyboard focus, the list renders
// a single card for the row under the pointer. Nothing is fetched; the card
// reads the item summary every row already has.
export function useItemPreview() {
  const [state, setState] = useState<{
    itemId: string;
    anchor: HTMLElement;
  }>();
  const timer = useRef<number>(undefined);
  const closedAt = useRef(0);
  const openRef = useRef(false);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    if (openRef.current) closedAt.current = Date.now();
    openRef.current = false;
    setState(undefined);
  }, []);
  const show = useCallback((itemId: string, anchor: HTMLElement) => {
    window.clearTimeout(timer.current);
    const warm = openRef.current || Date.now() - closedAt.current < WARM_FOR;
    const open = () => {
      openRef.current = true;
      setState({ itemId, anchor });
    };
    if (warm) open();
    else timer.current = window.setTimeout(open, OPEN_DELAY);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A row that moves (scroll) or a key press ends the preview: it belongs to
  // the row as it was under the pointer.
  useEffect(() => {
    if (!state) return;
    const end = () => hide();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("scroll", end, true);
    window.addEventListener("resize", end);
    window.addEventListener("blur", end);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", end, true);
      window.removeEventListener("resize", end);
      window.removeEventListener("blur", end);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [state, hide]);
  const target = useMemo<ItemPreviewTarget>(
    () => ({ show, hide }),
    [show, hide],
  );
  return { previewed: state, target };
}

export function ItemPreviewCard({
  item,
  project,
  anchor,
  externalLink,
  deliveryTool,
}: {
  item: WorkItem;
  project: Project | undefined;
  anchor: HTMLElement;
  externalLink?: ExternalLink;
  deliveryTool: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const height = panel.offsetHeight;
    // Beside the list, over the document; on the other side when the row
    // sits at the right edge.
    let left = rect.right + gap;
    if (left + WIDTH > window.innerWidth - gap)
      left = Math.max(gap, rect.left - gap - WIDTH);
    const top = Math.min(
      Math.max(gap, rect.top - 6),
      Math.max(gap, window.innerHeight - height - gap),
    );
    setPosition({ top, left });
  }, [anchor, item]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      data-item-preview
      // Supplementary: everything here is on the item page, and the row's
      // link names the item. The card never takes the pointer or focus.
      aria-hidden
      style={{
        width: WIDTH,
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
      }}
      className={cn(
        "pointer-events-none fixed z-50 max-h-[calc(100dvh-1rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-(--shadow-panel)",
        position ? "animate-in" : "invisible",
      )}
    >
      <PreviewContent
        item={item}
        project={project}
        externalLink={externalLink}
        deliveryTool={deliveryTool}
      />
    </div>,
    document.body,
  );
}

function PreviewContent({
  item,
  project,
  externalLink,
  deliveryTool,
}: {
  item: WorkItem;
  project: Project | undefined;
  externalLink?: ExternalLink;
  deliveryTool: string;
}) {
  const { items, delivery, labels, milestones, memberName } = useWorkspace();
  const type = typeOf(delivery, item);
  const external = project?.deliveryMode === "external";
  const status = delivery.statuses.get(item.statusId);
  const parent = item.parentId
    ? items.find((i) => i.id === item.parentId)
    : undefined;
  const iteration = item.iterationId
    ? delivery.iterations.get(item.iterationId)
    : undefined;
  const team = item.teamId ? delivery.teams.get(item.teamId) : undefined;
  const milestone = item.milestoneId
    ? milestones.find((m) => m.id === item.milestoneId)
    : undefined;
  const itemLabels = labels.filter((l) => item.labelIds.includes(l.id));
  const estimate = external ? null : estimateLabel(project, item.estimate);
  const reviews = item.reviews.filter((r) => r.status !== "cancelled");
  const spec = type.hasSpecification && item.refinementState;
  const accepted = item.committedRevisionNumber;
  return (
    <div className="space-y-3 p-3.5 text-[13px]">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TypeIcon type={type} className="size-3.5 rounded-[3px]" />
          <span className="font-mono tabular-nums">
            {identifier(project, item.number)}
          </span>
          <span className="truncate">· {type.name}</span>
          {item.archivedAt && (
            <span className="inline-flex items-center gap-1">
              · <Archive className="size-3" /> Archived
            </span>
          )}
          <span className="ml-auto shrink-0">
            Updated {relativeTime(item.updatedAt)}
          </span>
        </div>
        {parent && (
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <TypeIcon
              type={typeOf(delivery, parent)}
              className="size-3 rounded-[3px]"
            />
            <span className="shrink-0 font-mono tabular-nums">
              {identifier(project, parent.number)}
            </span>
            <span className="truncate">{parent.title}</span>
          </div>
        )}
        <p className="line-clamp-4 text-[14px] leading-snug font-semibold break-words">
          {item.title}
        </p>
      </div>

      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        <Field label="Status">
          {external ? (
            <>
              <StatusIcon
                category={deliveryCategory(
                  item,
                  project,
                  delivery,
                  externalLink,
                )}
              />
              <span className="truncate">
                {externalLink?.externalKey
                  ? `${externalLink.externalStatus ?? "Status unavailable"} in ${deliveryTool}`
                  : `Not handed off to ${deliveryTool}`}
              </span>
            </>
          ) : (
            <>
              <StatusIcon category={status?.category} color={status?.color} />
              <span className="truncate">
                {status?.name ?? "Unknown status"}
              </span>
            </>
          )}
        </Field>
        <Field label="Priority">
          <PriorityIcon priority={item.priority} />
          <span>{priorityMeta[item.priority].label}</span>
        </Field>
        <Field label={external ? "Assignee" : "Owner"}>
          {external ? (
            <span
              className={cn(
                "truncate",
                !externalLink?.externalAssignee && "text-muted-foreground",
              )}
            >
              {externalLink?.externalKey
                ? externalLink.externalAssignee?.length
                  ? externalLink.externalAssignee
                  : `Unassigned in ${deliveryTool}`
                : "Not handed off"}
            </span>
          ) : item.assigneeId ? (
            <>
              <Avatar
                userId={item.assigneeId}
                name={memberName(item.assigneeId)}
                size="xs"
              />
              <span className="truncate">{memberName(item.assigneeId)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
        </Field>
        {estimate && (
          <Field label="Estimate">
            {estimate}
            {project?.estimateScale !== "tshirt" && " pts"}
          </Field>
        )}
        {iteration && (
          <Field
            label={project?.iterationMode === "automatic" ? "Cycle" : "Sprint"}
          >
            <span className="truncate">{iterationLabel(iteration)}</span>
            {iteration.state === "active" && (
              <span className="text-xs text-success">Active</span>
            )}
          </Field>
        )}
        {team && (
          <Field label="Team">
            <span className="truncate">{team.name}</span>
          </Field>
        )}
        {milestone && (
          <Field label="Milestone">
            <MilestoneBadge milestone={milestone} />
          </Field>
        )}
        {itemLabels.length > 0 && (
          <Field label="Labels" wrap>
            {itemLabels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </Field>
        )}
      </dl>

      {spec && (
        <section className="space-y-2.5 rounded-lg bg-muted/50 p-2.5">
          <div className="flex items-center gap-1.5">
            <RefinementIcon state={spec} />
            <span className="font-medium">{refinementMeta[spec].label}</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              Revision {item.revisionNumber}
            </span>
          </div>
          {accepted != null && (
            <p className="text-xs text-muted-foreground">
              {accepted === item.revisionNumber
                ? "Current revision accepted for delivery"
                : `Revision ${accepted} accepted for delivery`}
            </p>
          )}
          {item.readinessTotal > 0 && (
            <Meter
              label="Readiness checks"
              done={item.readinessPassed}
              total={item.readinessTotal}
              failing={item.blockingThreads > 0}
            />
          )}
          {reviews.length > 0 && (
            <ul className="space-y-1">
              {reviews.map((review) => (
                <li key={review.id} className="flex items-center gap-1.5">
                  {review.approved ? (
                    <ShieldCheck className="size-3.5 shrink-0 text-success" />
                  ) : review.status === "changes_requested" ? (
                    <ShieldX className="size-3.5 shrink-0 text-warning" />
                  ) : (
                    <span
                      aria-hidden
                      className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/60"
                    />
                  )}
                  <span className="min-w-0 truncate">
                    {review.responsibility}
                  </span>
                  {!review.required && (
                    <span className="text-xs text-muted-foreground">
                      optional
                    </span>
                  )}
                  <span
                    className={cn(
                      "ml-auto shrink-0 text-xs",
                      review.approved
                        ? "text-success"
                        : review.status === "changes_requested"
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}
                  >
                    {review.approved
                      ? "Approved"
                      : review.status === "changes_requested"
                        ? "Changes requested"
                        : "Awaiting review"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(item.blockingThreads > 0 ||
            item.openThreads > 0 ||
            item.openSuggestions > 0) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {item.blockingThreads > 0 && (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <CircleAlert className="size-3" />
                  {plural(item.blockingThreads, "blocker")}
                </span>
              )}
              {item.openThreads > item.blockingThreads && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <MessageSquare className="size-3" />
                  {plural(
                    item.openThreads - item.blockingThreads,
                    "open discussion",
                  )}
                </span>
              )}
              {item.openSuggestions > 0 && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <SquarePen className="size-3" />
                  {plural(item.openSuggestions, "open suggestion")}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {item.childCount > 0 && (
        <Meter
          label={`Child items done${
            item.childReadyCount
              ? ` · ${item.childReadyCount} specification${item.childReadyCount === 1 ? "" : "s"} ready`
              : ""
          }`}
          done={item.childDoneCount}
          total={item.childCount}
        />
      )}
    </div>
  );
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function Field({
  label,
  children,
  wrap = false,
}: {
  label: string;
  children: ReactNode;
  wrap?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          wrap && "flex-wrap gap-1",
        )}
      >
        {children}
      </dd>
    </>
  );
}

function Meter({
  label,
  done,
  total,
  failing = false,
}: {
  label: string;
  done: number;
  total: number;
  failing?: boolean;
}) {
  return (
    <div className="text-xs">
      <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums">
          {done}/{total}
        </span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: Math.max(total, 1) }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index < done
                ? "bg-success"
                : // An open blocker fails one check, as in the row meter.
                  index === done && failing
                  ? "bg-destructive"
                  : "bg-foreground/10",
            )}
          />
        ))}
      </div>
    </div>
  );
}
