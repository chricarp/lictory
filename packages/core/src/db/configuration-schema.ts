import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "@lictory/core/db/auth-schema";

// Immutable history of configuration changes: project and team settings,
// memberships, disciplines, integrations, and the retired delegated roles.
// A database trigger refuses updates, and deletes other than the
// organization's own deletion (see docs/internals/audit.md).
export const configurationAudit = pgTable(
  "configuration_audit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("configuration_audit_org_idx").on(t.organizationId, t.createdAt),
  ],
);

// Append-only record of security-relevant events in an organization:
// membership, application roles, invitations, access tokens, exports.
// Written by `recordAuditEvent` (domain/audit.ts), in the same transaction as
// the change whenever Lictory owns the write. The actor is a plain id (not a
// foreign key) with the name and email it had at the time, so entries stay
// readable after an account is renamed or deleted. Never store secrets or
// specification content in `detail`. A database trigger refuses updates, and
// deletes other than the organization's own deletion.
export const auditEvent = pgTable(
  "audit_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The person who acted; null when Lictory itself acted.
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    // A catalogued action (`auditActions`), e.g. `member.role_changed`.
    action: text("action").notNull(),
    // What the action was applied to: a member, invitation, access token...
    targetType: text("target_type"),
    targetId: text("target_id"),
    // A readable name for the target at the time (email, token name).
    targetLabel: text("target_label"),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_event_org_idx").on(t.organizationId, t.createdAt, t.id),
    check("audit_event_action_present", sql`length(${t.action}) > 0`),
  ],
);
