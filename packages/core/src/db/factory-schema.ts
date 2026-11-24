import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { project, workItem } from "@lictory/core/db/domain-schema";

// The Factory: agents, the runners that execute their sessions and the
// sessions themselves (docs/internals/factory.md). Domain rows here are never
// replicated; browsers read `factory_entity` (projections written in the
// same transaction) and `agent_session_event`, an append-only log shaped for
// synchronization whose payloads are bounded and carry no credentials.

export const agentKind = pgEnum("agent_kind", [
  // A coding harness executed on a runner.
  "runner",
  // An MCP client using an access token bound to the agent.
  "external",
  // Lictory Intelligence, built in.
  "intelligence",
]);

export const agentSessionStatus = pgEnum("agent_session_status", [
  "queued",
  "assigned",
  "running",
  "waiting",
  "completed",
  "failed",
  "canceled",
]);

export const agentApprovalStatus = pgEnum("agent_approval_status", [
  "pending",
  "approved",
  "denied",
  "expired",
]);

// A named, non-human member of an organization. It acts with its owner's
// permissions narrowed by its scope (`access`, `project_ids`), and never for
// anyone else.
export const agent = pgTable(
  "agent",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Lowercase, unique in the organization: `@forge` in channels.
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // A short visual token (an emoji or a palette name), never a URL.
    avatar: text("avatar"),
    // The accountable person. The agent never has more access than they do.
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    kind: agentKind("kind").notNull(),
    // Runner agents: which harness runs them and with which model.
    harness: text("harness"),
    model: text("model"),
    // Extra instructions given to the harness with every session.
    instructions: text("instructions").notNull().default(""),
    // `read` agents only reach queries.
    access: text("access").notNull().default("write"),
    // Null: every project of the organization. Otherwise only these.
    projectIds: text("project_ids").array(),
    // Other members may start sessions with it (it still acts as its owner).
    shared: boolean("shared").notNull().default(false),
    defaultRunnerId: text("default_runner_id").references(() => runner.id, {
      onDelete: "set null",
    }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_handle_idx").on(t.organizationId, t.handle),
    index("agent_owner_idx").on(t.ownerId),
    check("agent_access", sql`${t.access} in ('read', 'write')`),
    check("agent_handle_format", sql`${t.handle} ~ '^[a-z][a-z0-9_]{2,29}$'`),
    check("agent_name_present", sql`length(trim(${t.name})) > 0`),
  ],
);

