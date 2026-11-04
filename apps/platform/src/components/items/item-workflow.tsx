import { useId, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FilePenLine,
  ListTree,
  TriangleAlert,
} from "lucide-react";
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
      className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground uppercase max-sm:hidden"
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
  const [decisionOpen, setDecisionOpen] = useState(false);
  const decisionId = useId();
  const refinement = item.refinementState;
  // One dominant statement, then the evidence behind it. An amendment names
  // both revisions in one sentence: the one under refinement and the one
  // delivery still uses.
  const statement =
    amendment && current
      ? `Revision ${current.number} is ${refinement ? refinementMeta[refinement].label.toLowerCase() : "in refinement"}`
      : label;
  const subline =
    amendment && agreed != null
      ? `Delivery continues with revision ${agreed}${status ? ` · ${status.name}` : ""}.`
      : description;
  const evidence = (
    <ul
      aria-label="Evidence"
      className="flex flex-wrap items-center gap-1.5 text-[11.5px]"
    >
      {type.hasSpecification && refinement && (
        <li>
          <Pill
            tone={
              refinement === "ready"
                ? "good"
                : refinement === "in_review"
                  ? "info"
                  : "neutral"
            }
          >
            <RefinementIcon state={refinement} className="size-3" />
            {refinementMeta[refinement].label}
          </Pill>
        </li>
      )}
      {current && (
        <li>
          <Pill tone="neutral" mono>
            Revision {current.number}
          </Pill>
        </li>
      )}
      {type.hasSpecification && item.readinessTotal > 0 && (
        <li>
          <Pill
            tone={
              item.readinessPassed === item.readinessTotal ? "good" : "neutral"
            }
          >
            {item.readinessPassed}/{item.readinessTotal} checks
          </Pill>
        </li>
      )}
      {item.blockingThreads > 0 && (
        <li>
          <Pill tone="danger">
            {item.blockingThreads} blocking discussion
            {item.blockingThreads === 1 ? "" : "s"}
          </Pill>
        </li>
      )}
      {native && item.committedRevisionNumber != null && (
        <li>
          <Pill tone="neutral">
            {status && (
              <StatusIcon
                category={status.category}
                color={status.color}
                className="size-3"
              />
            )}
            Accepted revision {item.committedRevisionNumber}
          </Pill>
        </li>
      )}
      {native && item.deliveredRevisionNumber != null && (
        <li>
          <Pill tone="good">
            Delivered revision {item.deliveredRevisionNumber}
          </Pill>
        </li>
      )}
    </ul>
  );
  return (
    <section
      aria-label="Item workflow"
      className="mt-5 rounded-[1.25rem] bg-tray p-1 ring-1 ring-border/70 ring-inset"
    >
      {/* A tray: the state card on top, the decision it leads to beneath. */}
      <div className="rounded-2xl bg-card px-4 pt-3.5 pb-4 shadow-(--shadow-border)">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.015em]">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  amendment
                    ? "bg-warning"
                    : stage === "ready" || stage === "completed"
                      ? "bg-success"
                      : "bg-foreground/70",
                )}
              />
              {statement}
            </p>
            {subline && (
              <p className="mt-1 line-clamp-3 pl-4 text-[13px] leading-relaxed text-muted-foreground sm:line-clamp-none">
                {subline}
              </p>
            )}
          </div>
          {action && <div className="shrink-0 max-sm:hidden">{action}</div>}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-4">
          {evidence}
          {stages}
        </div>
        {action && <div className="mt-3 pl-4 sm:hidden">{action}</div>}
      </div>
      {children && (
        <div>
          {/* Phones keep the document first: the decision folds into one
              line that still names what is pending. */}
          <button
            type="button"
            aria-expanded={decisionOpen}
            aria-controls={decisionId}
            onClick={() => setDecisionOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:hidden"
          >
            {amendment && (
              <TriangleAlert
                aria-hidden
                className="size-3.5 shrink-0 text-warning"
              />
            )}
            <span className="min-w-0 flex-1">
              {amendment && current
                ? `Revision ${current.number} is not accepted for delivery`
                : "Delivery decision"}
            </span>
            <ChevronDown
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                decisionOpen && "rotate-180",
              )}
            />
          </button>
          <div
            id={decisionId}
            className={cn(
              "px-4 pb-3 sm:pt-3",
              !decisionOpen && "max-sm:hidden",
            )}
          >
            {children}
          </div>
        </div>
      )}
    </section>
  );
}

// Evidence chips share the status grammar: a tint, a hairline ring of the
// same hue, and color only when it means something.
function Pill({
  tone,
  mono = false,
  children,
}: {
  tone: "neutral" | "good" | "info" | "danger";
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-medium whitespace-nowrap ring-1 ring-inset",
        mono && "font-mono text-[11px] tracking-[0.02em]",
        tone === "neutral" && "bg-muted text-foreground/80 ring-foreground/8",
        tone === "good" && "bg-success/8 text-success ring-success/20",
        tone === "info" && "bg-ring/8 text-ring ring-ring/20",
        tone === "danger" &&
          "bg-destructive/8 text-destructive ring-destructive/20",
      )}
    >
      {children}
    </span>
  );
}
