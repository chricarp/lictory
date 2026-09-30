"use client";
import { useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  type ReactNode,
} from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "~/components/ui/button";
import { usePanelCollapsed } from "~/lib/panel-preference";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import { identifier, isTopLevel, typeOf } from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { useWorkspace } from "~/components/workspace/provider";
import { useProject } from "~/components/workspace/project-gate";
import { IssueList } from "./issue-list";

const ListPanelContext = createContext<{
  collapsed: boolean;
  toggle: () => void;
  id: string;
} | null>(null);

export function WorkItemListToggle() {
  const panel = useContext(ListPanelContext);
  if (!panel) return null;
  const label = panel.collapsed ? "Show work item list" : "Hide work item list";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="hidden xl:inline-flex"
      aria-label={label}
      title={label}
      aria-expanded={!panel.collapsed}
      aria-controls={panel.id}
      onClick={panel.toggle}
    >
      <PanelLeft className="size-4" aria-hidden />
    </Button>
  );
}

// List + detail side by side on wide screens. Both read from the organization
// store, so selecting another item only changes which local data is shown. The
// URL stays the source of truth; on narrow screens the detail takes over.
export function SplitView({
  kind,
  children,
}: {
  kind: "epics" | "stories";
  children: ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  const searchParams = useSearchParams();
  const { items, organization, delivery } = useWorkspace();
  const [collapsed, toggle] = usePanelCollapsed(
    organization.id,
    "work-item-list",
  );
  const listId = useId();
  const project = useProject();
  const selected =
    segment && segment !== "__DEFAULT__"
      ? decodeURIComponent(segment)
      : undefined;
  const scoped = useMemo(
    () =>
      items.filter(
        (i) =>
          i.projectId === project.id &&
          (kind === "epics") === isTopLevel(typeOf(delivery, i)),
      ),
    [items, project.id, kind, delivery],
  );
  const selectedItem = selected
    ? scoped.find(
        (i) =>
          i.id === selected ||
          identifier(project, i.number).toLowerCase() ===
            selected.toLowerCase(),
      )
    : undefined;
  const hrefFor = useCallback(
    (item: WorkItem) =>
      paths.item(
        organization.slug,
        project.key,
        kind,
        identifier(project, item.number),
        searchParams,
      ),
    [organization.slug, project, kind, searchParams],
  );
  const list = (compact: boolean) => (
    <IssueList
      items={scoped}
      project={project}
      hrefFor={hrefFor}
      selectedId={selectedItem?.id}
      compact={compact}
      title={kind === "epics" ? "Epics" : "Work items"}
      createKind={kind === "epics" ? "epic" : "story"}
      allowEpicFilter={kind === "stories"}
      emptyTitle={kind === "epics" ? "No epics yet" : "No work items yet"}
      emptyBody={
        kind === "epics"
          ? "An Epic captures a project capability. Start with a title; refine it with your team."
          : "Stories describe concrete behavior engineering will implement. Create them from an Epic or here."
      }
    />
  );
  if (!selected) return <div className="h-full">{list(false)}</div>;
  return (
    <ListPanelContext.Provider value={{ collapsed, toggle, id: listId }}>
      <div className="flex h-full">
        <div
          id={listId}
          className={cn(
            "hidden w-[320px] shrink-0 border-r",
            !collapsed && "xl:block",
          )}
        >
          {!collapsed && list(true)}
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ListPanelContext.Provider>
  );
}
