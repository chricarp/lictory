import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "@lictory/core/db/auth-schema";
// Idempotency receipts: a mutation id is bound to its actor and command for
// every writer (Zero pushes, capabilities, MCP, the embedded agent).
export const syncMutation = pgTable(
  "sync_mutation",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.id] })],
);
export const activity = pgTable(
  "activity",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    projectId: text("project_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    actorId: text("actor_id").notNull(),
    // Domain action key (e.g. status_changed) with structured detail for rendering.
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("activity_item_idx").on(t.organizationId, t.workItemId, t.createdAt),
  ],
);
