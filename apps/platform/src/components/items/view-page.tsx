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
  refinementMeta,
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
import { placeInProject } from "@lictory/platform/components/workspace/orientation";

const viewIllustrations: Record<ViewId, IllustrationKind> = {
  all: "proposal",
  "needs-my-review": "personalReview",
  "needs-review": "teamReview",
  blocked: "blocked",
  ready: "ready",
  drafts: "drafts",
  updated: "updated",
};
// The tabs are the refinement states and carry their names (the Refinement
// property's), so an item reads the same in the list and on its page.
const refinementTabs = [
  { id: undefined, label: "All" },
  { id: "refinement", label: refinementMeta.refinement.label },
  { id: "review", label: refinementMeta.in_review.label },
  { id: "ready", label: refinementMeta.ready.label },
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
  const {
    organization,
    userId,
    disciplineIds,
    delivery,
    directory,
    capabilitiesIn,
  } = useWorkspace();
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
  // Without "New proposal", an empty queue says why, from the person's own
  // disciplines, instead of leaving them to wonder.
  const place = placeInProject(directory.disciplines, userId, project.id);
  const noProposalNote =
    hasSpecificationTypes && !place.canPropose ? (
      <span className="mt-2 block">{place.whyNoProposal}</span>
    ) : null;
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
        ? `Amendment · ${nextRefinementAction(item)}`
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
              ? `${item.openSuggestions} suggested change${item.openSuggestions === 1 ? "" : "s"} waiting for you`
              : "Suggested change waiting for you"
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
      breadcrumbs={[
        {
          label: project.name,
          href: paths.project(organization.slug, project.key),
        },
      ]}
      description={overview ? undefined : meta.description}
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
          <Link
            className="block text-primary hover:underline"
            href={paths.items(organization.slug, project.key)}
          >
            Browse and create work →
          </Link>
        ) : overview ? (
          proposals ? (
            noProposalNote
          ) : (
            <span>
              {noProposalNote}
              <Link
                className="mt-3 block text-primary hover:underline"
                href={paths.proposals(organization.slug, project.key)}
              >
                Explore proposals →
              </Link>
            </span>
          )
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
            {stage === "ready" && project.deliveryMode === "external" && (
              <div className="flex flex-wrap items-center justify-end gap-2 bg-muted/15 px-5 py-3 text-xs">
                <Link
                  href={deliveryHref}
                  className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                >
                  Open hand-off
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            )}
          </div>
        )
      }
    />
  );
}
