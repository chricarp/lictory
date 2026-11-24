// The boundary between Lictory's Code module and code hosts (GitHub, GitLab,
// Bitbucket; cloud and self-managed). The domain speaks in repositories,
// branches, pull requests, checks, issues and commits; each adapter
// translates its host's REST payloads and webhook bodies into these shapes.
// Nothing outside src/code/<host> may know a host's payloads.
//
// Ownership: the host owns every field described here. Lictory mirrors them
// read-only and writes to a host only through the explicit write operations
// below, sent by the worker from the outbox.

import type {
  CodeCheckRun,
  CodeHostAuthKind,
  CodeHostProviderKind,
} from "@lictory/core/db/code-schema";

export type { CodeCheckRun, CodeHostAuthKind, CodeHostProviderKind };

export type CodeConnection = {
  // Canonical web origin (see `normalizeBaseUrl`).
  baseUrl: string;
  authKind: CodeHostAuthKind;
  credential: unknown;
};

export type CodeRepositoryInfo = {
  externalId: string;
  fullName: string;
  defaultBranch: string;
  webUrl: string;
  cloneUrl: string;
  visibility: "public" | "private" | "internal";
  archived: boolean;
};

// How a repository is addressed in calls: its id and full name, both stable
// enough for every host's API.
export type CodeRepositoryRef = { externalId: string; fullName: string };

export type CodeBranchInfo = { name: string; headSha: string };

export type CodeChecksSummary = {
  state: "pending" | "success" | "failure" | "none";
  runs: CodeCheckRun[];
};

export type CodeReviewDecision =
  "approved" | "changes_requested" | "review_required" | "none";

export type CodePullRequestInfo = {
  externalId: string;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  authorLogin: string | null;
  authorIsBot: boolean;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  reviewDecision: CodeReviewDecision;
  requestedReviewers: string[];
  // Logins whose latest review approves.
  approvedBy: string[];
  mergeable: boolean | null;
  webUrl: string;
  mergedAt: Date | null;
  mergedByLogin: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CodeIssueInfo = {
  externalId: string;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  authorLogin: string | null;
  webUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CodeCommitInfo = {
  sha: string;
  message: string;
  authorName: string | null;
  authorLogin: string | null;
  webUrl: string;
  committedAt: Date;
};

export type CodePullRequestFile = {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  // Unified diff hunk text; null when the host omits it (binary or too
  // large).
  patch: string | null;
};

export type CodeMergeMethod = "merge" | "squash" | "rebase";

// A webhook translated into what Lictory needs to know. Events are hints:
// pull requests, issues and checks are read again from the host by the
// processor, so a missed, duplicated or reordered delivery never leaves a
// wrong state. Only pushes carry data used as is (the commits they name).
export type CodeWebhookEvent =
  | { kind: "ping" }
  | { kind: "repository"; repository: CodeRepositoryRef }
  | { kind: "pull_request"; repository: CodeRepositoryRef; number: number }
  | {
      kind: "push";
      repository: CodeRepositoryRef;
      branch: string;
      headSha: string | null;
      deleted: boolean;
      commits: CodeCommitInfo[];
    }
  | {
      kind: "checks";
      repository: CodeRepositoryRef;
      sha: string;
      // Pull request numbers the payload names, if any.
      pullRequests: number[];
    }
  | { kind: "issue"; repository: CodeRepositoryRef; number: number };

export type CodeHostErrorKind =
  | "authentication"
  | "permission"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "unavailable";

// Errors carry an actionable message for the person plus whether a retry
// can succeed without anyone changing anything.
export class CodeHostError extends Error {
  constructor(
    readonly kind: CodeHostErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CodeHostError";
  }

  get retryable() {
    return this.kind === "rate_limited" || this.kind === "unavailable";
  }
}

export type SessionCredential = {
  // For git over HTTPS: the user name to send with the token.
  username: string;
  token: string;
  expiresAt: Date | null;
  // A stored token, not minted for this session: it outlives the session
  // and may reach more than this repository. The UI warns about it.
  longLived: boolean;
};

export type WebhookRequest = {
  // Lower-cased header names.
  headers: Record<string, string | undefined>;
  // The exact bytes the host signed.
  body: string;
};

export type VerifiedWebhook = {
  deliveryId: string;
  event: string;
};

export interface CodeHostProvider {
  readonly kind: CodeHostProviderKind;
  readonly authKinds: readonly CodeHostAuthKind[];
  // Canonical web origin for a host URL the person entered; throws a
  // validation error naming what to enter instead.
  normalizeBaseUrl(url: string): string;
  // Confirms the credential works; returns who it acts as.
  verify(connection: CodeConnection): Promise<{ accountLabel: string }>;
  listRepositories(
    connection: CodeConnection,
    query?: string,
  ): Promise<CodeRepositoryInfo[]>;
  getRepository(
    connection: CodeConnection,
    fullNameOrId: string,
  ): Promise<CodeRepositoryInfo | null>;
  listBranches(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
  ): Promise<CodeBranchInfo[]>;
  getBranch(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    name: string,
  ): Promise<CodeBranchInfo | null>;
  // Open pull requests and those updated since `since`, newest first. A
  // listing is a discovery hint: review decisions may be unresolved, so
  // ingest reads each changed pull request with `getPullRequest`.
  listPullRequests(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    options: { since?: Date; limit?: number },
  ): Promise<CodePullRequestInfo[]>;
  // With review decision and approvals resolved.
  getPullRequest(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
  ): Promise<CodePullRequestInfo | null>;
  listPullRequestFiles(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
  ): Promise<CodePullRequestFile[]>;
  getChecks(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    sha: string,
  ): Promise<CodeChecksSummary>;
  listIssues(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    options: { since?: Date; limit?: number },
  ): Promise<CodeIssueInfo[]>;
  getIssue(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
  ): Promise<CodeIssueInfo | null>;
  listCommits(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    options: { branch?: string; since?: Date; limit?: number },
  ): Promise<CodeCommitInfo[]>;

  // Webhooks. `verifyWebhook` checks the host's signature against the
  // connection's secret in constant time and names the delivery; it never
  // parses the body before the signature holds.
  verifyWebhook(
    request: WebhookRequest,
    secret: string,
  ): VerifiedWebhook | null;
  parseWebhook(event: string, payload: unknown): CodeWebhookEvent[];

  // Writes, each idempotent or recoverable (see code/outbox.ts).
  createBranch(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    name: string,
    fromSha: string,
  ): Promise<CodeBranchInfo>;
  findOpenPullRequest(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    headBranch: string,
  ): Promise<CodePullRequestInfo | null>;
  openPullRequest(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    input: {
      head: string;
      base: string;
      title: string;
      body: string;
      draft: boolean;
    },
  ): Promise<CodePullRequestInfo>;
  // Comments of a pull request containing `marker`, for recovering a
  // comment whose answer was lost.
  findComment(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
    marker: string,
  ): Promise<{ id: string; url: string | null } | null>;
  comment(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
    body: string,
  ): Promise<{ id: string; url: string | null }>;
  requestReview(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
    reviewers: string[],
  ): Promise<void>;
  // Merges only while the head is still `expectedHeadSha`.
  merge(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
    input: { method: CodeMergeMethod; expectedHeadSha: string },
  ): Promise<{ sha: string | null }>;
  setPullRequestState(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
    state: "open" | "closed",
  ): Promise<void>;
  // A credential for git over HTTPS to this one repository.
  createSessionCredential(
    connection: CodeConnection,
    repository: CodeRepositoryRef,
  ): Promise<SessionCredential>;
}
