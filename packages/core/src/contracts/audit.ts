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
