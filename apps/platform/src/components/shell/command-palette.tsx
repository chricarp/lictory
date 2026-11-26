import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/react/command";
import { Dialog, DialogBackdrop, DialogContent } from "@ui-sdk/react/dialog";
import { usePathname, useRouter } from "@lictory/platform/lib/navigation";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Bot,
  BookOpen,
  BookOpenCheck,
  FilePlus,
  FileText,
  FolderKanban,
  KanbanSquare,
  Library,
  Lightbulb,
  ListOrdered,
  Monitor,
  Moon,
  Search,
  Send,
  Settings,
  Settings2,
  Sun,
  UserRound,
} from "lucide-react";
import type { Appearance } from "@lictory/core/lib/appearance";
import { spaceLevelAtLeast } from "@lictory/core/contracts/protocol";
import { toast } from "@lictory/ui/toast";
import { dialogBackdropClass, dialogPanelClass } from "@lictory/ui/dialog";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { popupContainer } from "@lictory/ui/popup";
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
import { OrganizationMark } from "@lictory/platform/components/workspace/organization-logo";
import { useAppearance } from "@lictory/platform/components/app/appearance-provider";
import { saveAppearance } from "@lictory/platform/lib/appearance-save";
import {
  navSections,
  paletteProviders,
  type PaletteEntry,
} from "@lictory/platform/components/shell/nav-registry";
import { StatusIcon } from "@lictory/platform/components/items/status";
import { TypeIcon, storyGlyph } from "@lictory/platform/components/items/icons";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useShell } from "@lictory/platform/components/workspace/shell";
import { useAgents } from "@lictory/platform/components/claims/claims";
import { startableAgents } from "@lictory/platform/components/factory/start-session";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import { organizationSettingsSections } from "@lictory/platform/components/settings/organization-sections";
import { useDock } from "@lictory/platform/components/intelligence/dock/store";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import { SpaceIcon } from "@lictory/platform/components/spaces/space-meta";
import {
  Highlighted,
  MIN_CONTENT_QUERY,
  StaleNotice,
  useContentSearch,
} from "@lictory/platform/components/workspace/content-search";
import type { KnowledgeResult } from "@lictory/core/capabilities/product-knowledge";

type Item = {
  id: string;
  label: string;
  // Right-aligned detail in words: a space, "approved r1", an agent.
  hint?: string;
  // A key before the hint, in mono: "PAY-5".
  identifier?: string;
  // A state, as a `StatusChip`.
  chip?: ReactNode;
  icon?: ReactNode;
  group: string;
  keywords?: string;
  // Content results: the title with its matches marked and an excerpt
  // around the match, on a second line.
  title?: ReactNode;
  excerpt?: ReactNode;
  run: () => void;
};

const contentGroups = {
  page: "In pages",
  item: "In specifications",
  approved: "In specifications",
  delivered: "In specifications",
  decision: "Decisions",
} as const;

// Before typing: what I can do with the open item, a few ways to create,
// then the modules.
function suggested(commands: Item[]) {
  const current = commands.filter((c) => c.group === "Current item");
  const create = commands
    .filter((c) => c.group === "Create")
    .sort(
      (a, b) =>
        Number(b.id === "new-proposal") - Number(a.id === "new-proposal"),
    )
    .slice(0, 3);
  const navigate = commands.filter((c) => c.id.startsWith("nav-"));
  return [...current.slice(0, 4), ...create, ...navigate];
}

const navKeywords: Record<string, string> = {
  home: "home dashboard overview start waiting",
  inbox: "inbox notifications updates to do reviews",
  channels: "channels chat messages conversations team",
  "direct-messages": "direct messages dm chat people",
  factory: "factory agents sessions runners automation",
  code: "code repositories pull requests branches checks github gitlab bitbucket",
  spaces: "spaces pages knowledge handbook docs wiki",
};

const appearanceLabels: Record<Appearance, string> = {
  light: "Switch to light appearance",
  dark: "Switch to dark appearance",
  system: "Match the system appearance",
};

