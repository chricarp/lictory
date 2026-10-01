// The notification catalog: every domain event a person may be told about.
// Shared by server (derivation, delivery) and client (inbox, preferences).
//
// Notifications exist to unblock work. Defaults follow that rule: events that
// ask something of the recipient (review requested, mentioned, blocking thread)
// notify in the app and by email; informational events notify in the app only;
// noisy events (every revision) are off until someone opts in.

export const notificationCategories = [
  "review",
  "discussion",
  "suggestions",
  "delivery",
  "iterations",
  "export",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

export const categoryLabels: Record<NotificationCategory, string> = {
  review: "Reviews and approvals",
  discussion: "Discussions and mentions",
  suggestions: "Branches and pull requests",
  delivery: "Work items",
  iterations: "Iterations",
  export: "Exports",
};

type Definition = {
  category: NotificationCategory;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
};

export const notificationKinds = {
  review_requested: {
    category: "review",
    label: "Review requested",
    description: "You or one of your roles is asked to review a specification.",
    inApp: true,
    email: true,
  },
  review_cancelled: {
    category: "review",
    label: "Review cancelled",
    description: "A review you were asked for is no longer needed.",
    inApp: true,
    email: false,
  },
  review_decided: {
    category: "review",
    label: "Review decision",
    description:
      "A reviewer approved, requested changes on, or revoked approval of an item you own or requested review for.",
    inApp: true,
    email: true,
  },
  approval_invalidated: {
    category: "review",
    label: "Your approval went stale",
    description:
      "The specification changed after you approved it and needs your review again.",
    inApp: true,
    email: true,
  },
  specification_revised: {
    category: "review",
    label: "Specification revised",
    description: "A new revision of a specification you are involved in.",
    inApp: false,
    email: false,
  },
  item_ready: {
    category: "review",
    label: "Ready for delivery",
    description: "All readiness checks pass for an item you are involved in.",
    inApp: true,
    email: true,
  },
  item_unready: {
    category: "review",
    label: "No longer ready",
    description: "A ready item failed a readiness check again.",
    inApp: true,
    email: false,
  },
  mentioned: {
    category: "discussion",
    label: "Mentioned",
    description: "Someone @mentioned you in a discussion.",
    inApp: true,
    email: true,
  },
  blocking_thread: {
    category: "discussion",
    label: "Blocking discussion",
    description:
      "A blocking discussion was opened (or a discussion was marked blocking) on an item you are involved in.",
    inApp: true,
    email: true,
  },
  thread_opened: {
    category: "discussion",
    label: "New discussion",
    description:
      "A non-blocking discussion was opened on an item you are involved in.",
    inApp: true,
    email: false,
  },
  thread_reply: {
    category: "discussion",
    label: "Reply",
    description: "Someone replied in a discussion you took part in.",
    inApp: true,
    email: false,
  },
  thread_resolved: {
    category: "discussion",
    label: "Discussion resolved or reopened",
    description: "A discussion you took part in was resolved or reopened.",
    inApp: true,
    email: false,
  },
  pull_request_review_requested: {
    category: "suggestions",
    label: "Pull request review requested",
    description: "You or one of your roles is asked to review a pull request.",
    inApp: true,
    email: true,
  },
  pull_request_decided: {
    category: "suggestions",
    label: "Pull request decision",
    description: "A reviewer decides a review on your pull request.",
    inApp: true,
    email: true,
  },
  pull_request_merged: {
    category: "suggestions",
    label: "Pull request merged",
    description: "A pull request you contribute to or review was merged.",
    inApp: true,
    email: false,
  },
  suggestion_review_requested: {
    category: "suggestions",
    label: "Suggestion review requested",
    description: "You are asked to review a suggested change.",
    inApp: true,
    email: true,
  },
  suggestion_decided: {
    category: "suggestions",
    label: "Suggestion decision",
    description: "A reviewer approved or requested changes on your suggestion.",
    inApp: true,
    email: true,
  },
  suggestion_updated: {
    category: "suggestions",
    label: "Suggestion updated",
    description: "A suggestion you review has a new version to look at.",
    inApp: true,
    email: false,
  },
  suggestion_merged: {
    category: "suggestions",
    label: "Suggestion merged or closed",
    description: "Your suggestion, or one you review, was merged or closed.",
    inApp: true,
    email: false,
  },
  assigned: {
    category: "delivery",
    label: "Assigned to you",
    description: "You became the assignee of a work item.",
    inApp: true,
    email: true,
  },
  status_changed: {
    category: "delivery",
    label: "Status changed",
    description: "The status of an item you are involved in changed.",
    inApp: true,
    email: false,
  },
  item_archived: {
    category: "delivery",
    label: "Archived or restored",
    description: "An item you are involved in was archived or restored.",
    inApp: true,
    email: false,
  },
  relation_blocked: {
    category: "delivery",
    label: "Blocked by another item",
    description: "An item you are involved in became blocked by another item.",
    inApp: true,
    email: false,
  },
  iteration_started: {
    category: "iterations",
    label: "Iteration started",
    description: "An iteration of one of your teams started.",
    inApp: true,
    email: false,
  },
  iteration_completed: {
    category: "iterations",
    label: "Iteration completed",
    description: "An iteration of one of your teams was completed.",
    inApp: true,
    email: false,
  },
  export_failed: {
    category: "export",
    label: "Export failed",
    description:
      "An export you started finished with failures or conflicts that need attention.",
    inApp: true,
    email: true,
  },
  export_completed: {
    category: "export",
    label: "Export completed",
    description: "An export you started finished successfully.",
    inApp: true,
    email: false,
  },
} as const satisfies Record<string, Definition>;

export type NotificationKind = keyof typeof notificationKinds;
export const notificationKindList = Object.keys(
  notificationKinds,
) as NotificationKind[];
export function isNotificationKind(kind: string): kind is NotificationKind {
  return kind in notificationKinds;
}

// Preferences are layered: team, then project, then organization, then the
// catalog default. The most specific rule for a kind wins. A team rule wins
// over a project rule because a team is where a person does the work.
export type PreferenceScope = "organization" | "project" | "team";
export type PreferenceRule = {
  scope: PreferenceScope;
  scopeId: string;
  kind: NotificationKind;
  inApp: boolean;
  email: boolean;
};
export type Channels = { inApp: boolean; email: boolean };

export function resolveChannels(
  rules: readonly PreferenceRule[],
  kind: NotificationKind,
  context: {
    organizationId: string;
    projectId?: string | null;
    teamId?: string | null;
  },
): Channels {
  const pick = (scope: PreferenceScope, scopeId?: string | null) =>
    scopeId
      ? rules.find(
          (r) => r.kind === kind && r.scope === scope && r.scopeId === scopeId,
        )
      : undefined;
  const rule =
    pick("team", context.teamId) ??
    pick("project", context.projectId) ??
    pick("organization", context.organizationId);
  const fallback = notificationKinds[kind];
  const channels = rule ?? fallback;
  // Email is a delivery of the in-app notification, never on its own.
  return { inApp: channels.inApp, email: channels.inApp && channels.email };
}
