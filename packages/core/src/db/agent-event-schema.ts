import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "@lictory/core/db/auth-schema";
import { accessToken } from "@lictory/core/db/agent-schema";

// The agent event feed (docs/internals/agent-events.md): what is waiting on
// a person (or one of their agents), so external agents are woken instead
// of polling. Events are addressed, carry identifiers and a short title
// only, and are read back through ordinary, authorized capabilities.

// One addressed event for one person. Append-only; removed after the
// retention period (and with the organization or the person).
//
// Ordering is commit-safe: every writer takes one transaction lock before it
// draws sequence numbers and holds it until it commits
// (agent-events/feed.ts), so sequences become visible in order and a reader
// that passed `seq` never meets a smaller one later.
export const agentEvent = pgTable(
  "agent_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The person the event is addressed to.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Narrowed to one of the person's agents (a Factory agent id, or the
    // access token id an external agent claims with). Other agents bound
    // to the person do not see it; the person's own tokens do.
    agentId: text("agent_id"),
    // Event type from agent-events/catalog.ts.
    type: text("type").notNull(),
    // The notification kind (or agent-only kind) it was derived from.
    sourceKind: text("source_kind").notNull(),
    actorId: text("actor_id"),
    // What read-time authorization checks: the event is dropped when the
    // person can no longer read its space or channel, and agents limited
    // to projects only see their projects.
    projectId: text("project_id"),
    workItemId: text("work_item_id"),
    channelId: text("channel_id"),
    spaceId: text("space_id"),
    pageId: text("page_id"),
    // Identifiers and short titles only: never specification text or
    // message bodies (agent-events/catalog.ts builds it).
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    // The notice's deduplication key: one event per person and key, like
    // notifications (overlapping workers, repeated automatic steps).
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  },
  (t) => [
    index("agent_event_feed_idx").on(t.userId, t.seq),
    index("agent_event_org_idx").on(t.organizationId),
    index("agent_event_created_idx").on(t.createdAt),
    uniqueIndex("agent_event_dedupe_idx")
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

// Declared in contracts/state-machines.ts (`agentEventSubscription`).
export const agentEventSubscriptionStatus = pgEnum(
  "agent_event_subscription_status",
  ["active", "paused", "suspended", "expired"],
);
export const agentEventSubscriptionKind = pgEnum(
  "agent_event_subscription_kind",
  [
    // A destination a person registered in Account settings: a URL and a
    // bearer secret (Grok, Claude routines, OpenClaw hooks…).
    "webhook",
    // An MCP Events webhook subscription an MCP client created
    // (`events/subscribe`): one event type, signed with the client's
    // `whsec_` secret, kept alive by renewing before `refresh_before`.
    "mcp",
  ],
);

// Where a person's events are delivered. Both kinds share the delivery
// engine: in order, one event at a time, after a cursor, with retries.
export const agentEventSubscription = pgTable(
  "agent_event_subscription",
  {
    id: text("id").primaryKey(),
    kind: agentEventSubscriptionKind("kind").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Null: every organization the person belongs to (and whose policy
    // allows the destination).
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    // A Factory agent the subscription belongs to (its token was bound to
    // one): only that agent's events, inside its scope.
    agentId: text("agent_id"),
    // MCP subscriptions belong to the access token that created them and
    // stop when it stops working.
    accessTokenId: text("access_token_id").references(() => accessToken.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    // Encrypted (delivery/credentials.ts): the bearer secret of a webhook,
    // the client's `whsec_` signing secret of an MCP subscription.
    secret: text("secret").notNull(),
    // MCP: the replaced secret, still signed with until `previous_until`
    // so a receiver rotating its key loses nothing.
    previousSecret: text("previous_secret"),
    previousUntil: timestamp("previous_until"),
    // Event types delivered; empty means every type.
    eventTypes: text("event_types")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Only events of these projects (null: any).
    projectIds: text("project_ids").array(),
    // MCP: the subscription key's canonical arguments.
    arguments: jsonb("arguments").$type<Record<string, unknown>>(),
    // MCP: events older than this are not delivered (`maxAgeMs`).
    maxAgeMs: integer("max_age_ms"),
    status: agentEventSubscriptionStatus("status").notNull(),
    statusReason: text("status_reason"),
    // Delivered up to and including this event.
    cursorSeq: bigint("cursor_seq", { mode: "number" }).notNull(),
    // MCP: the granted lease; the subscription expires when it passes.
    refreshBefore: timestamp("refresh_before"),
    // Delivery state of the event at the cursor.
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    leaseUntil: timestamp("lease_until"),
    lastAttemptAt: timestamp("last_attempt_at"),
    lastSuccessAt: timestamp("last_success_at"),
    // A categorized reason (`timeout`, `http_5xx`, `blocked_address`…)
    // and the detail people read.
    lastError: text("last_error"),
    lastErrorDetail: text("last_error_detail"),
    failedSince: timestamp("failed_since"),
    deliveredCount: integer("delivered_count").default(0).notNull(),
    // MCP: verification handshake passed for (token, url).
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("agent_event_subscription_user_idx").on(t.userId),
    index("agent_event_subscription_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'active'`),
    index("agent_event_subscription_token_idx").on(t.accessTokenId),
    check(
      "agent_event_subscription_mcp_token",
      sql`${t.kind} <> 'mcp' or (${t.accessTokenId} is not null and ${t.refreshBefore} is not null)`,
    ),
    check(
      "agent_event_subscription_name_present",
      sql`length(trim(${t.name})) > 0`,
    ),
  ],
);

// Whether this organization's events may leave Lictory for webhook
// destinations, and where to. No row: allowed to any public host.
export const agentEventPolicy = pgTable("agent_event_policy", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  webhooksAllowed: boolean("webhooks_allowed").default(true).notNull(),
  // Host names (exact, or `*.example.com`); null: any host.
  allowedHosts: text("allowed_hosts").array(),
  version: integer("version").default(1).notNull(),
  updatedById: text("updated_by_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
