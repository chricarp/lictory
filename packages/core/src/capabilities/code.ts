import { z } from "zod";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";
import {
  codePullRequest,
  codeWrite,
} from "@lictory/core/contracts/state-machines";
import { createCodeService } from "@lictory/core/code/service";
import type { Actor } from "@lictory/core/domain/service";

// The Code module's operations (docs/internals/code-hosts.md). Writes to a
// code host are queued in the domain transaction and sent by the worker:
// these commands return the queued write, whose status the caller follows
// with getCodeWrite (or live, in the browser). Mirrored pull requests,
// branches, issues and checks are the host's; only links are Lictory's.

function service(ctx: CapabilityContext) {
  return createCodeService(ctx.db, { providers: ctx.codeHostProviders });
}
function actor(ctx: CapabilityContext): Actor {
  const p = ctx.principal;
  return {
    userId: p.userId,
    surface: p.surface,
    client: p.client,
    // A Factory agent is named by its own id (its pull requests and reviews
    // are recorded as its); other MCP agents by their access token's.
    agentId: p.agent?.id ?? p.tokenId ?? null,
    agentName: p.agent?.name ?? p.agentName ?? null,
    agentSessionId: p.agent?.sessionId ?? null,
    agentScope: p.agent ?? null,
  };
}
function track(
  ctx: CapabilityContext,
  event: string,
  properties: Record<string, string | number | boolean | null>,
) {
  ctx.effects.track(event, {
    ...properties,
    ...(ctx.principal.surface === "web"
      ? {}
      : { surface: ctx.principal.surface }),
  });
}

const provider = z.enum(["github", "gitlab", "bitbucket"]);
const mutationId = z
  .string()
  .min(1)
  .max(160)
  .optional()
  .describe(
    "Idempotency key: retrying with the same value returns the first request's write instead of queueing another.",
  );
const secret = z.string().trim().max(20_000).optional();

// Credentials are entered by an organization administrator in the browser
// only: a token or private key must never pass through an agent's
// transcript.
const connectCodeHost = defineCapability({
  name: "connectCodeHost",
  title: "Connect a code host",
  description:
    "Organization administrators: connect GitHub (an app installation or a fine-grained token; github.com or GitHub Enterprise Server), GitLab (gitlab.com or self-managed; a personal, group or project access token) or Bitbucket Cloud (an access token, an API token with its email, or an OAuth consumer). The credential is verified, stored encrypted and never returned. Returns the webhook URL and, for a new connection, its webhook secret, shown once. With `connectionId`, replaces that connection's credential.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: {
    reason: "credentials",
    where: "Organization settings → Code hosts",
  },
  external: true,
  input: z.object({
    organizationId,
    provider,
    authKind: z.enum(["github_app", "token", "oauth_consumer"]),
    baseUrl: z.string().trim().max(300).default(""),
    name: z.string().max(120).optional(),
    connectionId: id.optional(),
    credential: z.object({
      token: secret,
      appId: secret,
      privateKey: secret,
      installationId: secret,
      email: secret,
      apiToken: secret,
      key: secret,
      secret,
    }),
  }),
  async run(ctx, input) {
    const result = await service(ctx).connect(actor(ctx), input);
    track(ctx, "code_host_connected", {
      organization_id: input.organizationId,
      provider: input.provider,
      auth_kind: input.authKind,
    });
    return result;
  },
});

const rotateCodeHostWebhookSecret = defineCapability({
  name: "rotateCodeHostWebhookSecret",
  title: "Rotate webhook secret",
  description:
    "Organization administrators: replace a code host connection's webhook secret. The new secret is returned once; paste it into the host's webhook settings, since deliveries signed with the old one are refused.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: {
    reason: "credentials",
    where: "Organization settings → Code hosts",
  },
  input: z.object({ organizationId, connectionId: id }),
  run: (ctx, input) =>
    service(ctx).rotateWebhookSecret(
      actor(ctx),
      input.organizationId,
      input.connectionId,
    ),
});

