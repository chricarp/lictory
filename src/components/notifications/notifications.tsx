"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleCheckBig,
  GitPullRequestArrow,
  Mail,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  SquareKanban,
  Upload,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Popover, Picker } from "~/components/ui/popover";
import { Avatar, EmptyState } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import { relativeTime } from "~/lib/work-items";
import {
  categoryLabels,
  notificationCategories,
  notificationKindList,
  notificationKinds,
  type NotificationCategory,
} from "~/notifications/catalog";
import { describeNotification, notificationHref } from "~/notifications/format";
import type { NotificationItem } from "~/notifications/service";
import {
  announceNotificationChange,
  notificationRequest,
  useNotificationSignal,
  type NotificationPage,
} from "./client";

type Status = "unread" | "all" | "archived";
type Filters = {
  status: Status;
  everywhere: boolean;
  projectId: string | null;
  teamId: string | null;
  category: NotificationCategory | null;
};

const categoryIcons: Record<NotificationCategory, typeof Bell> = {
  review: ShieldAlert,
  discussion: MessageSquare,
  suggestions: GitPullRequestArrow,
  delivery: SquareKanban,
  iterations: RefreshCw,
  export: Upload,
};

function kindCategory(kind: string): NotificationCategory | null {
  return (
    (notificationKinds as Record<string, { category: NotificationCategory }>)[
      kind
    ]?.category ?? null
  );
}

