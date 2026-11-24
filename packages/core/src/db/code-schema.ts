import { sql } from "drizzle-orm";
import {
  boolean,
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
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "@lictory/core/db/auth-schema";
import { project, workItem } from "@lictory/core/db/domain-schema";

// The Code module (docs/internals/code-hosts.md): code host connections,
// read-only mirrors of what the hosts own, the links Lictory owns between
// work items and code, the webhook inbox and the outbox of writes to hosts.
//
// Ownership: every mirrored column (repositories, branches, pull requests,
// checks, issues, commits) is written only by ingest (webhooks,
// reconciliation, backfill) and by the outbox recording what a host
// answered. Nothing a person or agent sends edits a mirror. Links and their
// history are Lictory's. Credentials and webhook secrets are encrypted
// columns of their connection and never reach a projection.

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
const createdAt = () => timestamp("created_at").defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const codeHostProvider = pgEnum("code_host_provider", [
  "github",
  "gitlab",
  "bitbucket",
]);
export type CodeHostProviderKind = (typeof codeHostProvider.enumValues)[number];

// How a connection authenticates. `github_app` mints short-lived
// installation tokens; `token` stores one long-lived token (personal,
// group, project or repository access token, or an Atlassian API token);
// `oauth_consumer` exchanges a Bitbucket OAuth consumer for short-lived
// access tokens.
export const codeHostAuthKind = pgEnum("code_host_auth_kind", [
  "github_app",
  "token",
  "oauth_consumer",
]);
export type CodeHostAuthKind = (typeof codeHostAuthKind.enumValues)[number];

export const codeConnectionStatus = pgEnum("code_connection_status", [
  "active",
  "invalid",
]);

export const codeConnection = pgTable(
  "code_connection",
  {
    id: id(),
    organizationId: organizationId(),
    provider: codeHostProvider("provider").notNull(),
    name: text("name").notNull(),
    // Canonical web origin of the host (https://github.com, a GitHub
    // Enterprise Server, https://gitlab.com or a self-managed GitLab,
    // https://bitbucket.org). The adapter derives its API URL from it.
    baseUrl: text("base_url").notNull(),
    authKind: codeHostAuthKind("auth_kind").notNull(),
    // Who the credential acts as on the host (display only).
    accountLabel: text("account_label").notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    // HMAC key (GitHub, Bitbucket) or shared token (GitLab) the host signs
    // webhooks with; encrypted like the credential.
    encryptedWebhookSecret: text("encrypted_webhook_secret").notNull(),
    status: codeConnectionStatus("status").default("active").notNull(),
    lastError: text("last_error"),
    lastVerifiedAt: timestamp("last_verified_at").notNull(),
    lastWebhookAt: timestamp("last_webhook_at"),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("code_connection_org_id_unique").on(t.organizationId, t.id),
    check("code_connection_name_present", sql`length(trim(${t.name})) > 0`),
    index("code_connection_org_idx").on(t.organizationId),
  ],
);

export const codeRepositoryVisibility = pgEnum("code_repository_visibility", [
  "public",
  "private",
  "internal",
]);

// A repository Lictory mirrors: it enters this table when someone links it
// to a project, and stays (history) when every link is removed.
export const codeRepository = pgTable(
  "code_repository",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: text("connection_id").notNull(),
    // The host's stable id (GitHub node-independent numeric id, GitLab
    // project id, Bitbucket UUID).
    externalId: text("external_id").notNull(),
    // owner/name, group/subgroup/project or workspace/slug.
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    webUrl: text("web_url").notNull(),
    cloneUrl: text("clone_url").notNull(),
    visibility: codeRepositoryVisibility("visibility").notNull(),
    hostArchived: boolean("host_archived").default(false).notNull(),
    // Reconciliation: when it last completed, and when the next run is due
    // (set to now by a link or a backfill request).
    lastSyncedAt: timestamp("last_synced_at"),
    syncDueAt: timestamp("sync_due_at"),
    syncLeaseUntil: timestamp("sync_lease_until"),
    lastSyncError: text("last_sync_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("code_repository_org_id_unique").on(t.organizationId, t.id),
    unique("code_repository_external_unique").on(
      t.organizationId,
      t.connectionId,
      t.externalId,
    ),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [codeConnection.organizationId, codeConnection.id],
    }).onDelete("restrict"),
    index("code_repository_sync_idx").on(t.syncDueAt),
  ],
);

