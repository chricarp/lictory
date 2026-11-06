import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "@lictory/core/db/auth-schema";

// A notification is a per-recipient record of a domain event. It is written in
// the same transaction as the event, so a notification never exists for a
// change that rolled back and never goes missing for one that committed.
export const notification = pgTable(
  "notification",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Catalog key (src/notifications/catalog.ts).
    kind: text("kind").notNull(),
    // Null for system actors (automatic cycles, scheduled jobs).
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id"),
    teamId: text("team_id"),
    workItemId: text("work_item_id"),
    // Lictory Spaces notifications name their space and page. Reading one
    // (inbox, unread counts, email) requires current access to that space,
    // not only organization membership, so nobody who lost access sees a
    // page title or excerpt again.
    spaceId: text("space_id"),
    pageId: text("page_id"),
    // Rendering context captured at event time (item key and title, thread
    // excerpt, review responsibility…). Links resolve against live data.
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    // Makes system-generated notifications idempotent (job retries).
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("notification_inbox_idx").on(t.userId, t.createdAt),
    index("notification_unread_idx")
      .on(t.userId, t.organizationId)
      .where(sql`${t.readAt} is null and ${t.archivedAt} is null`),
    uniqueIndex("notification_dedupe_idx")
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

export const notificationPreferenceScope = pgEnum(
  "notification_preference_scope",
  ["organization", "project", "team"],
);

// Only explicit choices are stored; absent rows fall back to the catalog
// default. Resolution order: team, project, organization, default.
export const notificationPreference = pgTable(
  "notification_preference",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: notificationPreferenceScope("scope").notNull(),
    // Organization, project or team ID according to scope.
    scopeId: text("scope_id").notNull(),
    kind: text("kind").notNull(),
    inApp: boolean("in_app").notNull(),
    email: boolean("email").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    primaryKey({
      name: "notification_preference_pk",
      columns: [t.userId, t.organizationId, t.scope, t.scopeId, t.kind],
    }),
  ],
);

// Explicit watch state. Involvement (author, assignee, reviewer, participant)
// subscribes implicitly; a row with watching=false opts out of that too.
export const workItemWatcher = pgTable(
  "work_item_watcher",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    workItemId: text("work_item_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    watching: boolean("watching").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.workItemId, t.userId] })],
);

export const notificationEmailStatus = pgEnum("notification_email_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

// Email outbox. One row per notification that should be emailed; a worker
// claims rows with a lease, sends with an idempotency key and records the
// outcome. Failures retry with backoff up to a bounded number of attempts.
export const notificationEmail = pgTable(
  "notification_email",
  {
    notificationId: text("notification_id")
      .primaryKey()
      .references(() => notification.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: notificationEmailStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    leaseUntil: timestamp("lease_until"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("notification_email_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);
