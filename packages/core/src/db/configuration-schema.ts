import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { invitation, organization } from "@lictory/core/db/auth-schema";

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

// Organization-wide sign-in requirements set by organization administrators.
// No row means the defaults (nothing required). Changes are recorded in the
// audit log (`two_factor.requirement_changed` in `audit_event`).
export const organizationSecurityPolicy = pgTable(
  "organization_security_policy",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Members must have two-factor authentication (an authenticator app)
    // before they can read or change the organization's data.
    requireTwoFactor: boolean("require_two_factor").default(false).notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
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

// Instance administration history: accounts created, deactivated or
// reactivated, instance administrators granted or revoked, organizations
// created by an administrator, and the first administrator set up on the
// server. Written by `recordInstanceAudit` (domain/instance-admin.ts). Not
// scoped to an organization, and readable only by instance administrators.
// The actor is a plain id with the name and email it had at the time (null
// when the server CLI acted). A database trigger refuses updates and deletes.
export const instanceAuditEvent = pgTable(
  "instance_audit_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    // `cli` (server command line), `web` (a person in the browser) or
    // `worker` (background work, such as deleting an organization).
    via: text("via").notNull(),
    // A catalogued action (`instanceAuditActions`), e.g. `user.deactivated`.
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("instance_audit_event_created_idx").on(t.createdAt, t.id),
    check("instance_audit_event_action_present", sql`length(${t.action}) > 0`),
    check(
      "instance_audit_event_via",
      sql`${t.via} in ('cli', 'web', 'worker')`,
    ),
  ],
);

// An organization an owner scheduled for deletion. While the row exists the
// organization is locked (members cannot open its data; owners can still
// export it and cancel). When `deleteAfter` has passed, the worker claims the
// row (`status` becomes `deleting`, which can no longer be cancelled), deletes
// the stored files, then every organization row in one transaction, and
// records `organization.deleted` in `instance_audit_event`. The row goes with
// the organization. Cancelling removes it. See
// docs/internals/organization-deletion.md.
export const organizationDeletion = pgTable(
  "organization_deletion",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    // A plain id with the name it had, like the audit log.
    requestedById: text("requested_by_id").notNull(),
    requestedByName: text("requested_by_name"),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    deleteAfter: timestamp("delete_after").notNull(),
    // `scheduled` (cancellable) or `deleting` (claimed by the worker).
    status: text("status").notNull().default("scheduled"),
    // Incremented by every claim; outcomes are fenced on it.
    attempt: integer("attempt").notNull().default(0),
    // The claim's lease, and after a failed attempt the time of the retry.
    leaseUntil: timestamp("lease_until"),
    startedAt: timestamp("started_at"),
    // Set once every stored file object is deleted, so retries skip storage.
    filesDeletedAt: timestamp("files_deleted_at"),
    // Why the last attempt failed; shown to instance administrators.
    error: text("error"),
  },
  (t) => [
    index("organization_deletion_due_idx").on(t.deleteAfter),
    check(
      "organization_deletion_status",
      sql`${t.status} in ('scheduled', 'deleting')`,
    ),
  ],
);

// Private invitation metadata; workspace membership is written only on acceptance.
export const invitationPlacement = pgTable(
  "invitation_placement",
  {
    invitationId: text("invitation_id")
      .primaryKey()
      .references(() => invitation.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    disciplineIds: jsonb("discipline_ids").$type<string[]>().notNull(),
    // Who chose this placement: the inviter, or an administrator who resent
    // the invitation with a new one. Placement is applied on their authority.
    placedById: text("placed_by_id"),
    appliedAt: timestamp("applied_at"),
    // What acceptance actually granted, so a join never hides missing access.
    outcome: jsonb("outcome").$type<{
      status: "applied" | "partial" | "skipped";
      missing: string[];
      reason?: string;
    }>(),
  },
  (t) => [index("invitation_placement_org_idx").on(t.organizationId)],
);
