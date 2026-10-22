import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "@lictory/core/db/auth-schema";

// Explicit, versioned read projections replicated to browsers by Zero. Every
// domain writer maintains these rows in the same transaction as its domain
// writes (see docs/internals/synchronization.md). `data` holds a protocol
// projection (an Entity, the organization Directory or its public profile),
// never a raw domain row: secrets and private configuration cannot reach it.
//
// `key` is `${type}:${id}`. A NULL `work_item_id` marks an organization-level
// list row (projects, work item summaries, labels, milestones, relations,
// external links, directory, organization profile); otherwise the row belongs
// to that work item's history, which clients load on demand.
export const syncEntity = pgTable(
  "sync_entity",
  {
    key: text("key").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    workItemId: text("work_item_id"),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("sync_entity_scope_idx").on(t.organizationId, t.workItemId, t.type),
  ],
);
