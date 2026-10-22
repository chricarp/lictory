import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { organization } from "@lictory/core/db/auth-schema";

// Immutable history of configuration changes: project and team settings,
// memberships, disciplines, integrations, and the retired delegated roles.
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
