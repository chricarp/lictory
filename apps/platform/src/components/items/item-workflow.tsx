import type { ReactNode } from "react";
import { ArrowRight, Check, FilePenLine, ListTree } from "lucide-react";
import { Link } from "@lictory/platform/lib/navigation";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { isTopLevel, refinementMeta } from "@lictory/core/lib/work-items";
import {
  externalLinksByItem,
  isAmended,
  lifecycleStage,
  nextRefinementAction,
  type LifecycleStage,
} from "@lictory/core/lib/lifecycle";
import { Button } from "@lictory/ui/button";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";

const labels: Record<LifecycleStage, string> = {
  proposal: "Shape the proposal",
  refinement: "Agree on what to build",
  review: "Review the current specification",
  ready: "Ready for delivery",
  committed: "Accepted for delivery",
  underway: "In progress",
  completed: "Delivered",
  canceled: "Canceled",
};

// The item stays the same artifact as its purpose changes. Keep the next step
// beside the document so a user never has to infer it from two status pickers.
export function ItemWorkflow({
  onStartRefinement,
  onReview,
  onBreakdown,
  children,
}: {
  onStartRefinement?: () => void;
  onReview: () => void;
  onBreakdown: () => void;
  children?: ReactNode;
}) {
  const { item, type, project, current, readOnly, entities } = useItem();
  const { organization, directory, delivery } = useWorkspace();
  const link = externalLinksByItem(entities, directory.delivery.targets).get(
    item.id,
  );
  const native = project.deliveryMode === "native";
  const stage = lifecycleStage(item, project, delivery, link);
  const delivering = [
    "committed",
    "underway",
    "completed",
    "canceled",
  ].includes(stage);
  // A later revision is refined while the accepted one stays in delivery.
  const amendment =
    type.hasSpecification &&
    delivering &&
    stage !== "canceled" &&
    isAmended(item, project, link);
  const step =
    !type.hasSpecification || (delivering && !amendment)
      ? 2
      : stage === "proposal"
        ? 0
        : 1;
  const steps = type.hasSpecification
    ? ["Proposal", "Refinement", "Delivery"]
    : ["Create", "Delivery"];
  // Boards and backlogs show implementation work; higher levels are
  // delivered through their children.
  const container = native && isTopLevel(type);
  const label =
    type.hasSpecification || delivering
      ? labels[stage]
      : "Ready to plan the work";
  const agreed = native
    ? item.committedRevisionNumber
    : link?.publishedRevisionNumber;
  const description = amendment
    ? `Revision ${item.revisionNumber} changes the ${native ? "accepted" : "handed-off"} scope and needs agreement. Delivery continues with revision ${agreed ?? "—"} until the change is ${native ? "accepted" : "handed off"}.`
    : !type.hasSpecification
      ? `This ${type.name.toLowerCase()} is implementation work. Plan and track it in ${native ? "Lictory" : "your delivery tool"}.`
      : stage === "proposal"
        ? "Capture the problem and expected outcome. Start refinement when it is worth exploring with the team."
        : stage === "ready"
          ? native
            ? container
              ? "The checks pass. Accept this revision for delivery and break it down into work the team can pick up."
              : "The checks pass. Accept this revision for delivery when the team is ready to build it."
            : "The checks pass. Hand off this revision to your delivery tool."
          : stage === "completed"
            ? "The delivered revision and its history stay here. Later changes are refined as a new revision."
            : stage === "committed" || stage === "underway"
              ? container
                ? "Delivery happens through the work below. Changes to the specification stay reviewable here."
                : "Track the work in Delivery. Changes to the specification stay reviewable here."
              : stage === "canceled"
                ? "The specification, reviews and decisions remain available for reference."
                : nextRefinementAction(item);
  const destination = !native
    ? paths.handoff(organization.slug, project.key)
    : delivering
      ? paths.board(organization.slug, project.key)
      : paths.backlog(organization.slug, project.key);
  // Accepting a ready native scope happens in the panel below; the other
  // stages point to the place where their next step happens.
  const action =
    !readOnly && stage === "proposal" && onStartRefinement ? (
      <Button size="sm" onClick={onStartRefinement}>
        <FilePenLine className="size-3.5" /> Start refinement
      </Button>
    ) : type.hasSpecification &&
      ((!delivering && stage !== "ready") || amendment) ? (
      <Button variant="secondary" size="sm" onClick={onReview}>
        Review & checks
      </Button>
    ) : stage === "canceled" ? null : container &&
      (stage === "ready" || delivering) ? (
      <Button variant="ghost" size="sm" onClick={onBreakdown}>
        <ListTree className="size-3.5" /> View breakdown
      </Button>
    ) : stage === "ready" && native ? null : (
      <Link
        href={destination}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        {native ? "Open delivery" : "Open hand-off"}
        <ArrowRight className="size-3.5" />
      </Link>
    );
  const stages = (
    <ol
      aria-label="Workflow stages"
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground max-sm:hidden"
    >
      {steps.map((name, index) => {
        const position = type.hasSpecification ? index : index === 0 ? 0 : 2;
        const active = position === step;
        const complete = position < step;
        return (
          <li
            key={name}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 items-center gap-1.5"
          >
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  "h-px w-3 shrink-0",
                  complete || active ? "bg-primary/40" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                active && "font-medium text-foreground",
              )}
            >
              {complete ? (
                <Check className="size-3 shrink-0 text-success" aria-hidden />
              ) : (
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    active
                      ? "bg-primary ring-3 ring-primary/15"
                      : "bg-muted-foreground/30",
                  )}
                />
              )}
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
  const status = delivery.statuses.get(item.statusId);
  // The two states an item can be in at once, each named: the specification's
  // refinement (always about the current revision) and, once a revision is
  // accepted, its delivery.
  const specificationRow = type.hasSpecification && current && (
    <StateRow label="Specification">
      {item.refinementState && (
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <RefinementIcon state={item.refinementState} />
          {refinementMeta[item.refinementState].label}
        </span>
      )}
      <Segment className="font-mono tabular-nums">
        Revision {current.number}
      </Segment>
      {item.readinessTotal > 0 && (
        <Segment className="tabular-nums">
          {item.readinessPassed} of {item.readinessTotal} checks pass
        </Segment>
      )}
      {item.blockingThreads > 0 && (
        <span className="rounded-full bg-destructive/8 px-2 py-0.5 font-medium whitespace-nowrap text-destructive">
          {item.blockingThreads} blocking discussion
          {item.blockingThreads === 1 ? "" : "s"}
        </span>
      )}
    </StateRow>
  );
  const deliveryRow = native && item.committedRevisionNumber != null && (
    <StateRow label="Delivery">
      {status && (
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <StatusIcon category={status.category} color={status.color} />
          {status.name}
        </span>
      )}
      <Segment>Accepted revision {item.committedRevisionNumber}</Segment>
      {item.deliveredRevisionNumber != null && (
        <Segment>Delivered revision {item.deliveredRevisionNumber}</Segment>
      )}
    </StateRow>
  );
  // The delivery scope below explains an amendment and its decision; the
  // guidance would only repeat it.
  const guidance = !(amendment && children);
  return (
    <section
      aria-label="Item workflow"
      className="mt-5 overflow-hidden rounded-xl bg-card shadow-(--shadow-border)"
    >
      <div className="px-4 pt-3 pb-3.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* An amendment names itself; the delivery status it would repeat is
              in the Delivery row below. */}
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium tracking-[-0.01em]">
            {amendment ? (
              <>
                <span
                  className="size-1.5 rounded-full bg-warning"
                  aria-hidden
                />
                Amendment in refinement
              </>
            ) : (
              label
            )}
          </p>
          {stages}
        </div>
        {guidance && (
          <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground sm:line-clamp-none">
            {description}
          </p>
        )}
        {(Boolean(specificationRow) ||
          Boolean(deliveryRow) ||
          Boolean(action)) && (
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <dl className="grid min-w-0 flex-1 gap-2 text-xs text-muted-foreground sm:gap-1.5">
              {specificationRow}
              {deliveryRow}
            </dl>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        )}
      </div>
      {children && (
        <div className="border-t bg-muted/40 px-4 py-3">{children}</div>
      )}
    </section>
  );
}

function StateRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[5.5rem_1fr] sm:items-baseline sm:gap-x-2">
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {children}
      </dd>
    </div>
  );
}

// Facts in a state row are separated by space rather than dots, so a wrapped
// line never starts or ends with a stray separator.
function Segment({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn("whitespace-nowrap", className)}>{children}</span>;
}