const disconnectCodeHost = defineCapability({
  name: "disconnectCodeHost",
  title: "Disconnect a code host",
  description:
    "Organization administrators: remove a code host connection. Its repositories, pull requests and links stay as history and return when the same host and account are connected again; writes not yet sent are canceled.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  input: z.object({ organizationId, connectionId: id }),
  async run(ctx, input) {
    await service(ctx).disconnect(
      actor(ctx),
      input.organizationId,
      input.connectionId,
    );
    track(ctx, "code_host_disconnected", {
      organization_id: input.organizationId,
    });
    return { ok: true };
  },
});

const listCodeHostRepositories = defineCapability({
  name: "listCodeHostRepositories",
  title: "Browse a code host's repositories",
  description:
    "Repositories a connection can see on its host right now (organization and project administrators), with the projects each already serves. Use it to find the repository to link.",
  kind: "query",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    connectionId: id,
    query: z.string().max(120).optional(),
  }),
  run: (ctx, input) =>
    service(ctx).listHostRepositories(
      actor(ctx),
      input.organizationId,
      input.connectionId,
      input.query,
    ),
});

const linkCodeRepository = defineCapability({
  name: "linkCodeRepository",
  title: "Link a repository to a project",
  description:
    "Project administrators: make a repository serve a project. Lictory then mirrors its pull requests, issues, checks and the branches and commits that name the project's work item keys (PAY-142), and backfills the last 30 days. `repository` is the full name (owner/name, group/project) or the host's id.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  idempotent: true,
  input: z.object({
    organizationId,
    connectionId: id,
    repository: z.string().trim().min(1).max(300),
    projectId: id,
  }),
  async run(ctx, input) {
    const result = await service(ctx).linkRepository(actor(ctx), input);
    track(ctx, "code_repository_linked", {
      organization_id: input.organizationId,
      project_id: input.projectId,
    });
    return result;
  },
});

const unlinkCodeRepository = defineCapability({
  name: "unlinkCodeRepository",
  title: "Unlink a repository from a project",
  description:
    "Project administrators: the repository stops serving the project. Key detection no longer links the project's items to its code; existing links stay.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  input: z.object({ organizationId, repositoryId: id, projectId: id }),
  async run(ctx, input) {
    await service(ctx).unlinkRepository(actor(ctx), input);
    return { ok: true };
  },
});

const syncCodeRepository = defineCapability({
  name: "syncCodeRepository",
  title: "Refresh a repository",
  description:
    "Read a repository's pull requests, issues, branches and checks from its host again now, repairing anything a missed webhook left out. Runs in the background.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({ organizationId, repositoryId: id }),
  run: (ctx, input) =>
    service(ctx).requestSync(
      actor(ctx),
      input.organizationId,
      input.repositoryId,
    ),
});

const listCodeRepositories = defineCapability({
  name: "listCodeRepositories",
  title: "List repositories",
  description:
    "Repositories the organization mirrors, with their host, default branch and the projects they serve.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    service(ctx).listRepositories(actor(ctx), input.organizationId),
});

const listCodePullRequests = defineCapability({
  name: "listCodePullRequests",
  title: "List pull requests",
  description:
    "Mirrored pull requests (merge requests on GitLab), newest activity first, with state, draft, review decision, checks and the work items they are linked to. Filter by state, repository, project or work item.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    state: z.enum(["open", "closed", "merged"]).optional(),
    repositoryId: id.optional(),
    projectId: id.optional(),
    workItemId: id.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  run: (ctx, input) => service(ctx).listPullRequests(actor(ctx), input),
});

const getCodePullRequest = defineCapability({
  name: "getCodePullRequest",
  title: "Get a pull request",
  description:
    "One mirrored pull request: description excerpt, head and base, review decision and approvals, every check, linked work items, writes queued for it and `mergeBlockers` (why Lictory would not merge it now).",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, pullRequestId: id }),
  run: (ctx, input) =>
    service(ctx).getPullRequest(
      actor(ctx),
      input.organizationId,
      input.pullRequestId,
    ),
});