// Which projects a repository serves. Key detection only links items of
// these projects.
export const codeRepositoryProject = pgTable(
  "code_repository_project",
  {
    organizationId: organizationId(),
    repositoryId: text("repository_id").notNull(),
    projectId: text("project_id").notNull(),
    linkedById: actor("linked_by_id"),
    // The repository agent sessions of the project work in when the
    // session names none (at most one per project; else the first linked).
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.repositoryId, t.projectId] }),
    uniqueIndex("code_repository_project_default_unique")
      .on(t.organizationId, t.projectId)
      .where(sql`${t.isDefault}`),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [codeRepository.organizationId, codeRepository.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    index("code_repository_project_project_idx").on(
      t.organizationId,
      t.projectId,
    ),
  ],
);

export const codeBranch = pgTable(
  "code_branch",
  {
    id: id(),
    organizationId: organizationId(),
    repositoryId: text("repository_id").notNull(),
    name: text("name").notNull(),
    headSha: text("head_sha"),
    // The host deleted the branch; links keep pointing at this row.
    deletedAt: timestamp("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("code_branch_org_id_unique").on(t.organizationId, t.id),
    unique("code_branch_name_unique").on(
      t.organizationId,
      t.repositoryId,
      t.name,
    ),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [codeRepository.organizationId, codeRepository.id],
    }).onDelete("restrict"),
  ],
);

export const codePullRequestState = pgEnum("code_pull_request_state", [
  "open",
  "closed",
  "merged",
]);
export const codeReviewDecision = pgEnum("code_review_decision", [
  "approved",
  "changes_requested",
  "review_required",
  "none",
]);
// Aggregate of a commit's checks: `none` when the host reports no checks.
export const codeChecksState = pgEnum("code_checks_state", [
  "pending",
  "success",
  "failure",
  "none",
]);

export type CodeCheckRun = {
  name: string;
  state: "pending" | "success" | "failure" | "neutral";
  url: string | null;
  // Known to be required by the host's branch protection.
  required?: boolean;
};

export const codePullRequest = pgTable(
  "code_pull_request",
  {
    id: id(),
    organizationId: organizationId(),
    repositoryId: text("repository_id").notNull(),
    externalId: text("external_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    // The first characters of the description; the host keeps the rest.
    bodyExcerpt: text("body_excerpt").notNull().default(""),
    state: codePullRequestState("state").notNull(),
    draft: boolean("draft").default(false).notNull(),
    authorLogin: text("author_login"),
    authorIsBot: boolean("author_is_bot").default(false).notNull(),
    headBranch: text("head_branch").notNull(),
    headSha: text("head_sha").notNull(),
    baseBranch: text("base_branch").notNull(),
    reviewDecision: codeReviewDecision("review_decision")
      .default("none")
      .notNull(),
    // Logins and team slugs asked to review.
    requestedReviewers: jsonb("requested_reviewers")
      .$type<string[]>()
      .default([])
      .notNull(),
    // Logins whose latest review approved the current head.
    approvedBy: jsonb("approved_by").$type<string[]>().default([]).notNull(),
    mergeable: boolean("mergeable"),
    webUrl: text("web_url").notNull(),
    mergedAt: timestamp("merged_at"),
    mergedByLogin: text("merged_by_login"),
    closedAt: timestamp("closed_at"),
    hostCreatedAt: timestamp("host_created_at").notNull(),
    hostUpdatedAt: timestamp("host_updated_at").notNull(),
    // Opened through Lictory's outbox: by whom, and the agent acting for
    // them, if any. Lictory-owned provenance, never host data.
    openedById: optionalActor("opened_by_id"),
    openedVia: text("opened_via"),
    // Opened by a Factory agent (its id) from an agent session: what the
    // "Agent-authored" filter reads (text; the Factory owns those rows).
    agentId: text("agent_id"),
    agentSessionId: text("agent_session_id"),
    // A merge Lictory sent: who asked (a person, or the administrator whose
    // autonomy policy merged it) and how ("Autopilot · policy set by Ada").
    mergeRequestedById: optionalActor("merge_requested_by_id"),
    mergedVia: text("merged_via"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("code_pull_request_org_id_unique").on(t.organizationId, t.id),
    unique("code_pull_request_number_unique").on(
      t.organizationId,
      t.repositoryId,
      t.number,
    ),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [codeRepository.organizationId, codeRepository.id],
    }).onDelete("restrict"),
    index("code_pull_request_head_idx").on(
      t.organizationId,
      t.repositoryId,
      t.headSha,
    ),
  ],
);

