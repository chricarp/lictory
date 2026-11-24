// The audit log's vocabulary, shared by the server and the browser. See
// docs/internals/audit.md.

export const auditCategories = [
  "membership",
  "access",
  "organization",
  "configuration",
  "agent",
] as const;
export type AuditCategory = (typeof auditCategories)[number];

// Every action `audit_event` may hold. Add new actions here (with a category
// and a past-tense label) before recording them; the audit view and CSV use
// the label, filters use the category.
export const auditActions = {
  "organization.created": {
    category: "organization",
    label: "Created the organization",
  },
  "organization.updated": {
    category: "organization",
    label: "Changed the organization's name or handle",
  },
  "audit_log.exported": {
    category: "organization",
    label: "Exported the audit log",
  },
  "data_export.requested": {
    category: "organization",
    label: "Started an export of the organization's data",
  },
  "data_export.downloaded": {
    category: "organization",
    label: "Downloaded an export of the organization's data",
  },
  "organization.deletion_scheduled": {
    category: "organization",
    label: "Scheduled the organization's deletion",
  },
  "organization.deletion_cancelled": {
    category: "organization",
    label: "Cancelled the organization's deletion",
  },
  "member.added": { category: "membership", label: "Added a member" },
  "member.joined": {
    category: "membership",
    label: "Joined by accepting an invitation",
  },
  "member.removed": { category: "membership", label: "Removed a member" },
  "member.left": { category: "membership", label: "Left the organization" },
  "member.account_deleted": {
    category: "membership",
    label: "Deleted their account",
  },
  "member.role_changed": {
    category: "membership",
    label: "Changed an application role",
  },
  "invitation.created": { category: "membership", label: "Invited someone" },
  "invitation.cancelled": {
    category: "membership",
    label: "Withdrew an invitation",
  },
  "invitation.rejected": {
    category: "membership",
    label: "Declined an invitation",
  },
  "access_token.created": {
    category: "access",
    label: "Created an access token",
  },
  "access_token.revoked": {
    category: "access",
    label: "Revoked an access token",
  },
  "agent.created": { category: "access", label: "Created an agent" },
  "agent.updated": { category: "access", label: "Changed an agent" },
  "agent.scope_changed": {
    category: "access",
    label: "Changed an agent's access or projects",
  },
  "agent.archived": { category: "access", label: "Archived an agent" },
  "agent.restored": { category: "access", label: "Restored an agent" },
  "runner.registration_created": {
    category: "access",
    label: "Created a runner registration token",
  },
  "runner.registered": { category: "access", label: "Registered a runner" },
  "runner.revoked": { category: "access", label: "Revoked a runner" },
  "two_factor.requirement_changed": {
    category: "access",
    label: "Changed the two-factor requirement",
  },
  "two_factor.member_reset": {
    category: "access",
    label: "Reset a member's two-factor authentication",
  },
  // Agent events (docs/internals/agent-events.md): where a person's events
  // leave Lictory.
  "event_webhook.created": {
    category: "access",
    label: "Added an agent event webhook",
  },
  "event_webhook.deleted": {
    category: "access",
    label: "Removed an agent event webhook",
  },
  "event_subscription.created": {
    category: "access",
    label: "An MCP client subscribed to agent events",
  },
  "event_subscription.deleted": {
    category: "access",
    label: "An MCP event subscription ended",
  },
  // Lictory Channels: who can read a conversation. Public channel joins and
  // direct conversations are not security events and are not recorded.
  "channel.created": { category: "access", label: "Created a channel" },
  "channel.archived": { category: "access", label: "Archived a channel" },
  "channel.restored": { category: "access", label: "Restored a channel" },
  "channel.member_added": {
    category: "access",
    label: "Added someone to a private channel",
  },
  "channel.member_removed": {
    category: "access",
    label: "Removed someone from a private channel",
  },
  // Slack: conversations leave Lictory for a workspace the organization
  // controls, so connecting and linking are access events.
  "slack.app_saved": {
    category: "access",
    label: "Saved the Slack app's credentials",
  },
  "slack.installed": { category: "access", label: "Installed the Slack app" },
  "slack.disconnected": { category: "access", label: "Disconnected Slack" },
  "slack.channel_linked": {
    category: "access",
    label: "Linked a channel to Slack",
  },
  "slack.channel_unlinked": {
    category: "access",
    label: "Unlinked a channel from Slack",
  },
} as const satisfies Record<
  string,
  { category: Exclude<AuditCategory, "configuration" | "agent">; label: string }
>;
export type AuditAction = keyof typeof auditActions;

// One audit log entry as the server returns it.
export type AuditEntry = {
  id: string;
  source: "event" | "configuration" | "agent";
  category: AuditCategory;
  at: string;
  actor: { id: string; name: string | null; email: string | null } | null;
  action: string;
  label: string;
  summary: string;
  target: { type: string; id: string | null; label: string | null } | null;
  detail: Record<string, unknown>;
};