// A machine that executes agent sessions. Organization runners run any
// eligible agent; personal runners (`owner_id`) only their owner's agents.
export const runner = pgTable(
  "runner",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").references(() => user.id),
    name: text("name").notNull(),
    // SHA-256 of the runner credential; the secret is shown once.
    credentialHash: text("credential_hash").notNull(),
    credentialPrefix: text("credential_prefix").notNull(),
    os: text("os").notNull().default(""),
    arch: text("arch").notNull().default(""),
    version: text("version").notNull().default(""),
    hostname: text("hostname").notNull().default(""),
    // Harnesses detected on the machine: [{ id, version }].
    harnesses: jsonb("harnesses")
      .$type<{ id: string; version: string | null }[]>()
      .notNull()
      .default([]),
    labels: text("labels").array().notNull().default([]),
    maxSessions: integer("max_sessions").notNull().default(2),
    // `host` or `container`.
    isolation: text("isolation").notNull().default("host"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedById: text("revoked_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("runner_credential_idx").on(t.credentialHash),
    index("runner_organization_idx").on(t.organizationId),
    check("runner_isolation", sql`${t.isolation} in ('host', 'container')`),
    check("runner_max_sessions", sql`${t.maxSessions} between 1 and 64`),
  ],
);

// A one-time registration token, valid for an hour. Exchanged once for a
// runner credential by `lictory-runner register`.
export const runnerRegistration = pgTable(
  "runner_registration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Set for a personal runner.
    ownerId: text("owner_id").references(() => user.id),
    tokenHash: text("token_hash").notNull(),
    prefix: text("prefix").notNull(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    runnerId: text("runner_id").references(() => runner.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("runner_registration_token_idx").on(t.tokenHash),
    index("runner_registration_organization_idx").on(t.organizationId),
  ],
);

// People are referenced without cascades: accounts are anonymized, never
// deleted (docs/internals/account-deletion.md), and history keeps them.

// One run of an agent on one task. Its lease (`lease_token`, renewed by the
// runner) fences every write from the runner that claimed it.
export const agentSession = pgTable(
  "agent_session",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    // The runner holding (or that last held) the session.
    runnerId: text("runner_id").references(() => runner.id, {
      onDelete: "set null",
    }),
    // Only this runner may claim it, when set.
    requestedRunnerId: text("requested_runner_id").references(() => runner.id, {
      onDelete: "set null",
    }),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => user.id),
    status: agentSessionStatus("status").notNull().default("queued"),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    workItemId: text("work_item_id").references(() => workItem.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    repositoryUrl: text("repository_url"),
    baseBranch: text("base_branch"),
    branch: text("branch"),
    // The conversation that steers the session (owned by Channels; no
    // foreign keys across modules).
    channelId: text("channel_id"),
    threadRootMessageId: text("thread_root_message_id"),
    resultSummary: text("result_summary"),
    // The code pull request the session opened (owned by Code).
    pullRequestId: text("pull_request_id"),
    pullRequestUrl: text("pull_request_url"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    // Last event sequence written, and the runner's last accepted batch
    // sequence for the current attempt (idempotent event batches).
    eventSequence: integer("event_sequence").notNull().default(0),
    runnerSequence: integer("runner_sequence").notNull().default(0),
    // Last steering input sequence written, and the first one the current
    // run reads after (a retry does not replay an earlier run's cancel).
    inputSequence: integer("input_sequence").notNull().default(0),
    inputCursor: integer("input_cursor").notNull().default(0),
    // The session-scoped Lictory access token issued to the current attempt.
    accessTokenId: text("access_token_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_session_queue_idx").on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    index("agent_session_runner_idx").on(t.runnerId, t.status),
    index("agent_session_lease_idx").on(t.status, t.leaseExpiresAt),
    index("agent_session_agent_idx").on(t.agentId, t.createdAt),
    // A reply in a channel thread finds the session it steers.
    index("agent_session_thread_idx").on(
      t.organizationId,
      t.threadRootMessageId,
    ),
    check(
      "agent_session_attempts",
      sql`${t.maxAttempts} between 1 and 10 and ${t.attempts} >= 0`,
    ),
  ],
);

// The session's append-only event log, shaped for synchronization: bounded
// payloads, per-session sequence, no credentials. Written only by
// factory/sessions.ts.
export const agentSessionEvent = pgTable(
  "agent_session_event",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.sequence] })],
);

// Steering inputs for the runner (messages, interrupt, cancel, approval
// answers), read by the runner's long-poll after a cursor.
export const agentSessionInput = pgTable(
  "agent_session_input",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.sequence] }),
    check(
      "agent_session_input_kind",
      sql`${t.kind} in ('message', 'interrupt', 'cancel', 'approval_answer')`,
    ),
  ],
);

// Something the agent asked a person to decide (a permission it lacks, a
// command it wants to run). Answering is a person's decision.
export const agentApproval = pgTable(
  "agent_approval",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    // The runner's id for the request, unique within the session.
    requestKey: text("request_key").notNull(),
    title: text("title").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    status: agentApprovalStatus("status").notNull().default("pending"),
    decidedById: text("decided_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_approval_request_idx").on(t.sessionId, t.requestKey),
    index("agent_approval_pending_idx").on(t.organizationId, t.status),
  ],
);

// Factory read projections replicated by Zero: agents, runners and session
// summaries (`data` is a protocol projection, never a raw row). `key` is
// `${type}:${id}`.
export const factoryEntity = pgTable(
  "factory_entity",
  {
    key: text("key").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("factory_entity_scope_idx").on(t.organizationId, t.type, t.updatedAt),
  ],
);
