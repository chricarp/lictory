"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { relativeTime, priorityMeta, refinementMeta } from "~/lib/work-items";
import type {
  EntityOf,
  RefinementState,
  StatusCategory,
  WorkItemPriority,
} from "~/sync/shared/protocol";
import { iterationLabel } from "~/sync/shared/protocol";
import { Avatar, SectionLabel } from "~/components/ui/primitives";
import { RefinementIcon, StatusIcon } from "~/components/items/status";
import { useDelivery } from "~/components/workspace/provider";
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
  const delivery = useDelivery();
  const iterationName = (id: string | undefined) => {
    const it = id ? delivery.iterations.get(id) : undefined;
    return it ? iterationLabel(it) : "an earlier iteration";
  };
  const d = entry.detail ?? {};
  const auto = d.automatic === true;
  const actor =
    entry.action === "branch_deleted" && auto
      ? "Lictory"
      : memberName(entry.actorId);
  let body: ReactNode;
  switch (entry.action) {
    case "created":
      body = (
        <>created this {(str(d.type) ?? str(d.kind) ?? "item").toLowerCase()}</>
      );
      break;
    case "revised":
      body = (
        <>
          saved <b>revision {num(d.number)}</b>
          {str(d.summary) ? <> — {str(d.summary)}</> : null}
        </>
      );
      break;
    // Status names are recorded at the time of the change, so history keeps
    // reading correctly after a team renames or archives a status.
    case "status_changed": {
      const to = str(d.to);
      const category = str(d.category) as StatusCategory | undefined;
      const early = Array.isArray(d.startedBeforeReady);
      body = (
        <>
          moved this{" "}
          {str(d.from) && (
            <span className="text-muted-foreground">from {str(d.from)} </span>
          )}
          to{" "}
          <span className="inline-flex items-center gap-1">
            {category && <StatusIcon category={category} />}
            <b>{to}</b>
          </span>
          {d.reason === "status_archived" && (
            <span className="text-muted-foreground">
              {" "}
              (the previous status was archived)
            </span>
          )}
          {early && (
            <span className="text-amber-700 dark:text-amber-400">
              {" "}
              before the specification was ready
            </span>
          )}
        </>
      );
      break;
    }
    case "refinement_changed": {
      const from = str(d.from) as RefinementState | undefined;
      const to = str(d.to) as RefinementState | undefined;
      body = (
        <>
          {auto ? "refinement became" : "changed refinement"}{" "}
          {from && refinementMeta[from] && (
            <>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <RefinementIcon state={from} />
                {refinementMeta[from].label}
              </span>{" "}
              →{" "}
            </>
          )}
          {to && refinementMeta[to] && (
            <span className="inline-flex items-center gap-1">
              <RefinementIcon state={to} />
              {refinementMeta[to].label}
            </span>
          )}
          {auto && (
            <span className="text-muted-foreground"> automatically</span>
          )}
        </>
      );
      break;
    }
    case "type_changed":
      body = (
        <>
          changed the type from {str(d.from)} to <b>{str(d.to)}</b>
        </>
      );
      break;
    case "team_changed":
      body = (
        <>
          moved this to{" "}
          <b>{delivery.teams.get(str(d.to) ?? "")?.name ?? "another team"}</b>
        </>
      );
      break;
    case "iteration_changed":
      body = str(d.to) ? (
        <>
          {d.reason === "carried_over"
            ? "carried this over to"
            : "planned this for"}{" "}
          <b>{iterationName(str(d.to))}</b>
        </>
      ) : (
        <>
          {d.reason === "carried_over"
            ? "returned unfinished work to the backlog"
            : "moved this to the backlog"}
        </>
      );
      break;
    case "estimate_changed":
      body =
        d.to === null ? (
          <>removed the estimate</>
        ) : (
          <>
            estimated this at <b>{num(d.to)}</b>
          </>
        );
      break;
    case "relation_added":
      body = (
        <>
          linked a{" "}
          {str(d.kind) === "blocks"
            ? "blocked"
            : str(d.kind) === "duplicates"
              ? "duplicate"
              : "related"}{" "}
          item
        </>
      );
      break;
    case "relation_removed":
      body = <>removed a relation</>;
      break;
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
      body = (
        <>
          {d.draft === true
            ? "drafted a suggestion"
            : "opened a suggestion for review"}
        </>
      );
      break;
    case "suggestion_opened":
      body = <>opened their suggestion for review</>;
      break;
    case "suggestion_drafted":
      body = <>converted their suggestion back to a draft</>;
      break;
    case "suggestion_updated":
      body = (
        <>
          {d.rebased === true
            ? `updated their suggestion against revision ${num(d.revision)}`
            : "updated their suggestion"}{" "}
          <b>(v{num(d.version)})</b>
        </>
      );
      break;
    case "suggestion_closed":
      body = (
        <>
          closed{" "}
          {str(d.authorId) === entry.actorId ? (
            "their"
          ) : (
            <>
              <b>{memberName(str(d.authorId))}</b>’s
            </>
          )}{" "}
          suggestion
        </>
      );
      break;
    case "suggestion_reopened":
      body = <>reopened their suggestion</>;
      break;
    case "suggestion_reviewer_assigned":
      body = (
        <>
          asked <b>{memberName(str(d.userId))}</b> to review their suggestion
        </>
      );
      break;
    case "suggestion_reviewer_unassigned":
      body = (
        <>
          removed <b>{memberName(str(d.userId))}</b> as suggestion reviewer
        </>
      );
      break;
    case "suggestion_approved":
      body = (
        <>
          <b className="text-success">approved</b> v{num(d.version)} of{" "}
          <b>{memberName(str(d.authorId))}</b>’s suggestion
        </>
      );
      break;
    case "suggestion_changes_requested":
      body = (
        <>
          <b className="text-warning">requested changes</b> on v{num(d.version)}{" "}
          of <b>{memberName(str(d.authorId))}</b>’s suggestion
        </>
      );
      break;
    case "suggestion_decision_revoked":
      body = <>revoked their suggestion decision</>;
      break;
    case "suggestion_merged":
    case "suggestion_accepted":
      body = (
        <>
          merged <b>{memberName(str(d.authorId))}</b>’s suggestion
        </>
      );
      break;
    case "suggestion_rejected":
      body = (
        <>
          closed <b>{memberName(str(d.authorId))}</b>’s suggestion
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
          <b className="text-success">approved</b> revision {num(d.revision)}{" "}
          for {str(d.responsibility)}
        </>
      );
      break;
    case "changes_requested":
      body = (
        <>
          <b className="text-warning">requested changes</b> on revision{" "}
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
    case "exported": {
      const key = str(d.key);
      const link = key ? (
        str(d.url) ? (
          <a
            href={str(d.url)}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline-offset-2 hover:underline"
          >
            {key}
          </a>
        ) : (
          <b>{key}</b>
        )
      ) : (
        "Jira"
      );
      body = (
        <>
          {d.outcome === "created" ? "exported this to " : "updated "}
          {link}
          {num(d.revision) !== undefined && (
            <> from revision {num(d.revision)}</>
          )}
        </>
      );
      break;
    }
    case "external_linked":
      body = (
        <>
          linked this to <b>{str(d.key)}</b>
        </>
      );
      break;
    case "external_unlinked":
      body = (
        <>
          unlinked <b>{str(d.key)}</b>
        </>
      );
      break;
    case "branch_created":
      body = (
        <>
          created branch <b>{str(d.branch)}</b> from {str(d.from)}
        </>
      );
      break;
    case "branch_committed":
      body = (
        <>
          committed to <b>{str(d.branch)}</b> — {str(d.message)}
        </>
      );
      break;
    case "branch_deleted":
      body = (
        <>
          {auto ? "automatically deleted branch" : "deleted branch"}{" "}
          <b>{str(d.branch)}</b>
          {auto && d.reason === "pull_request_merged" && (
            <> after its pull request was merged into main</>
          )}
        </>
      );
      break;
    case "branch_collaborator_changed":
      body = (
        <>
          {d.assigned ? "invited" : "removed"}{" "}
          <b>{memberName(str(d.userId))}</b> {d.assigned ? "to" : "from"} branch{" "}
          <b>{str(d.branch)}</b>
        </>
      );
      break;
    case "pull_request_created":
      body = (
        <>
          opened {d.draft ? "draft " : ""}pull request <b>{str(d.title)}</b> ·{" "}
          {str(d.source)} → {str(d.target)}
        </>
      );
      break;
    case "pull_request_deleted":
      body = (
        <>
          deleted pull request <b>{str(d.title)}</b>
        </>
      );
      break;
    case "pull_request_merged":
      body = (
        <>
          merged <b>{str(d.title)}</b> into {str(d.target)}
        </>
      );
      break;
    case "pull_request_review_requested":
      body = (
        <>
          requested {str(d.role)} review of <b>{str(d.title)}</b>
        </>
      );
      break;
    case "pull_request_review_decided":
      body = (
        <>
          {str(d.decision) === "approve"
            ? "approved"
            : str(d.decision) === "revoke"
              ? "revoked their review of"
              : "requested changes to"}{" "}
          <b>{str(d.title)}</b> for {str(d.role)}
        </>
      );
      break;
    case "pull_request_draft_changed":
      body = (
        <>
          {d.draft ? "converted to draft" : "marked ready for review"}:{" "}
          <b>{str(d.title)}</b>
        </>
      );
      break;
    case "pull_request_approval_invalidated":
      body = (
        <>
          invalidated approvals of <b>{str(d.title)}</b> by changing the merge
          result
        </>
      );
      break;
    case "revision_restored":
      body = (
        <>
          restored revision <b>{num(d.revision)}</b> as a new main revision
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
