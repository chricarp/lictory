import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { lock, type Database } from "@lictory/core/domain/service";
import { createConnections } from "@lictory/core/code/connections";
import { apply, type Fetched } from "@lictory/core/code/ingest";
import { writeCodeProjections } from "@lictory/core/code/projections";
import { followCodeEvidence } from "@lictory/core/code/follow";
import { afterCommit, codeSessionHooks } from "@lictory/core/code/hooks";
import { CodeHostError } from "@lictory/core/code/provider";
import type { CodeHostProviders } from "@lictory/core/code/registry";
import { detectKeys } from "@lictory/core/code/keys";
import {
  repositoryProjects,
  Touched,
  upsertBranch,
} from "@lictory/core/code/store";

// Reconciliation repairs what webhooks missed (a host that could not reach
// Lictory, a delivery that failed for good, a repository connected without
// webhooks) and backfills a repository when it is first linked. Each
// repository is due on `sync_due_at`; a run claims it with a lease, reads
// the host outside any transaction and applies the result exactly like a
// webhook. The interval keeps API use bounded: only pull requests and
// issues updated since the last run (with a margin) are read again.

const INTERVAL_MS = 10 * 60_000;
const LEASE_MS = 5 * 60_000;
const MARGIN_MS = 10 * 60_000;
// A first sync reads this far back.
const BACKFILL_MS = 30 * 24 * 60 * 60_000;

