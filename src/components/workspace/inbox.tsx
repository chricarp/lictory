"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  CircleAlert,
  CircleCheckBig,
  MessageSquareWarning,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { useUnreadNotifications } from "~/components/notifications/client";
import { NotificationFeed } from "~/components/notifications/notifications";
import { cn } from "~/lib/utils";
import { EmptyState } from "~/components/ui/primitives";
import { paths } from "~/lib/paths";
import {
  identifier,
  categoryOf,
  statusOf,
  needsMyReview,
  relativeTime,
  segmentOf,
  typeOf,
} from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { useWorkspace } from "./provider";
import { IssueIdentifier } from "~/components/items/identifier";
import { StatusIcon } from "~/components/items/status";
import { TypeIcon } from "~/components/items/icons";

type Entry = {
  item: WorkItem;
  reason: string;
  detail: string;
  icon: React.ReactNode;
  weight: number;
};

// What needs my attention right now, derived from synchronized state.
// Deliberately narrow: review requests, blocked items I own, requested changes
// on my items, items of mine that became ready. An entry disappears when the
// underlying state resolves, unlike notifications, which record events.
export function useAttention() {
  const { items, userId, roleIds, delivery } = useWorkspace();
  return useMemo<Entry[]>(() => {
    const mine = (i: WorkItem) =>
      i.assigneeId === userId || i.createdById === userId;
    const list: Entry[] = [];
    for (const item of items) {
      if (item.archivedAt) continue;
      if (needsMyReview(item, userId, roleIds)) {
        const pending = item.reviews.filter(
          (r) =>
            r.status !== "completed" &&
            r.status !== "cancelled" &&
            r.assigneeIds.some((id) => id === userId || roleIds.includes(id)),
        );
        const suggestion = item.suggestionReviewerIds.includes(userId);
        list.push({
          item,
          reason: pending.length ? "Review requested" : "Suggestion to review",
          detail: pending.length
            ? `${pending.map((r) => r.responsibility).join(", ")} · revision ${item.revisionNumber}${suggestion ? " · a suggestion awaits your approval" : ""}`
            : "A suggestion awaits your approval to be merged",
          icon: <ShieldAlert className="size-4 text-primary" />,
          weight: 0,
        });
        continue;
      }
      if (
        mine(item) &&
        item.reviews.some((r) => r.status === "changes_requested")
      )
        list.push({
          item,
          reason: "Changes requested",
          detail: item.reviews
            .filter((r) => r.status === "changes_requested")
            .map((r) => r.responsibility)
            .join(", "),
          icon: <MessageSquareWarning className="size-4 text-warning" />,
          weight: 1,
        });
      else if (mine(item) && item.blockingThreads > 0)
        list.push({
          item,
          reason: "Blocked",
          detail: `${item.blockingThreads} blocking discussion${item.blockingThreads > 1 ? "s" : ""} open`,
          icon: <CircleAlert className="size-4 text-destructive" />,
          weight: 2,
        });
      else if (
        mine(item) &&
        item.refinementState === "ready" &&
        !["started", "done", "canceled"].includes(
          categoryOf(delivery, item) ?? "",
        )
      )
        list.push({
          item,
          reason: "Ready for development",
          detail: `${item.readinessPassed}/${item.readinessTotal} checks pass`,
          icon: <CircleCheckBig className="size-4 text-success" />,
          weight: 3,
        });
    }
    return list.sort(
      (a, b) =>
        a.weight - b.weight || b.item.updatedAt.localeCompare(a.item.updatedAt),
    );
  }, [items, userId, roleIds, delivery]);
}

export function AttentionList({ entries }: { entries: Entry[] }) {
  const { projects, organization, delivery } = useWorkspace();
  // Rendered incrementally: very large organizations can have thousands of
  // items, but attention is scarce; the first page is what matters.
  const PAGE = 50;
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyState title="Nothing needs your attention">
            Review requests, blocking discussions on your items and requested
            changes appear here.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {entries.slice(0, shown).map(({ item, reason, detail, icon }) => {
              const project = projects.find((p) => p.id === item.projectId);
              return (
                <li key={`${item.id}-${reason}`}>
                  <Link
                    href={paths.item(
                      organization.slug,
                      project?.key ?? "",
                      segmentOf(typeOf(delivery, item)),
                      identifier(project, item.number),
                    )}
                    className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/60"
                  >
                    <span className="mt-0.5">{icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="font-medium">{reason}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="truncate text-muted-foreground">
                          {detail}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[13px]">
                        <StatusIcon
                          category={categoryOf(delivery, item)}
                          color={statusOf(delivery, item)?.color}
                        />
                        <TypeIcon type={typeOf(delivery, item)} />
                        <IssueIdentifier
                          project={project}
                          number={item.number}
                        />
                        <span className="truncate">{item.title}</span>
                      </div>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {relativeTime(item.updatedAt)}
                    </time>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {entries.length > shown && (
          <div className="flex items-center justify-center gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
            Showing {shown} of {entries.length}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShown((n) => n + PAGE)}
            >
              Show {Math.min(PAGE, entries.length - shown)} more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

type InboxView = "updates" | "todo";

// One place for everything addressed to me. "Updates" is the notification
// history (events, with read state); "To do" is current work derived from live
// state. They answer different questions ("what happened?" vs "what is
// waiting on me?") but people look for both in the same place.
export function Inbox() {
  const { organization } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: InboxView =
    searchParams.get("view") === "todo" ? "todo" : "updates";
  const entries = useAttention();
  const unread = useUnreadNotifications(organization.id)[organization.id] ?? 0;
  const tabs: { id: InboxView; label: string; count: number }[] = [
    { id: "updates", label: "Updates", count: unread },
    { id: "todo", label: "To do", count: entries.length },
  ];
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-semibold">Inbox</h1>
        <div
          role="tablist"
          aria-label="Inbox view"
          className="flex items-center gap-0.5"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={view === t.id}
              onClick={() =>
                router.replace(
                  t.id === "todo"
                    ? `${paths.inbox(organization.slug)}?view=todo`
                    : paths.inbox(organization.slug),
                )
              }
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px]",
                view === t.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.count > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <Link
          href={paths.notificationSettings(organization.slug)}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings2 className="size-3.5" /> Notification settings
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        {view === "todo" ? (
          <AttentionList entries={entries} />
        ) : (
          <NotificationFeed />
        )}
      </div>
    </div>
  );
}
