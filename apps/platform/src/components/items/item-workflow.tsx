import { useId, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FilePenLine,
  GitCompareArrows,
  ListTree,
  TriangleAlert,
} from "lucide-react";
import { Link } from "@lictory/platform/lib/navigation";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  identifier,
  isTopLevel,
  refinementMeta,
  refinementOrder,
} from "@lictory/core/lib/work-items";
import { isCarriedApproval } from "@lictory/core/contracts/decomposition";
import { pullRequestIsActive } from "@lictory/core/contracts/state-machines";
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
import { projectDeliveryTool } from "@lictory/platform/components/delivery/provider-name";
import { StatusIcon } from "@lictory/platform/components/items/status";
import { useMyReview } from "@lictory/platform/components/review/review-panel";

const labels: Record<LifecycleStage, string> = {
  proposal: "Shape the proposal",
  refinement: "Agree on what to build",
  review: "Review the current specification",
  ready: "Ready for delivery",
  committed: "Accepted for delivery",
  // Not "In progress": that is a delivery status name in most workflows.
  underway: "Delivery underway",
  completed: "Delivered",
  canceled: "Canceled",
};

// The item stays the same artifact as its purpose changes. Keep the next step
// beside the document so a user never has to infer it from two status pickers.
export function ItemWorkflow({
  onStartRefinement,
  onReview,
  onBreakdown,
  onCompare,
  onChanges,
  onOpen,
  children,
}: {
  onStartRefinement?: () => void;
  // The card summarizes; the checks, the reviews and the discussions each
  // have one authoritative place, and each summary opens it.
  onOpen?: (place: "readiness" | "review" | "discussions") => void;
  onReview: () => void;
  onBreakdown: () => void;
  // Opens the specification's proposed changes.
  onChanges?: () => void;
  // Opens what changed between two revisions.
  onCompare?: (from: string, to: string) => void;
  children?: ReactNode;
}) {
  const {
    item,
    type,
    project,
    current,
    readOnly,
    entities,
    reviews,
    approvals,
    memberName,
    revisionNumber,
  } = useItem();
  // A requested reviewer sees their own step first: the decision, and
  // whether an approval they gave earlier stopped applying.
  const mine = useMyReview();
  const { organization, directory, delivery, items } = useWorkspace();
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
  // The stages are the refinement states, named as the Refinement property
  // and the Refinement tabs name them, then delivery: one vocabulary for
  // where an item stands. An amendment is refined while delivery continues,
  // so its stage is the current revision's refinement state.
  const steps = type.hasSpecification
    ? [...refinementOrder.map((s) => refinementMeta[s].label), "Delivery"]
    : ["Create", "Delivery"];
  // A task without a specification is created, then delivered.
  const step =
    !type.hasSpecification || (delivering && !amendment)
      ? steps.length - 1
      : Math.max(
          0,
          refinementOrder.indexOf(item.refinementState ?? "refinement"),
        );
  // Boards and backlogs show implementation work; higher levels are
  // delivered through their children.
  const container = native && isTopLevel(type);
  const tool = projectDeliveryTool(directory, project.id);
  // In an external project the delivery tool owns delivery status: its own
  // words lead, named as its.
  const externalStatus =
    !native && delivering && link?.externalStatus
      ? `${link.externalStatus} in ${tool.name}`
      : null;
  const label =
    externalStatus ??
    (type.hasSpecification || delivering
      ? labels[stage]
      : "Ready to plan the work");
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
              ? `Every readiness check passes on revision ${current?.number ?? ""}. Delivery starts when a person accepts it; then break it down into work the team can pick up.`
              : `Every readiness check passes on revision ${current?.number ?? ""}. Delivery starts when a person accepts it: the board, iterations and agents work from the accepted revision.`
            : "The checks pass. Hand off this revision to your delivery tool."
          : stage === "completed"
            ? "The delivered revision and its history stay here. Later changes are refined as a new revision."
            : stage === "committed" || stage === "underway"
              ? !native
                ? `${tool.Name} owns its delivery status and assignee; Lictory reads them back. Changes to the specification stay reviewable here.`
                : container
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
  // The main button is the step the NEXT line names: while no required
  // review is requested, that is requesting them (which also moves a draft
  // into review). Starting refinement first is optional, so it is quieter.
  const noReviewYet = !item.reviews.some(
    (r) => r.required && r.status !== "cancelled",
  );
  const empty = !current?.content.trim();
  const requestReviews = !readOnly && noReviewYet && !empty && (
    <Button size="sm" onClick={onReview}>
      Request reviews
    </Button>
  );
  // Accepting a ready native scope happens in the panel below; the other
  // stages point to the place where their next step happens.
  const action = mine.review ? (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" onClick={() => mine.decide("approve")}>
        <Check className="size-3.5" /> Approve revision {current?.number}
      </Button>
      {mine.review.status !== "changes_requested" && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => mine.decide("changes_requested")}
        >
          Request changes
        </Button>
      )}
    </div>
  ) : !readOnly && stage === "proposal" && onStartRefinement ? (
    <div className="flex flex-wrap gap-1.5">
      {requestReviews}
      <Button
        size="sm"
        variant="secondary"
        title="Optional: tells the team the proposal is being explored before anyone reviews it."
        onClick={onStartRefinement}
      >
        <FilePenLine className="size-3.5" /> Start refinement
      </Button>
    </div>
  ) : type.hasSpecification &&
    ((!delivering && stage !== "ready") || amendment) ? (
    requestReviews || (
      <Button variant="secondary" size="sm" onClick={onReview}>
        Review & checks
      </Button>
    )
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
      {!native ? "Open hand-off" : delivering ? "Open board" : "Open backlog"}
      <ArrowRight className="size-3.5" />
    </Link>
  );
  const stages = (
    <ol
      aria-label="Workflow stages"
      className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden"
    >
      {steps.map((name, index) => {
        const active = index === step;
        const complete = index < step;
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
  // What happens next, in one line: the specification's open concern. A
  // ready revision's delivery decision is the panel below, and a requested
  // reviewer's next step is their decision above.
  const next =
    !mine.review &&
    type.hasSpecification &&
    refinement &&
    refinement !== "ready"
      ? stage === "proposal" && empty && noReviewYet
        ? "Describe the intent and the expected behavior in the specification, then request the required reviews."
        : // Two buttons for one draft: say what the quieter one is for.
          stage === "proposal" && noReviewYet && !readOnly && onStartRefinement
          ? "Request the required reviews when the intent is clear. To explore it with the team before anyone is asked to decide, start refinement first."
          : nextRefinementAction(item)
      : null;
  // One dominant statement, then the evidence behind it. An amendment names
  // both revisions in one sentence: the one under refinement and the one
  // delivery still uses.
  const statement = mine.review
    ? `Your ${mine.review.responsibility} review is requested`
    : amendment && current
      ? `Revision ${current.number} is ${refinement ? refinementMeta[refinement].label.toLowerCase() : "in refinement"}`
      : label;
  // When a NEXT line names the step, the general guidance would repeat it.
  const subline = mine.review
    ? mine.staleRevision && current
      ? `You approved revision ${mine.staleRevision.number}. It changed since, so that approval no longer applies to revision ${current.number}.`
      : `Read revision ${current?.number ?? ""}, then approve it or request changes. Your decision applies to this revision only.`
    : amendment && agreed != null
      ? `Delivery continues with revision ${agreed}${status ? ` · ${status.name}` : ""}.`
      : next
        ? null
        : description;
  // The reviews of the current revision, so approval state reads here
  // even while the review rail steps aside for discussions.
  const requested = reviews.filter(
    (r) => r.status !== "cancelled" && r.revisionId === current?.id,
  );
  const approvedReviews = requested.filter((r) =>
    approvals.some((a) => a.reviewId === r.id && a.status === "granted"),
  ).length;
  // Proposed changes sent for review (a suggested change on a ready
  // specification is one): findable from the card after the toast is gone.
  const inReview = entities.filter(
    (e) =>
      e.type === "pullRequest" &&
      e.workItemId === item.id &&
      pullRequestIsActive(e),
  ).length;
  // Approvals a later revision made outdated, for reviews of the current
  // revision nobody has approved yet: "Engineering approved revision 12;
  // revision 14 needs review" reads on the card, not only in the rail.
  const outdated = requested.flatMap((r) => {
    if (approvals.some((a) => a.reviewId === r.id && a.status === "granted"))
      return [];
    const latest = approvals
      .filter(
        (a) =>
          a.status === "stale" &&
          !isCarriedApproval(a.endReason) &&
          reviews.find((x) => x.id === a.reviewId)?.responsibility ===
            r.responsibility,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return latest
      ? [{ responsibility: r.responsibility, approval: latest }]
      : [];
  });
  // Evidence, grouped by what it is about: the specification's refinement
  // (always the current revision) and, once a revision is accepted, delivery.
  // The statement names the stage (the refinement state's sentence), so
  // the evidence lists facts only once: the revision as plain metadata,
  // then what holds it back. Pills are states; text is metadata.
  const specEvidence = type.hasSpecification && (
    <>
      {current && (
        <li className="pr-1 text-muted-foreground">
          Revision {current.number}
        </li>
      )}
      {item.readinessTotal > 0 && (
        <li>
          <Opens
            to={onOpen && (() => onOpen("readiness"))}
            hint="Show the readiness checks"
          >
            <Pill
              tone={
                item.readinessPassed === item.readinessTotal
                  ? "good"
                  : "neutral"
              }
            >
              {item.readinessPassed}/{item.readinessTotal} checks
            </Pill>
          </Opens>
        </li>
      )}
      {requested.length > 0 && (
        <li>
          <Opens
            to={onOpen && (() => onOpen("review"))}
            hint="Show the reviews"
          >
            <Pill
              tone={approvedReviews === requested.length ? "good" : "neutral"}
            >
              {approvedReviews}/{requested.length} approved
            </Pill>
          </Opens>
        </li>
      )}
      {inReview > 0 && (
        <li>
          {onChanges ? (
            <button
              type="button"
              onClick={onChanges}
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Pill tone="info">
                {inReview} {inReview === 1 ? "change" : "changes"} in review
              </Pill>
            </button>
          ) : (
            <Pill tone="info">
              {inReview} {inReview === 1 ? "change" : "changes"} in review
            </Pill>
          )}
        </li>
      )}
      {item.blockingThreads > 0 && (
        <li>
          <Opens
            to={onOpen && (() => onOpen("discussions"))}
            hint="Show the discussions"
          >
            <Pill tone="danger">
              {item.blockingThreads} blocking discussion
              {item.blockingThreads === 1 ? "" : "s"}
            </Pill>
          </Opens>
        </li>
      )}
    </>
  );
  const parent = item.parentId
    ? items.find((i) => i.id === item.parentId)
    : undefined;
  const handedOff =
    !native && link?.externalKey && link.publishedRevisionNumber != null ? (
      <li className="px-1 text-muted-foreground">
        Handed off revision {link.publishedRevisionNumber}
      </li>
    ) : null;
  const deliveryEvidence =
    handedOff ??
    (native && item.committedRevisionNumber != null && (
      <>
        {status && (
          <li>
            <Pill tone={status.category === "done" ? "good" : "neutral"}>
              <StatusIcon
                category={status.category}
                color={status.color}
                className="size-3"
              />
              {status.name}
            </Pill>
          </li>
        )}
        <li className="px-1 text-muted-foreground">
          {/* Plain work without a description of its own is agreed through
              its parent's specification: an empty revision 1 is not the
              agreement. */}
          {!type.hasSpecification && parent && empty
            ? `Part of ${identifier(project, parent.number)}’s accepted scope`
            : item.deliveredRevisionNumber == null
              ? `Accepted revision ${item.committedRevisionNumber}`
              : item.deliveredRevisionNumber === item.committedRevisionNumber
                ? `Delivered revision ${item.deliveredRevisionNumber}`
                : `Accepted revision ${item.committedRevisionNumber} · Delivered revision ${item.deliveredRevisionNumber}`}
        </li>
      </>
    ));
  const evidence = (
    <dl className="grid gap-1.5 text-[11.5px] sm:gap-2">
      {specEvidence && <EvidenceRow label="Spec">{specEvidence}</EvidenceRow>}
      {deliveryEvidence && (
        <EvidenceRow label="Delivery">{deliveryEvidence}</EvidenceRow>
      )}
    </dl>
  );
  return (
    <section
      aria-label="Item workflow"
      className="mt-5 rounded-[1.25rem] bg-tray p-1 ring-1 ring-border/70 ring-inset"
    >
      {/* A tray: the state card on top, the decision it leads to beneath. */}
      <div className="rounded-2xl bg-card px-4 pt-3.5 pb-4 shadow-(--shadow-border)">
        {/* The decision sits beside the statement while both fit and wraps
            below it on phones and at high zoom, so neither is squeezed
            into a one-word column. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
          <div className="min-w-0 flex-[1_1_20rem]">
            <p className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.015em]">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  amendment || mine.review
                    ? "bg-warning"
                    : stage === "ready" || stage === "completed"
                      ? "bg-success"
                      : "bg-foreground/70",
                )}
              />
              {statement}
            </p>
            {subline && (
              <p className="mt-1 pl-4 text-[13px] leading-relaxed text-muted-foreground">
                {subline}
              </p>
            )}
            {mine.review && mine.staleRevision && current && onCompare && (
              <button
                type="button"
                onClick={() => onCompare(mine.staleRevision!.id, current.id)}
                className="mt-1.5 ml-4 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <GitCompareArrows aria-hidden className="size-3.5" />
                What changed since revision {mine.staleRevision.number}
              </button>
            )}
          </div>
          {action && (
            <div className="max-w-full shrink-0 max-sm:pl-4">{action}</div>
          )}
        </div>
        <div className="mt-3 pl-4 max-sm:pl-0 sm:mt-3.5">{evidence}</div>
        {!mine.review && outdated.length > 0 && current && (
          <ul className="mt-2 space-y-0.5 pl-4 text-[12.5px] max-sm:pl-0">
            {outdated.map(({ responsibility, approval }) => (
              <li
                key={approval.id}
                className="flex items-baseline gap-1.5 text-muted-foreground"
              >
                <TriangleAlert
                  aria-hidden
                  className="size-3 shrink-0 self-center text-warning"
                />
                <span>
                  {responsibility}: {memberName(approval.reviewerId)} approved
                  revision {revisionNumber(approval.revisionId) ?? "?"};
                  revision {current.number} needs their review again.
                </span>
              </li>
            ))}
          </ul>
        )}
        {next && (
          <p className="mt-2.5 flex items-baseline gap-2 border-t pt-2.5 pl-4 text-[13px] max-sm:pl-0 sm:mt-3">
            <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground sm:w-16">
              Next
            </span>
            <span className="min-w-0">{next}</span>
          </p>
        )}
        <div className="mt-3 hidden pl-4 sm:block">{stages}</div>
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

function EvidenceRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    // The label aligns with the first line of chips when they wrap.
    <div className="flex items-start gap-2">
      <dt className="w-12 shrink-0 text-xs leading-6 font-medium text-muted-foreground sm:w-16">
        {label}
      </dt>
      <dd>
        <ul className="flex flex-wrap items-center gap-1.5">{children}</ul>
      </dd>
    </div>
  );
}

// A summary chip that opens the place where its facts are kept.
function Opens({
  to,
  hint,
  children,
}: {
  to?: () => void;
  hint: string;
  children: ReactNode;
}) {
  if (!to) return children;
  return (
    <button
      type="button"
      onClick={to}
      title={hint}
      className="rounded-full outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {children}
      <span className="sr-only">. {hint}</span>
    </button>
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