export function createCodeReconciler(
  db: Database,
  options: { providers?: CodeHostProviders; now?: () => Date } = {},
) {
  const connections = createConnections(db, options);
  const now = connections.now;

  return {
    async processDue(limit = 5, signal?: AbortSignal) {
      // Repositories no project uses are not reconciled.
      const due = await db
        .select({ id: s.codeRepository.id })
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
            isNull(s.codeConnection.archivedAt),
            eq(s.codeConnection.status, "active"),
            isNotNull(s.codeRepository.syncDueAt),
            lt(s.codeRepository.syncDueAt, sql`now() + interval '1 second'`),
            or(
              isNull(s.codeRepository.syncLeaseUntil),
              lt(s.codeRepository.syncLeaseUntil, sql`now()`),
            ),
            sql`exists (select 1 from ${s.codeRepositoryProject} where ${s.codeRepositoryProject.organizationId} = ${s.codeRepository.organizationId} and ${s.codeRepositoryProject.repositoryId} = ${s.codeRepository.id})`,
          ),
        )
        .orderBy(asc(s.codeRepository.syncDueAt))
        .limit(limit);
      let synced = 0;
      let failed = 0;
      for (const { id } of due) {
        if (signal?.aborted) break;
        const result = await this.syncRepository(id);
        if (result === "synced") synced++;
        else if (result === "failed") failed++;
      }
      return { due: due.length, synced, failed };
    },

    async syncRepository(repositoryId: string) {
      const lease = new Date(now().getTime() + LEASE_MS);
      const [claimed] = await db
        .update(s.codeRepository)
        .set({ syncLeaseUntil: lease })
        .where(
          and(
            eq(s.codeRepository.id, repositoryId),
            or(
              isNull(s.codeRepository.syncLeaseUntil),
              lt(s.codeRepository.syncLeaseUntil, now()),
            ),
          ),
        )
        .returning();
      if (!claimed) return "skipped" as const;
      const [row] = await db
        .select()
        .from(s.codeConnection)
        .where(eq(s.codeConnection.id, claimed.connectionId));
      if (!row || row.archivedAt) return "skipped" as const;
      const { provider, connection } = connections.open(row);
      const ref = {
        externalId: claimed.externalId,
        fullName: claimed.fullName,
      };
      const since = claimed.lastSyncedAt
        ? new Date(claimed.lastSyncedAt.getTime() - MARGIN_MS)
        : new Date(now().getTime() - BACKFILL_MS);
      const startedAt = now();
      let entry: Fetched;
      let branches: { name: string; headSha: string }[];
      let onHost: Set<string>;
      try {
        const [stored, projects] = await Promise.all([
          db
            .select({
              number: s.codePullRequest.number,
              hostUpdatedAt: s.codePullRequest.hostUpdatedAt,
              headSha: s.codePullRequest.headSha,
              state: s.codePullRequest.state,
            })
            .from(s.codePullRequest)
            .where(
              and(
                eq(s.codePullRequest.organizationId, claimed.organizationId),
                eq(s.codePullRequest.repositoryId, claimed.id),
              ),
            ),
          db.transaction((tx) =>
            repositoryProjects(tx, claimed.organizationId, claimed.id),
          ),
        ]);
        const known = new Map(stored.map((p) => [p.number, p]));
        const info = await provider.getRepository(connection, ref.externalId);
        const listed = await provider.listPullRequests(connection, ref, {
          since,
          limit: 100,
        });
        entry = {
          repository: claimed,
          repositoryInfo: info,
          pullRequests: [],
          issues: [],
          checks: [],
          pushes: [],
        };
        for (const summary of listed) {
          const previous = known.get(summary.number);
          // Unchanged closed history is not read again; open ones are, so
          // review and check rollups stay fresh.
          if (
            previous &&
            summary.state !== "open" &&
            previous.state === summary.state &&
            previous.hostUpdatedAt.getTime() >= summary.updatedAt.getTime()
          )
            continue;
          const full = await provider.getPullRequest(
            connection,
            ref,
            summary.number,
          );
          if (!full) continue;
          const checks = full.headSha
            ? await provider.getChecks(connection, ref, full.headSha)
            : { state: "none" as const, runs: [] };
          entry.pullRequests.push({ info: full, checks });
        }
        entry.issues = await provider.listIssues(connection, ref, {
          since,
          limit: 200,
        });
        const keys = projects.map((p) => p.key);
        const all = await provider.listBranches(connection, ref);
        onHost = new Set(all.map((b) => b.name));
        branches = all.filter((b) => detectKeys([b.name], keys).length > 0);
        const commits = await provider.listCommits(connection, ref, {
          branch: (info ?? claimed).defaultBranch,
          since,
          limit: 200,
        });
        const named = commits.filter(
          (c) => detectKeys([c.message], keys).length > 0,
        );
        if (named.length)
          entry.pushes.push({
            kind: "push",
            repository: ref,
            branch: (info ?? claimed).defaultBranch,
            // Commits only: the default branch itself is not mirrored.
            headSha: null,
            deleted: false,
            commits: named,
          });
      } catch (error) {
        await connections.markFailure(row, error);
        await db.transaction(async (tx) => {
          await lock(tx, claimed.organizationId);
          await tx
            .update(s.codeRepository)
            .set({
              syncLeaseUntil: null,
              syncDueAt: new Date(now().getTime() + INTERVAL_MS),
              lastSyncError:
                error instanceof CodeHostError
                  ? error.message
                  : "The repository could not be read. Lictory tries again shortly.",
            })
            .where(
              and(
                eq(s.codeRepository.id, claimed.id),
                eq(s.codeRepository.syncLeaseUntil, lease),
              ),
            );
          await writeCodeProjections(tx, claimed.organizationId, {
            repositoryIds: [claimed.id],
          });
        });
        return "failed" as const;
      }
      const changed: string[] = [];
      await db.transaction(async (tx) => {
        await lock(tx, claimed.organizationId);
        const [own] = await tx
          .select({ id: s.codeRepository.id })
          .from(s.codeRepository)
          .where(
            and(
              eq(s.codeRepository.id, claimed.id),
              eq(s.codeRepository.syncLeaseUntil, lease),
            ),
          )
          .for("update");
        if (!own) return;
        const touched = new Touched();
        await apply(tx, entry, touched);
        for (const branch of branches)
          await upsertBranch(tx, claimed, branch, touched);
        // Mirrored branches the host no longer has were deleted there.
        const mirrored = await tx
          .select({ name: s.codeBranch.name })
          .from(s.codeBranch)
          .where(
            and(
              eq(s.codeBranch.organizationId, claimed.organizationId),
              eq(s.codeBranch.repositoryId, claimed.id),
              isNull(s.codeBranch.deletedAt),
            ),
          );
        for (const { name } of mirrored)
          if (!onHost.has(name))
            await upsertBranch(tx, claimed, { name, deleted: true }, touched);
        // Branches named for items are linked like pushed ones.
        await apply(
          tx,
          {
            repository: claimed,
            pullRequests: [],
            issues: [],
            checks: [],
            pushes: branches.map((b) => ({
              kind: "push" as const,
              repository: ref,
              branch: b.name,
              headSha: b.headSha,
              deleted: false,
              commits: [],
            })),
          },
          touched,
        );
        await tx
          .update(s.codeRepository)
          .set({
            lastSyncedAt: startedAt,
            syncDueAt: new Date(now().getTime() + INTERVAL_MS),
            syncLeaseUntil: null,
            lastSyncError: null,
          })
          .where(eq(s.codeRepository.id, claimed.id));
        touched.repositoryIds.add(claimed.id);
        await writeCodeProjections(
          tx,
          claimed.organizationId,
          touched.toTouch(),
        );
        // What a missed webhook would have moved, the reconciliation does.
        await followCodeEvidence(tx, claimed.organizationId, touched);
        changed.push(...touched.pullRequestIds);
      });
      if (changed.length)
        await afterCommit("pull_requests_changed", () =>
          codeSessionHooks().pullRequestsChanged(
            claimed.organizationId,
            changed,
          ),
        );
      return "synced" as const;
    },
  };
}
