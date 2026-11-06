import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "@lictory/platform/lib/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  FileText,
  Inbox,
  KanbanSquare,
  Library,
  ListOrdered,
  Send,
  Settings,
  Settings2,
  UserRound,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { cn } from "@lictory/core/lib/utils";
import { track } from "@lictory/core/lib/analytics/client";
import { paths } from "@lictory/core/lib/paths";
import {
  activeStatuses,
  identifier,
  enabledTypes,
  parseIdentifier,
  typeOf,
  views,
} from "@lictory/core/lib/work-items";
import { Kbd } from "@lictory/ui/primitives";
import { StatusIcon } from "@lictory/platform/components/items/status";
import { TypeIcon, storyGlyph } from "@lictory/platform/components/items/icons";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useShell } from "@lictory/platform/components/workspace/shell";
import { useDock } from "@lictory/platform/components/intelligence/dock/store";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import { SpaceIcon } from "@lictory/platform/components/spaces/space-meta";

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
    directory,
  } = useWorkspace();
  const { openCreate, currentItem, project: shellProject } = useShell();
  const { spaces, index: spaceIndex, openCreateSpace } = useSpaces();
  // The dock is absent on the Intelligence page itself.
  const pathname = usePathname();
  const dockStore = useDock();
  const dock = pathname.startsWith(paths.intelligence(organization.slug))
    ? null
    : dockStore;
  const aiOn = directory.ai.available && directory.ai.enabled;
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
    if (
      currentItem &&
      currentProject?.deliveryMode === "native" &&
      capabilities.changeProperties
    ) {
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
    // Outside a project the dialog chooses the project and its types.
    if (!currentProject)
      list.push({
        id: "create-item",
        label: "Create item",
        group: "Create",
        icon: <TypeIcon type={storyGlyph} />,
        keywords: "new item proposal task",
        run: () => {
          onClose();
          openCreate({});
        },
      });
    for (const type of currentProject
      ? enabledTypes(delivery, currentProject.id)
      : []) {
      if (
        type.hasSpecification
          ? !capabilities.editSpecifications
          : !(capabilities.editSpecifications || capabilities.changeProperties)
      )
        continue;
      list.push({
        id: `create-${type.id}`,
        label: `Create ${type.name}`,
        group: "Create",
        icon: <TypeIcon type={type} />,
        keywords: "new item proposal task",
        run: () => {
          onClose();
          openCreate({
            intent: type.hasSpecification ? "proposal" : "work",
            typeId: type.id,
            projectId: currentProject?.id,
            parentId:
              currentItem && typeOf(delivery, currentItem).level > type.level
                ? currentItem.id
                : null,
          });
        },
      });
    }
    list.push(
      {
        id: "intelligence",
        // Truthful while Litto is unavailable: the page explains the setup.
        label: aiOn ? "Ask Litto" : "Litto setup",
        group: "Navigate",
        icon: <IntelligenceMark className="size-4" />,
        keywords: "ai assistant chat lictory intelligence",
        run: () => {
          if (!aiOn || !dock) return go(paths.intelligence(org));
          onClose();
          dock.open();
        },
      },
      {
        id: "intelligence-history",
        label: "Litto conversations",
        group: "Navigate",
        icon: <IntelligenceMark className="size-4" />,
        keywords: "ai assistant chat history lictory intelligence",
        run: () => go(paths.intelligence(org)),
      },
      {
        id: "spaces",
        label: "Go to Spaces",
        group: "Navigate",
        icon: <Library className="size-4" />,
        keywords: "spaces pages knowledge handbook docs wiki",
        run: () => go(paths.spaces(org)),
      },
      {
        id: "create-space",
        label: "Create space",
        group: "Create",
        icon: <Library className="size-4" />,
        keywords: "new space pages knowledge handbook docs wiki",
        run: () => {
          onClose();
          openCreateSpace(
            currentProject ? { projectId: currentProject.id } : {},
          );
        },
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
    for (const space of spaces)
      if (!space.archivedAt)
        list.push({
          id: `space-${space.id}`,
          label: `${space.name} · Space`,
          group: "Spaces",
          icon: <SpaceIcon space={space} />,
          keywords: `space pages ${space.slug}`,
          run: () => go(paths.space(org, space.slug)),
        });
    for (const p of projects) {
      list.push(
        {
          id: `proposals-${p.id}`,
          label: `${p.name} · Proposals`,
          group: "Navigate",
          icon: <TypeIcon type={storyGlyph} />,
          keywords: "open project ideas capture",
          run: () => go(paths.proposals(org, p.key)),
        },
        {
          id: `refinement-${p.id}`,
          label: `${p.name} · Refinement`,
          group: "Navigate",
          icon: <BookOpenCheck className="size-4" />,
          run: () => go(paths.refinement(org, p.key)),
        },
        {
          id: `items-${p.id}`,
          label: `${p.name} · All items`,
          group: "Navigate",
          icon: <TypeIcon type={storyGlyph} />,
          run: () => go(paths.items(org, p.key)),
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
        if (!["needs-my-review", "all", "drafts", "ready"].includes(v.id))
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
    aiOn,
    dock,
    spaces,
    openCreateSpace,
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
              identifier(project, item.number),
            ),
          ),
      }));
    // Page titles of readable, active spaces.
    const matchedPages: Item[] = [];
    if (q && !parsed)
      for (const page of spaceIndex.pageById.values()) {
        if (matchedPages.length >= 12) break;
        if (page.archivedAt || !page.title.toLowerCase().includes(q)) continue;
        const space = spaceIndex.spaceById.get(page.spaceId);
        if (!space || space.archivedAt) continue;
        matchedPages.push({
          id: `page-${page.id}`,
          label: page.title,
          hint: space.name,
          group: "Pages",
          icon: <FileText className="size-4" />,
          run: () => go(paths.spacePage(org, space.slug, page.id)),
        });
      }
    const matchedCommands = commands.filter(
      (c) => !q || c.label.toLowerCase().includes(q) || c.keywords?.includes(q),
    );
    // Anything typed can also be a question for Litto.
    const ask: Item[] =
      q && !parsed && aiOn && dock
        ? [
            {
              id: "ask-intelligence",
              label: `Ask Litto: “${query.trim()}”`,
              group: "Litto",
              icon: <IntelligenceMark className="size-4" />,
              run: () => {
                onClose();
                dock.open({ prompt: query.trim(), send: true });
              },
            },
          ]
        : [];
    return [
      ...matchedItems,
      ...matchedPages,
      ...(q ? matchedCommands : commands.slice(0, 8)),
      ...ask,
    ];
  }, [
    items,
    q,
    query,
    parsed,
    commands,
    projectOf,
    go,
    org,
    delivery,
    aiOn,
    dock,
    onClose,
    spaceIndex,
  ]);
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
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape and arrow keys bubble from the search field; the backdrop is not a control.
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
            placeholder="Search items, pages or commands…"
            aria-label="Search"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 touch:text-base"
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
