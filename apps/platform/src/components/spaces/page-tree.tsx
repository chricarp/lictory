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
import { Popover } from "@lictory/ui/popover";
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
import { Menu, MenuItem } from "@lictory/platform/components/spaces/menu";

// The page tree of one space (WAI-ARIA tree view): arrow keys move and
// expand, Enter opens, Alt+Arrow reorders among siblings, Shift+F10 opens
// a page's actions (new subpage, move, archive). Pages are dragged before,
// after or into another page; "Move…" does the same without a pointer.
// Large trees render only the rows in view.

const ROW = 30;
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
  const [focusedId, setFocusedId] = useState<string>();
  const tabStop =
    focusedId && indexOf.has(focusedId)
      ? focusedId
      : activePageId && indexOf.has(activePageId)
        ? activePageId
        : rows[0]?.page.id;
  const [menuFor, setMenuFor] = useState<string>();
  const [drag, setDrag] = useState<{
    pageId: string;
    over?: { targetId: string; position: DropPosition };
  }>();
  const listRef = useRef<HTMLDivElement>(null);
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
    ? Math.max(0, Math.floor(viewport.top / ROW) - OVERSCAN)
    : 0;
  const end = windowed
    ? Math.min(
        rows.length,
        Math.ceil((viewport.top + viewport.height) / ROW) + OVERSCAN,
      )
    : rows.length;

  const focusRow = useCallback(
    (id: string | undefined) => {
      if (!id) return;
      setFocusedId(id);
      pendingFocus.current = id;
      const index = indexOf.get(id);
      const node = listRef.current;
      if (node && index !== undefined && windowed) {
        const top = index * ROW;
        if (top < node.scrollTop) node.scrollTop = top;
        else if (top + ROW > node.scrollTop + node.clientHeight)
          node.scrollTop = top + ROW - node.clientHeight;
      }
    },
    [indexOf, windowed],
  );
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-page-row="${CSS.escape(id)}"]`,
    );
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

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, row: TreeRow) => {
    // Keys pressed in the actions menu button belong to it.
    if (event.target !== event.currentTarget) return;
    const index = indexOf.get(row.page.id) ?? 0;
    const page = row.page;
    if (
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      if (!canEdit || page.archivedAt) return;
      event.preventDefault();
      apply(page, siblingStep(tree, page.id, event.key === "ArrowUp" ? -1 : 1));
      focusRow(page.id);
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(rows[index + 1]?.page.id);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(rows[index - 1]?.page.id);
        break;
      case "Home":
        event.preventDefault();
        focusRow(rows[0]?.page.id);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.at(-1)?.page.id);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (row.hasChildren && !row.expanded) toggle(page.id, true);
        else if (row.expanded) focusRow(rows[index + 1]?.page.id);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (row.expanded) toggle(page.id, false);
        else if (page.parentId && indexOf.has(page.parentId))
          focusRow(page.parentId);
        break;
      case "Enter":
        event.preventDefault();
        open(page);
        break;
      case "ContextMenu":
      case "F10":
        if (event.key === "F10" && !event.shiftKey) return;
        if (!canEdit) return;
        event.preventDefault();
        setMenuFor(page.id);
        break;
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
          role="tree"
          tabIndex={-1}
          aria-label={label}
          aria-describedby={hintId}
          onDragOver={onListDragOver}
          onDrop={onListDrop}
          className={cn(
            "relative min-h-0 overflow-y-auto overscroll-contain",
            variant === "pane" ? "flex-1 px-2 pb-4" : "max-h-[70vh] pb-1",
          )}
        >
          <div
            role="none"
            style={windowed ? { height: rows.length * ROW } : undefined}
            className="relative"
          >
            {rows.slice(start, end).map((row, offset) => (
              <TreeItem
                key={row.page.id}
                row={row}
                top={windowed ? (start + offset) * ROW : undefined}
                active={row.page.id === activePageId}
                tabbable={row.page.id === tabStop}
                canEdit={canEdit}
                menuOpen={menuFor === row.page.id}
                dragging={drag?.pageId === row.page.id}
                dropPosition={
                  drag?.over?.targetId === row.page.id
                    ? drag.over.position
                    : undefined
                }
                onMenu={(openMenu) => {
                  setMenuFor(openMenu ? row.page.id : undefined);
                  if (!openMenu) focusRow(row.page.id);
                }}
                onFocus={() => setFocusedId(row.page.id)}
                onOpen={() => open(row.page)}
                onToggle={() => toggle(row.page.id)}
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
          </div>
        </div>
      )}
      {archivedCount > 0 && (
        <div className={cn("pt-2", variant === "pane" ? "px-4 pb-3" : "")}>
          <button
            type="button"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Archive className="size-3.5" aria-hidden />
            {showArchived
              ? "Hide archived pages"
              : `Show archived pages (${archivedCount})`}
          </button>
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function TreeItem({
  row,
  top,
  active,
  tabbable,
  canEdit,
  menuOpen,
  dragging,
  dropPosition,
  onMenu,
  onFocus,
  onOpen,
  onToggle,
  onKeyDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  row: TreeRow;
  top?: number;
  active: boolean;
  tabbable: boolean;
  canEdit: boolean;
  menuOpen: boolean;
  dragging: boolean;
  dropPosition?: DropPosition;
  onMenu: (open: boolean) => void;
  onFocus: () => void;
  onOpen: () => void;
  onToggle: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const { page, depth, hasChildren, expanded } = row;
  const archived = Boolean(page.archivedAt);
  const movable = canEdit && !archived;
  return (
    <div
      role="treeitem"
      aria-label={archived ? `${page.title}, archived` : page.title}
      aria-level={depth}
      aria-setsize={row.siblings}
      aria-posinset={row.position}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      tabIndex={tabbable ? 0 : -1}
      data-page-row={page.id}
      draggable={movable}
      onClick={(event) => {
        // Clicks in the actions menu (portaled, but a React child) are not
        // clicks on the page.
        if (event.currentTarget.contains(event.target as Node)) onOpen();
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocus();
      }}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        paddingLeft: 4 + (depth - 1) * 16,
        ...(top !== undefined
          ? { position: "absolute", top, left: 0, right: 0 }
          : {}),
      }}
      className={cn(
        "group relative flex h-[30px] cursor-pointer items-center gap-1 rounded-md pr-1 text-[13px] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
        active
          ? "bg-sidebar-accent font-medium text-foreground shadow-(--shadow-border)"
          : "text-foreground/85 hover:bg-muted/70",
        archived && "text-muted-foreground",
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
      {hasChildren ? (
        // Pointer shortcut; keyboards use Right and Left on the tree item.
        <span
          aria-hidden
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-150 ease-out",
              expanded && "rotate-90",
            )}
          />
        </span>
      ) : (
        <span aria-hidden className="size-5 shrink-0" />
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
      {canEdit && (
        <PageMenu
          page={page}
          open={menuOpen}
          onOpenChange={onMenu}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

function PageMenu({
  page,
  open,
  onOpenChange,
  onOpen,
}: {
  page: SpacePage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: () => void;
}) {
  const { createPage, movePage, archivePage, restorePage } = usePageActions();
  const archived = Boolean(page.archivedAt);
  return (
    <Popover
      width={200}
      align="end"
      open={open}
      onOpenChange={onOpenChange}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          tabIndex={-1}
          aria-label={`Actions for ${page.title}`}
          title="Page actions (Shift+F10)"
          onClick={(event) => {
            event.stopPropagation();
            props.onClick();
          }}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
            open
              ? "opacity-100"
              : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <Menu label={`Actions for ${page.title}`}>
          <MenuItem
            onSelect={() => {
              close();
              onOpen();
            }}
            icon={<ExternalLink className="size-3.5" />}
          >
            Open
          </MenuItem>
          {!archived && (
            <>
              <MenuItem
                onSelect={() => {
                  close();
                  createPage(page.id);
                }}
                icon={<CornerDownRight className="size-3.5" />}
              >
                New subpage
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close();
                  movePage(page);
                }}
                icon={<MoveRight className="size-3.5" />}
              >
                Move…
              </MenuItem>
            </>
          )}
          <MenuItem
            onSelect={() => {
              close();
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
        </Menu>
      )}
    </Popover>
  );
}
