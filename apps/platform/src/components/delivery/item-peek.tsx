import { Link } from "@lictory/platform/lib/navigation";
import { usePathname, useSearchParams } from "@lictory/platform/lib/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ArrowUpRight, CircleAlert, MessageSquare, X } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  identifier,
  isTopLevel,
  parseIdentifier,
  refinementMeta,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  iterationLabel,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  IssueStatus,
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import {
  AssigneePicker,
  IssuePriority,
} from "@lictory/platform/components/items/properties";
import { estimateLabel } from "@lictory/platform/components/delivery/card";

const PARAM = "item";

// Board and backlogs open work items in a preview instead of navigating away.
// The previewed item lives in the URL (`?item=PAY-12`) so a reload or a shared
// link reopens it; replacing the history entry keeps flipping between items
// out of Back.
export function useItemPeek() {
  const params = useSearchParams();
  const pathname = usePathname();
  const peeked = params.get(PARAM)?.toUpperCase();
  const set = useCallback(
    (value: string | undefined) => {
      const query = new URLSearchParams(window.location.search);
      if (value) query.set(PARAM, value);
      else query.delete(PARAM);
      const search = query.toString();
      window.history.replaceState(
        null,
        "",
        search ? `${pathname}?${search}` : pathname,
      );
    },
    [pathname],
  );
  // Plain clicks preview; modified clicks (new tab, new window) keep the link.
  const onLinkClick = useCallback(
    (event: MouseEvent, id: string) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      set(id);
    },
    [set],
  );
  const close = useCallback(() => set(undefined), [set]);
  return { peeked, onLinkClick, close };
}

export type ItemPeekState = ReturnType<typeof useItemPeek>;

export function ItemPeek({
  project,
  peek,
}: {
  project: Project;
  peek: ItemPeekState;
}) {
  const { items, view } = useWorkspace();
  const { peeked, close } = peek;
  const ref = useRef<HTMLElement>(null);
  const item = useMemo(() => {
    const parsed = peeked ? parseIdentifier(peeked) : undefined;
    if (parsed?.key !== project.key.toUpperCase()) return undefined;
    return items.find(
      (i) => i.projectId === project.id && i.number === parsed.number,
    );
  }, [items, peeked, project.id, project.key]);

  // Anything outside the preview closes it, except another work item (which
  // swaps the content), toasts, and open pickers (the first click only closes
  // those).
  useEffect(() => {
    if (!peeked) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        ref.current?.contains(target) ||
        target.closest("[data-peek-item],[data-popover],[data-slot='toast']") ||
        document.querySelector("[data-popover]")
      )
        return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Open pickers and modal dialogs handle their own Escape; toasts do not
      // count.
      if (document.querySelector("[role='dialog']:not([data-slot='toast'])"))
        return;
      close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [peeked, close]);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [item?.id]);

  if (!peeked) return null;
  return (
    <aside
      ref={ref}
      aria-label={`Preview of ${item ? identifier(project, item.number) : peeked}`}
      data-item-peek
      className={cn(
        "item-peek-in fixed z-30 flex flex-col overflow-hidden border bg-popover text-popover-foreground shadow-(--shadow-panel)",
        // Phones: a bottom sheet the width of the screen.
        "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
        // Tablets and up: docked to the bottom-right corner, over the work.
        "sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-h-[min(680px,calc(100dvh-6rem))] sm:w-[380px] sm:rounded-xl sm:pb-0 2xl:w-[420px]",
      )}
    >
      <div
        aria-hidden
        className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/25 sm:hidden"
      />
      {item ? (
        <PeekContent
          item={item}
          project={project}
          peek={peek}
          bodyRef={bodyRef}
        />
      ) : (
        <>
          <PeekHeader onClose={close}>
            <span className="font-mono text-xs text-muted-foreground">
              {peeked}
            </span>
          </PeekHeader>
          <p className="px-4 py-6 text-[13px] text-muted-foreground">
            {view.status === "hydrating"
              ? "Opening…"
              : `${peeked} is not part of ${project.name}, or it no longer exists.`}
          </p>
        </>
      )}
    </aside>
  );
}

