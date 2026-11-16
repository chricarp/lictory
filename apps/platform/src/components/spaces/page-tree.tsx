import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { createMenuController } from "@ui-sdk/react/menu";
import { Toggle } from "@ui-sdk/react/toggle";
import {
  Tree,
  TreeItem,
  TreeItemIndicator,
  TreeItemLabel,
  type TreeItemData,
} from "@ui-sdk/react/tree";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  CornerDownRight,
  ExternalLink,
  FileText,
  MoreHorizontal,
  MoveRight,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { useRouter } from "@lictory/platform/lib/navigation";
import {
  ancestorsOf,
  pageTree,
  placeUnder,
  placement,
  siblingStep,
  visibleRows,
  type DropPosition,
  type Placement,
  type SpacePage,
  type TreeRow,
} from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpacePages } from "@lictory/platform/components/spaces/store";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@lictory/platform/components/spaces/menu";
import {
  touchRow,
  useTouchSizing,
} from "@lictory/platform/components/spaces/touch";

// The page tree of one space (WAI-ARIA tree view): arrow keys move and
// expand, Enter opens, Alt+Arrow reorders among siblings, Shift+F10 opens
// a page's actions (new subpage, move, archive). Pages are dragged before,
// after or into another page; "Move…" does the same without a pointer.
// Large trees render only the rows in view. Rows are 30px for a mouse and
// 44px on phones and touch screens.

const DENSE_ROW = 30;
const TOUCH_ROW = 44;
const WINDOW_FROM = 120;
const OVERSCAN = 12;
const DRAG_TYPE = "application/x-lictory-page";

