"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  CircleAlert,
  CircleCheckBig,
  MessageSquareWarning,
  ShieldAlert,
} from "lucide-react";
import { EmptyState } from "~/components/ui/primitives";
import { paths } from "~/lib/paths";
import { identifier, needsMyReview, relativeTime } from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { useWorkspace } from "./provider";
import { IssueIdentifier } from "~/components/items/identifier";
import { StatusIcon } from "~/components/items/status";
import { KindIcon } from "~/components/items/icons";

type Entry = {
  item: WorkItem;
  reason: string;
  detail: string;
  icon: React.ReactNode;
  weight: number;
};

// What needs my attention, derived from synchronized state. Deliberately
// narrow: review requests, blocked items I own, requested changes on my items,
// items of mine that just became ready. No activity firehose.
export function Inbox() {
  const { items, projects, userId, roleIds, organization } = useWorkspace();
  // Rendered incrementally: very large organizations can have thousands of
  // items, but attention is scarce; the first page is what matters.
  const PAGE = 50;
  const [shown, setShown] = useState(PAGE);
  const entries = useMemo<Entry[]>(() => {
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
        list.push({
          item,
          reason: "Review requested",
          detail: `${pending.map((r) => r.responsibility).join(", ")} · revision ${item.revisionNumber}`,
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
          icon: <MessageSquareWarning className="size-4 text-amber-600" />,
          weight: 1,
        });
      else if (mine(item) && item.blockingThreads > 0)
        list.push({
          item,
          reason: "Blocked",
          detail: `${item.blockingThreads} blocking discussion${item.blockingThreads > 1 ? "s" : ""} open`,
          icon: <CircleAlert className="size-4 text-red-600" />,
          weight: 2,
        });
      else if (mine(item) && item.status === "ready")
        list.push({
          item,
          reason: "Ready for development",
          detail: `${item.readinessPassed}/${item.readinessTotal} checks pass`,
          icon: <CircleCheckBig className="size-4 text-emerald-600" />,
          weight: 3,
        });
    }
    return list.sort(
      (a, b) =>
        a.weight - b.weight || b.item.updatedAt.localeCompare(a.item.updatedAt),
    );
  }, [items, userId, roleIds]);
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="text-sm font-semibold">Inbox</h1>
        <span className="text-xs text-muted-foreground">
          {entries.length} items
        </span>
      </header>
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
                      item.kind === "epic" ? "epics" : "stories",
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
                        <StatusIcon status={item.status} />
                        <KindIcon kind={item.kind} />
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
