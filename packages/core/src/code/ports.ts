import { and, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { canManageProject } from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import type { Database } from "@lictory/core/domain/service";
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
  };
}

export function createCodeEvidence(db: Database) {
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
        .select({ pr: s.codePullRequest, fullName: s.codeRepository.fullName })
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
        rows.map((r) => ({ ...r.pr, repositoryFullName: r.fullName })),
      );
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
        .select({ pr: s.codePullRequest, fullName: s.codeRepository.fullName })
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
        { ...row.pr, repositoryFullName: row.fullName },
      ]);
      return evidence!;
    },
  };
}

export type CodeEvidence = ReturnType<typeof createCodeEvidence>;

// The autopilot's merge: queued like a person's merge, attributed to the
// policy ("Autopilot") and the administrator who configured it, and refused
// for the same reasons (state, draft, failing or pending checks, requested
// changes, conflicts, a head that moved). The Definition of Done is the
// caller's to check first.
export function createCodeMergeExecutor(
  db: Database,
  options: CodeServiceOptions = {},
) {
  const service = createCodeService(db, options);
  return {
    async enqueueMerge(input: {
      organizationId: string;
      pullRequestId: string;
      expectedHeadSha: string;
      method?: CodeMergeMethod;
      // The project whose autonomy policy merges, and who configured it.
      policy: { projectId: string; configuredById: string; label?: string };
      // One merge per policy decision: retries reuse it.
      idempotencyKey: string;
    }) {
      // The configuring administrator must still administer the project,
      // and the repository must serve it.
      await db.transaction(async (tx) => {
        const access = await codeAccess(
          tx,
          input.policy.configuredById,
          input.organizationId,
        );
        if (
          !canManageProject(
            access.roster,
            input.policy.configuredById,
            access.admin,
            input.policy.projectId,
          )
        )
          throw new DomainError(
            "forbidden",
            "The administrator who set this project's autonomy policy no longer administers it; Autopilot does not merge until a current administrator confirms the policy.",
          );
        const [pr] = await tx
          .select({ repositoryId: s.codePullRequest.repositoryId })
          .from(s.codePullRequest)
          .where(
            and(
              eq(s.codePullRequest.organizationId, input.organizationId),
              eq(s.codePullRequest.id, input.pullRequestId),
            ),
          );
        if (!pr)
          throw new DomainError(
            "not_found",
            "This pull request is unavailable.",
          );
        const projects = await linkedProjectIds(
          tx,
          input.organizationId,
          pr.repositoryId,
        );
        if (!projects.includes(input.policy.projectId))
          throw new DomainError(
            "forbidden",
            "This pull request's repository does not serve the project whose policy would merge it.",
          );
      });
      return service.merge(
        { userId: input.policy.configuredById },
        {
          organizationId: input.organizationId,
          pullRequestId: input.pullRequestId,
          expectedHeadSha: input.expectedHeadSha,
          method: input.method,
          mutationId: input.idempotencyKey,
        },
        { performedVia: input.policy.label ?? "Autopilot" },
      );
    },
    mergeBlockers,
  };
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
