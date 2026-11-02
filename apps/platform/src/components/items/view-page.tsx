import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "@lictory/platform/lib/navigation";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import {
  type ViewId,
  identifier,
  matchesView,
  segmentOf,
  typeOf,
  views,
} from "@lictory/core/lib/work-items";
import {
  externalLinksByItem,
  lifecycleStage,
  lifecycleStages,
  nextRefinementAction,
  readyForSelection,
} from "@lictory/core/lib/lifecycle";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import type { IllustrationKind } from "@lictory/ui/state-illustration";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { IssueList } from "@lictory/platform/components/items/issue-list";

const viewIllustrations: Record<ViewId, IllustrationKind> = {
  all: "proposal",
  "needs-my-review": "personalReview",
  "needs-review": "teamReview",
  blocked: "blocked",
  ready: "ready",
  drafts: "drafts",
  updated: "updated",
};

// System views derive from real evidence. Refinement brings the lifecycle
// together without creating another work item, status or configuration layer.
export function ViewPage({ view }: { view: ViewId }) {
  const {
    items,
    organization,
    userId,
    disciplineIds,
    delivery,
    directory,
    capabilitiesIn,
    view: workspaceView,
  } = useWorkspace();
  const project = useProject();
  const params = useSearchParams();
  const stage = lifecycleStages.find((s) => s.id === params.get("stage"));
  const overview = view === "all";
  const meta = views.find((v) => v.id === view)!;
  const links = useMemo(
    () =>
      externalLinksByItem(
        Object.values(workspaceView.entities),
        directory.delivery.targets,
      ),
    [workspaceView.entities, directory.delivery.targets],
  );
  const projectItems = useMemo(
    () => items.filter((i) => i.projectId === project.id && !i.archivedAt),
    [items, project.id],
  );
  const specifications = useMemo(
    () => projectItems.filter((i) => typeOf(delivery, i).hasSpecification),
    [projectItems, delivery],
  );
  const scoped = useMemo(
    () =>
      (overview ? specifications : projectItems).filter((item) => {
        if (overview)
          return (
            !stage ||
            lifecycleStage(item, project, delivery, links.get(item.id)) ===
              stage.id
          );
        if (view === "ready")
          return readyForSelection(item, project, delivery, links.get(item.id));
        if (view === "drafts")
          return (
            lifecycleStage(item, project, delivery, links.get(item.id)) ===
            "proposal"
          );
        return matchesView(item, view, userId, disciplineIds);
      }),
    [
      overview,
      specifications,
      projectItems,
      stage,
      project,
      delivery,
      links,
      view,
      userId,
      disciplineIds,
    ],
  );
  const hrefFor = useCallback(
    (item: WorkItem) =>
      paths.item(
        organization.slug,
        project.key,
        segmentOf(typeOf(delivery, item)),
        identifier(project, item.number),
      ),
    [organization.slug, project, delivery],
  );
  const stageHref = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("stage", id);
    else next.delete("stage");
    const query = next.toString();
    return `${paths.view(organization.slug, project.key, "all")}${query ? `?${query}` : ""}`;
  };
  return (
    <IssueList
      items={scoped}
      project={project}
      hrefFor={hrefFor}
      title={view === "needs-my-review" ? "Needs my review" : meta.label}
      description={
        overview
          ? "Capture intent → agree on behavior → select a scope → deliver. Readiness makes a specification eligible; selecting it records the team's commitment."
          : meta.description
      }
      emptyTitle={
        overview
          ? stage
            ? `No specifications in “${stage.label}”`
            : "Start with a proposal"
          : view === "needs-my-review"
            ? "No reviews waiting for you"
            : `Nothing in “${meta.label}”`
      }
      emptyIllustration={viewIllustrations[view]}
      emptyBody={
        overview
          ? "Capture the problem or expected behavior. Product, Engineering, QA and agents can refine it together before the team commits to delivery."
          : view === "needs-my-review"
            ? "When someone requests your review, the item appears here with what changed."
            : view === "ready"
              ? "Specifications appear here when their checks pass and no delivery commitment has been made."
              : undefined
      }
      showArchivedToggle={false}
      groupBy={overview ? "lifecycle" : "refinement"}
      createKind={
        overview && capabilitiesIn(project.id).editSpecifications
          ? "story"
          : undefined
      }
      createLabel={overview ? "New proposal" : undefined}
      itemHint={
        overview
          ? (item) => {
              const currentStage = lifecycleStage(
                item,
                project,
                delivery,
                links.get(item.id),
              );
              return ["proposal", "refinement", "review", "ready"].includes(
                currentStage,
              )
                ? nextRefinementAction(item)
                : lifecycleStages.find((s) => s.id === currentStage)!
                    .description;
            }
          : undefined
      }
      summary={
        overview && (
          <nav
            aria-label="Specification lifecycle"
            className="flex shrink-0 flex-wrap gap-1 border-b bg-muted/20 px-3 py-2"
          >
            <Link
              href={stageHref()}
              aria-current={!stage ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs hover:bg-muted",
                !stage
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              All{" "}
              <span className="ml-1 tabular-nums">{specifications.length}</span>
            </Link>
            {lifecycleStages.map((s) => {
              const count = specifications.filter(
                (item) =>
                  lifecycleStage(
                    item,
                    project,
                    delivery,
                    links.get(item.id),
                  ) === s.id,
              ).length;
              return (
                <Link
                  key={s.id}
                  href={stageHref(s.id)}
                  aria-current={stage?.id === s.id ? "page" : undefined}
                  title={s.description}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-xs hover:bg-muted",
                    stage?.id === s.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {s.label} <span className="ml-1 tabular-nums">{count}</span>
                </Link>
              );
            })}
          </nav>
        )
      }
    />
  );
}
