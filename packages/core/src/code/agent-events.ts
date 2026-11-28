import { and, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import type { CodePullRequestInfo } from "@lictory/core/code/provider";
import { queueCodePullRequestEvent } from "@lictory/core/agent-events/producers";

// Agent events for code host pull requests (docs/internals/agent-events.md,
// pull_request.*): when a mirrored pull request is decided, merged or stops
// being mergeable, the people it concerns are told through their agents'
// feeds. Only transitions of a pull request Lictory already mirrored count:
// a first sighting (a backfill, a newly linked repository) is history, not
// news. Identifiers and the title only; the dedupe key names the change, so
// a replayed webhook or a reconciliation pass tells nobody twice.

type PullRequestRow = typeof s.codePullRequest.$inferSelect;
type RepositoryRow = typeof s.codeRepository.$inferSelect;

export async function queuePullRequestTransitions(
  tx: Tx,
  repository: RepositoryRow,
  before: PullRequestRow,
  after: CodePullRequestInfo,
) {
  const changes: {
    kind:
      | "code_pull_request_decided"
      | "code_pull_request_merged"
      | "code_pull_request_unmergeable";
    detail: Record<string, string>;
    key: string;
  }[] = [];
  if (after.state === "merged" && before.state !== "merged")
    changes.push({
      kind: "code_pull_request_merged",
      detail: {},
      key: "merged",
    });
  if (
    after.state === "open" &&
    (after.reviewDecision === "approved" ||
      after.reviewDecision === "changes_requested") &&
    after.reviewDecision !== before.reviewDecision
  )
    changes.push({
      kind: "code_pull_request_decided",
      detail: { decision: after.reviewDecision },
      key: `decided:${after.reviewDecision}`,
    });
  if (
    after.state === "open" &&
    after.mergeable === false &&
    (before.mergeable !== false || before.headSha !== after.headSha)
  )
    changes.push({
      kind: "code_pull_request_unmergeable",
      detail: { reason: "conflicts" },
      key: "unmergeable",
    });
  if (!changes.length) return;

  const organizationId = repository.organizationId;
  const [connection] = await tx
    .select({ provider: s.codeConnection.provider })
    .from(s.codeConnection)
    .where(
      and(
        eq(s.codeConnection.organizationId, organizationId),
        eq(s.codeConnection.id, repository.connectionId),
      ),
    );
  // Who it concerns: the person who opened it through Lictory, its author
  // on the host when mapped to a person, and the assignees of the items it
  // is linked to.
  const items = await tx
    .select({
      id: s.workItem.id,
      projectId: s.workItem.projectId,
      number: s.workItem.number,
      assigneeId: s.workItem.assigneeId,
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
        eq(s.codeWorkLink.targetId, before.id),
        isNull(s.codeWorkLink.unlinkedAt),
      ),
    );
  const logins = [after.authorLogin, after.mergedByLogin].filter(
    (login): login is string => Boolean(login),
  );
  const identities = logins.length
    ? await tx
        .select({
          userId: s.codeHostIdentity.userId,
          login: s.codeHostIdentity.login,
        })
        .from(s.codeHostIdentity)
        .where(
          and(
            eq(s.codeHostIdentity.organizationId, organizationId),
            eq(s.codeHostIdentity.connectionId, repository.connectionId),
            inArray(s.codeHostIdentity.login, logins),
          ),
        )
    : [];
  const personOf = (login: string | null) =>
    identities.find((i) => login && i.login === login)?.userId ?? null;
  const userIds = [
    ...new Set(
      [
        before.openedById,
        personOf(after.authorLogin),
        ...items.map((i) => i.assigneeId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!userIds.length) return;
  const only = items.length === 1 ? items[0]! : null;
  for (const change of changes)
    await queueCodePullRequestEvent(tx, {
      organizationId,
      kind: change.kind,
      userIds,
      actorId:
        change.kind === "code_pull_request_merged"
          ? personOf(after.mergedByLogin)
          : null,
      projectId: only?.projectId ?? items[0]?.projectId ?? null,
      workItemId: only?.id ?? null,
      detail: {
        codePullRequestId: before.id,
        repositoryId: repository.id,
        number: after.number,
        pullRequestTitle: after.title,
        provider: connection?.provider ?? null,
        ...(only ? { itemKey: `${only.key}-${only.number}` } : {}),
        ...change.detail,
      },
      dedupeKey: `${before.id}:${after.headSha}:${change.key}`,
    });
}