const getCodePullRequestFiles = defineCapability({
  name: "getCodePullRequestFiles",
  title: "Files changed in a pull request",
  description:
    "The files a pull request changes, with their unified diff hunks, read from the code host now (Lictory does not store diffs). Large patches are left out and marked truncated.",
  kind: "query",
  surfaces: everywhere,
  external: true,
  input: z.object({ organizationId, pullRequestId: id }),
  run: (ctx, input) =>
    service(ctx).getPullRequestFiles(
      actor(ctx),
      input.organizationId,
      input.pullRequestId,
    ),
});

const listCodeIssues = defineCapability({
  name: "listCodeIssues",
  title: "List code host issues",
  description:
    "Issues mirrored from repositories' trackers. They stay the host's until someone imports one as a work item (importCodeIssue).",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    state: z.enum(["open", "closed"]).optional(),
    repositoryId: id.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  run: (ctx, input) => service(ctx).listIssues(actor(ctx), input),
});

const listCodeBranches = defineCapability({
  name: "listCodeBranches",
  title: "List branches",
  description:
    "Branches Lictory mirrors (those that name a work item key, were created from Lictory or head a linked pull request) of one repository or of the repositories serving a project, with the work items each is linked to. For one item's branches use getWorkItemCode.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    repositoryId: id.optional(),
    projectId: id.optional(),
    includeDeleted: z.boolean().optional(),
  }),
  run: (ctx, input) => service(ctx).listBranches(actor(ctx), input),
});

const getWorkItemCode = defineCapability({
  name: "getWorkItemCode",
  title: "Code of a work item",
  description:
    "Branches, pull requests (with checks and review state), issues and commits linked to a work item, and the code host writes queued for it.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, workItemId: id }),
  run: (ctx, input) =>
    service(ctx).workItemCode(
      actor(ctx),
      input.organizationId,
      input.workItemId,
    ),
});

const suggestCodeBranchName = defineCapability({
  name: "suggestCodeBranchName",
  title: "Suggest a branch name",
  description:
    "A branch name for a work item (its key and a slug of its title, `pay-142-refunds-over-the-api`), and the repositories that serve its project. A branch named with the key is linked to the item automatically.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, workItemId: id }),
  run: (ctx, input) =>
    service(ctx).suggestBranchName(
      actor(ctx),
      input.organizationId,
      input.workItemId,
    ),
});

const linkCodeToWorkItem = defineCapability({
  name: "linkCodeToWorkItem",
  title: "Link code to a work item",
  description:
    "Link a branch (by name), pull request or issue (by number) or commit (by SHA) of a repository that serves the item's project to the item. Code that names the item's key is linked automatically; use this for code that does not. Needs “Change properties” in the item's project.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    workItemId: id,
    repositoryId: id,
    target: z.enum(["branch", "pull_request", "issue", "commit"]),
    ref: z.string().trim().min(1).max(250),
  }),
  run: (ctx, input) => service(ctx).linkCode(actor(ctx), input),
});

const unlinkCodeFromWorkItem = defineCapability({
  name: "unlinkCodeFromWorkItem",
  title: "Unlink code from a work item",
  description:
    "Remove a link between a work item and code. The unlinking is recorded in the item's activity, and key detection does not link the same code to the item again. Nothing changes on the code host.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  input: z.object({ organizationId, linkId: id }),
  run: (ctx, input) =>
    service(ctx).unlinkCode(actor(ctx), input.organizationId, input.linkId),
});

const createCodeBranch = defineCapability({
  name: "createCodeBranch",
  title: "Create a branch for a work item",
  description:
    "Create a branch on the code host for a work item, from the repository's default branch unless `from` names another branch or commit. The name defaults to suggestCodeBranchName's. Queued and sent by the worker; the branch is linked to the item when the host confirms it. Needs “Change properties” in the item's project.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    workItemId: id,
    repositoryId: id.optional(),
    name: z.string().trim().max(80).optional(),
    from: z.string().trim().max(200).optional(),
    mutationId,
  }),
  async run(ctx, input) {
    const result = await service(ctx).createBranch(actor(ctx), input);
    track(ctx, "code_branch_requested", {
      organization_id: input.organizationId,
    });
    return result;
  },
});