export function PageTree({
  activePageId,
  variant,
}: {
  activePageId?: string;
  variant: "pane" | "home";
}) {
  const { space, canEdit, moveTo, announcement } = usePageActions();
  const { organization } = useWorkspace();
  const router = useRouter();
  const pages = useSpacePages(space.id);
  const [showArchived, setShowArchived] = useState(false);
  const tree = useMemo(
    () => pageTree(pages, showArchived),
    [pages, showArchived],
  );
  // The space home opens the top level one step, so its sections show
  // what they hold; the pane beside a page opens the way to that page.
  const firstLevel = (list: readonly SpacePage[]) =>
    variant === "home"
      ? list.filter(
          (p) =>
            !p.parentId &&
            !p.archivedAt &&
            list.some((c) => c.parentId === p.id && !c.archivedAt),
        )
      : [];
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const ids = new Set<string>(firstLevel(pages).map((p) => p.id));
    if (activePageId)
      for (const p of ancestorsOf(pageTree(pages, true).byId, activePageId))
        ids.add(p.id);
    return ids;
  });
  // Pages that arrive after the first render (a cold start) open the same
  // way, once.
  const [opened, setOpened] = useState(pages.length > 0);
  if (!opened && pages.length > 0) {
    setOpened(true);
    const first = firstLevel(pages);
    if (first.length)
      setExpanded(new Set([...expanded, ...first.map((p) => p.id)]));
  }
  // Opening a page (from a link, the palette or after creating it), or
  // moving the open page, reveals it in the tree.
  const activeAncestors = activePageId
    ? ancestorsOf(tree.byId, activePageId)
    : [];
  const revealKey = [activePageId, ...activeAncestors.map((p) => p.id)].join(
    "/",
  );
  const [revealed, setRevealed] = useState(revealKey);
  if (revealKey !== revealed) {
    setRevealed(revealKey);
    const missing = activeAncestors.filter((p) => !expanded.has(p.id));
    if (missing.length)
      setExpanded(new Set([...expanded, ...missing.map((p) => p.id)]));
  }
  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);
  const indexOf = useMemo(
    () => new Map(rows.map((r, i) => [r.page.id, i])),
    [rows],
  );
  // The whole hierarchy, so the tree knows levels and positions of rows
  // that are collapsed or outside the window.
  const items = useMemo(() => {
    const build = (parentId: string | null): TreeItemData[] =>
      (tree.children.get(parentId) ?? []).map((page) => {
        const children = tree.children.get(page.id);
        return children?.length
          ? { value: page.id, label: page.title, children: build(page.id) }
          : { value: page.id, label: page.title };
      });
    return build(null);
  }, [tree]);
  const expandedIds = useMemo(() => [...expanded], [expanded]);
  // One actions menu for the tree: each row's button opens it for its page,
  // and so does Shift+F10 on the row.
  const [menu] = useState(() => createMenuController<SpacePage>());
  const [menuFor, setMenuFor] = useState<string>();
  const [drag, setDrag] = useState<{
    pageId: string;
    over?: { targetId: string; position: DropPosition };
  }>();
  const listRef = useRef<HTMLDivElement>(null);
  const rowHeight = useTouchSizing() ? TOUCH_ROW : DENSE_ROW;
  const pendingFocus = useRef<string | undefined>(undefined);

  // Windowing: only the rows in view (plus a margin) are in the document.
  const windowed = rows.length > WINDOW_FROM;
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node || !windowed) return;
    const measure = () =>
      setViewport({ top: node.scrollTop, height: node.clientHeight || 600 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", measure);
    };
  }, [windowed]);
  const start = windowed
    ? Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN)
    : 0;
  const end = windowed
    ? Math.min(
        rows.length,
        Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN,
      )
    : rows.length;

  const rowNode = (id: string | undefined) =>
    id
      ? listRef.current?.querySelector<HTMLElement>(
          `[data-page-row="${CSS.escape(id)}"]`,
        )
      : undefined;
  const scrollToRow = (index: number) => {
    const node = listRef.current;
    if (!node || !windowed) return;
    const top = index * rowHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + rowHeight > node.scrollTop + node.clientHeight)
      node.scrollTop = top + rowHeight - node.clientHeight;
  };
  // A page moved with the keyboard keeps focus where it lands.
  const focusRow = (id: string) => {
    pendingFocus.current = id;
    const index = indexOf.get(id);
    if (index !== undefined) scrollToRow(index);
  };
  // Revealing the open page includes bringing it into view: in a windowed
  // tree a page far down has no row in the document until the list scrolls
  // to it, and the tree's tab stop is that row.
  useEffect(() => {
    if (!activePageId) return;
    const index = indexOf.get(activePageId);
    if (index !== undefined) scrollToRow(index);
    // Only when the open page, or where it sits, changes: not whenever the
    // rows around it do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const node = rowNode(id);
    if (node) {
      pendingFocus.current = undefined;
      node.focus({ preventScroll: !windowed });
    }
  });

  const toggle = useCallback(
    (id: string, open?: boolean) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (open ?? !next.has(id)) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const open = useCallback(
    (page: SpacePage) =>
      router.push(paths.spacePage(organization.slug, space.slug, page.id)),
    [router, organization.slug, space.slug],
  );
  const describeMove = useCallback(
    (page: SpacePage, to: Placement) => {
      const parent = to.parentId ? tree.byId.get(to.parentId) : undefined;
      return parent
        ? `Moved “${page.title}” into “${parent.title}”.`
        : `Moved “${page.title}” in ${space.name}.`;
    },
    [tree, space.name],
  );
  const apply = useCallback(
    (page: SpacePage, to: Placement | null) => {
      if (!to) return;
      moveTo(page, to, describeMove(page, to));
      if (to.parentId) toggle(to.parentId, true);
    },
    [moveTo, describeMove, toggle],
  );

  // The tree moves focus, expands and opens; these keys are the page tree's
  // own.
  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, row: TreeRow) => {
    if (event.target !== event.currentTarget) return;
    const page = row.page;
    if (
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      if (!canEdit || page.archivedAt) return;
      apply(page, siblingStep(tree, page.id, event.key === "ArrowUp" ? -1 : 1));
      focusRow(page.id);
      return;
    }
    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      if (!canEdit) return;
      event.preventDefault();
      setMenuFor(page.id);
      // The row's own button opens the menu for its page, anchored to it.
      event.currentTarget
        .querySelector<HTMLElement>("[data-page-actions]")
        ?.click();
    }
  };

  // Drag and drop: the upper quarter of a row drops before it, the lower
  // quarter after it, the middle into it.
  const dropAt = (event: DragEvent<HTMLElement>, row: TreeRow) => {
    if (!drag) return undefined;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height;
    const position: DropPosition =
      y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
    const to = placement(tree, drag.pageId, row.page.id, position);
    return to ? { position, to } : undefined;
  };
  const onDragOver = (event: DragEvent<HTMLElement>, row: TreeRow) => {
    event.stopPropagation();
    const target = dropAt(event, row);
    if (!target || row.page.archivedAt) {
      if (drag?.over) setDrag({ pageId: drag.pageId });
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (
      drag?.over?.targetId !== row.page.id ||
      drag.over.position !== target.position
    )
      setDrag({
        pageId: drag!.pageId,
        over: { targetId: row.page.id, position: target.position },
      });
  };
  const onDrop = (event: DragEvent<HTMLElement>, row: TreeRow) => {
    event.preventDefault();
    event.stopPropagation();
    const target = dropAt(event, row);
    const page = drag && tree.byId.get(drag.pageId);
    setDrag(undefined);
    if (target && page) apply(page, target.to);
  };
  // Below the last row: the end of the top level.
  const onListDragOver = (event: DragEvent<HTMLElement>) => {
    if (!drag || !placeUnder(tree, drag.pageId, null, "last")) return;
    event.preventDefault();
    if (drag.over) setDrag({ pageId: drag.pageId });
  };
  const onListDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const page = drag && tree.byId.get(drag.pageId);
    setDrag(undefined);
    if (page) apply(page, placeUnder(tree, page.id, null, "last"));
  };

  const hintId = useId();
  const archivedCount = useMemo(
    () => pages.filter((p) => p.archivedAt).length,
    [pages],
  );
  const label = `Pages of ${space.name}`;
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        variant === "pane" ? "h-full" : "",
      )}
    >
      <p id={hintId} className="sr-only">
        Arrow keys move between pages and open or close subpages. Enter opens a
        page.
        {canEdit &&
          " Alt with the up or down arrow moves a page among its siblings. Shift F10 opens its actions."}
      </p>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-[13px] text-muted-foreground">
          {pages.length ? "Every page is archived." : "No pages yet."}
        </p>
      ) : (
        <div
          ref={listRef}
          onDragOver={onListDragOver}
          onDrop={onListDrop}
          className={cn(
            "relative min-h-0 overflow-y-auto overscroll-contain",
            variant === "pane" ? "flex-1 px-2 pb-4" : "max-h-[70vh] pb-1",
          )}
        >
          <Tree
            mode="none"
            items={items}
            current={activePageId ?? null}
            expanded={expandedIds}
            onExpandedChange={(next) => setExpanded(new Set(next))}
            expandOnPress={false}
            onAction={(value) => {
              const page = tree.byId.get(value);
              if (page) open(page);
            }}
            onHighlight={(_value, { index }) => scrollToRow(index)}
            aria-label={label}
            aria-describedby={hintId}
            style={windowed ? { height: rows.length * rowHeight } : undefined}
            className="relative block max-w-none gap-0"
          >
            {rows.slice(start, end).map((row, offset) => (
              <PageRow
                key={row.page.id}
                row={row}
                top={windowed ? (start + offset) * rowHeight : undefined}
                canEdit={canEdit}
                menu={menu}
                menuOpen={menuFor === row.page.id}
                dragging={drag?.pageId === row.page.id}
                dropPosition={
                  drag?.over?.targetId === row.page.id
                    ? drag.over.position
                    : undefined
                }
                onKeyDown={(event) => onRowKeyDown(event, row)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TYPE, row.page.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDrag({ pageId: row.page.id });
                }}
                onDragEnd={() => setDrag(undefined)}
                onDragOver={(event) => onDragOver(event, row)}
                onDrop={(event) => onDrop(event, row)}
              />
            ))}
          </Tree>
        </div>
      )}
      {canEdit && (
        <Menu
          controller={menu}
          onOpenChange={(isOpen) => {
            if (!isOpen) setMenuFor(undefined);
          }}
        >
          <MenuContent
            align="end"
            width={200}
            // Focus returns to the page's row, not to its hidden button.
            finalFocus={() => rowNode(menu.getPayload()?.id)}
            render={(props, state) => (
              <div
                {...props}
                aria-label={`Actions for ${(state.payload as SpacePage | undefined)?.title ?? "the page"}`}
              />
            )}
          >
            {(state) => {
              const page = state.payload as SpacePage | undefined;
              return page ? (
                <PageMenuItems page={page} onOpen={() => open(page)} />
              ) : null;
            }}
          </MenuContent>
        </Menu>
      )}
      {archivedCount > 0 && (
        <div className={cn("pt-2", variant === "pane" ? "px-4 pb-3" : "")}>
          <Toggle
            pressed={showArchived}
            onPressedChange={setShowArchived}
            className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Archive className="size-3.5" aria-hidden />
            {showArchived
              ? "Hide archived pages"
              : `Show archived pages (${archivedCount})`}
          </Toggle>
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function PageRow({
  row,
  top,
  canEdit,
  menu,
  menuOpen,
  dragging,
  dropPosition,
  onKeyDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  row: TreeRow;
  top?: number;
  canEdit: boolean;
  menu: ReturnType<typeof createMenuController<SpacePage>>;
  menuOpen: boolean;
  dragging: boolean;
  dropPosition?: DropPosition;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const { page, depth, hasChildren } = row;
  const archived = Boolean(page.archivedAt);
  const movable = canEdit && !archived;
  const archivedNameId = useId();
  return (
    <TreeItem
      value={page.id}
      // The row is named by its label, the page's title; an archived page
      // says so in words.
      aria-labelledby={archived ? archivedNameId : undefined}
      data-page-row={page.id}
      draggable={movable}
      onClick={(event) => {
        // A press on the actions button is not a press on the page.
        if ((event.target as Element).closest("[data-page-actions]"))
          event.preventDefault();
      }}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        paddingLeft: 2 + (depth - 1) * 16,
        ...(top !== undefined
          ? { position: "absolute", top, left: 0, right: 0 }
          : {}),
      }}
      className={cn(
        "group relative flex h-[30px] cursor-pointer items-center gap-1 rounded-md pr-1 text-[13px] text-foreground/85 outline-none select-none not-data-current:hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset data-current:bg-sidebar-accent data-current:font-medium data-current:text-foreground data-current:shadow-(--shadow-border) max-sm:text-sm touch:text-sm",
        touchRow,
        archived && "text-muted-foreground data-current:text-muted-foreground",
        dragging && "opacity-50",
        dropPosition === "inside" && "bg-primary/8 ring-1 ring-primary/40",
      )}
    >
      {dropPosition === "before" && (
        <span
          aria-hidden
          className="absolute -top-px right-1 left-2 h-0.5 rounded-full bg-primary"
        />
      )}
      {dropPosition === "after" && (
        <span
          aria-hidden
          className="absolute right-1 -bottom-px left-2 h-0.5 rounded-full bg-primary"
        />
      )}
      <TreeItemLabel className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-none bg-transparent p-0 outline-none">
        {hasChildren ? (
          // Pointer shortcut; keyboards use Right and Left on the tree item.
          <TreeItemIndicator className="grid size-6 shrink-0 rotate-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground max-sm:-mr-1.5 max-sm:size-11 touch:-mr-1.5 touch:size-11">
            <ChevronRight className="size-3.5 in-data-expanded:rotate-90 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out" />
          </TreeItemIndicator>
        ) : (
          <span
            aria-hidden
            className="size-6 shrink-0 max-sm:-mr-1.5 max-sm:w-11 touch:-mr-1.5 touch:w-11"
          />
        )}
        <FileText
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="ml-0.5 min-w-0 flex-1 truncate">{page.title}</span>
        {archived && (
          <span className="shrink-0 font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            Archived
          </span>
        )}
      </TreeItemLabel>
      {archived && (
        <span id={archivedNameId} hidden>
          {page.title}, archived
        </span>
      )}
      {canEdit && (
        <MenuTrigger
          controller={menu}
          payload={page}
          data-page-actions=""
          aria-label={`Actions for ${page.title}`}
          title="Page actions (Shift+F10)"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          render={<button type="button" tabIndex={-1} />}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground max-sm:size-11 max-sm:text-muted-foreground/70 touch:size-11 touch:text-muted-foreground/70",
            // Touch has no hover to reveal it.
            menuOpen
              ? "opacity-100"
              : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-open:opacity-100 max-sm:opacity-100 touch:opacity-100",
          )}
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </MenuTrigger>
      )}
    </TreeItem>
  );
}

function PageMenuItems({
  page,
  onOpen,
}: {
  page: SpacePage;
  onOpen: () => void;
}) {
  const { createPage, movePage, archivePage, restorePage } = usePageActions();
  const archived = Boolean(page.archivedAt);
  return (
    <>
      <MenuItem onSelect={onOpen} icon={<ExternalLink className="size-3.5" />}>
        Open
      </MenuItem>
      {!archived && (
        <>
          <MenuItem
            onSelect={() => createPage(page.id)}
            icon={<CornerDownRight className="size-3.5" />}
          >
            New subpage
          </MenuItem>
          <MenuItem
            onSelect={() => movePage(page)}
            icon={<MoveRight className="size-3.5" />}
          >
            Move…
          </MenuItem>
        </>
      )}
      <MenuItem
        onSelect={() => {
          if (archived) restorePage(page);
          else archivePage(page);
        }}
        icon={
          archived ? (
            <ArchiveRestore className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )
        }
      >
        {archived ? "Restore" : "Archive"}
      </MenuItem>
    </>
  );
}
