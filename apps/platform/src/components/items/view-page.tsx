import { useCallback, useMemo } from "react";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { Link, useSearchParams } from "@lictory/platform/lib/navigation";
import { ArrowRight } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import {
  type ViewId,
  identifier,
  isReviewAskedOf,
  matchesView,
  typeOf,
  views,
  enabledTypes,
} from "@lictory/core/lib/work-items";
import {
  isAmended,
  nextRefinementAction,
  readyForSelection,
} from "@lictory/core/lib/lifecycle";
import type { IllustrationKind } from "@lictory/ui/state-illustration";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { useLifecycleQueues } from "@lictory/platform/components/items/queues";
import { IssueList } from "@lictory/platform/components/items/issue-list";
import { ProjectKnowledge } from "@lictory/platform/components/knowledge/project-knowledge";

const viewIllustrations: Record<ViewId, IllustrationKind> = {
  all: "proposal",
  "needs-my-review": "personalReview",
  "needs-review": "teamReview",
  blocked: "blocked",
  ready: "ready",
  drafts: "drafts",
  updated: "updated",
};
const refinementTabs = [
  { id: undefined, label: "All in refinement" },
  { id: "refinement", label: "In progress" },
  { id: "review", label: "In review" },
  { id: "ready", label: "Ready for delivery" },
] as const;