const openCodePullRequest = defineCapability({
  name: "openCodePullRequest",
  title: "Open a pull request",
  description:
    "Open a pull request (merge request on GitLab) from `head` into `base` (the default branch unless given). With `workItemId`, the title defaults to the item's key and title, the description links back to the item and the pull request is linked to it. If an open pull request from `head` already exists it is linked instead of opening another. Queued and sent by the worker.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    workItemId: id.optional(),
    repositoryId: id.optional(),
    head: z.string().trim().min(1).max(200),
    base: z.string().trim().max(200).optional(),
    title: z.string().trim().max(250).optional(),
    body: z.string().max(60_000).optional(),
    draft: z.boolean().optional(),
    mutationId,
  }),
  async run(ctx, input) {
    const result = await service(ctx).openPullRequest(actor(ctx), input);
    track(ctx, "code_pull_request_requested", {
      organization_id: input.organizationId,
    });
    return result;
  },
});

const commentOnCodePullRequest = defineCapability({
  name: "commentOnCodePullRequest",
  title: "Comment on a pull request",
  description: `Post a comment on a pull request, signed with your name (and the agent's, when an agent posts it) because the host shows the connection's account as its author. ${codePullRequest.rule("comment")}`,
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    pullRequestId: id,
    body: z.string().trim().min(1).max(60_000),
    mutationId,
  }),
  run: (ctx, input) => service(ctx).comment(actor(ctx), input),
});

const requestCodeReview = defineCapability({
  name: "requestCodeReview",
  title: "Request a code review",
  description: `Ask people on the code host (by their host login) to review a pull request. ${codePullRequest.rule("requestReview")}`,
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    pullRequestId: id,
    reviewers: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    mutationId,
  }),
  run: (ctx, input) => service(ctx).requestReview(actor(ctx), input),
});

const mergeCodePullRequest = defineCapability({
  name: "mergeCodePullRequest",
  decision: true,
  title: "Merge a pull request",
  description: `Merge a pull request on its code host, only when the person explicitly asked to. \`expectedHeadSha\` is the head commit the person reviewed: the merge is refused if new commits arrived. Lictory also refuses a draft, failing or running checks, requested changes and conflicts (getCodePullRequest lists them as mergeBlockers); the host's branch protection applies on top. ${codePullRequest.rule("merge")} Needs “Change properties” in a project the repository serves.`,
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    pullRequestId: id,
    expectedHeadSha: z.string().trim().min(7).max(64),
    method: z.enum(["merge", "squash", "rebase"]).optional(),
    mutationId,
  }),
  async run(ctx, input) {
    const result = await service(ctx).merge(actor(ctx), input);
    track(ctx, "code_merge_requested", {
      organization_id: input.organizationId,
      method: input.method ?? "merge",
    });
    return result;
  },
});

const setCodePullRequestState = defineCapability({
  name: "setCodePullRequestState",
  title: "Close or reopen a pull request",
  description: `Close a pull request without merging, or reopen a closed one, on its code host. ${codePullRequest.rule("close", "reopen")}`,
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    pullRequestId: id,
    state: z.enum(["open", "closed"]),
    mutationId,
  }),
  run: (ctx, input) => service(ctx).setPullRequestState(actor(ctx), input),
});

const reviewCodePullRequest = defineCapability({
  name: "reviewCodePullRequest",
  title: "Review a pull request",
  description: `Record your review of a pull request's head commit in Lictory: \`approve\` or \`request_changes\`, with a body saying what you checked. The review belongs to that commit: new commits need a new review, and \`expectedHeadSha\` (the head you read) refuses the review if it moved. The project's Definition of Done counts the reviewer agent's approval of the head (or any approval when the policy names no reviewer agent). A comment on the host shows the verdict, signed. An agent never reviews its own pull request. ${codePullRequest.rule("review")} Needs “Change properties” in a project the repository serves.`,
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    pullRequestId: id,
    decision: z.enum(["approve", "request_changes"]),
    body: z.string().max(20_000).optional(),
    expectedHeadSha: z.string().trim().min(7).max(64).optional(),
    mutationId,
  }),
  async run(ctx, input) {
    const result = await service(ctx).reviewPullRequest(actor(ctx), input);
    track(ctx, "code_review_recorded", {
      organization_id: input.organizationId,
      decision: input.decision,
    });
    return result;
  },
});

