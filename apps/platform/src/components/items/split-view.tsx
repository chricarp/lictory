import { useParams, useSearchParams } from "@lictory/platform/lib/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@lictory/ui/button";
import { usePanelCollapsed } from "@lictory/platform/lib/panel-preference";
import {
  PaneResizer,
  usePaneResize,
  type PaneSpec,
} from "@lictory/platform/components/workspace/pane-resizer";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { identifier, matchesView } from "@lictory/core/lib/work-items";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { IssueList } from "@lictory/platform/components/items/issue-list";
import {
  itemOrigin,
  originLink,
  useLifecycleQueues,
} from "@lictory/platform/components/items/queues";

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
      className="hidden @min-[65rem]/frame:inline-flex"
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

// A quarter of the frame by default, so titles stay readable wherever it fits.
const listPane: PaneSpec = {
  pane: "work-item-list",
  label: "work item list",
  edge: "end",
  min: 240,
  max: 560,
  share: { fraction: 0.3, floor: 272, of: "frame" },
  preferred: ({ frame }) => Math.min(400, Math.max(272, frame * 0.26)),
  neighbour: () => document.querySelector("[data-pane-document]"),
  keep: 440,
};

// List + detail side by side on wide screens. Every item type shares one
// address; `?from=` keeps the queue the item was opened from beside it. Both
// read from the organization store, so selecting another item only changes
// which local data is shown. On narrow screens the detail takes over.
export function SplitView({ children }: { children: ReactNode }) {
  // The selected item is the child route's `$id`.
  const segment = useParams<{ id: string }>().id;
  const searchParams = useSearchParams();
  const { items, organization, userId, disciplineIds } = useWorkspace();
  const [collapsed, toggle, setCollapsed] = usePanelCollapsed(
    organization.id,
    "work-item-list",
  );
  const resize = usePaneResize(listPane, {
    collapse: { collapsed, setCollapsed },
  });
  const listId = resize.pane.id;
  const { attach: attachList } = resize.pane;
  const project = useProject();
  const queues = useLifecycleQueues(project);
  const origin = itemOrigin(searchParams);
  const stage = searchParams.get("stage");
  const selected = segment ? decodeURIComponent(segment) : undefined;
  const listed = useMemo(() => {
    if (origin === "proposals") return queues.proposals;
    if (origin === "refinement")
      return queues.refining.filter(
        (item) => !stage || queues.stages.get(item.id) === stage,
      );
    if (origin === "reviews")
      return queues.projectItems.filter((item) =>
        matchesView(item, "needs-my-review", userId, disciplineIds),
      );
    return items.filter((i) => i.projectId === project.id);
  }, [origin, stage, queues, items, project.id, userId, disciplineIds]);
  const selectedItem = selected
    ? items.find(
        (i) =>
          i.projectId === project.id &&
          (i.id === selected ||
            identifier(project, i.number).toLowerCase() ===
              selected.toLowerCase()),
      )
    : undefined;
  const hrefFor = useCallback(
    (item: WorkItem) =>
      paths.item(
        organization.slug,
        project.key,
        identifier(project, item.number),
        searchParams,
      ),
    [organization.slug, project, searchParams],
  );
  if (!selected) return <div className="h-full">{children}</div>;
  const { label } = originLink(
    organization.slug,
    project.key,
    origin,
    searchParams,
  );
  return (
    <ListPanelContext.Provider value={{ collapsed, toggle, id: listId }}>
      <div className="flex h-full">
        <div
          id={listId}
          ref={attachList}
          style={resize.pane.style}
          data-work-item-list
          className={cn(
            "hidden shrink-0 border-r bg-shell/50",
            resize.pane.sized ? "w-(--pane-w)" : "w-[clamp(272px,26cqw,400px)]",
            !collapsed && "@min-[65rem]/frame:block",
          )}
        >
          {!collapsed && (
            <IssueList
              items={listed}
              project={project}
              hrefFor={hrefFor}
              selectedId={selectedItem?.id}
              compact
              title={label}
              createKind="story"
              createIntent={
                origin === "proposals" || origin === "refinement"
                  ? "proposal"
                  : undefined
              }
              createLabel={
                origin === "proposals" || origin === "refinement"
                  ? "New proposal"
                  : "New item"
              }
              emptyTitle="Nothing else here"
              groupBy={origin ? "refinement" : "status"}
            />
          )}
        </div>
        {/* Stays while a drag folds the list, so pulling back reopens it. */}
        <PaneResizer
          resize={resize.handle}
          className={cn(
            "hidden",
            (!collapsed || resize.handle.dragging) &&
              "@min-[65rem]/frame:block",
          )}
        />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ListPanelContext.Provider>
  );
}
