import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  CodeEvidence as ClaimsCodeEvidence,
  CodeMergeExecutor as ClaimsCodeMergeExecutor,
  CodePullRequestEvidence,
} from "@lictory/core/claims/ports";
import { DomainError } from "@lictory/core/domain/errors";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import {
  canWorkWithCode,
  codeAccess,
  linkedProjectIds,
} from "@lictory/core/code/access";
import { createConnections } from "@lictory/core/code/connections";
import { mergeBlockers } from "@lictory/core/code/merge-rules";
import type {
  CodeMergeMethod,
  SessionCredential,
} from "@lictory/core/code/provider";
import type { CodeHostProviders } from "@lictory/core/code/registry";
import {
  createCodeService,
  type CodeServiceOptions,
} from "@lictory/core/code/service";

// What other modules use of Code (docs/internals/code-hosts.md#ports). They
// never read the code tables themselves.
//
// - Claims (Definition of Done): `createCodeEvidence` answers "are this
//   item's linked pull requests merged", "did the required checks pass for
//   this head", "what is the review decision". Evidence comes from the
//   mirror, which only the host's answers move.
// - Autopilot: `createCodeMergeExecutor` queues a merge attributed to the
//   autonomy policy and the administrator who set it, under the same merge
//   rules a person's merge follows.
// - Factory: `resolveSessionWorkspace` gives an agent session's runner the
//   clone URL and a short-lived, repository-scoped credential.

export type CheckEvidence = {
  sha: string;
  state: "pending" | "success" | "failure" | "none";
  // Every check passed (or the host reported none and none are required).
  passed: boolean;
  failing: string[];
  pending: string[];
  // Whether the host told Lictory which checks are required; when it did
  // not, every reported check counts as required.
  requiredKnown: boolean;
  // How many checks count (required ones, or every reported one).
  counted: number;
};

export type PullRequestEvidence = {
  pullRequestId: string;
  repositoryId: string;
  repositoryFullName: string;
  number: number;
  title: string;
  webUrl: string;
  state: "open" | "closed" | "merged";
  merged: boolean;
  mergedAt: Date | null;
  draft: boolean;
  headSha: string;
  baseBranch: string;
  reviewDecision: "approved" | "changes_requested" | "review_required" | "none";
  approvedBy: string[];
  authorLogin: string | null;
  // Opened through Lictory: by whom and via which agent.
  openedById: string | null;
  openedVia: string | null;
  // Opened from this Factory agent session, by this agent.
  agentId: string | null;
  agentSessionId: string | null;
  mergeable: boolean | null;
  connectionId: string;
  checks: CheckEvidence;
};

function checkEvidence(
  sha: string,
  row: { state: CheckEvidence["state"]; runs: s.CodeCheckRun[] } | undefined,
): CheckEvidence {
  const runs = row?.runs ?? [];
  const requiredKnown = runs.some((r) => r.required !== undefined);
  const counted = requiredKnown ? runs.filter((r) => r.required) : runs;
  const failing = counted
    .filter((r) => r.state === "failure")
    .map((r) => r.name);
  const pending = counted
    .filter((r) => r.state === "pending")
    .map((r) => r.name);
  return {
    sha,
    state: row?.state ?? "none",
    passed: failing.length === 0 && pending.length === 0,
    failing,
    pending,
    requiredKnown,
    counted: counted.length,
  };
}

// The mirror as Definition of Done evidence (claims/ports.ts), read with the
// caller's transaction so the claims transaction sees what ingest just
// wrote. Approvals of the head commit come from reviews recorded in Lictory
// (agents and people) and from the host's approving logins, mapped to the
// people who set them as their login (`code_host_identity`).
const noConnection =
  "No code host is connected, so Lictory cannot see this item's pull requests or checks. An organization administrator connects GitHub, GitLab or Bitbucket under Code.";

