import { useState } from "react";
import type { ReactNode } from "react";
import {
  relativeTime,
  priorityMeta,
  refinementMeta,
} from "@lictory/core/lib/work-items";
import type {
  EntityOf,
  RefinementState,
  StatusCategory,
  WorkItemPriority,
} from "@lictory/core/contracts/protocol";
import { iterationLabel } from "@lictory/core/contracts/protocol";
import { Cog } from "lucide-react";
import { Avatar, SectionLabel } from "@lictory/ui/primitives";
import { AgentAvatar } from "@lictory/platform/components/identity/actor";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";
import { useDelivery } from "@lictory/platform/components/workspace/provider";
import { useItem } from "@lictory/platform/components/items/item-context";
import { cn } from "@lictory/core/lib/utils";
import { claimActivity } from "@lictory/platform/components/claims/activity";
import { activitySubject } from "@lictory/platform/components/review/activity-subject";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// Which of the person's agents executed a delegated change. The agent's name
// is its access token's name; entries recorded before agents were named fall
// back to the self-reported client.
function agentLabel(d: Record<string, unknown>) {
  if (d.performedVia === "agent") return "Litto";
  // A runner agent's session the factory dispatcher started.
  if (d.performedVia === "runner") return str(d.agentName) ?? "a runner agent";
  const name = str(d.agentName);
  if (name) return `${name} (MCP)`;
  const client = str(d.agentClient);
  return client ? `MCP (${client})` : "MCP";
}
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

