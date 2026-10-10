"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  Inbox,
  KanbanSquare,
  ListOrdered,
  Send,
  Settings,
  Settings2,
  UserRound,
} from "lucide-react";
import { IntelligenceMark } from "~/components/logo";
import { cn } from "~/lib/utils";
import { track } from "~/lib/analytics/client";
import { paths } from "~/lib/paths";
import {
  activeStatuses,
  identifier,
  isTopLevel,
  parseIdentifier,
  segmentOf,
  typeOf,
  views,
} from "~/lib/work-items";
import { Kbd } from "~/components/ui/primitives";
import { StatusIcon } from "~/components/items/status";
import { TypeIcon, epicGlyph, storyGlyph } from "~/components/items/icons";
import { useWorkspace } from "./provider";
import { useShell } from "./shell";

type Item = {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  group: string;
  keywords?: string;
  run: () => void;
};

// Search and commands in one place. Items are matched by identifier and title
// from the local store; commands depend on where the user currently is.
export function CommandPalette({
  initialQuery,
  onClose,
}: {
  initialQuery: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const {
    organization,
    projects,
    items,
    userId,
    mutate,
    capabilitiesIn,
    delivery,
  } = useWorkspace();
  const { openCreate, currentItem, project: shellProject } = useShell();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const org = organization.slug;
  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );
  const projectOf = useCallback(
    (id: string) => projects.find((p) => p.id === id),
    [projects],
  );
  // The open item's project, otherwise the project in context.
  const currentProject = currentItem
    ? projectOf(currentItem.projectId)
    : shellProject;
  const commands = useMemo<Item[]>(() => {
    const list: Item[] = [];
    const capabilities = capabilitiesIn(currentProject?.id);
    if (currentItem && currentProject && capabilities.changeProperties) {
      const id = identifier(currentProject, currentItem.number);
      if (currentItem.assigneeId !== userId)
        list.push({
          id: "assign-me",
          label: `Assign ${id} to me`,
          group: "Current item",
          icon: <UserRound className="size-4" />,
          run: () => {
            onClose();
            void mutate({
              type: "updateWorkItem",
              workItemId: currentItem.id,
              assigneeId: userId,
            });
          },
        });
      for (const status of activeStatuses(delivery, currentItem.projectId))
        if (status.id !== currentItem.statusId)
          list.push({
            id: `status-${status.id}`,
            label: `Set status: ${status.name}`,
            group: "Current item",
            icon: (
              <StatusIcon category={status.category} color={status.color} />
            ),
            keywords: "status change move",
            run: () => {
              onClose();
              void mutate({
                type: "updateWorkItem",
                workItemId: currentItem.id,
                statusId: status.id,
              });
            },
          });
    }
    if (capabilities.editSpecifications)
      list.push({
        id: "create-epic",
        label: "Create Epic",
        group: "Create",
        icon: <TypeIcon type={epicGlyph} />,
        run: () => {
          onClose();
          openCreate({ kind: "epic", projectId: currentProject?.id });
        },
      });
    if (capabilities.editSpecifications || capabilities.changeProperties)
      list.push({
        id: "create-story",
        label: "Create work item",
        group: "Create",
        icon: <TypeIcon type={storyGlyph} />,
        run: () => {
          onClose();
          openCreate({
            kind: "story",
            projectId: currentProject?.id,
            parentId:
              currentItem && isTopLevel(typeOf(delivery, currentItem))
                ? currentItem.id
                : null,
          });
        },
      });
    list.push(
      {
        id: "intelligence",
        label: "Ask Lictory Intelligence",
        group: "Navigate",
        icon: <IntelligenceMark className="size-4" />,
        run: () => go(paths.intelligence(org)),
      },
      {
        id: "inbox",
        label: "Go to Inbox",
        group: "Navigate",
        icon: <Inbox className="size-4" />,
        run: () => go(paths.inbox(org)),
      },
      {
        id: "settings",
        label: "Organization settings",
        group: "Navigate",
        icon: <Settings className="size-4" />,
        keywords: "settings members projects types integrations",
        run: () => go(paths.settings(org)),
      },
    );
    if (currentProject) {
      const p = currentProject;
      if (p.deliveryMode === "external")
        list.push({
          id: `handoff-${p.id}`,
          label: `${p.name} · Hand-off`,
          group: "Navigate",
          icon: <Send className="size-4" />,
          keywords: "jira export delivery handoff",
          run: () => go(paths.handoff(org, p.key)),
        });
      else
        list.push(
          {
            id: `board-${p.id}`,
            label: `${p.name} · Board`,
            group: "Navigate",
            icon: <KanbanSquare className="size-4" />,
            keywords: "kanban delivery",
            run: () => go(paths.board(org, p.key)),
          },
          {
            id: `backlog-${p.id}`,
            label: `${p.name} · Backlog`,
            group: "Navigate",
            icon: <ListOrdered className="size-4" />,
            keywords: "sprints cycles iterations planning",
            run: () => go(paths.backlog(org, p.key)),
          },
        );
      for (const t of [...delivery.teams.values()].filter(
        (x) => x.projectId === p.id && !x.archivedAt,
      ))
        list.push({
          id: `team-${t.id}`,
          label: `${t.name} · Team backlog`,
          group: "Navigate",
          icon: <ListOrdered className="size-4" />,
          keywords: `team ${p.name} backlog triage`,
          run: () => go(paths.team(org, p.key, t.id)),
        });
      list.push({
        id: `project-settings-${p.id}`,
        label: `${p.name} · Project settings`,
        group: "Navigate",
        icon: <Settings2 className="size-4" />,
        keywords: "settings workflow teams disciplines members delivery",
        run: () => go(paths.projectSettings(org, p.key)),
      });
    }
    for (const p of projects) {
      list.push(
        {
          id: `epics-${p.id}`,
          label: `${p.name} · Epics`,
          group: "Navigate",
          icon: <TypeIcon type={epicGlyph} />,
          keywords: "open project",
          run: () => go(paths.list(org, p.key, "epics")),
        },
        {
          id: `stories-${p.id}`,
          label: `${p.name} · Work items`,
          group: "Navigate",
          icon: <TypeIcon type={storyGlyph} />,
          run: () => go(paths.list(org, p.key, "stories")),
        },
        {
          id: `reviews-${p.id}`,
          label: `${p.name} · Needs my review`,
          group: "Navigate",
          icon: <BookOpenCheck className="size-4" />,
          run: () => go(paths.reviews(org, p.key)),
        },
      );
      for (const v of views)
        if (v.id !== "needs-my-review")
          list.push({
            id: `view-${p.id}-${v.id}`,
            label: `${p.name} · ${v.label}`,
            group: "Views",
            run: () => go(paths.view(org, p.key, v.id)),
          });
    }
    return list;
  }, [
    currentItem,
    currentProject,
    userId,
    capabilitiesIn,
    mutate,
    onClose,
    openCreate,
    projects,
    org,
    go,
    delivery,
  ]);
  const q = query.trim().toLowerCase();
  const parsed = parseIdentifier(query);
  const results = useMemo<Item[]>(() => {
    const matchedItems = items
      .filter((i) => !i.archivedAt)
      .map((i) => ({ item: i, project: projectOf(i.projectId) }))
      .filter(({ item, project }) => {
        if (!q) return false;
        const id = identifier(project, item.number).toLowerCase();
        if (parsed)
          return project?.key === parsed.key && item.number === parsed.number;
        return id.includes(q) || item.title.toLowerCase().includes(q);
      })
      .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt))
      .slice(0, 12)
      .map<Item>(({ item, project }) => ({
        id: item.id,
        label: item.title,
        hint: identifier(project, item.number),
        group: "Items",
        icon: <TypeIcon type={typeOf(delivery, item)} />,
        run: () =>
          go(
            paths.item(
              org,
              project?.key ?? "",
              segmentOf(typeOf(delivery, item)),
              identifier(project, item.number),
            ),
          ),
      }));
    const matchedCommands = commands.filter(
      (c) => !q || c.label.toLowerCase().includes(q) || c.keywords?.includes(q),
    );
    return [...matchedItems, ...(q ? matchedCommands : commands.slice(0, 8))];
  }, [items, q, parsed, commands, projectOf, go, org, delivery]);
  const [lastQuery, setLastQuery] = useState(q);
  if (lastQuery !== q) {
    setLastQuery(q);
    setActive(0);
  }
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-active]")
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const groups = [...new Set(results.map((r) => r.group))];
  const run = (entry?: Item) => {
    if (!entry) return;
    track("command_palette_result_selected", {
      organization_id: organization.id,
      result_group: entry.group,
      has_query: Boolean(query.trim()),
      result_count: results.length,
    });
    entry.run();
  };
  let index = -1;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[14vh] pb-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => Math.min(results.length - 1, a + 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(0, a - 1));
        }
        if (e.key === "Enter") {
          e.preventDefault();
          run(results[active]);
        }
      }}
    >
      <button
        aria-label="Close"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-popover shadow-(--shadow-panel)"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items by ID or title, or type a command…"
            aria-label="Search"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <Kbd>esc</Kbd>
        </div>
        <div
          ref={listRef}
          role="listbox"
          className="min-h-0 overflow-y-auto p-1.5"
        >
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No results.
            </p>
          )}
          {groups.map((group) => (
            <div key={group}>
              <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
                {group}
              </p>
              {results
                .filter((r) => r.group === group)
                .map((r) => {
                  index++;
                  const i = index;
                  return (
                    <button
                      key={r.id}
                      role="option"
                      aria-selected={i === active}
                      data-active={i === active || undefined}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => run(r)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]",
                        i === active && "bg-muted",
                      )}
                    >
                      <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
                        {r.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {r.hint && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {r.hint}
                        </span>
                      )}
                      {i === active && (
                        <ArrowRight className="size-3.5 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
