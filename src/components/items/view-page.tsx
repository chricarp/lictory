"use client";
import { useCallback, useMemo } from "react";
import { paths } from "~/lib/paths";
import { identifier, matchesView, views, type ViewId } from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { useWorkspace } from "~/components/workspace/provider";
import { useProject } from "~/components/workspace/project-gate";
import { IssueList } from "./issue-list";

// System views derive from real domain state; nothing here is a saved query.
export function ViewPage({ view }: { view: ViewId }) {
  const { items, organization, userId, groupIds } = useWorkspace();
  const project = useProject();
  const meta = views.find((v) => v.id === view)!;
  const scoped = useMemo(
    () =>
      items.filter(
        (i) =>
          i.projectId === project.id &&
          !i.archivedAt &&
          matchesView(i, view, userId, groupIds),
      ),
    [items, project.id, view, userId, groupIds],
  );
  const hrefFor = useCallback(
    (item: WorkItem) =>
      paths.item(
        organization.slug,
        project.key,
        item.kind === "epic" ? "epics" : "stories",
        identifier(project, item.number),
      ),
    [organization.slug, project],
  );
  return (
    <IssueList
      items={scoped}
      project={project}
      hrefFor={hrefFor}
      title={view === "needs-my-review" ? "Needs my review" : meta.label}
      description={meta.description}
      emptyTitle={
        view === "needs-my-review"
          ? "No reviews waiting for you"
          : `Nothing in “${meta.label}”`
      }
      emptyBody={
        view === "needs-my-review"
          ? "When someone requests your review, the item appears here with what changed."
          : undefined
      }
      showArchivedToggle={false}
    />
  );
}