// The checks the host reported for one commit, as one summary row.
export const codeCommitChecks = pgTable(
  "code_commit_checks",
  {
    organizationId: organizationId(),
    repositoryId: text("repository_id").notNull(),
    sha: text("sha").notNull(),
    state: codeChecksState("state").notNull(),
    runs: jsonb("runs").$type<CodeCheckRun[]>().default([]).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.repositoryId, t.sha] }),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [codeRepository.organizationId, codeRepository.id],
    }).onDelete("restrict"),
  ],
);

export const codeIssueState = pgEnum("code_issue_state", ["open", "closed"]);

export const codeIssue = pgTable(
  "code_issue",
  {
    id: id(),
    organizationId: organizationId(),
    repositoryId: text("repository_id").notNull(),
    externalId: text("external_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    bodyExcerpt: text("body_excerpt").notNull().default(""),
    state: codeIssueState("state").notNull(),
    labels: jsonb("labels").$type<string[]>().default([]).notNull(),
    assignees: jsonb("assignees").$type<string[]>().default([]).notNull(),
    authorLogin: text("author_login"),
    webUrl: text("web_url").notNull(),
    hostCreatedAt: timestamp("host_created_at").notNull(),
    hostUpdatedAt: timestamp("host_updated_at").notNull(),
    // Imported as this work item: from then on the item is Lictory's and
    // the issue stays linked.
    importedWorkItemId: text("imported_work_item_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("code_issue_org_id_unique").on(t.organizationId, t.id),
    unique("code_issue_number_unique").on(
      t.organizationId,
      t.repositoryId,
      t.number,
    ),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [codeRepository.organizationId, codeRepository.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.importedWorkItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
  ],
);

// Commits that mention a work item key (others are not mirrored).
export const codeCommit = pgTable(
  "code_commit",
  {
    id: id(),
    organizationId: organizationId(),
    repositoryId: text("repository_id").notNull(),
    sha: text("sha").notNull(),
    // The first line and a bounded excerpt of the rest.
    message: text("message").notNull(),
    authorName: text("author_name"),
    authorLogin: text("author_login"),
    branch: text("branch"),
    webUrl: text("web_url").notNull(),
    committedAt: timestamp("committed_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("code_commit_org_id_unique").on(t.organizationId, t.id),
    unique("code_commit_sha_unique").on(
      t.organizationId,
      t.repositoryId,
      t.sha,
    ),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [codeRepository.organizationId, codeRepository.id],
    }).onDelete("restrict"),
  ],
);

export const codeLinkTarget = pgEnum("code_link_target", [
  "branch",
  "pull_request",
  "issue",
  "commit",
]);
export type CodeLinkTarget = (typeof codeLinkTarget.enumValues)[number];
// Why the link exists: the code names the item's key, a person or agent
// linked it, an agent session produced it, the item was imported from the
// issue, or Lictory itself created the branch or pull request for the item.
export const codeLinkSource = pgEnum("code_link_source", [
  "key",
  "manual",
  "agent_session",
  "import",
  "lictory",
]);
export type CodeLinkSource = (typeof codeLinkSource.enumValues)[number];

// Lictory-owned links between work items and code. Links are history:
// unlinking sets `unlinkedAt`, and a key-detected link a person removed is
// never recreated by detection.
export const codeWorkLink = pgTable(
  "code_work_link",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    projectId: text("project_id").notNull(),
    repositoryId: text("repository_id").notNull(),
    target: codeLinkTarget("target").notNull(),
    // The mirror row (code_branch, code_pull_request, code_issue,
    // code_commit) the link points at.
    targetId: text("target_id").notNull(),
    source: codeLinkSource("source").notNull(),
    createdById: text("created_by_id").notNull(),
    performedVia: text("performed_via"),
    agentSessionId: text("agent_session_id"),
    createdAt: createdAt(),
    unlinkedAt: timestamp("unlinked_at"),
    unlinkedById: optionalActor("unlinked_by_id"),
  },
  (t) => [
    unique("code_work_link_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("code_work_link_active_unique")
      .on(t.organizationId, t.workItemId, t.target, t.targetId)
      .where(sql`${t.unlinkedAt} IS NULL`),
    foreignKey({
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [codeRepository.organizationId, codeRepository.id],
    }).onDelete("restrict"),
    index("code_work_link_item_idx").on(t.organizationId, t.workItemId),
    index("code_work_link_target_idx").on(
      t.organizationId,
      t.target,
      t.targetId,
    ),
  ],
);

export const codeWebhookStatus = pgEnum("code_webhook_status", [
  "pending",
  "processed",
  "ignored",
  "failed",
]);

// Verified webhook deliveries, stored once per host delivery id and
// processed by the worker under a lease. The route acknowledges as soon as
// the row is written.
export const codeWebhookDelivery = pgTable(
  "code_webhook_delivery",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: text("connection_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: codeWebhookStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    leaseUntil: timestamp("lease_until"),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    unique("code_webhook_delivery_unique").on(t.connectionId, t.deliveryId),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [codeConnection.organizationId, codeConnection.id],
    }).onDelete("restrict"),
    index("code_webhook_delivery_pending_idx").on(t.status, t.leaseUntil),
  ],
);