function PeekHeader({
  children,
  actions,
  onClose,
}: {
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-1.5 border-b pr-1.5 pl-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
      {actions}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Close preview"
        title="Close (Esc)"
        onClick={onClose}
      >
        <X className="size-4" />
      </Button>
    </header>
  );
}

function PeekContent({
  item,
  project,
  peek,
  bodyRef,
}: {
  item: WorkItem;
  project: Project;
  peek: ItemPeekState;
  bodyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const {
    items,
    projects,
    relations,
    delivery,
    organization,
    mutate,
    capabilitiesIn,
  } = useWorkspace();
  const type = typeOf(delivery, item);
  const id = identifier(project, item.number);
  const canChange = capabilitiesIn(project.id).changeProperties;
  const native = project.deliveryMode === "native";
  const href = paths.item(organization.slug, project.key, id);
  const parent = item.parentId
    ? items.find((i) => i.id === item.parentId)
    : undefined;
  const iteration = item.iterationId
    ? delivery.iterations.get(item.iterationId)
    : undefined;
  const team = item.teamId ? delivery.teams.get(item.teamId) : undefined;
  const estimate = estimateLabel(project, item.estimate);
  const blockers = useMemo(
    () =>
      relations
        .filter((r) => r.kind === "blocks" && r.toId === item.id)
        .map((r) => items.find((i) => i.id === r.fromId))
        .filter((i): i is WorkItem => Boolean(i && !i.archivedAt)),
    [relations, items, item.id],
  );
  const update = (
    patch: { statusId: string } | { assigneeId: string | null },
  ) => void mutate({ type: "updateWorkItem", workItemId: item.id, ...patch });
  const notReady =
    type.hasSpecification &&
    item.refinementState !== "ready" &&
    project.readinessPolicy !== "off";
  const startHint = notReady
    ? project.readinessPolicy === "block"
      ? "Blocked until the specification is ready"
      : "Specification not ready yet"
    : undefined;
  const required = item.reviews.filter((r) => r.required);
  return (
    <>
      <PeekHeader
        onClose={peek.close}
        actions={
          <Link href={href} className="contents">
            <Button variant="ghost" size="sm" title="Open the full item page">
              Open
              <ArrowUpRight className="size-3.5" />
            </Button>
          </Link>
        }
      >
        <TypeIcon type={type} className="size-3.5 rounded-[3px]" />
        <span className="font-mono text-xs text-muted-foreground">{id}</span>
        <span className="truncate text-xs text-muted-foreground">
          · {type.name}
        </span>
      </PeekHeader>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          <div>
            {parent && (
              <PeekLink
                item={parent}
                project={project}
                peek={peek}
                className="mb-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <TypeIcon
                  type={typeOf(delivery, parent)}
                  className="size-3 rounded-[3px]"
                />
                <span className="truncate">{parent.title}</span>
              </PeekLink>
            )}
            <h2 className="text-[15px] leading-snug font-semibold break-words">
              {item.title}
            </h2>
          </div>

          <dl className="space-y-0.5">
            <Row label="Status">
              <IssueStatus
                projectId={item.projectId}
                statusId={item.statusId}
                onChange={
                  canChange && !item.archivedAt
                    ? (statusId) => update({ statusId })
                    : undefined
                }
                hint={startHint}
              />
            </Row>
            <Row label="Owner">
              <AssigneePicker
                assigneeId={item.assigneeId}
                onChange={
                  canChange && !item.archivedAt
                    ? (assigneeId) => update({ assigneeId })
                    : undefined
                }
              />
            </Row>
            <Row label="Priority">
              <Value>
                <IssuePriority priority={item.priority} />
              </Value>
            </Row>
            {native && project.estimateScale !== "none" && (
              <Row label="Estimate">
                <Value muted={!estimate}>{estimate ?? "None"}</Value>
              </Row>
            )}
            {native && project.iterationMode !== "off" && (
              <Row
                label={
                  project.iterationMode === "automatic" ? "Cycle" : "Sprint"
                }
              >
                <Value muted={!iteration}>
                  {iteration
                    ? iterationLabel(iteration, project?.iterationMode)
                    : "Backlog"}
                  {iteration?.state === "active" && (
                    <span className="ml-1.5 inline-flex h-5 items-center gap-1 rounded-full bg-success/8 px-2 font-mono text-[10.5px] font-medium tracking-[0.06em] text-success uppercase ring-1 ring-success/20 ring-inset">
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-success"
                      />
                      Active
                    </span>
                  )}
                </Value>
              </Row>
            )}
            {team && (
              <Row label="Team">
                <Value>{team.name}</Value>
              </Row>
            )}
          </dl>

          {type.hasSpecification && item.refinementState && (
            <section
              aria-label="Specification"
              className="space-y-2 rounded-lg bg-muted/50 p-3 text-[13px]"
            >
              <div className="flex items-center gap-1.5">
                <RefinementIcon state={item.refinementState} />
                <span className="font-medium">
                  {refinementMeta[item.refinementState].label}
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  Revision {item.revisionNumber}
                </span>
              </div>
              <Meter
                label="Readiness checks"
                done={item.readinessPassed}
                total={item.readinessTotal}
              />
              {required.length > 0 && (
                <Meter
                  label="Required approvals"
                  done={required.filter((r) => r.approved).length}
                  total={required.length}
                />
              )}
              {(item.blockingThreads > 0 || item.openThreads > 0) && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {item.blockingThreads > 0 && (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <CircleAlert className="size-3" />
                      {item.blockingThreads} blocking
                    </span>
                  )}
                  {item.openThreads > 0 && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <MessageSquare className="size-3" />
                      {item.openThreads} open discussion
                      {item.openThreads > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}
            </section>
          )}

          {item.childCount > 0 && (
            <Meter
              label="Subtasks done"
              done={item.childDoneCount}
              total={item.childCount}
            />
          )}

          {blockers.length > 0 && (
            <section aria-label="Blocked by">
              <h3 className="mb-1 text-xs text-muted-foreground">Blocked by</h3>
              <ul className="overflow-hidden rounded-md border">
                {blockers.map((b) => {
                  const status = delivery.statuses.get(b.statusId);
                  return (
                    <li
                      key={b.id}
                      className="border-b text-[13px] last:border-b-0"
                    >
                      <PeekLink
                        item={b}
                        project={project}
                        peek={peek}
                        className="flex h-9 items-center gap-2 px-2 hover:bg-muted/50"
                      >
                        <StatusIcon
                          category={status?.category}
                          color={status?.color}
                        />
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {identifier(
                            projects.find((p) => p.id === b.projectId),
                            b.number,
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {b.title}
                        </span>
                      </PeekLink>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// Links to related items preview them when they belong to this project and
// open their page otherwise.
function PeekLink({
  item,
  project,
  peek,
  className,
  children,
}: {
  item: WorkItem;
  project: Project;
  peek: ItemPeekState;
  className?: string;
  children: ReactNode;
}) {
  const { projects, delivery, organization } = useWorkspace();
  const owner = projects.find((p) => p.id === item.projectId);
  if (!owner) return <span className={className}>{children}</span>;
  const type = typeOf(delivery, item);
  const id = identifier(owner, item.number);
  const previewable =
    owner.id === project.id && !isTopLevel(type) && !item.archivedAt;
  return (
    <Link
      href={paths.item(organization.slug, owner.key, id)}
      onClick={previewable ? (e) => peek.onLinkClick(e, id) : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-[13px]">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function Value({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5",
        muted && "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Meter({
  label,
  done,
  total,
}: {
  label: string;
  done: number;
  total: number;
}) {
  return (
    <div className="text-xs">
      <div className="mb-1 flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {done}/{total}
        </span>
      </div>
      {/* One segment per check or approval: passed green, pending neutral,
          the same rule as the item's readiness meter. */}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="flex gap-0.5"
      >
        {Array.from({ length: Math.max(total, 1) }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index < done ? "bg-success" : "bg-foreground/10",
            )}
          />
        ))}
      </div>
    </div>
  );
}
