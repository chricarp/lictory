"use client";
import { useCallback, useMemo } from "react";
import { paths } from "@lictory/core/lib/paths";
import {
  type ViewId,
  identifier,
  matchesView,
  segmentOf,
  typeOf,
  views,
} from "@lictory/core/lib/work-items";
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

// System views derive from real domain state; nothing here is a saved query.
export function ViewPage({ view }: { view: ViewId }) {
  const { items, organization, userId, disciplineIds, delivery } =
    useWorkspace();
  const project = useProject();
  const meta = views.find((v) => v.id === view)!;
  const scoped = useMemo(
    () =>
      items.filter(
        (i) =>
          i.projectId === project.id &&
          !i.archivedAt &&
          matchesView(i, view, userId, disciplineIds),
      ),
    [items, project.id, view, userId, disciplineIds],
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
      emptyIllustration={viewIllustrations[view]}
      emptyBody={
        view === "needs-my-review"
          ? "When someone requests your review, the item appears here with what changed."
          : undefined
      }
      showArchivedToggle={false}
    />
  );
}
