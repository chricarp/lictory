import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
import {
  project,
  specificationRevision,
  workItem,
} from "@lictory/core/db/domain-schema";
import type {
  AutopilotRequirement,
  DoneCheckDefinition,
} from "@lictory/core/claims/contracts";

// Claims, autonomy policy and the Definition of Done
// (docs/internals/claims.md). Agent and agent session ids are text without
// foreign keys: the Factory module owns those tables, and a claim must stay
// readable history after an agent is removed.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });
const actor = (name: string) =>
  text(name)
    .notNull()
    .references(() => user.id, { onDelete: "restrict" });
const optionalActor = (name: string) =>
  text(name).references(() => user.id, { onDelete: "restrict" });

// Declared in contracts/state-machines.ts (`claim`).
export const claimState = pgEnum("claim_state", [
  "starting",
  "active",
  "waiting",
  "released",
  "completed",
]);
export const autonomyLevel = pgEnum("autonomy_level", [
  "assist",
  "build",
  "autopilot",
]);

// A lease by an agent session on one native delivery item. At most one live
// claim per item (partial unique index); the organization lock serializes
// claims, the index makes the invariant the database's.
export const workItemClaim = pgTable(
  "work_item_claim",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    // The agent holding it, and its name when it claimed (history keeps it
    // readable). External MCP agents: the access token.
    agentId: text("agent_id").notNull(),
    agentName: text("agent_name").notNull(),
    agentSessionId: text("agent_session_id"),
    // The accountable person the agent acts for.
    ownerId: actor("owner_id"),
    // `agent` claimed it itself; `dispatcher` reserved it for a session.
    source: text("source").notNull(),
    state: claimState("state").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    // The status before the claim started work and the one it moved to, so
    // a release returns the item only if nobody moved it meanwhile.
    fromStatusId: text("from_status_id"),
    startedStatusId: text("started_status_id"),
    lastProgress: text("last_progress"),
    lastProgressAt: timestamp("last_progress_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedById: optionalActor("ended_by_id"),
    // released: agent, person, expired, launch_failed; completed: done.
    endReason: text("end_reason"),
    endNote: text("end_note"),
    // Completed: the revision the Definition of Done recorded as delivered.
    deliveredRevisionId: text("delivered_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.projectId, t.workItemId],
      foreignColumns: [
        workItem.organizationId,
        workItem.projectId,
        workItem.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("work_item_claim_live_unique")
      .on(t.organizationId, t.workItemId)
      .where(sql`${t.state} in ('starting', 'active', 'waiting')`),
    index("work_item_claim_project_idx").on(
      t.organizationId,
      t.projectId,
      t.state,
    ),
    index("work_item_claim_item_idx").on(
      t.organizationId,
      t.workItemId,
      t.createdAt,
    ),
    check(
      "work_item_claim_source",
      sql`${t.source} in ('agent', 'dispatcher')`,
    ),
    check(
      "work_item_claim_end_consistent",
      sql`(${t.state} in ('released', 'completed')) = (${t.endedAt} IS NOT NULL)`,
    ),
  ],
);

// A question an agent asked while holding a claim: a blocking discussion on
// the specification. The claim waits while any is unresolved.
export const claimQuestion = pgTable(
  "claim_question",
  {
    id: id(),
    organizationId: organizationId(),
    claimId: text("claim_id")
      .notNull()
      .references(() => workItemClaim.id, { onDelete: "restrict" }),
    // The item whose specification holds the discussion (the claimed item
    // or its nearest specification ancestor).
    workItemId: text("work_item_id").notNull(),
    threadId: text("thread_id").notNull(),
    askedAt: timestamp("asked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: optionalActor("resolved_by_id"),
  },
  (t) => [
    uniqueIndex("claim_question_thread_unique").on(
      t.organizationId,
      t.threadId,
    ),
    index("claim_question_claim_idx").on(t.organizationId, t.claimId),
  ],
);

// A project's autonomy policy. No row: Assist with Lictory's defaults.
// Every change is recorded in the configuration audit with the previous
// policy, so it can be read back and reverted.
export const autonomyPolicy = pgTable(
  "autonomy_policy",
  {
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    level: autonomyLevel("level").notNull(),
    implementerAgentIds: jsonb("implementer_agent_ids")
      .$type<string[]>()
      .notNull(),
    reviewerAgentId: text("reviewer_agent_id"),
    maxConcurrentSessions: integer("max_concurrent_sessions").notNull(),
    autopilotRequires: jsonb("autopilot_requires")
      .$type<AutopilotRequirement[]>()
      .notNull(),
    version: integer("version").notNull(),
    updatedById: actor("updated_by_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.projectId] }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    check(
      "autonomy_policy_concurrency",
      sql`${t.maxConcurrentSessions} between 1 and 20`,
    ),
  ],
);

// A project's Definition of Done. No row: Lictory's defaults.
export const definitionOfDone = pgTable(
  "definition_of_done",
  {
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    checks: jsonb("checks").$type<DoneCheckDefinition[]>().notNull(),
    version: integer("version").notNull(),
    updatedById: actor("updated_by_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.projectId] }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
  ],
);

// A person's sign-off on a Definition of Done check, or their override of
// a failing one, for one item and revision. Withdrawing keeps the record.
export const doneSignOff = pgTable(
  "done_sign_off",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    checkId: text("check_id").notNull(),
    // `sign_off` (acceptance verified) or `override` (passed by hand).
    kind: text("kind").notNull(),
    reason: text("reason"),
    userId: actor("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnById: optionalActor("withdrawn_by_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("done_sign_off_active_unique")
      .on(t.organizationId, t.workItemId, t.revisionId, t.checkId)
      .where(sql`${t.withdrawnAt} IS NULL`),
    index("done_sign_off_item_idx").on(t.organizationId, t.workItemId),
    check("done_sign_off_kind", sql`${t.kind} in ('sign_off', 'override')`),
    check(
      "done_sign_off_override_reason",
      sql`${t.kind} <> 'override' OR length(trim(coalesce(${t.reason}, ''))) > 0`,
    ),
    check(
      "done_sign_off_withdrawal_consistent",
      sql`(${t.withdrawnAt} IS NULL) = (${t.withdrawnById} IS NULL)`,
    ),
  ],
);

// The dispatcher's memory of failed starts for one item: consecutive
// failures and when it may try again. A completed claim or a person's retry
// clears it.
export const dispatchBackoff = pgTable(
  "dispatch_backoff",
  {
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    failures: integer("failures").notNull(),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
    }).notNull(),
    lastError: text("last_error").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.workItemId] })],
);

// Merges Autopilot requested: one per pull request head, so a retry never
// asks twice. Attributed to the policy version and the administrator who
// set it, never to the agent.
export const autopilotMerge = pgTable(
  "autopilot_merge",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    claimId: text("claim_id").references(() => workItemClaim.id, {
      onDelete: "restrict",
    }),
    pullRequestId: text("pull_request_id").notNull(),
    headSha: text("head_sha").notNull(),
    policyVersion: integer("policy_version").notNull(),
    // The administrator whose policy decision this merge carries out.
    authorizedById: actor("authorized_by_id"),
    // `requested` (handed to the code host's merge executor) or `refused`.
    outcome: text("outcome").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("autopilot_merge_head_unique").on(
      t.organizationId,
      t.pullRequestId,
      t.headSha,
    ),
    check(
      "autopilot_merge_outcome",
      sql`${t.outcome} in ('requested', 'refused')`,
    ),
  ],
);