const versionLabel = (r: KnowledgeResult) =>
  r.kind === "page"
    ? `v${r.version}`
    : r.kind === "approved"
      ? `approved r${r.revisionNumber}`
      : r.kind === "delivered"
        ? `delivered r${r.revisionNumber}`
        : r.kind === "item" && r.revisionNumber
          ? `r${r.revisionNumber}`
          : null;

// Search and commands in one place. Items are matched by identifier and title
// from the local store; commands depend on where the user currently is.
// What pages, specifications and decisions say comes from the server
// (searchKnowledge) a moment later, below the instant title matches.
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
  const { spaces, index: spaceIndex, openCreateSpace, levelOf } = useSpaces();
  const { appearance, setAppearance } = useAppearance();
  // The dock is absent on the Intelligence page itself.
  const pathname = usePathname();
  const dockStore = useDock();
  const dock = pathname.startsWith(paths.intelligence(organization.slug))
    ? null
    : dockStore;
  const aiOn = directory.ai.available && directory.ai.enabled;
  const agents = useAgents();
  const canStartAgent = startableAgents(agents.values(), userId).length > 0;
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  // Opened by a tap, the dialog would keep focus on itself to hold back the
  // on-screen keyboard; search is ready to type on a phone too.
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
    // The Factory's start dialog, with this item filled in.
    if (
      currentItem &&
      currentProject?.deliveryMode === "native" &&
      !currentItem.archivedAt &&
      canStartAgent
    )
      list.push({
        id: "start-agent",
        label: `Start agent on ${identifier(currentProject, currentItem.number)}`,
        group: "Current item",
        icon: <Bot className="size-4" />,
        keywords: "agent session factory implement run",
        run: () => go(`${factoryPaths.overview(org)}?start=${currentItem.id}`),
      });
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
        id: "settings",
        label: "Organization settings",
        group: "Navigate",
        icon: <Settings className="size-4" />,
        keywords: "settings members projects types integrations",
        run: () => go(paths.settings(org)),
      },
      {
        id: "account-settings",
        label: "Account settings",
        group: "Navigate",
        icon: <UserRound className="size-4" />,
        keywords: "profile password security two-factor appearance theme",
        run: () => go(paths.account(pathname)),
      },
      {
        id: "notification-settings",
        label: "Notification settings",
        group: "Navigate",
        icon: <Bell className="size-4" />,
        keywords: "email notifications digest inbox",
        run: () => go(paths.notificationSettings(org)),
      },
    );
    // Each section of organization settings and of the Factory, so "audit",
    // "runners" or "code hosts" lands on the page, not on its parent.
    for (const section of organizationSettingsSections)
      list.push({
        id: `settings-${section.id}`,
        label: `Organization settings · ${section.label}`,
        group: "Navigate",
        icon: <Settings className="size-4" />,
        keywords: `settings ${section.keywords}`,
        run: () => go(paths.settings(org, section.id)),
      });
    for (const [id, label, keywords, href] of [
      ["agents", "Agents", "agents harness owner scope", factoryPaths.agents],
      [
        "runners",
        "Runners",
        "runners machines register install",
        factoryPaths.runners,
      ],
      [
        "sessions",
        "Sessions",
        "sessions runs agent history",
        factoryPaths.sessions,
      ],
    ] as const)
      list.push({
        id: `factory-${id}`,
        label: `Factory · ${label}`,
        group: "Navigate",
        icon: <Bot className="size-4" />,
        keywords: `factory ${keywords}`,
        run: () => go(href(org)),
      });
    // Every module in the sidebar, by name.
    for (const section of navSections) {
      if (section.id === "projects") continue;
      const Icon = section.icon;
      list.push({
        id: `nav-${section.id}`,
        label: `Go to ${section.label}`,
        group: "Navigate",
        icon: <Icon className="size-4" />,
        keywords: navKeywords[section.id],
        run: () => go(section.href(org)),
      });
    }
    // A proposal in the project in context, when I may write one.
    if (
      currentProject &&
      capabilities.editSpecifications &&
      enabledTypes(delivery, currentProject.id).some((t) => t.hasSpecification)
    )
      list.push({
        id: "new-proposal",
        label: "New proposal",
        identifier: currentProject.key,
        group: "Create",
        icon: <Lightbulb className="size-4" />,
        keywords: "create proposal idea feature specification",
        run: () => {
          onClose();
          openCreate({ intent: "proposal", projectId: currentProject.id });
        },
      });
    // A page in a space I may edit: the space opens with its new page dialog.
    for (const space of spaces)
      if (!space.archivedAt && spaceLevelAtLeast(levelOf(space.id), "edit"))
        list.push({
          id: `new-page-${space.id}`,
          label: `New page in ${space.name}`,
          group: "Create",
          icon: <FilePlus className="size-4" />,
          keywords: "create page document doc wiki write",
          run: () => go(`${paths.space(org, space.slug)}?new=page`),
        });
    for (const mode of ["light", "dark", "system"] as const)
      if (mode !== appearance)
        list.push({
          id: `appearance-${mode}`,
          label: appearanceLabels[mode],
          group: "Preferences",
          icon:
            mode === "light" ? (
              <Sun className="size-4" />
            ) : mode === "dark" ? (
              <Moon className="size-4" />
            ) : (
              <Monitor className="size-4" />
            ),
          keywords: "theme appearance mode dark light system colors",
          run: () => {
            onClose();
            const previous = appearance;
            setAppearance(mode);
            void saveAppearance({ appearance: mode }).then((failed) => {
              if (!failed) return;
              setAppearance(previous);
              toast({ title: failed, type: "error" });
            });
          },
        });
    for (const other of directory.organizations)
      if (other.id !== organization.id)
        list.push({
          id: `organization-${other.id}`,
          label: `Switch to ${other.name}`,
          group: "Organizations",
          icon: <OrganizationMark organization={other} className="size-4" />,
          keywords: "organization workspace switch company",
          run: () => go(paths.org(other.slug)),
        });
    for (const p of projects)
      list.push({
        id: `project-${p.id}`,
        label: p.name,
        identifier: p.key,
        group: "Projects",
        icon: <FolderKanban className="size-4" />,
        keywords: `project open ${p.key.toLowerCase()}`,
        run: () => go(paths.project(org, p.key)),
      });
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
          {
            id: `queue-${p.id}`,
            label: `${p.name} · Factory queue`,
            group: "Navigate",
            icon: <Bot className="size-4" />,
            keywords: "agents claims claimable autonomy dispatch",
            run: () => go(paths.factoryQueue(org, p.key)),
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
    canStartAgent,
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
    levelOf,
    appearance,
    setAppearance,
    directory.organizations,
    organization.id,
    pathname,
  ]);
  const q = query.trim().toLowerCase();
  const parsed = parseIdentifier(query);
  const content = useContentSearch(userId, organization.id, query, !parsed);
  const matched = useMemo(() => {
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
        identifier: identifier(project, item.number),
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
    // What the content says, from the server. Titles already listed above
    // are not repeated.
    const shown = new Set([
      ...matchedItems.map((i) => i.id),
      ...matchedPages.map((p) => p.id),
    ]);
    const local = new Map(items.map((i) => [i.id, i]));
    const fromContent: Item[] = [];
    for (const group of new Set(Object.values(contentGroups)))
      for (const r of content.results) {
        if (contentGroups[r.kind] !== group) continue;
        const localId = r.kind === "page" ? `page-${r.id}` : r.id;
        if (r.kind === "item" && r.matched === "title" && shown.has(localId))
          continue;
        if (r.kind === "page" && r.matched === "title" && shown.has(localId))
          continue;
        const version = versionLabel(r);
        const known = "workItemId" in r ? local.get(r.workItemId) : undefined;
        fromContent.push({
          id: `content-${r.kind}-${r.id}`,
          label: r.title,
          title: <Highlighted text={r.title} highlights={r.titleHighlights} />,
          hint:
            r.kind === "page"
              ? [r.space.name, version].filter(Boolean).join(" · ")
              : (version ?? undefined),
          identifier: r.kind === "page" ? undefined : r.key,
          excerpt: r.snippet.text ? (
            <Highlighted
              text={r.snippet.text}
              highlights={r.snippet.highlights}
            />
          ) : undefined,
          group,
          icon:
            r.kind === "page" ? (
              <FileText className="size-4" />
            ) : r.kind === "decision" ? (
              <BookOpen className="size-4" />
            ) : r.kind === "approved" || r.kind === "delivered" ? (
              <BadgeCheck className="size-4" />
            ) : known ? (
              <TypeIcon type={typeOf(delivery, known)} />
            ) : (
              <TypeIcon type={storyGlyph} />
            ),
          run: () => go(r.href),
        });
      }
    const matchedCommands = commands.filter(
      (c) => !q || c.label.toLowerCase().includes(q) || c.keywords?.includes(q),
    );
    // A command whose name has a word starting with what was typed ("dark",
    // "home") is what the person is asking for: it leads the content search.
    const named = (c: Item) =>
      c.label
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .some((word) => word.startsWith(q));
    const namedCommands = q ? matchedCommands.filter(named) : [];
    const otherCommands = q
      ? matchedCommands.filter((c) => !named(c))
      : suggested(commands);
    // Everything the content says, beyond the first few, with filters.
    const seeAll: Item[] =
      !parsed && query.trim().length >= MIN_CONTENT_QUERY
        ? [
            {
              id: "see-all-results",
              label: `See all results for “${query.trim()}”`,
              group: "Search",
              icon: <Search className="size-4" />,
              run: () => go(paths.search(org, { q: query.trim() })),
            },
          ]
        : [];
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
    return {
      titles: [...matchedItems, ...matchedPages],
      rest: [
        ...namedCommands,
        ...fromContent,
        ...seeAll,
        ...otherCommands,
        ...ask,
      ],
    };
  }, [
    items,
    q,
    query,
    parsed,
    content.results,
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
  // Results modules register (channels, agents), matched like commands.
  const provided: { group: string; entries: readonly PaletteEntry[] }[] = [];
  for (const provider of paletteProviders)
    provided.push({
      group: provider.group,
      entries: provider.useEntries(query.trim()),
    });
  const fromProviders: Item[] = parsed
    ? []
    : provided.flatMap(({ group, entries }) =>
        entries
          .filter(
            (e) =>
              !q ||
              e.label.toLowerCase().includes(q) ||
              e.keywords?.toLowerCase().includes(q),
          )
          .slice(0, q ? 5 : 3)
          .map<Item>((e) => ({
            id: `provider-${group}-${e.id}`,
            label: e.label,
            hint: e.hint,
            chip: e.chip,
            icon: e.icon,
            group,
            run: () => {
              if (e.href !== undefined) return go(e.href);
              onClose();
              e.run();
            },
          })),
      );
  const results = [...matched.titles, ...fromProviders, ...matched.rest];
  // The highlight follows the first result, also as content results arrive
  // above it, until the person moves it. Typing starts over.
  const [moved, setMoved] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState(q);
  if (lastQuery !== q) {
    setLastQuery(q);
    setMoved(null);
  }
  const highlighted =
    (moved !== null && results.some((r) => r.id === moved)
      ? moved
      : results[0]?.id) ?? null;
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      container={popupContainer()}
    >
      <DialogBackdrop className={dialogBackdropClass} />
      <DialogContent
        aria-label="Command palette"
        initialFocus={() => inputRef.current}
        className={cn(
          dialogPanelClass,
          "top-[14vh] max-h-[calc(100dvh-14vh-1rem)] max-w-lg gap-0",
        )}
      >
        <Command
          // Results are matched and ordered here, and by the server.
          filter={false}
          loop={false}
          status={content.status === "loading" ? "loading" : "idle"}
          // The footer below is the palette's one live region.
          announcement={() => null}
          value={highlighted}
          onValueChange={(id, details) => {
            if (
              details.reason === "list-navigation" ||
              details.reason === "item-hover"
            )
              setMoved(id);
          }}
          query={query}
          onQueryChange={(next) => setQuery(next)}
          onAction={(id) => run(results.find((r) => r.id === id))}
          className="flex min-h-0 w-full flex-1 flex-col rounded-none bg-transparent"
        >
          {/* The field's focus is marked by a 2px line in the focus color
              under it (the field has no ring of its own), and the chosen
              option by a bar at its start, not only its tint. */}
          <div className="flex shrink-0 items-center gap-2 border-b px-3 focus-within:shadow-[inset_0_-2px_0_0_var(--ring)]">
            <CommandInput
              ref={inputRef}
              placeholder="Search items, pages or commands…"
              aria-label="Search"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-placeholder touch:text-base"
              onKeyDown={(event) => {
                // Escape closes the palette at once; left to the list, the
                // first press would only clear what was typed.
                if (event.key !== "Escape" || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                onClose();
              }}
            />
            <Kbd>esc</Kbd>
          </div>
          {results.length === 0 && content.status !== "loading" && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No results.
            </p>
          )}
          <CommandList className="max-h-none min-h-0 overflow-y-auto p-1.5">
            {groups.map((group) => (
              <CommandGroup key={group}>
                <CommandGroupLabel className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  {group}
                </CommandGroupLabel>
                {results
                  .filter((r) => r.group === group)
                  .map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.id}
                      label={r.label}
                      className={cn(
                        "group flex w-full cursor-default gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] select-none data-highlighted:bg-muted data-highlighted:shadow-[inset_2px_0_0_0_var(--ring)]",
                        r.excerpt ? "items-start" : "items-center",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center text-muted-foreground",
                          r.excerpt && "mt-0.5",
                        )}
                      >
                        {r.icon}
                      </span>
                      {r.excerpt ? (
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate">
                              {r.title ?? r.label}
                            </span>
                            <Detail item={r} excerpt />
                          </span>
                          <span className="mt-0.5 line-clamp-2 text-[12px] leading-[1.45] text-muted-foreground">
                            {r.excerpt}
                          </span>
                        </span>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate">
                            {r.title ?? r.label}
                          </span>
                          <Detail item={r} />
                        </>
                      )}
                      <ArrowRight
                        aria-hidden
                        className={cn(
                          "hidden size-3.5 shrink-0 text-muted-foreground group-data-highlighted:block",
                          r.excerpt && "mt-0.5",
                        )}
                      />
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
          {/* Content results arrive after the instant title matches. */}
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "flex shrink-0 flex-wrap items-center gap-x-1.5 border-t px-3 py-1.5 text-[11.5px] text-muted-foreground",
              content.status !== "loading" &&
                content.status !== "error" &&
                !(content.status === "done" && content.stale) &&
                "sr-only",
            )}
          >
            <span
              className={cn(
                content.status === "done" && content.stale && "sr-only",
              )}
            >
              {content.status === "loading"
                ? "Searching pages, specifications and decisions…"
                : content.status === "error"
                  ? `Could not search content: ${content.error}`
                  : content.status === "done"
                    ? content.results.length
                      ? `${content.results.length} content ${content.results.length === 1 ? "match" : "matches"}`
                      : "No matches in pages, specifications or decisions"
                    : ""}
            </span>
            {content.status === "done" && content.stale && (
              <StaleNotice
                checkedAt={content.stale.checkedAt}
                onRetry={() => {
                  content.stale?.retry();
                  // Typing and the arrow keys keep working.
                  inputRef.current?.focus();
                }}
              />
            )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// What follows a result's title: its key in mono, then words in the
// interface's sans (a space, "approved r1", an agent), then its state.
function Detail({ item, excerpt = false }: { item: Item; excerpt?: boolean }) {
  if (!item.identifier && !item.hint && !item.chip) return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground",
        excerpt && "max-w-[45%]",
      )}
    >
      {/* The option's name is its text: without a pause the title and the
          key are read as one word ("Refund reasonsPAY-11"). */}
      <span className="sr-only">, </span>
      {item.identifier && (
        <span className="shrink-0 font-mono text-[11px]">
          {item.identifier}
        </span>
      )}
      {item.identifier && item.hint && <span aria-hidden>·</span>}
      {item.hint && <span className="min-w-0 truncate">{item.hint}</span>}
      {item.chip}
    </span>
  );
}
