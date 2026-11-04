import { paths } from "@lictory/core/lib/paths";
import {
  notificationKinds,
  type NotificationKind,
} from "@lictory/core/notifications/catalog";

// One sentence per notification, shared by the inbox and email. Pure: the
// caller supplies names so both server and client can render.
export type NotificationView = {
  kind: string;
  detail: Record<string, unknown>;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) =>
  typeof v === "number" || typeof v === "string" ? String(v) : "?";

export function describeNotification(
  n: NotificationView,
  actor: string,
): { headline: string; body: string | null } {
  const d = n.detail;
  const item = str(d.itemKey) ?? "an item";
  const excerpt = str(d.excerpt);
  const responsibility = str(d.responsibility);
  const suggestion = str(d.suggestionTitle)
    ? `“${str(d.suggestionTitle)}”`
    : "a suggestion";
  switch (n.kind as NotificationKind) {
    case "review_requested":
      return {
        headline: `${actor} requested ${responsibility ? `${responsibility} ` : ""}review of ${item}`,
        body: d.revision
          ? `Revision ${num(d.revision)}${d.required ? " · required" : ""}`
          : null,
      };
    case "review_cancelled":
      return {
        headline: `${actor} cancelled the ${responsibility ? `${responsibility} ` : ""}review of ${item}`,
        body: null,
      };
    case "review_decided": {
      const verb =
        d.decision === "approved"
          ? "approved"
          : d.decision === "changes_requested"
            ? "requested changes on"
            : "revoked approval of";
      return {
        headline: `${actor} ${verb} ${item}`,
        body: responsibility
          ? `${responsibility} review · revision ${num(d.revision)}`
          : null,
      };
    }
    case "approval_invalidated":
      return {
        headline: `Your approval of ${item} needs review again`,
        body: str(d.pullRequestTitle)
          ? `${actor} changed the merge result of “${str(d.pullRequestTitle)}”.`
          : `${actor} revised the specification to revision ${num(d.revision)}.`,
      };
    case "specification_revised":
      return {
        headline: `${actor} revised ${item} (revision ${num(d.revision)})`,
        body: str(d.summary),
      };
    case "item_ready":
      return {
        headline: `${item} is ready`,
        body: "All readiness checks pass.",
      };
    case "item_unready":
      return {
        headline: `${item} is no longer ready`,
        body: "A readiness check failed again.",
      };
    case "mentioned":
      return { headline: `${actor} mentioned you on ${item}`, body: excerpt };
    case "blocking_thread":
      return {
        headline: d.marked
          ? `${actor} marked a discussion on ${item} as blocking`
          : `${actor} opened a blocking discussion on ${item}`,
        body: excerpt,
      };
    case "thread_opened":
      return {
        headline: `${actor} started a discussion on ${item}`,
        body: excerpt,
      };
    case "thread_reply":
      return { headline: `${actor} replied on ${item}`, body: excerpt };
    case "thread_resolved":
      return {
        headline: `${actor} ${d.resolved ? "resolved" : "reopened"} a discussion on ${item}`,
        body: null,
      };
    case "pull_request_review_requested":
      return {
        headline: `${actor} requested ${responsibility ?? ""} review of pull request “${str(d.pullRequestTitle) ?? "Proposed change"}” on ${item}`,
        body: null,
      };
    case "pull_request_decided":
      return {
        headline: `${actor} ${d.decision === "approve" ? "approved" : d.decision === "revoke" ? "revoked their review of" : "requested changes on"} pull request “${str(d.pullRequestTitle) ?? "Proposed change"}” on ${item}`,
        body: responsibility,
      };
    case "pull_request_mergeable":
      return {
        headline: `Pull request “${str(d.pullRequestTitle) ?? "Proposed change"}” on ${item} is ready to merge`,
        body: str(d.target)
          ? `Every requirement to merge into ${str(d.target)} is met.`
          : "Every merge requirement is met.",
      };
    case "pull_request_merged":
      return {
        headline: `${actor} merged pull request “${str(d.pullRequestTitle) ?? "Proposed change"}” on ${item}`,
        body: str(d.target) ? `Merged into ${str(d.target)}` : null,
      };
    case "suggestion_review_requested":
      return {
        headline: `${actor} asked you to review ${suggestion} on ${item}`,
        body: null,
      };
    case "suggestion_decided":
      return {
        headline: `${actor} ${d.decision === "approved" ? "approved" : "requested changes on"} ${suggestion} on ${item}`,
        body: d.version ? `Version ${num(d.version)}` : null,
      };
    case "suggestion_updated":
      return {
        headline: `${actor} updated ${suggestion} on ${item}`,
        body: `Version ${num(d.version)} needs your review.`,
      };
    case "suggestion_merged":
      return {
        headline: `${actor} ${d.merged ? "merged" : "closed"} ${suggestion} on ${item}`,
        body: null,
      };
    case "assigned":
      return { headline: `${actor} assigned ${item} to you`, body: null };
    case "status_changed":
      return {
        headline: `${actor} moved ${item} to ${str(d.to) ?? "a new status"}`,
        body: str(d.from) ? `From ${str(d.from)}` : null,
      };
    case "item_archived":
      return {
        headline: `${actor} ${d.archived ? "archived" : "restored"} ${item}`,
        body: null,
      };
    case "relation_blocked":
      return {
        headline: `${item} is now blocked by ${str(d.blockerKey) ?? "another item"}`,
        body: null,
      };
    case "iteration_started":
      return {
        headline: `${str(d.iterationName) ?? "An iteration"} started`,
        body: str(d.projectName) ?? str(d.teamName),
      };
    case "iteration_completed": {
      const carried = d.carriedOver as { count?: number } | null | undefined;
      return {
        headline: `${str(d.iterationName) ?? "An iteration"} was completed`,
        body:
          [
            str(d.projectName) ?? str(d.teamName),
            carried?.count ? `${carried.count} unfinished carried over` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
      };
    }
    case "export_failed": {
      const failures = (d.failures as { message: string | null }[]) ?? [];
      return {
        headline: `Export ${d.itemKey ? `of ${item} ` : ""}to ${str(d.connectionName) ?? "the delivery tool"} ${d.status === "partial" ? "partly failed" : "failed"}`,
        body: `${num(d.failed)} of ${num(d.total)} items were not exported.${failures[0]?.message ? ` ${failures[0].message}` : ""}`,
      };
    }
    case "export_completed":
      return {
        headline: `Export ${d.itemKey ? `of ${item} ` : ""}to ${str(d.connectionName) ?? "the delivery tool"} completed`,
        body: `${num(d.total)} items exported.`,
      };
    case "organization_deletion_scheduled":
      return {
        headline: `${actor} scheduled ${str(d.organizationName) ?? "the organization"} for deletion${str(d.deleteDay) ? ` on ${str(d.deleteDay)}` : ""}`,
        body: "Its projects, work items, specifications, reviews, discussions and files will then be permanently deleted. Until then the organization is locked. If this is a mistake, ask an owner to cancel the deletion.",
      };
    case "organization_deletion_cancelled":
      return {
        headline: `${actor} cancelled the deletion of ${str(d.organizationName) ?? "the organization"}`,
        body: "The organization is open again; nothing was deleted.",
      };
  }
  return {
    headline:
      (notificationKinds as Record<string, { label: string }>)[n.kind]?.label ??
      "Notification",
    body: null,
  };
}

// Where a notification leads. Item links use the project-agnostic route.
export function notificationHref(
  orgSlug: string,
  n: NotificationView & { teamId?: string | null },
) {
  const d = n.detail;
  const key = str(d.itemKey);
  if (key)
    return `${paths.itemByKey(orgSlug, key)}${str(d.pullRequestId) ? `?pr=${encodeURIComponent(str(d.pullRequestId)!)}` : ""}`;
  const projectKey = str(d.projectKey);
  const iterationId = str(d.iterationId);
  if (projectKey && iterationId)
    return paths.iteration(orgSlug, projectKey, iterationId);
  return paths.inbox(orgSlug);
}