const setDefaultCodeRepository = defineCapability({
  name: "setDefaultCodeRepository",
  title: "Choose a project's default repository",
  description:
    "Project administrators: the repository agent sessions of the project work in (and Lictory opens their pull requests in) when a session names none. Without one, sessions use the project's first linked repository. `repositoryId` null clears the choice.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    projectId: id,
    repositoryId: id.nullable(),
  }),
  run: (ctx, input) => service(ctx).setDefaultRepository(actor(ctx), input),
});

const getCodeWrite = defineCapability({
  name: "getCodeWrite",
  title: "Get a code host write",
  description:
    "Status of a write Lictory queued for a code host (queued, sending, succeeded, failed, canceled), with the host's error when it failed and its result when it succeeded.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, writeId: id }),
  run: (ctx, input) =>
    service(ctx).getWrite(actor(ctx), input.organizationId, input.writeId),
});

const retryCodeWrite = defineCapability({
  name: "retryCodeWrite",
  title: "Retry a code host write",
  description: `Send a failed write again, after fixing what the host refused. ${codeWrite.rule("retry")}`,
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({ organizationId, writeId: id }),
  run: (ctx, input) =>
    service(ctx).retryWrite(actor(ctx), input.organizationId, input.writeId),
});

const cancelCodeWrite = defineCapability({
  name: "cancelCodeWrite",
  title: "Cancel a code host write",
  description: `Give up on a write that has not succeeded. ${codeWrite.rule("cancel")}`,
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({ organizationId, writeId: id }),
  run: (ctx, input) =>
    service(ctx).cancelWrite(actor(ctx), input.organizationId, input.writeId),
});

const importCodeIssue = defineCapability({
  name: "importCodeIssue",
  title: "Import an issue as a work item",
  description:
    "Create a work item in a project from a mirrored issue of a repository that serves it: the item takes the issue's title and description and becomes Lictory's, and the issue stays linked to it. Importing an issue again returns the item it already became. The type defaults to Bug for issues labeled as bugs and Task otherwise.",
  kind: "command",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    issueId: id,
    projectId: id,
    typeId: id.optional(),
    mutationId,
  }),
  async run(ctx, input) {
    const result = await service(ctx).importIssue(actor(ctx), input);
    track(ctx, "code_issue_imported", {
      organization_id: input.organizationId,
      project_id: input.projectId,
    });
    return result;
  },
});

const setCodeHostLogin = defineCapability({
  name: "setCodeHostLogin",
  title: "Set your code host login",
  description:
    "Tell Lictory your login on a code host, so “mine” and “review requested” filters find your pull requests. It grants nothing. An empty login removes it.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    connectionId: id,
    login: z.string().trim().max(100).nullable(),
  }),
  run: (ctx, input) => service(ctx).setIdentity(actor(ctx), input),
});

export const codeCapabilities = [
  connectCodeHost,
  rotateCodeHostWebhookSecret,
  disconnectCodeHost,
  listCodeHostRepositories,
  linkCodeRepository,
  unlinkCodeRepository,
  syncCodeRepository,
  listCodeRepositories,
  listCodePullRequests,
  getCodePullRequest,
  getCodePullRequestFiles,
  listCodeIssues,
  listCodeBranches,
  getWorkItemCode,
  suggestCodeBranchName,
  linkCodeToWorkItem,
  unlinkCodeFromWorkItem,
  createCodeBranch,
  openCodePullRequest,
  commentOnCodePullRequest,
  requestCodeReview,
  mergeCodePullRequest,
  setCodePullRequestState,
  reviewCodePullRequest,
  setDefaultCodeRepository,
  getCodeWrite,
  retryCodeWrite,
  cancelCodeWrite,
  importCodeIssue,
  setCodeHostLogin,
] as AnyCapability[];
