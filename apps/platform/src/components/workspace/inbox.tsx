import { Link } from "@lictory/platform/lib/navigation";
import { useRouter, useSearchParams } from "@lictory/platform/lib/navigation";
import { useMemo, useState } from "react";
import { Tabs, TabsPanel } from "@ui-sdk/react/tabs";
import { Button } from "@lictory/ui/button";
import {
  CircleAlert,
  CircleCheckBig,
  CircleX,
  FileText,
  Inbox as InboxIcon,
  MessageSquareWarning,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { useUnreadNotifications } from "@lictory/platform/components/notifications/client";
import { NotificationFeed } from "@lictory/platform/components/notifications/notifications";
import { EmptyState } from "@lictory/ui/primitives";
import { paths } from "@lictory/core/lib/paths";
import { identifier, needsMyReview } from "@lictory/core/lib/work-items";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import {
  externalLinksByItem,
  lifecycleStage,
  readyForSelection,
} from "@lictory/core/lib/lifecycle";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { LittoLauncher } from "@lictory/platform/components/intelligence/dock/launcher";
import {
  PageHeader,
  PageTabs,
} from "@lictory/platform/components/shell/page-header";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { AgentAvatar } from "@lictory/platform/components/identity/actor";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import type {
  AgentEntity,
  RunnerEntity,
  SessionEntity,
} from "@lictory/core/factory/entities";
import {
  sessionOutcome,
  titleBeside,
  useItemKey,
} from "@lictory/platform/components/factory/parts";
import { failedForMe } from "@lictory/platform/components/factory/overview-blocks";
import { ApprovalRequest } from "@lictory/platform/components/shell/approval-request";
import { waitingOnYou } from "@lictory/platform/components/shell/home/derive";
import {
  useFactory,
  waitingOnMe,
} from "@lictory/platform/components/factory/store";
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

const blockingCount = (n: number) =>
  `${n} blocking discussion${n > 1 ? "s" : ""} open`;

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
        // Blocking discussions on what I review wait on my answer too.
        const blocking = item.blockingThreads
          ? ` · ${blockingCount(item.blockingThreads)}`
          : "";
        list.push({
          item,
          reason: pending.length
            ? "Review requested"
            : "Pull request to review",
          detail: pending.length
            ? `${pending.map((r) => r.responsibility).join(", ")} · revision ${item.revisionNumber}${suggestion ? " · a pull request awaits your approval" : ""}${blocking}`
            : `A pull request awaits your approval to be merged${blocking}`,
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
      else if (mine(item) && link?.status === "failed")
        // The delivery tool refused it: nothing reaches it until someone
        // fixes the cause and retries from the item.
        list.push({
          item,
          reason: "Publish failed",
          detail: `${link.lastError ?? "The delivery tool refused it."} Retry from the item.`,
          icon: <CircleAlert className="size-4 text-destructive" />,
          weight: 1,
        });
      else if (mine(item) && item.blockingThreads > 0)
        list.push({
          item,
          reason: "Blocked",
          detail: blockingCount(item.blockingThreads),
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
  { reason: string; detail: string; icon: React.ReactNode }
> = {
  review_requested: {
    reason: "Review requested",
    detail: "A page change awaits your review",
    icon: <ShieldAlert className="size-4 text-primary" />,
  },
  review_again: {
    reason: "Review again",
    detail: "The page change was updated after your review",
    icon: <ShieldAlert className="size-4 text-primary" />,
  },
  changes_requested: {
    reason: "Changes requested",
    detail: "A reviewer asked for changes to your page change",
    icon: <MessageSquareWarning className="size-4 text-warning" />,
  },
  ready_to_merge: {
    reason: "Ready to merge",
    detail: "Your page change is approved and nothing blocks it",
    icon: <CircleCheckBig className="size-4 text-success" />,
  },
};

// An agent's session waiting on me: one per question, or the session itself
// when it waits for my next message.
type AgentRequest = {
  session: SessionEntity;
  approval?: SessionEntity["approvals"][number];
  agent?: AgentEntity;
  runner?: RunnerEntity;
  // A session I started that failed: mine to retry or leave.
  failed?: boolean;
};

// Everything waiting on me, as one queue (see `waitingOnYou`): Home's
// "Waiting on you" and the Inbox's To do read this, so they never disagree.
export function useWaitingOnYou() {
  const { userId } = useWorkspace();
  const items = useAttention();
  const pages = usePageAttention();
  const { sessions, agentById, runnerById } = useFactory();
  return useMemo(() => {
    const requests = waitingOnMe(sessions, agentById, userId).flatMap(
      (session): AgentRequest[] => {
        const context = {
          session,
          agent: agentById.get(session.agentId),
          runner: session.runnerId
            ? runnerById.get(session.runnerId)
            : undefined,
        };
        // Without a question, it waits for my next message.
        return session.approvals.length
          ? session.approvals.map((approval) => ({ ...context, approval }))
          : [{ ...context, approval: undefined }];
      },
    );
    const failures = failedForMe(sessions, userId).map(
      (session): AgentRequest => ({
        session,
        agent: agentById.get(session.agentId),
        failed: true,
      }),
    );
    return waitingOnYou({ items, pages, requests: [...requests, ...failures] });
  }, [items, pages, sessions, agentById, runnerById, userId]);
}

export type WaitingRow = ReturnType<typeof useWaitingOnYou>[number];

// One entry of the queue: a work item or a page change as a row, an agent's
// question as a compact `ApprovalRequest` (reviewed in place before it can
// be approved). The link names why the row is here, then what it is.
export function WaitingRowView({ row }: { row: WaitingRow }) {
  const { projects, organization } = useWorkspace();
  const itemKey = useItemKey();
  if (row.kind === "agent") {
    const { session, approval, agent, runner, failed } = row.request;
    const key = itemKey(session.workItemId);
    if (failed)
      return (
        <ListRow
          href={factoryPaths.session(organization.slug, session.id)}
          leading={<CircleX className="size-4 text-destructive" />}
          identifier={key}
          title={
            <>
              <span className="sr-only">Failed · </span>
              {titleBeside(session.title, key)}
            </>
          }
          meta={
            <>
              <span className="shrink-0 font-medium text-foreground/80">
                {agent?.name ?? "The agent"} failed
              </span>
              <span aria-hidden>·</span>
              <span className="truncate">
                {sessionOutcome(session)} Retry it or start over.
              </span>
            </>
          }
          time={session.completedAt ?? session.updatedAt}
        />
      );
    if (!approval)
      return (
        <ListRow
          href={factoryPaths.session(organization.slug, session.id)}
          leading={agent ? <AgentAvatar agent={agent} size={20} /> : undefined}
          identifier={key}
          title={titleBeside(session.title, key)}
          meta={`${agent?.name ?? "An agent"} is waiting for your next message`}
          time={session.updatedAt}
        />
      );
    return (
      <ApprovalRequest
        compact
        session={session}
        approval={approval}
        agent={agent}
        runner={runner}
      />
    );
  }
  if (row.kind === "page") {
    const entry = row.entry;
    const { reason, icon } = pageReasons[entry.reason];
    const pr = entry.pullRequest;
    return (
      <ListRow
        href={`${paths.spacePage(organization.slug, entry.space.slug, entry.page.id)}/history?view=pulls&pr=${pr.id}`}
        leading={icon}
        title={
          <>
            <span className="sr-only">{reason} · Page · </span>
            {entry.page.title || "Untitled"}
          </>
        }
        meta={
          <>
            <span className="shrink-0 font-medium text-foreground/80">
              {reason}
            </span>
            <span aria-hidden>·</span>
            <FileText aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              {pr.title} · {entry.space.name}
            </span>
          </>
        }
        time={pr.updatedAt}
      />
    );
  }
  const { item, reason, detail, icon } = row.entry;
  const project = projects.find((p) => p.id === item.projectId);
  const key = identifier(project, item.number);
  return (
    <ListRow
      href={paths.item(organization.slug, project?.key ?? "", key)}
      leading={icon}
      identifier={key}
      title={
        <>
          <span className="sr-only">{reason} · </span>
          {item.title}
        </>
      }
      meta={
        <>
          <span className="shrink-0 font-medium text-foreground/80">
            {reason}
          </span>
          <span aria-hidden>·</span>
          <span className="truncate">{detail}</span>
        </>
      }
      time={item.updatedAt}
    />
  );
}

export function AttentionList({ rows }: { rows: readonly WaitingRow[] }) {
  // Rendered incrementally: very large organizations can have thousands of
  // items, but attention is scarce; the first page is what matters.
  const PAGE = 50;
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="h-full overflow-y-auto">
      {rows.length === 0 ? (
        <EmptyState illustration="inbox" title="Nothing needs your attention">
          Review requests on items and pages, questions from agents, blocking
          discussions on your items and requested changes appear here.
        </EmptyState>
      ) : (
        <ul
          aria-label="Waiting on you"
          className="mx-auto w-full max-w-5xl divide-y divide-border/70"
        >
          {rows.slice(0, shown).map((row) => (
            <WaitingRowView key={row.key} row={row} />
          ))}
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
  );
}

type InboxView = "updates" | "todo";

// One place for everything addressed to me. "To do" is current work derived
// from live state; "Updates" is the notification history (events, with read
// state). They answer different questions ("what is waiting on me?" vs
// "what happened?") but people look for both in the same place. The Inbox
// opens on To do when something waits on me, else on Updates; `?view=`
// names one, and choosing a tab writes it.
export function Inbox() {
  const { organization } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const waiting = useWaitingOnYou();
  // Once To do has opened by default it stays, even when its last entry
  // resolves while I look at it.
  const [todoOpened, setTodoOpened] = useState(false);
  if (waiting.length > 0 && !todoOpened) setTodoOpened(true);
  const asked = searchParams.get("view");
  const view: InboxView =
    asked === "todo" || asked === "updates"
      ? asked
      : todoOpened
        ? "todo"
        : "updates";
  const unread = useUnreadNotifications(organization.id)[organization.id] ?? 0;
  const tabs: { value: InboxView; label: string; count: number }[] = [
    { value: "todo", label: "To do", count: waiting.length },
    { value: "updates", label: "Updates", count: unread },
  ];
  return (
    <Tabs
      value={view}
      onValueChange={(next) => {
        if (next === null || next === view) return;
        router.replace(paths.inbox(organization.slug, next));
      }}
      className="flex h-full flex-col"
    >
      <PageHeader
        title="Inbox"
        icon={<InboxIcon />}
        tabs={<PageTabs label="Inbox view" tabs={tabs} />}
        actions={
          <>
            {/* On phones the bar keeps its room for the tabs; the Updates
                toolbar links the settings there. */}
            <Link
              href={paths.notificationSettings(organization.slug)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground max-sm:hidden"
            >
              <Settings2 className="size-3.5" aria-hidden />
              Notification settings
            </Link>
            <LittoLauncher />
          </>
        }
      />
      <TabsPanel value="todo" className="min-h-0 flex-1">
        <AttentionList rows={waiting} />
      </TabsPanel>
      <TabsPanel value="updates" className="min-h-0 flex-1">
        <NotificationFeed />
      </TabsPanel>
    </Tabs>
  );
}