function claimsEvidence(
  pr: PullRequestEvidence,
  context: {
    reviews: (typeof s.codeReview.$inferSelect)[];
    identities: Map<string, string>;
    connectionId: string;
  },
): CodePullRequestEvidence {
  const lictory = context.reviews
    .filter(
      (r) =>
        r.pullRequestId === pr.pullRequestId &&
        r.headSha === pr.headSha &&
        r.decision === "approve",
    )
    .map((r) => ({ agentId: r.agentId, userId: r.reviewerId, login: null }));
  const host = pr.approvedBy.map((login) => ({
    agentId: null,
    userId:
      context.identities.get(
        `${context.connectionId}:${login.toLowerCase()}`,
      ) ?? null,
    login,
  }));
  const counted = pr.checks;
  return {
    id: pr.pullRequestId,
    title: `${pr.repositoryFullName}#${pr.number} ${pr.title}`,
    url: pr.webUrl,
    state: pr.state,
    headSha: pr.headSha || null,
    checks: {
      required: counted.counted,
      failing: counted.failing,
      pending: counted.pending,
    },
    approvals: [...lictory, ...host],
    // What the host would refuse besides checks: a draft, requested
    // changes, conflicts (null while the host has not computed it).
    mergeable:
      pr.state !== "open"
        ? null
        : pr.draft || pr.reviewDecision === "changes_requested"
          ? false
          : pr.mergeable,
  };
}

