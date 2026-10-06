import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

// A personal access token lets an external agent (an MCP client) act as the
// user who created it. It grants no capability of its own: every call is
// authorized exactly like the user's web session, and `read` tokens are further
// limited to read-only capabilities. Only a SHA-256 hash of the secret is kept.
export const accessToken = pgTable(
  "access_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // `read` or `write`.
    scope: text("scope").notNull(),
    // First characters of the secret, shown so people can tell tokens apart.
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("access_token_hash_idx").on(t.tokenHash),
    index("access_token_user_idx").on(t.userId, t.createdAt),
    check("access_token_scope", sql`${t.scope} in ('read', 'write')`),
    check("access_token_name_present", sql`length(trim(${t.name})) > 0`),
  ],
);

// Audit of capability calls made by agents (MCP clients and the embedded
// Lictory agent). Web calls are already attributed through domain activity.
// Inputs are not stored: they can contain specification content.
export const capabilityInvocation = pgTable(
  "capability_invocation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    // `mcp` or `agent`.
    surface: text("surface").notNull(),
    tokenId: text("token_id").references(() => accessToken.id, {
      onDelete: "set null",
    }),
    // MCP client name reported at initialization, when known.
    client: text("client"),
    capability: text("capability").notNull(),
    // `ok` or the error category.
    outcome: text("outcome").notNull(),
    // Domain mutation id, for commands; joins to the sync receipt.
    mutationId: text("mutation_id"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("capability_invocation_user_idx").on(t.userId, t.createdAt),
    index("capability_invocation_org_idx").on(t.organizationId, t.createdAt),
  ],
);
