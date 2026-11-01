import { useMemo } from "react";
import { paths } from "@lictory/core/lib/paths";
import { typeOf, type Project } from "@lictory/core/lib/work-items";
import {
  externalLinksByItem,
  refinementQueueStage,
} from "@lictory/core/lib/lifecycle";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// The queue an item was opened from. Item pages keep it in `?from=` so the
// sidebar, breadcrumb and list beside the item stay in that place.
export type ItemOrigin = "proposals" | "refinement" | "reviews";
const origins: Record<ItemOrigin, string> = {
  proposals: "Proposals",
  refinement: "Refinement",
  reviews: "Reviews",
};
export const refinementStages = ["refinement", "review", "ready"] as const;
export type RefinementStage = (typeof refinementStages)[number];

export function itemOrigin(params: {
  get(name: string): string | null;
}): ItemOrigin | undefined {
  const from = params.get("from");
  return from && Object.hasOwn(origins, from)
    ? (from as ItemOrigin)
    : undefined;
}

// The part of an item address that keeps its queue when moving to a related
// item (parent, sibling).
export function originParams(params: { get(name: string): string | null }) {
  const next = new URLSearchParams();
  for (const name of ["from", "stage", "type"]) {
    const value = params.get(name);
    if (value) next.set(name, value);
  }
  return next;
}

export function originLink(
  org: string,
  project: string,
  origin: ItemOrigin | undefined,
  params: { get(name: string): string | null },
) {
  if (origin === "proposals")
    return { label: origins[origin], href: paths.proposals(org, project) };
  if (origin === "reviews")
    return { label: origins[origin], href: paths.reviews(org, project) };
  if (origin === "refinement") {
    const stage = params.get("stage");
    return {
      label: origins[origin],
      href: `${paths.refinement(org, project)}${stage ? `?stage=${encodeURIComponent(stage)}` : ""}`,
    };
  }
  const type = params.get("type");
  return {
    label: "All items",
    href: paths.items(
      org,
      project,
      type ? new URLSearchParams({ type }) : undefined,
    ),
  };
}

// Proposal and refinement queues of one project, shared by the queue pages
// and the list beside an opened item.
export function useLifecycleQueues(project: Project) {
  const { items, delivery, directory, view } = useWorkspace();
  const links = useMemo(
    () =>
      externalLinksByItem(
        Object.values(view.entities),
        directory.delivery.targets,
      ),
    [view.entities, directory.delivery.targets],
  );
  const projectItems = useMemo(
    () => items.filter((i) => i.projectId === project.id && !i.archivedAt),
    [items, project.id],
  );
  return useMemo(() => {
    const stages = new Map(
      projectItems
        .filter((item) => typeOf(delivery, item).hasSpecification)
        .map((item) => [
          item.id,
          refinementQueueStage(item, project, delivery, links.get(item.id)),
        ]),
    );
    const proposals = projectItems.filter(
      (item) => stages.get(item.id) === "proposal",
    );
    const refining = projectItems.filter((item) =>
      (refinementStages as readonly (string | undefined)[]).includes(
        stages.get(item.id),
      ),
    );
    return { links, projectItems, stages, proposals, refining };
  }, [projectItems, project, delivery, links]);
}