export function createCodeEvidence(db: Database | Tx) {
  const checksFor = async (
    organizationId: string,
    pairs: { repositoryId: string; sha: string }[],
  ) => {
    if (!pairs.length)
      return new Map<string, typeof s.codeCommitChecks.$inferSelect>();
    const rows = await db
      .select()
      .from(s.codeCommitChecks)
      .where(
        and(
          eq(s.codeCommitChecks.organizationId, organizationId),
          inArray(
            s.codeCommitChecks.sha,
            pairs.map((p) => p.sha),
          ),
        ),
      );
    return new Map(rows.map((r) => [`${r.repositoryId}:${r.sha}`, r]));
  };
  const evidenceOf = async (
    organizationId: string,
    prs: (typeof s.codePullRequest.$inferSelect & {
      repositoryFullName: string;
      connectionId: string;
    })[],
  ): Promise<PullRequestEvidence[]> => {
    const checks = await checksFor(
      organizationId,
      prs.map((p) => ({ repositoryId: p.repositoryId, sha: p.headSha })),
    );
    return prs.map((p) => ({
      pullRequestId: p.id,
      repositoryId: p.repositoryId,
      repositoryFullName: p.repositoryFullName,
      number: p.number,
      title: p.title,
      webUrl: p.webUrl,
      state: p.state,
      merged: p.state === "merged",
      mergedAt: p.mergedAt,
      draft: p.draft,
      headSha: p.headSha,
      baseBranch: p.baseBranch,
      reviewDecision: p.reviewDecision,
      approvedBy: p.approvedBy,
      authorLogin: p.authorLogin,
      openedById: p.openedById,
      openedVia: p.openedVia,
      agentId: p.agentId,
      agentSessionId: p.agentSessionId,
      mergeable: p.mergeable,
      connectionId: p.connectionId,
      checks: checkEvidence(
        p.headSha,
        checks.get(`${p.repositoryId}:${p.headSha}`),
      ),
    }));
  };
  return {
    // Pull requests currently linked to the item (unlinked ones do not
    // count), merged ones included.
    async linkedPullRequests(organizationId: string, workItemId: string) {
      const links = await db
        .select({ targetId: s.codeWorkLink.targetId })
        .from(s.codeWorkLink)
        .where(
          and(
            eq(s.codeWorkLink.organizationId, organizationId),
            eq(s.codeWorkLink.workItemId, workItemId),
            eq(s.codeWorkLink.target, "pull_request"),
            isNull(s.codeWorkLink.unlinkedAt),
          ),
        );
      if (!links.length) return [];
      const rows = await db
        .select({
          pr: s.codePullRequest,
          fullName: s.codeRepository.fullName,
          connectionId: s.codeRepository.connectionId,
        })
        .from(s.codePullRequest)
        .innerJoin(
          s.codeRepository,
          and(
            eq(
              s.codeRepository.organizationId,
              s.codePullRequest.organizationId,
            ),
            eq(s.codeRepository.id, s.codePullRequest.repositoryId),
          ),
        )
        .where(
          and(
            eq(s.codePullRequest.organizationId, organizationId),
            inArray(
              s.codePullRequest.id,
              links.map((l) => l.targetId),
            ),
          ),
        );
      return evidenceOf(
        organizationId,
        rows.map((r) => ({
          ...r.pr,
          repositoryFullName: r.fullName,
          connectionId: r.connectionId,
        })),
      );
    },

    // The Definition of Done's port (claims/ports.ts): every item's
    // currently linked pull requests, in the claims transaction.
    async evidence(
      tx: Tx,
      organizationId: string,
      workItemIds: string[],
    ): Promise<Map<string, ClaimsCodeEvidence>> {
      const result = new Map<string, ClaimsCodeEvidence>();
      if (!workItemIds.length) return result;
      const read = createCodeEvidence(tx);
      const [connection] = await tx
        .select({ id: s.codeConnection.id })
        .from(s.codeConnection)
        .where(
          and(
            eq(s.codeConnection.organizationId, organizationId),
            isNull(s.codeConnection.archivedAt),
          ),
        )
        .limit(1);
      if (!connection) {
        for (const id of workItemIds)
          result.set(id, { connected: false, explanation: noConnection });
        return result;
      }
      const perItem = new Map<string, PullRequestEvidence[]>();
      for (const id of workItemIds)
        perItem.set(id, await read.linkedPullRequests(organizationId, id));
      const all = [...perItem.values()].flat();
      const pullRequestIds = [...new Set(all.map((p) => p.pullRequestId))];
      const [reviews, identities] = await Promise.all([
        pullRequestIds.length
          ? tx
              .select()
              .from(s.codeReview)
              .where(
                and(
                  eq(s.codeReview.organizationId, organizationId),
                  inArray(s.codeReview.pullRequestId, pullRequestIds),
                  isNull(s.codeReview.supersededAt),
                ),
              )
          : Promise.resolve([]),
        all.some((p) => p.approvedBy.length)
          ? tx
              .select()
              .from(s.codeHostIdentity)
              .where(eq(s.codeHostIdentity.organizationId, organizationId))
          : Promise.resolve([]),
      ]);
      const byLogin = new Map(
        identities.map((i) => [
          `${i.connectionId}:${i.login.toLowerCase()}`,
          i.userId,
        ]),
      );
      for (const [id, prs] of perItem)
        result.set(id, {
          connected: true,
          pullRequests: prs.map((pr) =>
            claimsEvidence(pr, {
              reviews,
              identities: byLogin,
              connectionId: pr.connectionId,
            }),
          ),
        });
      return result;
    },

    // Whether the checks of one commit passed.
    async checksForSha(
      organizationId: string,
      repositoryId: string,
      sha: string,
    ) {
      const map = await checksFor(organizationId, [{ repositoryId, sha }]);
      return checkEvidence(sha, map.get(`${repositoryId}:${sha}`));
    },

    async pullRequest(organizationId: string, pullRequestId: string) {
      const [row] = await db
        .select({
          pr: s.codePullRequest,
          fullName: s.codeRepository.fullName,
          connectionId: s.codeRepository.connectionId,
        })
        .from(s.codePullRequest)
        .innerJoin(
          s.codeRepository,
          and(
            eq(
              s.codeRepository.organizationId,
              s.codePullRequest.organizationId,
            ),
            eq(s.codeRepository.id, s.codePullRequest.repositoryId),
          ),
        )
        .where(
          and(
            eq(s.codePullRequest.organizationId, organizationId),
            eq(s.codePullRequest.id, pullRequestId),
          ),
        );
      if (!row) return null;
      const [evidence] = await evidenceOf(organizationId, [
        {
          ...row.pr,
          repositoryFullName: row.fullName,
          connectionId: row.connectionId,
        },
      ]);
      return evidence!;
    },
  };
}

export type CodeEvidence = ReturnType<typeof createCodeEvidence>;

