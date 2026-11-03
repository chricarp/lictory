import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
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

// Organization-wide sign-in requirements set by organization administrators.
// No row means the defaults (nothing required). Changes are audited in
// `configuration_audit`.
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