export const codeWriteKind = pgEnum("code_write_kind", [
  "create_branch",
  "open_pull_request",
  "comment",
  "request_review",
  "merge",
  "close",
  "reopen",
]);
export type CodeWriteKind = (typeof codeWriteKind.enumValues)[number];
export const codeWriteStatus = pgEnum("code_write_status", [
  "queued",
  "sending",
  "succeeded",
  "failed",
  "canceled",
]);

// Writes to a code host, queued by a command in its domain transaction and
// sent by the worker. One row per request; `idempotencyKey` (the command's
// mutation id) makes a retried request reuse its row.
export const codeWrite = pgTable(
  "code_write",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: text("connection_id").notNull(),
    repositoryId: text("repository_id").notNull(),
    kind: codeWriteKind("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    workItemId: text("work_item_id"),
    pullRequestId: text("pull_request_id"),
    requestedById: actor("requested_by_id"),
    // The agent acting for the person (access token name, Litto) or the
    // autonomy policy, for history.
    performedVia: text("performed_via"),
    // The Factory agent and agent session the write was made for (text;
    // the Factory owns those rows).
    agentId: text("agent_id"),
    agentSessionId: text("agent_session_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: codeWriteStatus("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    leaseUntil: timestamp("lease_until"),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    unique("code_write_org_id_unique").on(t.organizationId, t.id),
    unique("code_write_idempotency_unique").on(
      t.organizationId,
      t.idempotencyKey,
    ),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [codeConnection.organizationId, codeConnection.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [codeRepository.organizationId, codeRepository.id],
    }).onDelete("restrict"),
    index("code_write_due_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const codeLictoryReviewDecision = pgEnum(
  "code_lictory_review_decision",
  ["approve", "request_changes"],
);

// Reviews recorded in Lictory, bound to the head commit they reviewed
// (docs/internals/code-hosts.md#reviews-recorded-in-lictory). Every write
// to a host carries the connection's identity, so a host cannot say which
// agent approved; an agent's review is therefore Lictory's record, and a
// comment on the host shows it there. A later review by the same reviewer
// of the same head supersedes this one (history keeps both); a new head
// needs a new review.
export const codeReview = pgTable(
  "code_review",
  {
    id: id(),
    organizationId: organizationId(),
    pullRequestId: text("pull_request_id").notNull(),
    headSha: text("head_sha").notNull(),
    decision: codeLictoryReviewDecision("decision").notNull(),
    body: text("body").notNull().default(""),
    // The accountable person, and the agent acting for them, if any.
    reviewerId: actor("reviewer_id"),
    agentId: text("agent_id"),
    agentName: text("agent_name"),
    agentSessionId: text("agent_session_id"),
    supersededAt: timestamp("superseded_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.pullRequestId],
      foreignColumns: [codePullRequest.organizationId, codePullRequest.id],
    }).onDelete("restrict"),
    index("code_review_pull_request_idx").on(
      t.organizationId,
      t.pullRequestId,
      t.headSha,
    ),
  ],
);

// The login a person uses on a host, set by the person, for the "mine" and
// "review requested" filters. Filtering only: it grants nothing.
export const codeHostIdentity = pgTable(
  "code_host_identity",
  {
    organizationId: organizationId(),
    connectionId: text("connection_id").notNull(),
    userId: actor("user_id"),
    login: text("login").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.connectionId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [codeConnection.organizationId, codeConnection.id],
    }).onDelete("restrict"),
  ],
);

// Code projections replicated to browsers by Zero, apart from `sync_entity`
// (docs/internals/code-hosts.md#projections). `data` is a code entity
// (contracts in code/entities.ts), never a raw row: no credential, secret
// or payload reaches it. `work_item_id` marks rows that belong to one work
// item's Code panel; `facet` (open, closed, merged) lets queries narrow pull
// requests and issues.
export const codeEntity = pgTable(
  "code_entity",
  {
    key: text("key").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id"),
    projectId: text("project_id"),
    workItemId: text("work_item_id"),
    type: text("type").notNull(),
    facet: text("facet"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("code_entity_scope_idx").on(t.organizationId, t.type, t.facet),
    index("code_entity_item_idx").on(t.organizationId, t.workItemId),
  ],
);
