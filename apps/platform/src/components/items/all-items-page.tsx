import { useCallback, useMemo } from "react";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { Link, useSearchParams } from "@lictory/platform/lib/navigation";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { enabledTypes, identifier } from "@lictory/core/lib/work-items";
import { IssueList } from "@lictory/platform/components/items/issue-list";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";

// Every configured type shares this catalog. Hierarchy is an item property,
// never a hard-coded navigation destination.
export function AllItemsPage() {
  const { items, organization, delivery } = useWorkspace();
  const project = useProject();
  const params = useSearchParams();
  const scoped = useMemo(
    () => items.filter((i) => i.projectId === project.id),
    [items, project.id],
  );
  const types = enabledTypes(delivery, project.id);
  // Filters travel with the item so the list beside it stays the same.
  const hrefFor = useCallback(
    (item: WorkItem) =>
      paths.item(
        organization.slug,
        project.key,
        identifier(project, item.number),
        params,
      ),
    [organization.slug, project, params],
  );
  const selected = params.get("type");
  const typeHref = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("type", id);
    else next.delete("type");
    return `${paths.items(organization.slug, project.key)}${next.size ? `?${next}` : ""}`;
  };
  return (
    <IssueList
      items={scoped}
      project={project}
      title="All items"
      description="Every proposal, specification and delivery task in this project. Filter by your team's item types, or find completed work and its history."
      hrefFor={hrefFor}
      groupBy="status"
      createKind="story"
      createLabel="New item"
      emptyTitle="No items yet"
      emptyBody="Capture a proposal to refine with your team, or create a task when the work is already understood."
      summary={
        <nav
          aria-label="Item types"
          className="flex shrink-0 flex-wrap gap-1 border-b px-3 py-2"
        >
          <Link
            href={typeHref()}
            aria-current={!selected ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1 text-xs hover:bg-muted",
              !selected ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            All types
          </Link>
          {types.map((type) => (
            <Link
              key={type.id}
              href={typeHref(type.id)}
              aria-label={type.name}
              aria-current={selected === type.id ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted",
                selected === type.id
                  ? "bg-muted font-medium"
                  : "text-muted-foreground",
              )}
            >
              <TypeIcon type={type} />
              {type.name}
            </Link>
          ))}
        </nav>
      }
    />
  );
}
