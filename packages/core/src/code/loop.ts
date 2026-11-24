import { and, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { configureClaimPorts } from "@lictory/core/claims/ports";
import { codeReviewPolicy } from "@lictory/core/claims/service";
import { DomainError } from "@lictory/core/domain/errors";
import type { Actor, Database } from "@lictory/core/domain/service";
import {
  setSessionCompletionListener,
  setSessionWorkspaceResolver,
  type SessionCompletion,
  type SessionWorkspaceResolver,
} from "@lictory/core/factory/ports";
import {
  publishSessionPullRequest,
  recordSessionPullRequest,
  recordSessionRepository,
  startSession,
} from "@lictory/core/factory/sessions";
import { stableId } from "@lictory/core/factory/thread-ids";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { paths } from "@lictory/core/lib/paths";
import { setCodeSessionHooks } from "@lictory/core/code/hooks";
import {
  chooseSessionRepository,
  createCodeEvidence,
  createCodeMergeExecutor,
  resolveSessionWorkspace,
} from "@lictory/core/code/ports";
import {
  createCodeService,
  type CodeServiceOptions,
} from "@lictory/core/code/service";

// The code loop, joined up (docs/internals/code-hosts.md#the-code-loop):
// Code installs its implementations of the boundaries the Factory and
// Claims left open, so a dispatched session works in the item's repository
// with a short-lived credential, its pushed branch becomes a pull request
// linked to the item and the session, the reviewer agent reviews each new
// head, and the Definition of Done reads the mirror (merging for Autopilot).
//
// `installCodeLoop` runs at process start in the API and the worker, after
// `installFactoryLoop` (both reach every port: the API answers runners'
// workspace requests and completions, the worker ingests webhooks, sends
// writes and dispatches).

const log = (event: string, detail: Record<string, unknown>) =>
  console.error(JSON.stringify({ event, ...detail }));

// ------------------------------------------------------- the workspace

function workspaceResolver(
  db: Database,
  options: CodeServiceOptions,
): SessionWorkspaceResolver {
  return {
    async resolve(session) {
      const repositoryId = await chooseSessionRepository(db, {
        organizationId: session.organizationId,
        projectId: session.projectId,
        repositoryId: session.repositoryId,
        repositoryUrl: session.repositoryUrl,
      });
      if (!repositoryId) {
        if (session.repositoryId)
          throw new DomainError(
            "validation",
            "The repository this session names does not serve its project. A project administrator links it in the project's settings.",
          );
        // An address the session states itself, cloned with the runner's
        // own git credentials (or none, for a public repository).
        return session.repositoryUrl && session.branch
          ? {
              url: session.repositoryUrl,
              baseBranch: session.baseBranch,
              branch: session.branch,
              auth: null,
            }
          : null;
      }
      // The agent's owner must be able to work with the repository's code;
      // the credential is minted for this repository only where the host
      // allows (GitHub App, Bitbucket OAuth).
      const workspace = await resolveSessionWorkspace(
        db,
        {
          organizationId: session.organizationId,
          userId: session.ownerId,
          repositoryId,
          branch: session.branch ?? "",
        },
        { providers: options.providers },
      );
      await recordSessionRepository(
        db,
        session.organizationId,
        session.id,
        repositoryId,
      );
      return {
        url: workspace.cloneUrl,
        baseBranch: session.baseBranch ?? workspace.defaultBranch,
        branch: workspace.branch,
        auth: {
          username: workspace.credential.username,
          password: workspace.credential.token,
          expiresAt: workspace.credential.expiresAt?.toISOString() ?? null,
        },
      };
    },
  };
}

// ------------------------------------------ the pull request a session opens

// The agent acting for its owner, as Code records it.
const sessionActor = (completion: SessionCompletion): Actor => ({
  userId: completion.ownerId,
  surface: "runner",
  agentId: completion.agentId,
  agentName: completion.agentName,
  agentSessionId: completion.sessionId,
  agentScope: {
    id: completion.agentId,
    organizationId: completion.organizationId,
    name: completion.agentName,
    handle: completion.agentHandle,
    access: "write",
    projectIds: null,
    sessionId: completion.sessionId,
  },
});

async function openSessionPullRequest(
  db: Database,
  options: CodeServiceOptions,
  completion: SessionCompletion,
) {
  const repositoryId =
    completion.repositoryId ??
    (await chooseSessionRepository(db, {
      organizationId: completion.organizationId,
      projectId: completion.projectId,
      repositoryId: null,
      repositoryUrl: completion.repositoryUrl,
    }));
  // A session that worked in a repository Code does not mirror reports its
  // branch only.
  if (!repositoryId) return;
  const [org] = await db
    .select({ slug: s.organization.slug })
    .from(s.organization)
    .where(eq(s.organization.id, completion.organizationId));
  const sessionUrl = `${(options.appUrl ?? platformUrl()).replace(/\/$/, "")}${paths.factorySession(org?.slug ?? "", completion.sessionId)}`;
  const body = [
    completion.summary?.trim().slice(0, 20_000) ?? "",
    `Opened by ${completion.agentName} from [an agent session](${sessionUrl}). The item reaches Done through its Definition of Done.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    await createCodeService(db, options).openSessionPullRequest(
      sessionActor(completion),
      {
        organizationId: completion.organizationId,
        sessionId: completion.sessionId,
        attempt: completion.attempt,
        repositoryId,
        workItemId: completion.workItemId,
        head: completion.branch,
        base: completion.baseBranch,
        // Without a work item, the session's title names the change.
        title: completion.workItemId ? undefined : completion.title,
        body,
      },
    );
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // The owner lost access, the repository stopped serving the project:
    // the branch stays pushed and the session says why.
    log("code.session_pull_request_refused", {
      organizationId: completion.organizationId,
      sessionId: completion.sessionId,
      reason: error.message,
    });
  }
}

// ------------------------------------------------- the reviewer's session

// What a review session is told: the pull request and the head it reviews,
// and how its verdict counts. The diff is in its worktree (the pull
// request's branch); the item's authority is read with Lictory's tools.
function reviewPrompt(pr: {
  id: string;
  number: number;
  title: string;
  headSha: string;
  fullName: string;
  itemKey: string;
}) {
  return [
    `Review pull request ${pr.id} (${pr.fullName}#${pr.number} “${pr.title}”) for ${pr.itemKey} at head ${pr.headSha}.`,
    "",
    "The project's autonomy policy names you its reviewer agent. Your worktree is the pull request's branch.",
    `- Read ${pr.itemKey} and the specification it is agreed against with Lictory's tools, then the change (git diff against the base branch).`,
    `- Record your verdict with reviewCodePullRequest: pullRequestId ${pr.id}, expectedHeadSha ${pr.headSha}, decision "approve" or "request_changes", and a body that says what you checked and what must change.`,
    "- Your approval counts for this head commit only; new commits need a new review. Do not commit to this branch.",
  ].join("\n");
}

async function dispatchReviews(
  db: Database,
  organizationId: string,
  pullRequestIds: string[],
) {
  const prs = await db
    .select({ pr: s.codePullRequest, fullName: s.codeRepository.fullName })
    .from(s.codePullRequest)
    .innerJoin(
      s.codeRepository,
      and(
        eq(s.codeRepository.organizationId, s.codePullRequest.organizationId),
        eq(s.codeRepository.id, s.codePullRequest.repositoryId),
      ),
    )
    .where(
      and(
        eq(s.codePullRequest.organizationId, organizationId),
        inArray(s.codePullRequest.id, [...new Set(pullRequestIds)]),
        eq(s.codePullRequest.state, "open"),
        eq(s.codePullRequest.draft, false),
      ),
    );
  for (const { pr, fullName } of prs) {
    // Only agents' pull requests get an agent's review.
    if (!pr.agentSessionId || !pr.headSha) continue;
    const [link] = await db
      .select({
        workItemId: s.codeWorkLink.workItemId,
        projectId: s.codeWorkLink.projectId,
        number: s.workItem.number,
        key: s.project.key,
      })
      .from(s.codeWorkLink)
      .innerJoin(
        s.workItem,
        and(
          eq(s.workItem.organizationId, s.codeWorkLink.organizationId),
          eq(s.workItem.id, s.codeWorkLink.workItemId),
        ),
      )
      .innerJoin(
        s.project,
        and(
          eq(s.project.organizationId, s.workItem.organizationId),
          eq(s.project.id, s.workItem.projectId),
        ),
      )
      .where(
        and(
          eq(s.codeWorkLink.organizationId, organizationId),
          eq(s.codeWorkLink.target, "pull_request"),
          eq(s.codeWorkLink.targetId, pr.id),
          isNull(s.codeWorkLink.unlinkedAt),
          isNull(s.workItem.archivedAt),
        ),
      )
      .limit(1);
    if (!link) continue;
    const policy = await db.transaction((tx) =>
      codeReviewPolicy(tx, organizationId, link.projectId),
    );
    if (!policy || policy.reviewer.id === pr.agentId) continue;
    // Already reviewed at this head.
    const [reviewed] = await db
      .select({ id: s.codeReview.id })
      .from(s.codeReview)
      .where(
        and(
          eq(s.codeReview.organizationId, organizationId),
          eq(s.codeReview.pullRequestId, pr.id),
          eq(s.codeReview.headSha, pr.headSha),
          eq(s.codeReview.agentId, policy.reviewer.id),
        ),
      )
      .limit(1);
    if (reviewed) continue;
    const itemKey = `${link.key}-${link.number}`;
    try {
      // One review session per head: the id derives from it, so a
      // repeated hook returns the session it started.
      await startSession(
        db,
        { userId: policy.reviewer.ownerId },
        {
          organizationId,
          agentId: policy.reviewer.id,
          sessionId: stableId("code-review", pr.id, pr.headSha),
          title: `Review #${pr.number}: ${pr.title}`.slice(0, 200),
          prompt: reviewPrompt({ ...pr, fullName, itemKey }),
          workItemId: link.workItemId,
          repositoryId: pr.repositoryId,
          branch: pr.headBranch,
          baseBranch: pr.baseBranch,
          channelId: policy.reportingChannelId,
        },
        { trustedChannel: true },
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      log("code.review_session_refused", {
        organizationId,
        pullRequestId: pr.id,
        reason: error.message,
      });
    }
  }
}

/** Installs the code loop's implementations (process start, tests). */
export function installCodeLoop(
  db: Database,
  options: CodeServiceOptions = {},
) {
  const evidence = createCodeEvidence(db);
  const merges = createCodeMergeExecutor(db, options);
  configureClaimPorts({
    evidence: { evidence: (tx, org, ids) => evidence.evidence(tx, org, ids) },
    merges: { requestMerge: (tx, request) => merges.requestMerge(tx, request) },
  });
  setSessionWorkspaceResolver(workspaceResolver(db, options));
  setSessionCompletionListener({
    pushed: (completion) => openSessionPullRequest(db, options, completion),
  });
  setCodeSessionHooks({
    pullRequestOpened: async (tx, event) => {
      await recordSessionPullRequest(tx, event);
    },
    afterPullRequestOpened: (event) =>
      publishSessionPullRequest(db, event.organizationId, event.sessionId, {
        number: event.number,
        title: event.title,
        url: event.url,
      }),
    pullRequestsChanged: (organizationId, ids) =>
      dispatchReviews(db, organizationId, ids),
  });
}
