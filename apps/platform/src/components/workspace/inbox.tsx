import { Link } from "@lictory/platform/lib/navigation";
import { useRouter, useSearchParams } from "@lictory/platform/lib/navigation";
import { useMemo, useState } from "react";
import { Tabs, TabsPanel } from "@ui-sdk/react/tabs";
import { Button } from "@lictory/ui/button";
import {
  CircleAlert,
  CircleCheckBig,
  FileText,
  Inbox as InboxIcon,
  MessageSquareWarning,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { useUnreadNotifications } from "@lictory/platform/components/notifications/client";
import { NotificationFeed } from "@lictory/platform/components/notifications/notifications";
import { Badge, EmptyState } from "@lictory/ui/primitives";
import { paths } from "@lictory/core/lib/paths";
import {
  identifier,
  statusOf,
  needsMyReview,
  relativeTime,
  typeOf,
} from "@lictory/core/lib/work-items";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import {
  deliveryCategory,
  externalLinksByItem,
  lifecycleStage,
  readyForSelection,
} from "@lictory/core/lib/lifecycle";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { IssueIdentifier } from "@lictory/platform/components/items/identifier";
import { StatusIcon } from "@lictory/platform/components/items/status";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { LittoLauncher } from "@lictory/platform/components/intelligence/dock/launcher";
import {
  PageHeader,
  PageTabs,
} from "@lictory/platform/components/shell/page-header";
import {
  usePageAttention,
  type PageAttentionEntry,
} from "@lictory/platform/components/knowledge/page-attention";

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
  const { items, userId, disciplineIds, delivery, projects, directory, view } =
    useWorkspace();
  return useMemo<Entry[]>(() => {
    const mine = (i: WorkItem) =>
      i.assigneeId === userId || i.createdById === userId;
    const list: Entry[] = [];
    const links = externalLinksByItem(
      Object.values(view.entities),
      directory.delivery.targets,
    );
    for (const item of items) {
      if (item.archivedAt) continue;
      const project = projects.find((p) => p.id === item.projectId);
      if (!project) continue;
      const link = links.get(item.id);
      const stage = lifecycleStage(item, project, delivery, link);
      if (needsMyReview(item, userId, disciplineIds)) {
        const pending = item.reviews.filter(
          (r) =>
            r.status !== "completed" &&
            r.status !== "cancelled" &&
            r.assigneeIds.some(
              (id) => id === userId || disciplineIds.includes(id),
            ),
        );
        const suggestion = item.suggestionReviewerIds.includes(userId);
        list.push({
          item,
          reason: pending.length
            ? "Review requested"
            : "Pull request to review",
          detail: pending.length
            ? `${pending.map((r) => r.responsibility).join(", ")} · revision ${item.revisionNumber}${suggestion ? " · a pull request awaits your approval" : ""}`
            : "A pull request awaits your approval to be merged",
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
        stage !== "completed" &&
        stage !== "canceled" &&
        (project.deliveryMode === "external"
          ? Boolean(
              link?.publishedRevisionId &&
              link.publishedRevisionId !== item.revisionId,
            )
          : Boolean(
              item.committedRevisionId &&
              item.committedRevisionId !== item.revisionId,
            ))
      )
        list.push({
          item,
          reason: "Scope changed after commitment",
          detail:
            "Review the current specification against the scope selected for delivery.",
          icon: <MessageSquareWarning className="size-4 text-warning" />,
          weight: 2,
        });
      else if (
        mine(item) &&
        stage === "underway" &&
        item.refinementState &&
        item.refinementState !== "ready"
      )
        list.push({
          item,
          reason: "Requirements need attention",
          detail: `Delivery is underway; ${item.readinessPassed}/${item.readinessTotal} readiness checks pass.`,
          icon: <CircleAlert className="size-4 text-warning" />,
          weight: 2,
        });
      else if (mine(item) && readyForSelection(item, project, delivery, link))
        list.push({
          item,
          reason: "Ready for delivery",
          detail: `${item.readinessPassed}/${item.readinessTotal} checks pass`,
          icon: <CircleCheckBig className="size-4 text-success" />,
          weight: 3,
        });
    }
    return list.sort(
      (a, b) =>
        a.weight - b.weight || b.item.updatedAt.localeCompare(a.item.updatedAt),
    );
  }, [
    items,
    userId,
    disciplineIds,
    delivery,
    projects,
    directory.delivery.targets,
    view.entities,
  ]);
}

const pageReasons: Record<
  PageAttentionEntry["reason"],
  { reason: string; detail: string; icon: React.ReactNode; weight: number }
> = {
  review_requested: {
    reason: "Review requested",
    detail: "A page change awaits your review",
    icon: <ShieldAlert className="size-4 text-primary" />,
    weight: 0,
  },
  review_again: {
    reason: "Review again",
    detail: "The page change was updated after your review",
    icon: <ShieldAlert className="size-4 text-primary" />,
    weight: 0,
  },
  changes_requested: {
    reason: "Changes requested",
    detail: "A reviewer asked for changes to your page change",
    icon: <MessageSquareWarning className="size-4 text-warning" />,
    weight: 1,
  },
  ready_to_merge: {
    reason: "Ready to merge",
    detail: "Your page change is approved and nothing blocks it",
    icon: <CircleCheckBig className="size-4 text-success" />,
    weight: 3,
  },
};

export function AttentionList({
  entries,
  pages = [],
}: {
  entries: Entry[];
  // Page pull requests waiting on me (Lictory Spaces).
  pages?: PageAttentionEntry[];
}) {
  const { projects, organization, delivery, directory, view } = useWorkspace();
  const links = useMemo(
    () =>
      externalLinksByItem(
        Object.values(view.entities),
        directory.delivery.targets,
      ),
    [view.entities, directory.delivery.targets],
  );
  // Rendered incrementally: very large organizations can have thousands of
  // items, but attention is scarce; the first page is what matters.
  const PAGE = 50;
  const [shown, setShown] = useState(PAGE);
  // Work items and page pull requests in one queue: by urgency, then by
  // what changed last.
  const rows = useMemo(
    () =>
      [
        ...entries.map((entry) => ({
          kind: "item" as const,
          entry,
          weight: entry.weight,
          at: entry.item.updatedAt,
        })),
        ...pages.map((entry) => ({
          kind: "page" as const,
          entry,
          weight: pageReasons[entry.reason].weight,
          at: entry.pullRequest.updatedAt,
        })),
      ].sort((a, b) => a.weight - b.weight || b.at.localeCompare(a.at)),
    [entries, pages],
  );
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState illustration="inbox" title="Nothing needs your attention">
            Review requests on items and pages, blocking discussions on your
            items and requested changes appear here.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {rows.slice(0, shown).map((row) => {
              if (row.kind === "page")
                return (
                  <PageAttentionRow
                    key={row.entry.pullRequest.id}
                    entry={row.entry}
                  />
                );
              const { item, reason, detail, icon } = row.entry;
              const project = projects.find((p) => p.id === item.projectId);
              return (
                <li key={`${item.id}-${reason}`}>
                  <Link
                    href={paths.item(
                      organization.slug,
                      project?.key ?? "",
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
                          category={
                            project
                              ? deliveryCategory(
                                  item,
                                  project,
                                  delivery,
                                  links.get(item.id),
                                )
                              : undefined
                          }
                          color={
                            project?.deliveryMode === "external"
                              ? undefined
                              : statusOf(delivery, item)?.color
                          }
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
        {rows.length > shown && (
          <div className="flex items-center justify-center gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
            Showing {shown} of {rows.length}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShown((n) => n + PAGE)}
            >
              Show {Math.min(PAGE, rows.length - shown)} more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PageAttentionRow({ entry }: { entry: PageAttentionEntry }) {
  const { organization } = useWorkspace();
  const { reason, detail, icon } = pageReasons[entry.reason];
  const pr = entry.pullRequest;
  return (
    <li>
      <Link
        href={`${paths.spacePage(organization.slug, entry.space.slug, entry.page.id)}/history?view=pulls&pr=${pr.id}`}
        className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/60"
      >
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-medium">{reason}</span>
            <span className="text-muted-foreground">·</span>
            <span className="truncate text-muted-foreground">{detail}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px]">
            <Badge>Page</Badge>
            <FileText
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate">{entry.page.title}</span>
            <span className="hidden min-w-0 truncate text-muted-foreground sm:inline">
              {pr.title} · {entry.space.name}
            </span>
          </div>
        </div>
        <time className="shrink-0 text-xs text-muted-foreground">
          {relativeTime(pr.updatedAt)}
        </time>
      </Link>
    </li>
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
  const pages = usePageAttention();
  const unread = useUnreadNotifications(organization.id)[organization.id] ?? 0;
  const tabs: { value: InboxView; label: string; count: number }[] = [
    { value: "updates", label: "Updates", count: unread },
    { value: "todo", label: "To do", count: entries.length + pages.length },
  ];
  return (
    <Tabs
      value={view}
      onValueChange={(next) => {
        if (next === null || next === view) return;
        router.replace(
          next === "todo"
            ? `${paths.inbox(organization.slug)}?view=todo`
            : paths.inbox(organization.slug),
        );
      }}
      className="flex h-full flex-col"
    >
      <PageHeader
        title="Inbox"
        icon={<InboxIcon />}
        tabs={<PageTabs label="Inbox view" tabs={tabs} />}
        actions={
          <>
            <Link
              href={paths.notificationSettings(organization.slug)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Settings2 className="size-3.5" />
              <span className="max-sm:sr-only">Notification settings</span>
            </Link>
            <LittoLauncher />
          </>
        }
      />
      <TabsPanel value="updates" className="min-h-0 flex-1">
        <NotificationFeed />
      </TabsPanel>
      <TabsPanel value="todo" className="min-h-0 flex-1">
        <AttentionList entries={entries} pages={pages} />
      </TabsPanel>
    </Tabs>
  );
}