// The autopilot's merge: queued like a person's merge, attributed to the
// policy ("Autopilot · policy set by Ada") and the administrator who
// configured it, who must still administer the project the repository
// serves, and refused for the same reasons (state, draft, failing or
// pending checks, requested changes, conflicts, a head that moved). The
// Definition of Done is the caller's to check first.
export function createCodeMergeExecutor(
  db: Database,
  options: CodeServiceOptions = {},
) {
  const service = createCodeService(db, options);
  const explain = async (
    tx: Tx,
    organizationId: string,
    workItemId: string,
    headSha: string,
  ) => {
    const [item] = await tx
      .select({ number: s.workItem.number, key: s.project.key })
      .from(s.workItem)
      .innerJoin(
        s.project,
        and(
          eq(s.project.organizationId, s.workItem.organizationId),
          eq(s.project.id, s.workItem.projectId),
        ),
      )
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          eq(s.workItem.id, workItemId),
        ),
      );
    const key = item ? ` for ${item.key}-${item.number}` : "";
    return `Autopilot merges this pull request${key} at ${headSha.slice(0, 7)}: the required checks passed on this commit, the reviewer agent approved it and every other Definition of Done check passed.`;
  };
  const executor: ClaimsCodeMergeExecutor & {
    enqueueMerge: (input: {
      organizationId: string;
      pullRequestId: string;
      expectedHeadSha: string;
      method?: CodeMergeMethod;
      policy: {
        projectId: string;
        configuredById: string;
        version?: number;
        label?: string;
      };
      idempotencyKey: string;
    }) => Promise<{ writeId: string | null }>;
    mergeBlockers: typeof mergeBlockers;
  } = {
    // The claims port (docs/internals/claims.md#ports): in the claims
    // transaction, under the organization lock, once per pull request head.
    async requestMerge(tx, request) {
      const result = await service.mergeForPolicyIn(tx, {
        organizationId: request.organizationId,
        pullRequestId: request.pullRequestId,
        expectedHeadSha: request.headSha,
        idempotencyKey: request.idempotencyKey,
        policy: {
          projectId: request.projectId,
          configuredById: request.authorizedById,
          version: request.policyVersion,
        },
        explanation: await explain(
          tx,
          request.organizationId,
          request.workItemId,
          request.headSha,
        ),
      });
      return result.requested
        ? { requested: true }
        : { requested: false, reason: result.reason };
    },
    // The same outside a transaction (tests, tools): refusals throw.
    async enqueueMerge(input) {
      const result = await db.transaction(async (tx) => {
        await lock(tx, input.organizationId);
        return service.mergeForPolicyIn(tx, {
          organizationId: input.organizationId,
          pullRequestId: input.pullRequestId,
          expectedHeadSha: input.expectedHeadSha,
          method: input.method,
          idempotencyKey: input.idempotencyKey,
          policy: { version: 0, ...input.policy },
        });
      });
      if (!result.requested)
        throw new DomainError(result.category, result.reason);
      return { writeId: result.writeId };
    },
    mergeBlockers,
  };
  return executor;
}

export type CodeMergeExecutor = ReturnType<typeof createCodeMergeExecutor>;

export type SessionWorkspace = {
  repositoryId: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  branch: string;
  credential: SessionCredential;
};

// For the runner protocol: the session's person must be able to work with
// the repository's code. The credential is minted per session (GitHub App
// installation tokens, Bitbucket OAuth tokens) or is the stored token, which
// `credential.longLived` flags so the UI can warn.
export async function resolveSessionWorkspace(
  db: Database,
  input: {
    organizationId: string;
    // The accountable person of the agent session.
    userId: string;
    repositoryId: string;
    branch: string;
  },
  options: { providers?: CodeHostProviders } = {},
): Promise<SessionWorkspace> {
  const connections = createConnections(db, options);
  const { repository, connection: row } = await db.transaction(async (tx) => {
    const access = await codeAccess(tx, input.userId, input.organizationId);
    const [found] = await tx
      .select({ repository: s.codeRepository, connection: s.codeConnection })
      .from(s.codeRepository)
      .innerJoin(
        s.codeConnection,
        and(
          eq(s.codeConnection.organizationId, s.codeRepository.organizationId),
          eq(s.codeConnection.id, s.codeRepository.connectionId),
        ),
      )
      .where(
        and(
          eq(s.codeRepository.organizationId, input.organizationId),
          eq(s.codeRepository.id, input.repositoryId),
          isNull(s.codeConnection.archivedAt),
        ),
      );
    if (!found)
      throw new DomainError("not_found", "This repository is unavailable.");
    const projects = await linkedProjectIds(
      tx,
      input.organizationId,
      input.repositoryId,
    );
    if (!projects.some((id) => canWorkWithCode(access, id)))
      throw new DomainError(
        "forbidden",
        "The session's person cannot work with this repository's code.",
      );
    return found;
  });
  const { provider, connection } = connections.open(row);
  try {
    const credential = await provider.createSessionCredential(connection, {
      externalId: repository.externalId,
      fullName: repository.fullName,
    });
    return {
      repositoryId: repository.id,
      fullName: repository.fullName,
      cloneUrl: repository.cloneUrl,
      defaultBranch: repository.defaultBranch,
      branch: input.branch || repository.defaultBranch,
      credential,
    };
  } catch (error) {
    await connections.markFailure(row, error);
    throw error;
  }
}

