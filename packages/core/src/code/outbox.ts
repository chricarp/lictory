import { and, asc, eq, lt, or, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import { createConnections } from "@lictory/core/code/connections";
import { apply } from "@lictory/core/code/ingest";
import { writeCodeProjections } from "@lictory/core/code/projections";
import {
  CodeHostError,
  type CodeChecksSummary,
  type CodeConnection,
  type CodeHostProvider,
  type CodeMergeMethod,
  type CodePullRequestInfo,
  type CodeRepositoryRef,
} from "@lictory/core/code/provider";
import type { CodeHostProviders } from "@lictory/core/code/registry";
import {
  addLink,
  Touched,
  upsertBranch,
  upsertPullRequest,
  type RepositoryRow,
} from "@lictory/core/code/store";
import { notifyCodeWriteFailed } from "@lictory/core/code/notifications";
import { followCodeEvidence } from "@lictory/core/code/follow";
import {
  afterCommit,
  codeSessionHooks,
  type SessionPullRequestEvent,
} from "@lictory/core/code/hooks";

// The outbox: writes to code hosts queued by commands in their domain
// transaction (`code_write`) and sent here, outside any transaction.
// - One sender at a time: a write is claimed under a lease, and the
//   result is recorded only while the lease (and attempt) still holds.
// - Every write is idempotent or recoverable: a branch that already
//   exists at the same commit counts as created, an open pull request is
//   looked up by its head branch before one is opened, a comment carries a
//   marker that is searched for before posting again, a merge of a merged
//   pull request succeeds.
// - Failures stay visible on the write (and to its requester) with the
//   host's reason; temporary ones are retried with backoff, others wait
//   for a person to retry or cancel.

const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;

type WriteRow = typeof s.codeWrite.$inferSelect;

const commentMarker = (writeId: string) => `<!-- lictory:write:${writeId} -->`;

export function createCodeOutbox(
  db: Database,
  options: { providers?: CodeHostProviders; now?: () => Date } = {},
) {
  const connections = createConnections(db, options);
  const now = connections.now;

  return {
    async processDue(limit = 10, signal?: AbortSignal) {
      const due = await db
        .select({
          id: s.codeWrite.id,
          organizationId: s.codeWrite.organizationId,
        })
        .from(s.codeWrite)
        .where(
          or(
            and(
              eq(s.codeWrite.status, "queued"),
              lt(s.codeWrite.nextAttemptAt, sql`now() + interval '1 second'`),
            ),
            and(
              eq(s.codeWrite.status, "sending"),
              lt(s.codeWrite.leaseUntil, sql`now()`),
            ),
          ),
        )
        .orderBy(asc(s.codeWrite.nextAttemptAt))
        .limit(limit);
      let succeeded = 0;
      let failed = 0;
      for (const { id, organizationId } of due) {
        if (signal?.aborted) break;
        const outcome = await this.send(organizationId, id);
        if (outcome === "succeeded") succeeded++;
        else if (outcome === "failed" || outcome === "retrying") failed++;
      }
      return { due: due.length, succeeded, failed };
    },

    async send(organizationId: string, writeId: string) {
      const claimed = await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const [write] = await tx
          .update(s.codeWrite)
          .set({
            status: "sending",
            leaseUntil: new Date(now().getTime() + LEASE_MS),
            attempts: sql`${s.codeWrite.attempts} + 1`,
          })
          .where(
            and(
              eq(s.codeWrite.organizationId, organizationId),
              eq(s.codeWrite.id, writeId),
              or(
                and(
                  eq(s.codeWrite.status, "queued"),
                  lt(
                    s.codeWrite.nextAttemptAt,
                    sql`now() + interval '1 second'`,
                  ),
                ),
                and(
                  eq(s.codeWrite.status, "sending"),
                  lt(s.codeWrite.leaseUntil, sql`now()`),
                ),
              ),
            ),
          )
          .returning();
        if (write)
          await writeCodeProjections(tx, organizationId, {
            writeIds: [write.id],
            ...(write.workItemId ? { workItemIds: [write.workItemId] } : {}),
          });
        return write;
      });
      if (!claimed) return "skipped" as const;
      const [context] = await db
        .select({ repository: s.codeRepository, connection: s.codeConnection })
        .from(s.codeRepository)
        .innerJoin(
          s.codeConnection,
          and(
            eq(
              s.codeConnection.organizationId,
              s.codeRepository.organizationId,
            ),
            eq(s.codeConnection.id, s.codeRepository.connectionId),
          ),
        )
        .where(
          and(
            eq(s.codeRepository.organizationId, organizationId),
            eq(s.codeRepository.id, claimed.repositoryId),
          ),
        );
      if (!context || context.connection.archivedAt)
        return settle(
          claimed,
          null,
          new CodeHostError(
            "validation",
            "The code host connection was removed. Reconnect it and ask again.",
          ),
        );
      const { provider, connection } = connections.open(context.connection);
      try {
        const result = await perform(
          provider,
          connection,
          context.repository,
          claimed,
        );
        return settle(
          claimed,
          { repository: context.repository, result },
          null,
        );
      } catch (error) {
        await connections.markFailure(context.connection, error);
        return settle(claimed, null, error);
      }
    },
  };

  async function perform(
    provider: CodeHostProvider,
    connection: CodeConnection,
    repository: RepositoryRow,
    write: WriteRow,
  ): Promise<Performed> {
    const ref: CodeRepositoryRef = {
      externalId: repository.externalId,
      fullName: repository.fullName,
    };
    const p = write.payload;
    const text = (key: string) => (typeof p[key] === "string" ? p[key] : "");
    const number = typeof p.number === "number" ? p.number : 0;
    const refreshed = async () => {
      const info = await provider.getPullRequest(connection, ref, number);
      if (!info)
        throw new CodeHostError(
          "not_found",
          `Pull request #${number} no longer exists on the host.`,
        );
      return withChecks(provider, connection, ref, info);
    };
    switch (write.kind) {
      case "create_branch": {
        const from = text("from") || repository.defaultBranch;
        const sha = /^[0-9a-f]{40}$/i.test(from)
          ? from
          : (await provider.getBranch(connection, ref, from))?.headSha;
        if (!sha)
          throw new CodeHostError(
            "not_found",
            `The branch ${from} to start from does not exist on the host.`,
          );
        const branch = await provider.createBranch(
          connection,
          ref,
          text("name"),
          sha,
        );
        return {
          kind: "branch",
          branch,
          result: { branch: branch.name, headSha: branch.headSha },
        };
      }
      case "open_pull_request": {
        // Recovers a pull request whose answer was lost: there is at most
        // one open pull request per head branch.
        const existing = await provider.findOpenPullRequest(
          connection,
          ref,
          text("head"),
        );
        const opened =
          existing ??
          (await provider.openPullRequest(connection, ref, {
            head: text("head"),
            base: text("base") || repository.defaultBranch,
            title: text("title"),
            body: text("body"),
            draft: p.draft === true,
          }));
        const full =
          (await provider.getPullRequest(connection, ref, opened.number)) ??
          opened;
        return {
          kind: "pull_request",
          ...(await withChecks(provider, connection, ref, full)),
          opened: true,
          result: {
            number: full.number,
            url: full.webUrl,
            existing: !!existing,
          },
        };
      }
      case "comment": {
        const marker = commentMarker(write.id);
        const found =
          write.attempts > 1
            ? await provider.findComment(connection, ref, number, marker)
            : null;
        const posted =
          found ??
          (await provider.comment(
            connection,
            ref,
            number,
            `${text("body")}\n\n${marker}`,
          ));
        return {
          kind: "none",
          result: { commentId: posted.id, url: posted.url },
        };
      }
      case "request_review":
        await provider.requestReview(
          connection,
          ref,
          number,
          Array.isArray(p.reviewers) ? p.reviewers.map(String) : [],
        );
        return {
          kind: "pull_request",
          ...(await refreshed()),
          result: { number },
        };
      case "merge": {
        const merged = await provider.merge(connection, ref, number, {
          method: (text("method") || "merge") as CodeMergeMethod,
          expectedHeadSha: text("expectedHeadSha"),
        });
        return {
          kind: "pull_request",
          ...(await refreshed()),
          result: { number, mergeSha: merged.sha },
        };
      }
      case "close":
      case "reopen":
        await provider.setPullRequestState(
          connection,
          ref,
          number,
          write.kind === "close" ? "closed" : "open",
        );
        return {
          kind: "pull_request",
          ...(await refreshed()),
          result: { number },
        };
    }
  }

  async function settle(
    write: WriteRow,
    done: { repository: RepositoryRow; result: Performed } | null,
    error: unknown,
  ) {
    const settled: {
      outcome: "succeeded" | "failed" | "retrying" | "lost";
      opened: SessionPullRequestEvent[];
      changed: string[];
    } = { outcome: "lost", opened: [], changed: [] };
    await db.transaction(async (tx) => {
      await lock(tx, write.organizationId);
      const [own] = await tx
        .select({ id: s.codeWrite.id })
        .from(s.codeWrite)
        .where(
          and(
            eq(s.codeWrite.id, write.id),
            eq(s.codeWrite.status, "sending"),
            eq(s.codeWrite.attempts, write.attempts),
          ),
        )
        .for("update");
      // Another sender took over after this lease expired.
      if (!own) return;
      const touched = new Touched();
      touched.writeIds.add(write.id);
      if (write.workItemId) touched.workItemIds.add(write.workItemId);
      if (done) {
        settled.opened = await record(
          tx,
          write,
          done.repository,
          done.result,
          touched,
        );
        settled.changed = [...touched.pullRequestIds];
        await tx
          .update(s.codeWrite)
          .set({
            status: "succeeded",
            result: done.result.result,
            leaseUntil: null,
            lastError: null,
            finishedAt: now(),
          })
          .where(eq(s.codeWrite.id, write.id));
        settled.outcome = "succeeded";
      } else {
        const hostError = error instanceof CodeHostError ? error : null;
        const message =
          hostError?.message ??
          "The code host could not be reached. Lictory tries again shortly.";
        const retryable = !hostError || hostError.retryable;
        if (retryable && write.attempts < MAX_ATTEMPTS) {
          const delay =
            hostError?.retryAfterMs ??
            Math.min(15_000 * 2 ** (write.attempts - 1), 15 * 60_000);
          await tx
            .update(s.codeWrite)
            .set({
              status: "queued",
              leaseUntil: null,
              lastError: message,
              nextAttemptAt: new Date(now().getTime() + delay),
            })
            .where(eq(s.codeWrite.id, write.id));
          settled.outcome = "retrying";
        } else {
          await tx
            .update(s.codeWrite)
            .set({
              status: "failed",
              leaseUntil: null,
              lastError: message,
              finishedAt: now(),
            })
            .where(eq(s.codeWrite.id, write.id));
          await notifyCodeWriteFailed(tx, write, message);
          settled.outcome = "failed";
        }
      }
      await writeCodeProjections(tx, write.organizationId, touched.toTouch());
      // A merge, an opened pull request or a refreshed one is evidence.
      if (done) await followCodeEvidence(tx, write.organizationId, touched);
    });
    for (const event of settled.opened)
      await afterCommit("session_pull_request", () =>
        codeSessionHooks().afterPullRequestOpened(event),
      );
    if (settled.changed.length)
      await afterCommit("pull_requests_changed", () =>
        codeSessionHooks().pullRequestsChanged(
          write.organizationId,
          settled.changed,
        ),
      );
    return settled.outcome;
  }

  // The host's answer updates the mirror and links what Lictory made for
  // the item.
  async function record(
    tx: Tx,
    write: WriteRow,
    repository: RepositoryRow,
    performed: Performed,
    touched: Touched,
  ): Promise<SessionPullRequestEvent[]> {
    const item = write.workItemId
      ? (
          await tx
            .select({ id: s.workItem.id, projectId: s.workItem.projectId })
            .from(s.workItem)
            .where(
              and(
                eq(s.workItem.organizationId, write.organizationId),
                eq(s.workItem.id, write.workItemId),
              ),
            )
        )[0]
      : undefined;
    const link = (
      target: "branch" | "pull_request",
      targetId: string,
      label: string,
      url: string | null,
    ) =>
      item
        ? addLink(
            tx,
            {
              organizationId: write.organizationId,
              workItemId: item.id,
              projectId: item.projectId,
              repositoryId: repository.id,
              target,
              targetId,
              source: write.agentSessionId ? "agent_session" : "lictory",
              createdById: write.requestedById,
              performedVia: write.performedVia,
              agentSessionId: write.agentSessionId,
              ref: label,
              url,
            },
            touched,
          )
        : undefined;
    const opened: SessionPullRequestEvent[] = [];
    if (performed.kind === "branch") {
      const id = await upsertBranch(tx, repository, performed.branch, touched);
      if (id) await link("branch", id, performed.branch.name, null);
      return opened;
    }
    if (performed.kind !== "pull_request") return opened;
    if (performed.opened) {
      // Provenance first, so the mirror row records who opened it.
      const { id } = await upsertPullRequest(
        tx,
        repository,
        performed.info,
        touched,
        {
          openedById: write.requestedById,
          openedVia: write.performedVia,
          agentId: write.agentId,
          agentSessionId: write.agentSessionId,
        },
      );
      await link(
        "pull_request",
        id,
        `#${performed.info.number}`,
        performed.info.webUrl,
      );
      const branch = await upsertBranch(
        tx,
        repository,
        { name: performed.info.headBranch, headSha: performed.info.headSha },
        touched,
      );
      if (branch) await link("branch", branch, performed.info.headBranch, null);
      if (write.agentSessionId) {
        const event: SessionPullRequestEvent = {
          organizationId: write.organizationId,
          sessionId: write.agentSessionId,
          pullRequestId: id,
          number: performed.info.number,
          title: performed.info.title,
          url: performed.info.webUrl,
          workItemId: item?.id ?? null,
        };
        await codeSessionHooks().pullRequestOpened(tx, event);
        opened.push(event);
      }
    }
    await apply(
      tx,
      {
        repository,
        pullRequests: [{ info: performed.info, checks: performed.checks }],
        issues: [],
        checks: [],
        pushes: [],
      },
      touched,
    );
    // The merge Lictory sent: who asked and how, on the mirror (Lictory's
    // provenance next to the host's own merged_by login).
    if (write.kind === "merge" && write.pullRequestId)
      await tx
        .update(s.codePullRequest)
        .set({
          mergeRequestedById: write.requestedById,
          mergedVia: write.performedVia,
        })
        .where(
          and(
            eq(s.codePullRequest.organizationId, write.organizationId),
            eq(s.codePullRequest.id, write.pullRequestId),
          ),
        );
    return opened;
  }
}

type Performed =
  | {
      kind: "branch";
      branch: { name: string; headSha: string };
      result: Record<string, unknown>;
    }
  | {
      kind: "pull_request";
      info: CodePullRequestInfo;
      checks: CodeChecksSummary;
      opened?: boolean;
      result: Record<string, unknown>;
    }
  | { kind: "none"; result: Record<string, unknown> };

async function withChecks(
  provider: CodeHostProvider,
  connection: CodeConnection,
  ref: CodeRepositoryRef,
  info: CodePullRequestInfo,
) {
  return {
    info,
    checks: info.headSha
      ? await provider.getChecks(connection, ref, info.headSha)
      : { state: "none" as const, runs: [] },
  };
}