// Notifications are a history of events addressed to me, across every
// organization I belong to. The Inbox shows current work; this shows what
// happened, and lets me clear it.
export function NotificationFeed() {
  const { organization, directory, projects, delivery } = useWorkspace();
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({
    status: "unread",
    everywhere: false,
    projectId: null,
    teamId: null,
    category: null,
  });
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const query = useMemo(
    () => ({
      status: filters.status,
      ...(filters.everywhere ? {} : { organizationId: organization.id }),
      ...(!filters.everywhere && filters.projectId
        ? { projectId: filters.projectId }
        : {}),
      ...(!filters.everywhere && filters.teamId
        ? { teamId: filters.teamId }
        : {}),
      ...(filters.category
        ? {
            kinds: notificationKindList.filter(
              (k) => notificationKinds[k].category === filters.category,
            ),
          }
        : {}),
    }),
    [filters, organization.id],
  );
  // Latest request wins; slower earlier responses are dropped.
  const load = useCallback(() => {
    const id = ++request.current;
    notificationRequest<NotificationPage>({ action: "list", query }).then(
      (result) => {
        if (id !== request.current) return;
        setPage(result);
        setError(undefined);
      },
      (e: unknown) => {
        if (id === request.current)
          setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, [query]);
  useEffect(load, [load]);
  useNotificationSignal(organization.id, load);

  const act = async (
    body: Parameters<typeof notificationRequest>[0],
    optimistic: (items: NotificationItem[]) => NotificationItem[],
  ) => {
    setPage((p) => (p ? { ...p, items: optimistic(p.items) } : p));
    try {
      await notificationRequest(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    announceNotificationChange();
    load();
  };
  const now = new Date().toISOString();
  const setRead = (ids: string[], read: boolean) =>
    act({ action: "markRead", ids, read }, (items) =>
      items
        .map((n) =>
          ids.includes(n.id) ? { ...n, readAt: read ? now : null } : n,
        )
        .filter((n) => filters.status !== "unread" || !n.readAt || !read),
    );
  const setArchived = (ids: string[], archived: boolean) =>
    act({ action: "archive", ids, archived }, (items) =>
      items.filter((n) => !ids.includes(n.id)),
    );
  const markAllRead = () =>
    act(
      {
        action: "markRead",
        read: true,
        ...(filters.everywhere ? {} : { organizationId: organization.id }),
      },
      (items) =>
        filters.status === "unread"
          ? []
          : items.map((n) => ({ ...n, readAt: n.readAt ?? now })),
    );
  const loadMore = async () => {
    if (!page?.next) return;
    setLoadingMore(true);
    try {
      const more = await notificationRequest<NotificationPage>({
        action: "list",
        query: { ...query, before: page.next },
      });
      setPage((p) =>
        p ? { ...more, items: [...p.items, ...more.items] } : more,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const unreadElsewhere = directory.organizations
    .filter((o) => o.id !== organization.id && (page?.unread[o.id] ?? 0) > 0)
    .map((o) => ({ ...o, count: page!.unread[o.id]! }));
  const teams = [...delivery.teams.values()].filter((t) => !t.archivedAt);
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name;
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div
          role="tablist"
          aria-label="Show notifications"
          className="flex items-center rounded-md bg-muted p-0.5"
        >
          {(["unread", "all", "archived"] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={filters.status === s}
              onClick={() => setFilters((f) => ({ ...f, status: s }))}
              className={cn(
                "h-6 rounded-lg px-2.5 text-xs font-medium capitalize",
                filters.status === s
                  ? "bg-card text-foreground shadow-(--shadow-border)"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <FilterMenu
          label={filters.everywhere ? "All organizations" : organization.name}
          active={filters.everywhere}
          title="Organization"
          options={[
            {
              value: "here",
              label: organization.name,
              hint: "This organization",
            },
            { value: "all", label: "All organizations" },
          ]}
          value={filters.everywhere ? "all" : "here"}
          onSelect={(v) =>
            setFilters((f) => ({
              ...f,
              everywhere: v === "all",
              projectId: null,
              teamId: null,
            }))
          }
        />
        {!filters.everywhere && (
          <>
            <FilterMenu
              label={projectName(filters.projectId) ?? "Any project"}
              active={!!filters.projectId}
              title="Project"
              options={[
                { value: "", label: "Any project" },
                ...projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                  hint: p.key,
                })),
              ]}
              value={filters.projectId ?? ""}
              onSelect={(v) =>
                setFilters((f) => ({ ...f, projectId: v || null }))
              }
            />
            {teams.length > 0 && (
              <FilterMenu
                label={teamName(filters.teamId) ?? "Any team"}
                active={!!filters.teamId}
                title="Team"
                options={[
                  { value: "", label: "Any team" },
                  ...teams.map((t) => ({ value: t.id, label: t.name })),
                ]}
                value={filters.teamId ?? ""}
                onSelect={(v) =>
                  setFilters((f) => ({ ...f, teamId: v || null }))
                }
              />
            )}
          </>
        )}
        <FilterMenu
          label={
            filters.category ? categoryLabels[filters.category] : "Any type"
          }
          active={!!filters.category}
          title="Type"
          options={[
            { value: "", label: "Any type" },
            ...notificationCategories.map((c) => ({
              value: c,
              label: categoryLabels[c],
            })),
          ]}
          value={filters.category ?? ""}
          onSelect={(v) =>
            setFilters((f) => ({
              ...f,
              category: (v || null) as NotificationCategory | null,
            }))
          }
        />
        <div className="ml-auto flex items-center gap-3">
          {unreadElsewhere.length > 0 && !filters.everywhere && (
            <p className="text-xs text-muted-foreground">
              Also unread in{" "}
              {unreadElsewhere.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ", "}
                  <Link
                    href={paths.inbox(o.slug)}
                    className="font-medium text-foreground hover:underline"
                  >
                    {o.name} ({o.count})
                  </Link>
                </span>
              ))}
            </p>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void markAllRead()}
            disabled={!page?.items.some((n) => !n.readAt)}
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </Button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 border-b bg-red-500/5 px-4 py-2 text-xs text-red-700 dark:text-red-400"
        >
          <CircleAlert className="size-3.5" /> {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!page ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">
            Loading…
          </p>
        ) : page.items.length === 0 ? (
          <EmptyState
            title={
              filters.status === "unread"
                ? "You're all caught up"
                : filters.status === "archived"
                  ? "No archived notifications"
                  : "No notifications"
            }
            action={
              <Link
                href={paths.notificationSettings(organization.slug)}
                className="text-[13px] font-medium text-primary hover:underline"
              >
                Choose what you&apos;re notified about
              </Link>
            }
          >
            Review requests, mentions, blocking discussions and other changes
            addressed to you appear here.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {page.items.map((n) => (
              <Row
                key={n.id}
                n={n}
                showOrganization={filters.everywhere}
                onOpen={(href) => {
                  if (!n.readAt) void setRead([n.id], true);
                  router.push(href);
                }}
                onRead={(read) => void setRead([n.id], read)}
                onArchive={(archived) => void setArchived([n.id], archived)}
              />
            ))}
          </ul>
        )}
        {page?.next && (
          <div className="flex justify-center border-t px-4 py-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Loading…" : "Show older"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  n,
  showOrganization,
  onOpen,
  onRead,
  onArchive,
}: {
  n: NotificationItem;
  showOrganization: boolean;
  onOpen: (href: string) => void;
  onRead: (read: boolean) => void;
  onArchive: (archived: boolean) => void;
}) {
  const category = kindCategory(n.kind);
  const Icon =
    n.kind === "item_ready"
      ? CircleCheckBig
      : n.kind === "blocking_thread" || n.kind === "export_failed"
        ? CircleAlert
        : category
          ? categoryIcons[category]
          : Bell;
  const actor = n.actorName ?? (n.actorId ? "Former member" : "Lictory");
  const { headline, body } = describeNotification(n, actor);
  const href = notificationHref(n.organizationSlug, n);
  const title = typeof n.detail.title === "string" ? n.detail.title : null;
  const unread = !n.readAt;
  const urgent = n.kind === "blocking_thread" || n.kind === "export_failed";
  return (
    <li className="group relative">
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(href);
        }}
        className={cn(
          "flex items-start gap-3 py-2.5 pr-24 pl-4 hover:bg-muted/60",
          !unread && "text-muted-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "mt-2 size-1.5 shrink-0 rounded-full",
            unread ? "bg-primary" : "bg-transparent",
          )}
        />
        <span
          className={cn(
            "mt-0.5 grid size-5 shrink-0 place-items-center",
            urgent
              ? "text-destructive"
              : n.kind === "item_ready"
                ? "text-success"
                : "text-muted-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "flex items-center gap-2 text-[13px]",
              unread && "font-medium text-foreground",
            )}
          >
            {n.actorName && <Avatar name={n.actorName} size="xs" />}
            <span className="min-w-0 truncate">{headline}</span>
          </p>
          {(title ?? body) && (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {title && <span className="text-foreground/80">{title}</span>}
              {title && body && " · "}
              {body}
            </p>
          )}
          {showOrganization && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {n.organizationName}
            </p>
          )}
        </div>
        <time
          dateTime={n.createdAt}
          title={new Date(n.createdAt).toLocaleString()}
          className="shrink-0 text-xs text-muted-foreground tabular-nums group-focus-within:invisible group-hover:invisible"
        >
          {relativeTime(n.createdAt)}
        </time>
      </a>
      <div className="invisible absolute top-2 right-3 flex items-center gap-0.5 group-focus-within:visible group-hover:visible">
        {!n.archivedAt && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={unread ? "Mark as read" : "Mark as unread"}
            title={unread ? "Mark as read" : "Mark as unread"}
            onClick={() => onRead(unread)}
          >
            {unread ? (
              <Check className="size-3.5" />
            ) : (
              <Mail className="size-3.5" />
            )}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={n.archivedAt ? "Restore" : "Archive"}
          title={n.archivedAt ? "Restore" : "Archive"}
          onClick={() => onArchive(!n.archivedAt)}
        >
          {n.archivedAt ? (
            <ArchiveRestore className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
        </Button>
      </div>
    </li>
  );
}

function FilterMenu({
  label,
  title,
  active,
  options,
  value,
  onSelect,
}: {
  label: string;
  title: string;
  active: boolean;
  options: { value: string; label: string; hint?: string }[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <Popover
      width={220}
      trigger={(props) => (
        <button
          {...props}
          aria-label={`${title}: ${label}`}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs",
            active
              ? "border-primary/30 bg-primary/5 text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown className="size-3" aria-hidden />
        </button>
      )}
    >
      <Picker
        title={title}
        options={options}
        value={value}
        onSelect={onSelect}
        hideSearch={options.length < 8}
      />
    </Popover>
  );
}
