import type {
  CodeCheckRun,
  CodeHostAuthKind,
  CodeHostProviderKind,
  CodeLinkSource,
  CodeLinkTarget,
  CodeWriteKind,
} from "@lictory/core/db/code-schema";

// What browsers receive of the Code module: rows of `code_entity`, keyed
// `${type}:${id}`. Built by code/projections.ts from the domain tables;
// never a credential, a webhook secret, a payload or a host token.

export type { CodeLinkTarget };

export type CodeChecks = {
  state: "pending" | "success" | "failure" | "none";
  runs: CodeCheckRun[];
};

export type CodeConnectionEntity = {
  type: "codeConnection";
  id: string;
  organizationId: string;
  provider: CodeHostProviderKind;
  name: string;
  baseUrl: string;
  authKind: CodeHostAuthKind;
  accountLabel: string;
  status: "active" | "invalid";
  lastError: string | null;
  // The credential is a stored token rather than minted per session.
  longLivedCredential: boolean;
  // Path of the webhook endpoint (append to the platform origin).
  webhookPath: string;
  lastWebhookAt: string | null;
  createdAt: string;
};

export type CodeRepositoryEntity = {
  type: "codeRepository";
  id: string;
  organizationId: string;
  connectionId: string;
  provider: CodeHostProviderKind;
  fullName: string;
  defaultBranch: string;
  webUrl: string;
  visibility: "public" | "private" | "internal";
  hostArchived: boolean;
  projectIds: string[];
  // Projects whose agent sessions work here when a session names no
  // repository.
  defaultForProjectIds: string[];
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

export type CodeLinkRef = {
  workItemId: string;
  projectId: string;
  source: CodeLinkSource;
};

export type CodePullRequestEntity = {
  type: "codePullRequest";
  id: string;
  organizationId: string;
  repositoryId: string;
  repositoryFullName: string;
  provider: CodeHostProviderKind;
  number: number;
  title: string;
  bodyExcerpt: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  authorLogin: string | null;
  authorIsBot: boolean;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  reviewDecision: "approved" | "changes_requested" | "review_required" | "none";
  requestedReviewers: string[];
  approvedBy: string[];
  mergeable: boolean | null;
  checks: CodeChecks;
  webUrl: string;
  mergedAt: string | null;
  mergedByLogin: string | null;
  closedAt: string | null;
  hostCreatedAt: string;
  hostUpdatedAt: string;
  openedById: string | null;
  openedVia: string | null;
  // Opened by a Factory agent, from this agent session (Lictory's
  // provenance, never the host's author login).
  agentId: string | null;
  agentSessionId: string | null;
  // Opened through Lictory by an agent acting for a person.
  agentAuthored: boolean;
  // A merge Lictory sent: who asked and how ("Autopilot · policy set by
  // Ada Lovelace").
  mergeRequestedById: string | null;
  mergedVia: string | null;
  // Reviews recorded in Lictory, newest first, with whether they reviewed
  // the current head.
  reviews: CodeReviewRef[];
  links: CodeLinkRef[];
};

export type CodeReviewRef = {
  id: string;
  decision: "approve" | "request_changes";
  headSha: string;
  current: boolean;
  reviewerId: string;
  agentId: string | null;
  agentName: string | null;
  agentSessionId: string | null;
  body: string;
  createdAt: string;
};

export type CodeIssueEntity = {
  type: "codeIssue";
  id: string;
  organizationId: string;
  repositoryId: string;
  repositoryFullName: string;
  provider: CodeHostProviderKind;
  number: number;
  title: string;
  bodyExcerpt: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  authorLogin: string | null;
  webUrl: string;
  hostCreatedAt: string;
  hostUpdatedAt: string;
  importedWorkItemId: string | null;
  links: CodeLinkRef[];
};

// What a link points at, as the item's Code panel shows it.
export type CodeLinkSummary =
  | {
      target: "branch";
      name: string;
      headSha: string | null;
      deleted: boolean;
      webUrl: string;
    }
  | {
      target: "pull_request";
      number: number;
      title: string;
      state: "open" | "closed" | "merged";
      draft: boolean;
      headBranch: string;
      checks: CodeChecks["state"];
      reviewDecision: CodePullRequestEntity["reviewDecision"];
      webUrl: string;
    }
  | {
      target: "issue";
      number: number;
      title: string;
      state: "open" | "closed";
      webUrl: string;
    }
  | {
      target: "commit";
      sha: string;
      message: string;
      authorName: string | null;
      committedAt: string;
      webUrl: string;
    };

export type CodeLinkEntity = {
  type: "codeLink";
  id: string;
  organizationId: string;
  workItemId: string;
  projectId: string;
  repositoryId: string;
  repositoryFullName: string;
  provider: CodeHostProviderKind;
  target: CodeLinkTarget;
  targetId: string;
  source: CodeLinkSource;
  createdById: string;
  performedVia: string | null;
  agentSessionId: string | null;
  createdAt: string;
  summary: CodeLinkSummary;
};

export type CodeWriteEntity = {
  type: "codeWrite";
  id: string;
  organizationId: string;
  repositoryId: string;
  repositoryFullName: string;
  kind: CodeWriteKind;
  status: "queued" | "sending" | "failed";
  // What the write does, in the person's words.
  summary: string;
  workItemId: string | null;
  pullRequestId: string | null;
  requestedById: string;
  performedVia: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CodeIdentityEntity = {
  type: "codeIdentity";
  id: string;
  organizationId: string;
  connectionId: string;
  userId: string;
  login: string;
};

export type CodeEntity =
  | CodeConnectionEntity
  | CodeRepositoryEntity
  | CodePullRequestEntity
  | CodeIssueEntity
  | CodeLinkEntity
  | CodeWriteEntity
  | CodeIdentityEntity;

export type CodeEntityType = CodeEntity["type"];

export const codeEntityKey = (entity: { type: string; id: string }) =>
  `${entity.type}:${entity.id}`;

export const webhookPath = (connectionId: string) =>
  `/api/code/webhooks/${connectionId}`;