// An inline-flex box takes its baseline from its first item, and an icon's
// baseline is its bottom edge. Let the label set the baseline so the chip
// sits on the same line as the surrounding sentence.
function IconLabel({
  icon,
  className,
  children,
}: {
  icon: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      {icon && <span className="flex self-center">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}

export function ActivityEntry({ entry }: { entry: EntityOf<"activity"> }) {
  const { memberName, disciplineName, project } = useItem();
  const delivery = useDelivery();
  const iterationName = (id: string | undefined) => {
    const it = id ? delivery.iterations.get(id) : undefined;
    return it
      ? iterationLabel(it, project.iterationMode)
      : "an earlier iteration";
  };
  const d = entry.detail ?? {};
  const auto = d.automatic === true;
  const person = memberName(entry.actorId);
  const subject = activitySubject(entry.action, d, person);
  const actor = subject.name;
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
    case "delivery_scope_committed":
      body = (
        <>
          accepted <b>revision {num(d.revision)}</b> for delivery
          {Array.isArray(d.failingChecks) && d.failingChecks.length > 0 && (
            <span className="text-warning">
              {" "}
              before all readiness checks passed
            </span>
          )}
        </>
      );
      break;
    case "delivery_scope_completed":
      body = (
        <>
          recorded <b>revision {num(d.revision)}</b> as delivered
        </>
      );
      break;
    case "decision_recorded":
      body = (
        <>
          recorded decision <b>{str(d.title)}</b>
        </>
      );
      break;
    case "decision_archive_changed":
      body = (
        <>
          {d.archived ? "archived" : "restored"} decision <b>{str(d.title)}</b>
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
          <IconLabel icon={category && <StatusIcon category={category} />}>
            <b>{to}</b>
          </IconLabel>
          {d.reason === "status_archived" && (
            <span className="text-muted-foreground">
              {" "}
              (the previous status was archived)
            </span>
          )}
          {early && (
            <span className="text-warning">
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
              <IconLabel
                icon={<RefinementIcon state={from} />}
                className="text-muted-foreground"
              >
                {refinementMeta[from].label}
              </IconLabel>{" "}
              →{" "}
            </>
          )}
          {to && refinementMeta[to] && (
            <IconLabel icon={<RefinementIcon state={to} />}>
              {refinementMeta[to].label}
            </IconLabel>
          )}
          {auto && (
            <span className="text-muted-foreground">
              {" "}
              automatically
              {d.reason === "readiness_checks_published" &&
                ` when Definition of Ready version ${num(d.readinessRevision)} was published`}
              {d.reason === "intelligence_review_completed" &&
                " when a Lictory Intelligence review completed"}
            </span>
          )}
        </>
      );
      break;
    }
    case "readiness_signed_off":
      body = (
        <>
          {d.override ? "overrode" : "signed off"} <b>{str(d.label)}</b> for
          revision {num(d.revision)}
        </>
      );
      break;
    case "readiness_sign_off_withdrawn":
      body = (
        <>
          withdrew{" "}
          {str(d.signedOffBy) && str(d.signedOffBy) !== entry.actorId ? (
            <>
              <b>{memberName(str(d.signedOffBy))}</b>’s
            </>
          ) : (
            "the"
          )}{" "}
          {d.override ? "override" : "sign-off"} of <b>{str(d.label)}</b>
        </>
      );
      break;
    case "readiness_checks_followed":
      body = (
        <>
          moved to Definition of Ready{" "}
          <b>{num(d.to) ? `version ${num(d.to)}` : "defaults"}</b>
          <span className="text-muted-foreground">
            {" "}
            after it was no longer ready (it was ready under version{" "}
            {num(d.from)})
          </span>
        </>
      );
      break;
    case "type_changed":
      body = (
        <>
          changed the type from {str(d.from)} to <b>{str(d.to)}</b>
        </>
      );
      break;
    case "team_changed":
      body = str(d.to) ? (
        <>
          moved this to{" "}
          <b>
            {delivery.teams.get(str(d.to) ?? "")?.name ??
              str(d.toName) ??
              "another team"}
          </b>
        </>
      ) : (
        <>removed this from its team</>
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
            ? "moved this under another parent"
            : "removed this from its parent"}
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
            {d.targetType === "discipline" ||
            d.targetType === "role" ||
            d.targetType === "group"
              ? d.targetType === "discipline"
                ? disciplineName(str(d.targetId))
                : `anyone in ${str(d.responsibility)}`
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
    // A material revision outdated these approvals: the record that an
    // approval no longer counts, and which revision it was for.
    case "approvals_outdated": {
      const outdated = Array.isArray(d.approvals)
        ? (d.approvals as {
            reviewerId?: string;
            responsibility?: string | null;
            revision?: number | null;
          }[])
        : [];
      body = (
        <>
          <b className="text-warning">outdated</b>{" "}
          {outdated.map((a, i) => (
            <span key={`${a.reviewerId}-${i}`}>
              {i > 0 && (i === outdated.length - 1 ? " and " : ", ")}
              <b>{memberName(a.reviewerId ?? "")}</b>’s{" "}
              {a.responsibility ? `${a.responsibility} ` : ""}approval
              {a.revision ? ` of revision ${a.revision}` : ""}
            </span>
          ))}{" "}
          with revision {num(d.revision)}
        </>
      );
      break;
    }
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
      ) : d.outcome === "created" ? (
        "the delivery tool"
      ) : (
        "the external issue"
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
    case "code_review_approved":
    case "code_review_changes_requested":
    case "code_pull_request_merged": {
      const ref = <PullRequestRef url={str(d.url)} number={num(d.number)} />;
      body =
        entry.action === "code_pull_request_merged" ? (
          <>
            merged pull request {ref}
            {str(d.login) && (
              <span className="text-muted-foreground">
                {" "}
                as {str(d.login)} on the code host
              </span>
            )}
          </>
        ) : (
          <>
            {entry.action === "code_review_approved"
              ? "approved"
              : "requested changes on"}{" "}
            pull request {ref}
            {str(d.headSha) && (
              <span className="text-muted-foreground">
                {" "}
                at{" "}
                <code className="font-mono text-xs">
                  {str(d.headSha)!.slice(0, 7)}
                </code>
              </span>
            )}
          </>
        );
      break;
    }
    case "code_pull_request_refused":
      body = (
        <>
          could not open {str(d.agentName) ?? "the agent"}&apos;s pull request
          for <b>{str(d.branch)}</b>: {str(d.reason)}
        </>
      );
      break;
    case "external_linked":
      body = (
        <>
          linked this to <b>{str(d.key)}</b>
        </>
      );
      break;
    case "code_linked":
    case "code_unlinked": {
      const what =
        d.target === "pull_request"
          ? "pull request"
          : d.target === "commit"
            ? "commit"
            : d.target === "issue"
              ? "issue"
              : "branch";
      const ref = str(d.url) ? (
        <a
          href={str(d.url)}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline-offset-2 hover:underline"
        >
          {str(d.ref)}
        </a>
      ) : (
        <b>{str(d.ref)}</b>
      );
      body =
        entry.action === "code_unlinked" ? (
          <>
            unlinked {what} {ref}
          </>
        ) : d.source === "key" ? (
          <>
            linked {what} {ref}, which mentions this item
          </>
        ) : d.source === "import" ? (
          <>imported this from issue {ref}</>
        ) : d.source === "lictory" || d.source === "agent_session" ? (
          <>
            {what === "branch" ? "created" : "opened"} {what} {ref}
          </>
        ) : (
          <>
            linked {what} {ref}
          </>
        );
      break;
    }
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
    case "pull_request_ready_to_merge":
      body = (
        <>
          found <b>{str(d.title)}</b> ready to merge: every merge requirement is
          met
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
          requested {str(d.discipline) ?? str(d.role)} review of{" "}
          <b>{str(d.title)}</b>
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
          <b>{str(d.title)}</b> for {str(d.discipline) ?? str(d.role)}
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
    case "ai_review_requested":
      body = <>requested a Lictory Intelligence review</>;
      break;
    case "ai_review_completed":
      body = (
        <>
          proposed{" "}
          <b>
            {num(d.findings)} {num(d.findings) === 1 ? "concern" : "concerns"}
          </b>{" "}
          in an AI assessment
          {str(d.requestedById) && (
            <> (requested by {memberName(str(d.requestedById))})</>
          )}
        </>
      );
      break;
    case "ai_corrective_pr_created":
      body = (
        <>
          opened a pull request proposing fixes for {num(d.findings)}{" "}
          {num(d.findings) === 1 ? "concern" : "concerns"}
        </>
      );
      break;
    case "ai_action_requested":
      body = (
        <>re-ran the Lictory Intelligence review action on a pull request</>
      );
      break;
    case "ai_action_completed":
      body = (
        <>
          reviewed commit <b>{str(d.commitId)?.slice(0, 7)}</b>:{" "}
          <b>{num(d.score)}/100</b> with {num(d.findings)}{" "}
          {num(d.findings) === 1 ? "finding" : "findings"}
        </>
      );
      break;
    case "ai_suggestion_applied":
      body = <>committed a Lictory Intelligence suggestion</>;
      break;
    default:
      body = claimActivity(entry.action, d) ?? (
        <>{entry.action.replaceAll("_", " ")}</>
      );
  }
  return (
    <li className="flex items-start gap-2 text-[13px] leading-5">
      {subject.kind === "agent" ? (
        <AgentAvatar
          agent={{ id: str(d.agentId) ?? subject.agent, name: subject.agent }}
          size={16}
          className="mt-0.5"
        />
      ) : subject.kind === "system" ? (
        <span
          aria-hidden
          className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
        >
          <Cog className="size-2.5" />
        </span>
      ) : (
        <Avatar
          userId={entry.actorId}
          name={actor}
          size="xs"
          className="mt-0.5"
        />
      )}
      <p className="min-w-0 flex-1">
        <span className="font-medium">{actor}</span> {body}
        {subject.after && (
          <span className="ml-1 text-xs text-muted-foreground">
            · {subject.after}
          </span>
        )}
        {subject.kind === "person" &&
          (d.performedVia === "agent" ||
            d.performedVia === "mcp" ||
            d.performedVia === "runner") && (
            <span
              className="ml-1 text-xs text-muted-foreground"
              title={
                str(d.agentClient) ? `Client: ${str(d.agentClient)}` : undefined
              }
            >
              via {agentLabel(d)}
            </span>
          )}
        {/* Lictory acted by itself for the person (the dispatcher, the
            Definition of Done, an expired lease). */}
        {str(d.automation) && subject.kind !== "system" && (
          <span className="ml-1 text-xs text-muted-foreground">
            · automatically
          </span>
        )}
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

function PullRequestRef({ url, number }: { url?: string; number?: number }) {
  const label = number !== undefined ? `#${number}` : "";
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="font-medium underline-offset-2 hover:underline"
    >
      {label}
    </a>
  ) : (
    <b>{label}</b>
  );
}