// Which repository an agent session works in
// (docs/internals/code-hosts.md#agent-sessions): the one the session names,
// else the one whose clone address the session states, else its project's
// default, else the project's first linked repository. Only repositories
// that serve the project count (or, for a session without a project, any
// of the organization's that the person can work with). Null when none.
export async function chooseSessionRepository(
  db: Database | Tx,
  input: {
    organizationId: string;
    projectId: string | null;
    repositoryId: string | null;
    repositoryUrl: string | null;
  },
) {
  const active = and(
    eq(s.codeRepository.organizationId, input.organizationId),
    isNull(s.codeConnection.archivedAt),
  );
  const joined = () =>
    db
      .select({
        id: s.codeRepository.id,
        cloneUrl: s.codeRepository.cloneUrl,
        webUrl: s.codeRepository.webUrl,
      })
      .from(s.codeRepository)
      .innerJoin(
        s.codeConnection,
        and(
          eq(s.codeConnection.organizationId, s.codeRepository.organizationId),
          eq(s.codeConnection.id, s.codeRepository.connectionId),
        ),
      );
  if (!input.projectId) {
    if (input.repositoryId) {
      const [named] = await joined().where(
        and(active, eq(s.codeRepository.id, input.repositoryId)),
      );
      return named?.id ?? null;
    }
    if (!input.repositoryUrl) return null;
    const rows = await joined().where(active);
    return (
      rows.find((r) => sameRepository(r, input.repositoryUrl!))?.id ?? null
    );
  }
  const rows = await db
    .select({
      id: s.codeRepository.id,
      cloneUrl: s.codeRepository.cloneUrl,
      webUrl: s.codeRepository.webUrl,
      isDefault: s.codeRepositoryProject.isDefault,
    })
    .from(s.codeRepositoryProject)
    .innerJoin(
      s.codeRepository,
      and(
        eq(
          s.codeRepository.organizationId,
          s.codeRepositoryProject.organizationId,
        ),
        eq(s.codeRepository.id, s.codeRepositoryProject.repositoryId),
      ),
    )
    .innerJoin(
      s.codeConnection,
      and(
        eq(s.codeConnection.organizationId, s.codeRepository.organizationId),
        eq(s.codeConnection.id, s.codeRepository.connectionId),
      ),
    )
    .where(
      and(
        eq(s.codeRepositoryProject.organizationId, input.organizationId),
        eq(s.codeRepositoryProject.projectId, input.projectId),
        isNull(s.codeConnection.archivedAt),
      ),
    )
    .orderBy(
      desc(s.codeRepositoryProject.isDefault),
      asc(s.codeRepositoryProject.createdAt),
      asc(s.codeRepository.fullName),
    );
  if (input.repositoryId)
    return rows.find((r) => r.id === input.repositoryId)?.id ?? null;
  if (input.repositoryUrl) {
    const stated = rows.find((r) => sameRepository(r, input.repositoryUrl!));
    // A stated address that is not one of the project's repositories is
    // the session's own (cloned without brokered credentials).
    return stated?.id ?? null;
  }
  return rows[0]?.id ?? null;
}

const normalized = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
function sameRepository(
  row: { cloneUrl: string; webUrl: string },
  url: string,
) {
  const stated = normalized(url);
  return (
    normalized(row.cloneUrl) === stated || normalized(row.webUrl) === stated
  );
}
