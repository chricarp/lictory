"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { relativeTime, statusMeta, priorityMeta } from "~/lib/work-items";
import type {
  EntityOf,
  WorkItemPriority,
  WorkItemStatus,
} from "~/sync/shared/protocol";
import { Avatar, SectionLabel } from "~/components/ui/primitives";
import { StatusIcon } from "~/components/items/status";
import { useItem } from "~/components/items/item-context";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

// The story of how the requirement evolved: meaningful domain events only.
export function Activity() {
  const { activity } = useItem();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? activity : activity.slice(0, 12);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Activity</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {activity.length}
        </span>
      </div>
      <ol className="space-y-2">
        {shown.map((a) => (
          <ActivityEntry key={a.id} entry={a} />
        ))}
      </ol>
      {activity.length > shown.length && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Show {activity.length - shown.length} earlier
        </button>
      )}
    </div>
  );
}

export function ActivityEntry({ entry }: { entry: EntityOf<"activity"> }) {
  const { memberName, roleName } = useItem();
  const d = entry.detail ?? {};
  const actor = memberName(entry.actorId);
  const auto = d.automatic === true;
  let body: ReactNode;
  switch (entry.action) {
    case "created":
      body = <>created this {str(d.kind) ?? "item"}</>;
      break;
    case "revised":
      body = (
        <>
          saved <b>revision {num(d.number)}</b>
          {str(d.summary) ? <> — {str(d.summary)}</> : null}
        </>
      );
      break;
    case "status_changed": {
      const from = str(d.from) as WorkItemStatus | undefined;
      const to = str(d.to) as WorkItemStatus | undefined;
      body = (
        <>
          {auto ? "status became" : "changed status"}{" "}
          {from && statusMeta[from] && (
            <>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <StatusIcon status={from} />
                {statusMeta[from].label}
              </span>{" "}
              →{" "}
            </>
          )}
          {to && statusMeta[to] && (
            <span className="inline-flex items-center gap-1">
              <StatusIcon status={to} />
              {statusMeta[to].label}
            </span>
          )}
          {auto && (
            <span className="text-muted-foreground"> automatically</span>
          )}
        </>
      );
      break;
    }
    case "priority_changed":
      body = (
        <>
          set priority to{" "}
          <b>
            {priorityMeta[(str(d.to) as WorkItemPriority) ?? "none"]?.label}
          </b>
        </>
      );
      break;
    case "assignee_changed":
      body = (
        <>
          {str(d.to) ? (
            <>
              assigned <b>{memberName(str(d.to))}</b>
            </>
          ) : (
            "removed the owner"
          )}
        </>
      );
      break;
    case "parent_changed":
      body = (
        <>
          {str(d.to)
            ? "moved this into another epic"
            : "removed this from its epic"}
        </>
      );
      break;
    case "archived":
      body = <>archived this item</>;
      break;
    case "restored":
      body = <>restored this item</>;
      break;
    case "thread_opened":
      body = <>opened a {d.blocking ? <b>blocking</b> : null} discussion</>;
      break;
    case "thread_resolved":
      body = <>resolved a discussion</>;
      break;
    case "thread_reopened":
      body = <>reopened a discussion</>;
      break;
    case "thread_blocking_changed":
      body = (
        <>marked a discussion {d.blocking ? "blocking" : "non-blocking"}</>
      );
      break;
    case "suggestion_created":
      body = <>proposed a change</>;
      break;
    case "suggestion_accepted":
      body = (
        <>
          accepted <b>{memberName(str(d.authorId))}</b>’s suggestion
        </>
      );
      break;
    case "suggestion_rejected":
      body = (
        <>
          rejected <b>{memberName(str(d.authorId))}</b>’s suggestion
        </>
      );
      break;
    case "review_requested":
      body = (
        <>
          requested <b>{str(d.responsibility)}</b> review from{" "}
          <b>
            {d.targetType === "role" || d.targetType === "group"
              ? roleName(str(d.targetId))
              : memberName(str(d.targetId))}
          </b>
        </>
      );
      break;
    case "review_cancelled":
      body = (
        <>
          cancelled the <b>{str(d.responsibility)}</b> review
        </>
      );
      break;
    case "approved":
      body = (
        <>
          <b className="text-emerald-700">approved</b> revision{" "}
          {num(d.revision)} for {str(d.responsibility)}
        </>
      );
      break;
    case "changes_requested":
      body = (
        <>
          <b className="text-amber-700">requested changes</b> on revision{" "}
          {num(d.revision)} ({str(d.responsibility)})
        </>
      );
      break;
    case "approval_revoked":
      body = <>revoked their approval of revision {num(d.revision)}</>;
      break;
    case "legacy":
      body = (
        <>
          {str(d.text)
            ?.replace(/([A-Z])/g, " $1")
            .toLowerCase()}
        </>
      );
      break;
    default:
      body = <>{entry.action.replaceAll("_", " ")}</>;
  }
  return (
    <li className="flex items-start gap-2 text-[13px] leading-5">
      <Avatar name={actor} size="xs" className="mt-0.5" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{actor}</span> {body}
      </p>
      <time
        className="shrink-0 text-xs text-muted-foreground"
        title={new Date(entry.createdAt).toLocaleString()}
      >
        {relativeTime(entry.createdAt)}
      </time>
    </li>
  );
}
