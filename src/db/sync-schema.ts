import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./auth-schema";
import type { Change } from "../sync/shared/protocol";
export const syncClock = pgTable("sync_clock", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id),
  cursor: bigint("cursor", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
});
export const syncChange = pgTable(
  "sync_change",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    cursor: bigint("cursor", { mode: "bigint" }).notNull(),
    productId: text("product_id").notNull(),
    workItemId: text("work_item_id"),
    change: jsonb("change").$type<Change>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.cursor] }),
    index("sync_scope_cursor_idx").on(t.organizationId, t.productId, t.cursor),
  ],
);
export const syncMutation = pgTable(
  "sync_mutation",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    cursor: bigint("cursor", { mode: "bigint" }).notNull(),
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
    productId: text("product_id").notNull(),
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
