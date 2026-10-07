"use client";
import { LoadingState } from "~/components/ui/spinner";
import Link from "next/link";
import { paths } from "~/lib/paths";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readListState, writeListState } from "~/lib/list-params";
import { ArrowUpDown, Filter, Plus, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { track } from "~/lib/analytics/client";
import {
  applyFilters,
  formatDate,
  identifier,
  type Label,
  type Milestone,
  priorityMeta,
  priorityOrder,
  sortItems,
  categoryMeta,
  categoryOrder,
  categoryOf,
  isTopLevel,
  refinementMeta,
  refinementOrder,
  typeOf,
  type Filters,
  type Project,
  type SortKey,
} from "~/lib/work-items";
import type {
  StatusCategory,
  WorkItem,
  WorkItemType,
} from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Popover, Picker } from "~/components/ui/popover";
import { PeoplePicker } from "~/components/ui/people-picker";
import { EmptyState, Kbd } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { useShell } from "~/components/workspace/shell";
import { IssueRow } from "./issue-row";
import { RefinementIcon, StatusIcon } from "./status";
import { TypeIcon } from "./icons";
import { PriorityIcon } from "./properties";
import { ColorDot } from "./labels";

export function IssueList({
  items,
  project,
  hrefFor,
  selectedId,
  compact = false,
  title,
  description,
  emptyTitle = "No items",
  emptyBody,
  createKind,
  showArchivedToggle = true,
  allowEpicFilter = true,
  header,
}: {
  items: WorkItem[];
  project: Project | undefined;
  hrefFor: (item: WorkItem) => string;
  selectedId?: string;
  compact?: boolean;
  title: string;
  description?: string;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  createKind?: "epic" | "story";
  showArchivedToggle?: boolean;
  allowEpicFilter?: boolean;
  header?: ReactNode;
}) {
  const {
    items: allItems,
    organization,
    projects,
    memberName,
    mutate,
    view,
    labels: allLabels,
    milestones: allMilestones,
    capabilities,
    delivery,
    isAdmin,
    directory,
  } = useWorkspace();
  const { openCreate } = useShell();
  const canCreate = capabilities.editSpecifications;
  const router = useRouter();
  // Filters, sort, grouping and the archived toggle are URL state.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const defaultGroup = !compact;
  const state = useMemo(
    () => readListState(searchParams, defaultGroup),
    [searchParams, defaultGroup],
  );
  const { filters, sort, group, archived: showArchived } = state;
  const commit = useCallback(
    (next: Partial<typeof state>) => {
      track("work_item_list_configured", {
        organization_id: organization.id,
        project_id: project?.id ?? null,
        changed_controls: Object.keys(next),
        ...(next.filters
          ? {
              filter_names: Object.keys(next.filters).filter((key) =>
                Boolean(next.filters?.[key as keyof Filters]),
              ),
              has_search: Boolean(next.filters.search),
            }
          : {}),
        ...(next.sort ? { sort: next.sort } : {}),
        ...(next.group !== undefined ? { grouped: next.group } : {}),
        ...(next.archived !== undefined
          ? { show_archived: next.archived }
          : {}),
      });
      const params = writeListState(
        searchParams,
        { ...state, ...next },
        defaultGroup,
      );
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [
      searchParams,
      state,
      defaultGroup,
      router,
      pathname,
      organization.id,
      project?.id,
    ],
  );
  const setFilters = (fn: (f: Filters) => Filters) =>
    commit({ filters: fn(filters) });
  const setSort = (value: SortKey) => commit({ sort: value });
  const setGroup = (value: boolean) => commit({ group: value });
  const setShowArchived = (value: boolean) => commit({ archived: value });
  // Search is typed locally and written to the URL after a short pause.
  const [search, setSearch] = useState(filters.search ?? "");
  const [urlSearch, setUrlSearch] = useState(filters.search ?? "");
  if (urlSearch !== (filters.search ?? "")) {
    setUrlSearch(filters.search ?? "");
    setSearch(filters.search ?? "");
  }
  useEffect(() => {
    if (search === (filters.search ?? "")) return;
    const timer = setTimeout(
      () => setFilters((f) => ({ ...f, search: search || undefined })),
      250,
    );
    return () => clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const [focus, setFocus] = useState<string | undefined>(selectedId);
  const listRef = useRef<HTMLUListElement>(null);
  const visible = useMemo(() => {
    const scoped = items.filter((i) => showArchived || !i.archivedAt);
    return sortItems(
      applyFilters(scoped, { ...filters, search }, projects, delivery),
      sort,
      delivery,
    );
  }, [items, filters, search, sort, projects, showArchived, delivery]);
  // Grouping uses status categories: items of several teams share them even
  // when their workflows differ.
  const groups = useMemo(() => {
    if (!group)
      return [
        { status: undefined as StatusCategory | undefined, items: visible },
      ];
    return categoryOrder
      .map((status) => ({
        status,
        items: visible.filter((i) => categoryOf(delivery, i) === status),
      }))
      .filter((g) => g.items.length);
  }, [group, visible, delivery]);
  const order = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [lastSelected, setLastSelected] = useState(selectedId);
  if (lastSelected !== selectedId) {
    setLastSelected(selectedId);
    if (selectedId) setFocus(selectedId);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const index = order.findIndex((i) => i.id === focus);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = order[Math.min(order.length - 1, index + 1)];
        if (next) setFocus(next.id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const prev = order[Math.max(0, index - 1)];
        if (prev) setFocus(prev.id);
      } else if ((event.key === "Enter" || event.key === "o") && focus) {
        const item = order.find((i) => i.id === focus);
        if (item) {
          event.preventDefault();
          router.push(hrefFor(item));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, focus, hrefFor, router]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-focused]")
      ?.scrollIntoView({ block: "nearest" });
  }, [focus]);
  const update = (
    item: WorkItem,
    patch: Parameters<
      NonNullable<Parameters<typeof IssueRow>[0]["onUpdate"]>
    >[0],
  ) => void mutate({ type: "updateWorkItem", workItemId: item.id, ...patch });
  const activeFilterCount =
    (filters.status?.length ? 1 : 0) +
    (filters.refinement?.length ? 1 : 0) +
    (filters.type?.length ? 1 : 0) +
    (filters.priority?.length ? 1 : 0) +
    (filters.assignee?.length ? 1 : 0) +
    (filters.parent?.length ? 1 : 0) +
    (filters.label?.length ? 1 : 0) +
    (filters.milestone?.length ? 1 : 0) +
    (filters.blocked ? 1 : 0) +
    (filters.needsReview ? 1 : 0);
  const epics = allItems.filter(
    (i) =>
      isTopLevel(typeOf(delivery, i)) &&
      i.projectId === project?.id &&
      !i.archivedAt,
  );
  const types = [...delivery.types.values()].filter(
    (t) => !t.archivedAt && items.some((i) => i.typeId === t.id),
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        <span className="text-xs text-muted-foreground tabular-nums">
          {visible.length}
        </span>
        {header}
        <div className="ml-auto flex items-center gap-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter by title or identifier"
            className={cn(
              "h-7 rounded-md bg-muted/70 px-2 text-xs outline-none placeholder:text-muted-foreground/70 focus:bg-muted",
              compact ? "w-24" : "w-32",
            )}
          />
          <Popover
            width={280}
            align="end"
            trigger={(props) => (
              <Button {...props} variant="ghost" size="sm" aria-label="Filters">
                <Filter className="size-3.5" />
                {!compact && "Filter"}
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            )}
          >
            <FilterPanel
              filters={filters}
              setFilters={setFilters}
              epics={allowEpicFilter ? epics : []}
              types={types}
              project={project}
              labels={allLabels.filter(
                (l) => l.projectId === project?.id && !l.archivedAt,
              )}
              milestones={allMilestones.filter(
                (m) => m.projectId === project?.id && !m.archivedAt,
              )}
            />
          </Popover>
          <Popover
            width={200}
            align="end"
            trigger={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="sm"
                aria-label="Sort and group"
              >
                <ArrowUpDown className="size-3.5" />
              </Button>
            )}
          >
            <div className="p-1">
              <p className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
                Sort by
              </p>
              {(
                [
                  "updated",
                  "created",
                  "priority",
                  "status",
                  "number",
                ] as SortKey[]
              ).map((key) => (
                <button
                  key={key}
                  onClick={() => setSort(key)}
                  className={cn(
                    "flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                    sort === key && "font-medium text-primary",
                  )}
                >
                  {
                    {
                      updated: "Last updated",
                      created: "Created",
                      priority: "Priority",
                      status: "Status",
                      number: "Identifier",
                    }[key]
                  }
                </button>
              ))}
              <div className="my-1 border-t" />
              <label className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={group}
                  onChange={(e) => setGroup(e.target.checked)}
                />{" "}
                Group by status
              </label>
              {showArchivedToggle && (
                <label className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />{" "}
                  Show archived
                </label>
              )}
            </div>
          </Popover>
          {createKind && project && canCreate && (
            <Button
              size="sm"
              onClick={() =>
                openCreate({ kind: createKind, projectId: project.id })
              }
              aria-label={`New ${createKind}`}
            >
              <Plus className="size-3.5" />
              {!compact && (createKind === "epic" ? "New Epic" : "New item")}
            </Button>
          )}
        </div>
      </header>
      {description && !compact && (
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5 text-xs">
          {filters.status?.map((s) => (
            <Chip
              key={s}
              onRemove={() =>
                setFilters((f) => ({
                  ...f,
                  status: f.status?.filter((x) => x !== s),
                }))
              }
            >
              <StatusIcon category={s} /> {categoryMeta[s].label}
            </Chip>
          ))}
          {filters.refinement?.map((r) => (
            <Chip
              key={r}
              onRemove={() =>
                setFilters((f) => ({
                  ...f,
                  refinement: f.refinement?.filter((x) => x !== r),
                }))
              }
            >
              <RefinementIcon state={r} /> {refinementMeta[r].label}
            </Chip>
          ))}
          {filters.type?.map((t) => (
            <Chip
              key={t}
              onRemove={() =>
                setFilters((f) => ({
                  ...f,
                  type: f.type?.filter((x) => x !== t),
                }))
              }
            >
              {delivery.types.get(t)?.name ?? "Type"}
            </Chip>
          ))}
          {filters.priority?.map((p) => (
            <Chip
              key={p}
              onRemove={() =>
                setFilters((f) => ({
                  ...f,
                  priority: f.priority?.filter((x) => x !== p),
                }))
              }
            >
              <PriorityIcon priority={p} /> {priorityMeta[p].label}
            </Chip>
          ))}
          {filters.assignee?.map((a) => (
            <Chip
              key={a}
              onRemove={() =>
                setFilters((f) => ({
                  ...f,
                  assignee: f.assignee?.filter((x) => x !== a),
                }))
              }
            >
              {a === "unassigned" ? "Unassigned" : memberName(a)}
            </Chip>
          ))}
          {filters.parent?.map((p) => (
            <Chip
              key={p}
              onRemove={() =>
                setFilters((f) => ({
                  ...f,
                  parent: f.parent?.filter((x) => x !== p),
                }))
              }
            >
              {p === "none"
                ? "No epic"
                : identifier(
                    project,
                    epics.find((e) => e.id === p)?.number ?? 0,
                  )}
            </Chip>
          ))}
          {filters.label?.map((l) => (
            <Chip
              key={l}
              onRemove={() =>
                setFilters((f) => ({
                  ...f,
                  label: f.label?.filter((x) => x !== l),
                }))
              }
            >
              {allLabels.find((x) => x.id === l)?.name ?? "Label"}
            </Chip>
          ))}
          {filters.milestone?.map((m) => (
            <Chip
              key={m}
              onRemove={() =>
                setFilters((f) => ({
                  ...f,
                  milestone: f.milestone?.filter((x) => x !== m),
                }))
              }
            >
              {m === "none"
                ? "No milestone"
                : (allMilestones.find((x) => x.id === m)?.name ?? "Milestone")}
            </Chip>
          ))}
          {filters.blocked && (
            <Chip
              onRemove={() => setFilters((f) => ({ ...f, blocked: false }))}
            >
              Blocked
            </Chip>
          )}
          {filters.needsReview && (
            <Chip
              onRemove={() => setFilters((f) => ({ ...f, needsReview: false }))}
            >
              Needs review
            </Chip>
          )}
          <button
            onClick={() => setFilters((f) => ({ search: f.search }))}
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.status === "hydrating" && items.length === 0 ? (
          <LoadingState label="Opening work items" />
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              activeFilterCount || filters.search
                ? "No matching items"
                : emptyTitle
            }
            action={
              createKind &&
              project &&
              canCreate &&
              !activeFilterCount &&
              !filters.search ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    openCreate({ kind: createKind, projectId: project.id })
                  }
                >
                  <Plus className="size-3.5" /> Create{" "}
                  {createKind === "epic" ? "an Epic" : "a work item"}{" "}
                  <Kbd>C</Kbd>
                </Button>
              ) : undefined
            }
          >
            {activeFilterCount || filters.search
              ? "Adjust the filters to see more."
              : emptyBody}
            {!activeFilterCount &&
              !filters.search &&
              !compact &&
              createKind === "epic" &&
              project &&
              !allItems.some((i) => i.projectId === project.id) &&
              isAdmin && (
                <span className="mt-5 block text-left text-xs leading-relaxed">
                  <span className="block font-medium text-foreground">
                    Your next steps
                  </span>
                  <span className="mt-2 block">
                    Start with a rough proposal. It doesn’t need to be complete;
                    review is where it gets sharp.
                  </span>
                  {directory.members.length === 1 && (
                    <Link
                      href={`${paths.settings(organization.slug)}#people`}
                      className="mt-3 block text-primary hover:underline"
                    >
                      Invite teammates and assign their roles →
                    </Link>
                  )}
                  {delivery.teams.get(project.defaultTeamId ?? "")
                    ?.deliveryMode === "external" &&
                    !directory.delivery.targets.length && (
                      <Link
                        href={`${paths.settings(organization.slug)}#jira`}
                        className="mt-3 block text-primary hover:underline"
                      >
                        Connect Jira to export ready work →
                      </Link>
                    )}
                  <Link
                    href={paths.teamSettings(
                      organization.slug,
                      project.defaultTeamId ?? "",
                    )}
                    className="mt-3 block text-primary hover:underline"
                  >
                    Revisit your team’s delivery choices →
                  </Link>
                </span>
              )}
          </EmptyState>
        ) : (
          <ul ref={listRef}>
            {groups.map((g) => (
              <li key={g.status ?? "all"}>
                {g.status && (
                  <div className="sticky top-0 z-1 flex h-8 items-center gap-2 border-b bg-muted/40 px-3 text-xs font-medium backdrop-blur">
                    <StatusIcon category={g.status} />
                    {categoryMeta[g.status].label}
                    <span className="text-muted-foreground tabular-nums">
                      {g.items.length}
                    </span>
                  </div>
                )}
                <ul>
                  {g.items.map((item) => (
                    <IssueRow
                      key={item.id}
                      item={item}
                      project={project}
                      parent={
                        item.parentId
                          ? allItems.find((i) => i.id === item.parentId)
                          : undefined
                      }
                      labels={allLabels.filter((l) =>
                        item.labelIds.includes(l.id),
                      )}
                      milestone={
                        item.milestoneId
                          ? allMilestones.find((m) => m.id === item.milestoneId)
                          : undefined
                      }
                      href={hrefFor(item)}
                      selected={item.id === selectedId}
                      focused={item.id === focus}
                      compact={compact}
                      memberName={memberName}
                      onUpdate={
                        capabilities.changeProperties
                          ? (patch) => update(item, patch)
                          : undefined
                      }
                      onFocus={() => setFocus(item.id)}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Chip({
  children,
  onRemove,
}: {
  children: ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md bg-muted px-1.5">
      {children}
      <button
        onClick={onRemove}
        aria-label="Remove filter"
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function FilterPanel({
  filters,
  setFilters,
  epics,
  types,
  project,
  labels,
  milestones,
}: {
  filters: Filters;
  setFilters: (fn: (f: Filters) => Filters) => void;
  epics: WorkItem[];
  types: WorkItemType[];
  project: Project | undefined;
  labels: Label[];
  milestones: Milestone[];
}) {
  type Section =
    | "status"
    | "refinement"
    | "type"
    | "priority"
    | "assignee"
    | "parent"
    | "label"
    | "milestone";
  const [section, setSection] = useState<"menu" | Section>("menu");
  const toggle = (key: Section, value: string) =>
    setFilters((f) => {
      const current: string[] = f[key] ?? [];
      const next = current.includes(value)
        ? current.filter((x) => x !== value)
        : [...current, value];
      return { ...f, [key]: next };
    });
  if (section === "status")
    return (
      <Picker
        multiple
        title="Status"
        options={categoryOrder.map((s) => ({
          value: s,
          label: categoryMeta[s].label,
          icon: <StatusIcon category={s} />,
        }))}
        value={filters.status ?? []}
        onSelect={(v) => toggle("status", v)}
      />
    );
  if (section === "refinement")
    return (
      <Picker
        multiple
        title="Refinement"
        options={refinementOrder.map((r) => ({
          value: r,
          label: refinementMeta[r].label,
          icon: <RefinementIcon state={r} />,
        }))}
        value={filters.refinement ?? []}
        onSelect={(v) => toggle("refinement", v)}
      />
    );
  if (section === "type")
    return (
      <Picker
        multiple
        title="Type"
        options={types.map((t) => ({
          value: t.id,
          label: t.name,
          icon: <TypeIcon type={t} />,
        }))}
        value={filters.type ?? []}
        onSelect={(v) => toggle("type", v)}
      />
    );
  if (section === "priority")
    return (
      <Picker
        multiple
        title="Priority"
        options={priorityOrder.map((p) => ({
          value: p,
          label: priorityMeta[p].label,
          icon: <PriorityIcon priority={p} />,
        }))}
        value={filters.priority ?? []}
        onSelect={(v) => toggle("priority", v)}
      />
    );
  if (section === "assignee")
    return (
      <PeoplePicker
        multiple
        title="Assignee"
        none={{ value: "unassigned", label: "Unassigned" }}
        value={filters.assignee ?? []}
        onSelect={(v) => toggle("assignee", v)}
      />
    );
  if (section === "parent")
    return (
      <Picker
        multiple
        title="Epic"
        options={[
          { value: "none", label: "No epic" },
          ...epics.map((e) => ({
            value: e.id,
            label: e.title,
            hint: identifier(project, e.number),
          })),
        ]}
        value={filters.parent ?? []}
        onSelect={(v) => toggle("parent", v)}
      />
    );
  if (section === "label")
    return (
      <Picker
        multiple
        title="Labels"
        options={labels.map((l) => ({
          value: l.id,
          label: l.name,
          icon: <ColorDot color={l.color} />,
        }))}
        value={filters.label ?? []}
        onSelect={(v) => toggle("label", v)}
        emptyText="No labels in this project."
      />
    );
  if (section === "milestone")
    return (
      <Picker
        multiple
        title="Milestone"
        options={[
          { value: "none", label: "No milestone" },
          ...milestones.map((m) => ({
            value: m.id,
            label: m.name,
            hint: m.targetDate ? formatDate(m.targetDate) : undefined,
          })),
        ]}
        value={filters.milestone ?? []}
        onSelect={(v) => toggle("milestone", v)}
      />
    );
  const labelsFor: Record<Section, string> = {
    status: "Status",
    refinement: "Refinement",
    type: "Type",
    priority: "Priority",
    assignee: "Assignee",
    parent: "Epic",
    label: "Labels",
    milestone: "Milestone",
  };
  return (
    <div className="p-1">
      <p className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
        Filter by
      </p>
      {(
        [
          "status",
          "refinement",
          ...(types.length > 1 ? (["type"] as const) : []),
          "priority",
          "assignee",
          ...(epics.length ? (["parent"] as const) : []),
          ...(labels.length ? (["label"] as const) : []),
          ...(milestones.length ? (["milestone"] as const) : []),
        ] as Section[]
      ).map((key) => (
        <button
          key={key}
          onClick={() => setSection(key)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
        >
          <span>{labelsFor[key]}</span>
          {(filters[key]?.length ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">
              {filters[key]!.length}
            </span>
          )}
        </button>
      ))}
      <div className="my-1 border-t" />
      <label className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
        <input
          type="checkbox"
          checked={Boolean(filters.blocked)}
          onChange={(e) =>
            setFilters((f) => ({ ...f, blocked: e.target.checked }))
          }
        />{" "}
        Blocked
      </label>
      <label className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
        <input
          type="checkbox"
          checked={Boolean(filters.needsReview)}
          onChange={(e) =>
            setFilters((f) => ({ ...f, needsReview: e.target.checked }))
          }
        />{" "}
        Review outstanding
      </label>
    </div>
  );
}