// A proposal is an incomplete specification, not an item type. Readiness and
// delivery remain distinct facts; completed work stays in the universal catalog.
export function ViewPage({
  view,
  phase = "refinement",
}: {
  view: ViewId;
  phase?: "proposal" | "refinement";
}) {
  const { organization, userId, disciplineIds, delivery, capabilitiesIn } =
    useWorkspace();
  const project = useProject();
  const params = useSearchParams();
  const overview = view === "all";
  const proposals =
    overview && (phase === "proposal" || params.get("stage") === "proposal");
  const stage = refinementTabs.find(
    (tab) => tab.id === params.get("stage"),
  )?.id;
  const meta = views.find((v) => v.id === view)!;
  const {
    links,
    projectItems,
    stages,
    proposals: proposed,
    refining,
  } = useLifecycleQueues(project);
  const counts = useMemo(() => {
    const byStage = new Map<string, number>();
    for (const item of refining) {
      const id = stages.get(item.id)!;
      byStage.set(id, (byStage.get(id) ?? 0) + 1);
    }
    return byStage;
  }, [refining, stages]);
  const scoped = useMemo(
    () =>
      overview
        ? proposals
          ? proposed
          : refining.filter((item) => !stage || stages.get(item.id) === stage)
        : projectItems.filter((item) => {
            if (view === "ready")
              return (
                typeOf(delivery, item).hasSpecification &&
                readyForSelection(item, project, delivery, links.get(item.id))
              );
            if (view === "drafts") return stages.get(item.id) === "proposal";
            return matchesView(item, view, userId, disciplineIds);
          }),
    [
      overview,
      proposals,
      proposed,
      refining,
      stage,
      stages,
      projectItems,
      view,
      delivery,
      project,
      links,
      userId,
      disciplineIds,
    ],
  );
  const hasSpecificationTypes = enabledTypes(delivery, project.id).some(
    (type) => type.hasSpecification,
  );
  const canPropose =
    capabilitiesIn(project.id).editSpecifications && hasSpecificationTypes;
  const deliveryHref =
    project.deliveryMode === "external"
      ? paths.handoff(organization.slug, project.key)
      : paths.backlog(organization.slug, project.key);
  const stageHref = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("stage", id);
    else next.delete("stage");
    return `${paths.refinement(organization.slug, project.key)}${next.size ? `?${next}` : ""}`;
  };
  // Opened items keep this queue beside them and in the breadcrumb.
  const hrefFor = useCallback(
    (item: WorkItem) => {
      const from = overview
        ? proposals
          ? "proposals"
          : "refinement"
        : view === "needs-my-review"
          ? "reviews"
          : undefined;
      const next = new URLSearchParams();
      if (from) next.set("from", from);
      if (from === "refinement" && stage) next.set("stage", stage);
      return paths.item(
        organization.slug,
        project.key,
        identifier(project, item.number),
        next,
      );
    },
    [overview, proposals, view, stage, organization.slug, project],
  );
  const itemHint = useCallback(
    (item: WorkItem) =>
      isAmended(item, project, links.get(item.id))
        ? `Amendment · ${nextRefinementAction(item)} Delivery continues with the accepted revision.`
        : nextRefinementAction(item),
    [project, links],
  );
  // A review queue is a decision queue: each row says which review is asked
  // of you, on which revision, and what else is outstanding.
  const reviewHint = useCallback(
    (item: WorkItem) => {
      const open = item.reviews.filter(
        (r) => r.status !== "cancelled" && r.status !== "completed",
      );
      const mine = open.filter((r) =>
        isReviewAskedOf(r, userId, disciplineIds),
      );
      const asked = (view === "needs-my-review" && mine.length ? mine : open)
        .map((r) => r.responsibility)
        .join(", ");
      const parts = [
        asked
          ? `${asked} review requested on revision ${item.revisionNumber}`
          : item.suggestionReviewerIds.includes(userId)
            ? item.openSuggestions > 0
              ? `${item.openSuggestions} proposed change${item.openSuggestions === 1 ? "" : "s"} waiting for your review`
              : "A proposed change waits for your review"
            : `Revision ${item.revisionNumber}`,
      ];
      if (item.blockingThreads)
        parts.push(
          `${item.blockingThreads} blocking discussion${item.blockingThreads === 1 ? "" : "s"}`,
        );
      return parts.join(" · ");
    },
    [view, userId, disciplineIds],
  );
  // "Needs my review" groups each item under the reviews asked of you; other
  // disciplines' pending reviews are not your queue.
  const mineOnly = useCallback(
    (review: WorkItem["reviews"][number]) =>
      isReviewAskedOf(review, userId, disciplineIds),
    [userId, disciplineIds],
  );
  return (
    <IssueList
      items={scoped}
      project={project}
      hrefFor={hrefFor}
      title={overview ? (proposals ? "Proposals" : "Refinement") : meta.label}
      description={
        overview
          ? proposals
            ? "A place for rough ideas. Capture the problem now, clarify the expected behavior, then start refinement and request the reviews it needs."
            : // The queue holds specifications not yet in delivery (and
              // amendments of accepted ones): a story under way with its
              // accepted revision is delivery work, whatever its review.
              "Clarify behavior, resolve questions and review changes together until the work is accepted for delivery. Work already in delivery returns here only when its specification changes."
          : meta.description
      }
      emptyTitle={
        overview && !hasSpecificationTypes
          ? "No specification types in this project"
          : overview
            ? proposals
              ? "Start with a proposal"
              : stage === "ready"
                ? "Nothing ready for delivery"
                : stage === "review"
                  ? "Nothing in review"
                  : "Nothing in refinement yet"
            : view === "needs-my-review"
              ? "No reviews waiting for you"
              : `Nothing in “${meta.label}”`
      }
      emptyIllustration={proposals ? "proposal" : viewIllustrations[view]}
      emptyBody={
        overview && !hasSpecificationTypes ? (
          <span>
            Every enabled type is plain delivery work without specification
            reviews.
            <Link
              className="mt-3 block text-primary hover:underline"
              href={paths.items(organization.slug, project.key)}
            >
              Browse and create work →
            </Link>
          </span>
        ) : overview ? (
          proposals ? (
            "A title and a few notes are enough. Your team can shape the specification before committing to build it."
          ) : (
            <span>
              {stage === "ready"
                ? "Specifications appear here when their readiness checks pass and they are not yet accepted for delivery."
                : stage === "review"
                  ? "Specifications waiting on reviews appear here until they are accepted for delivery. Work already in delivery is not listed while its accepted revision is current."
                  : "Open a proposal and start refinement to work through the behavior, acceptance criteria and review concerns."}
              <Link
                className="mt-3 block text-primary hover:underline"
                href={paths.proposals(organization.slug, project.key)}
              >
                Explore proposals →
              </Link>
            </span>
          )
        ) : view === "needs-my-review" ? (
          "When someone requests your review, the item appears here with what changed."
        ) : view === "ready" ? (
          "Specifications appear here when their checks pass and they are not yet accepted for delivery."
        ) : undefined
      }
      showArchivedToggle={false}
      groupBy={
        view === "needs-my-review" || view === "needs-review"
          ? "review"
          : "refinement"
      }
      reviewFilter={view === "needs-my-review" ? mineOnly : undefined}
      createKind={overview && canPropose ? "story" : undefined}
      createIntent="proposal"
      createLabel="New proposal"
      itemHint={
        overview
          ? proposals
            ? undefined
            : itemHint
          : view === "needs-my-review" || view === "needs-review"
            ? reviewHint
            : undefined
      }
      summary={
        overview &&
        !proposals && (
          <div className="shrink-0 border-b">
            <nav
              aria-label="Specification lifecycle"
              className="flex flex-wrap items-center gap-1 px-3 py-2"
            >
              {refinementTabs.map((tab) => (
                <Link
                  key={tab.id ?? "all"}
                  href={stageHref(tab.id)}
                  aria-current={stage === tab.id ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-xs hover:bg-muted",
                    stage === tab.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {tab.label}
                  <span className="ml-2 text-muted-foreground tabular-nums">
                    {tab.id ? (counts.get(tab.id) ?? 0) : refining.length}
                  </span>
                </Link>
              ))}
            </nav>
            <ProjectKnowledge project={project} />
            {stage === "ready" && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/15 px-5 py-3 text-xs">
                <span>
                  {project.deliveryMode === "external"
                    ? "Ready means the checks pass. Hand off a revision when the team is ready to build it."
                    : "Ready means the checks pass. Open an item to accept its revision for delivery when the team is ready to build it."}
                </span>
                {project.deliveryMode === "external" && (
                  <Link
                    href={deliveryHref}
                    className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                  >
                    Open hand-off
                    <ArrowRight className="size-3" />
                  </Link>
                )}
              </div>
            )}
          </div>
        )
      }
    />
  );
}
