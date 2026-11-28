import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import { signalWork } from "@lictory/core/jobs/signal";
import { createConnections } from "@lictory/core/code/connections";
import { writeCodeProjections } from "@lictory/core/code/projections";
import { followCodeEvidence } from "@lictory/core/code/follow";
import { afterCommit, codeSessionHooks } from "@lictory/core/code/hooks";
import {
  CodeHostError,
  type CodeChecksSummary,
  type CodeConnection,
  type CodeHostProvider,
  type CodeIssueInfo,
  type CodePullRequestInfo,
  type CodeRepositoryInfo,
  type CodeWebhookEvent,
} from "@lictory/core/code/provider";
import type { CodeHostProviders } from "@lictory/core/code/registry";
import {
  itemsNamedIn,
  linkNamedItems,
  addLink,
  repositoryProjects,
  Touched,
  updateRepository,
  upsertBranch,
  upsertChecks,
  upsertCommit,
  upsertIssue,
  upsertPullRequest,
  type RepositoryRow,
} from "@lictory/core/code/store";
import { SYSTEM_ACTOR } from "@lictory/core/domain/delivery";

// Webhook ingest (docs/internals/code-hosts.md#ingest).
//
// 1. The route verifies the host's signature with the connection's secret
//    and stores the delivery once by its delivery id (a replay is a
//    duplicate and changes nothing), then answers at once.
// 2. The worker claims pending deliveries under a lease, reads what they
//    name again from the host (outside any transaction), and applies it to
//    the mirrors, links and projections in one transaction fenced by the
//    lease.
// Text in a payload is data: it can name work items (key detection) but
// never authorizes anything.

const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 6;
// Processed deliveries are kept this long for diagnosis, then pruned.
const RETENTION_MS = 14 * 24 * 60 * 60_000;

export type ReceiveResult =
  | { status: "accepted" | "duplicate" }
  | { status: "rejected"; reason: "unknown" | "signature" | "payload" };

export async function receiveWebhook(
  db: Database,
  input: {
    connectionId: string;
    headers: Record<string, string | undefined>;
    body: string;
  },
  options: { providers?: CodeHostProviders } = {},
): Promise<ReceiveResult> {
  const connections = createConnections(db, options);
  if (!/^[0-9a-f-]{36}$/i.test(input.connectionId))
    return { status: "rejected", reason: "unknown" };
  const [row] = await db
    .select()
    .from(s.codeConnection)
    .where(
      and(
        eq(s.codeConnection.id, input.connectionId),
        isNull(s.codeConnection.archivedAt),
      ),
    );
  if (!row) return { status: "rejected", reason: "unknown" };
  const provider = connections.providers()[row.provider];
  let secret: string;
  try {
    secret = connections.webhookSecret(row);
  } catch {
    return refuse(db, row, "signature", connections.now());
  }
  const verified = provider.verifyWebhook(
    { headers: input.headers, body: input.body },
    secret,
  );
  if (!verified) return refuse(db, row, "signature", connections.now());
  let payload: unknown;
  try {
    payload = JSON.parse(input.body);
  } catch {
    return refuse(db, row, "payload", connections.now());
  }
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(s.codeWebhookDelivery)
      .values({
        organizationId: row.organizationId,
        connectionId: row.id,
        deliveryId: verified.deliveryId,
        event: verified.event,
        payload,
      })
      .onConflictDoNothing()
      .returning({ id: s.codeWebhookDelivery.id });
    if (!inserted.length) return { status: "duplicate" as const };
    await signalWork(tx, "code");
    return { status: "accepted" as const };
  });
}

// Records a refused delivery on its connection, at most once a minute, so
// administrators see why deliveries stopped counting (docs/internals/
// code-hosts.md#ingest). The request is unauthenticated: the throttle keeps
// a flood of forged deliveries from turning into a flood of writes.
const REFUSAL_RECORD_MS = 60_000;

export type WebhookRefusal = "signature" | "payload";

async function refuse(
  db: Database,
  row: typeof s.codeConnection.$inferSelect,
  reason: WebhookRefusal,
  at: Date,
): Promise<ReceiveResult> {
  const recent = row.lastWebhookRefusedAt
    ? at.getTime() - row.lastWebhookRefusedAt.getTime() < REFUSAL_RECORD_MS
    : false;
  if (!recent || row.lastWebhookRefusal !== reason)
    await db.transaction(async (tx) => {
      await lock(tx, row.organizationId);
      const updated = await tx
        .update(s.codeConnection)
        .set({ lastWebhookRefusedAt: at, lastWebhookRefusal: reason })
        .where(
          and(
            eq(s.codeConnection.organizationId, row.organizationId),
            eq(s.codeConnection.id, row.id),
            or(
              isNull(s.codeConnection.lastWebhookRefusedAt),
              lt(
                s.codeConnection.lastWebhookRefusedAt,
                new Date(at.getTime() - REFUSAL_RECORD_MS),
              ),
              sql`${s.codeConnection.lastWebhookRefusal} is distinct from ${reason}`,
            ),
          ),
        )
        .returning({ id: s.codeConnection.id });
      if (updated.length)
        await writeCodeProjections(tx, row.organizationId, {
          connectionIds: [row.id],
        });
    });
  return { status: "rejected", reason };
}

type Delivery = typeof s.codeWebhookDelivery.$inferSelect;

// What one delivery needs from the host, read before the transaction.
type Fetched = {
  repository: RepositoryRow;
  repositoryInfo?: CodeRepositoryInfo | null;
  pullRequests: { info: CodePullRequestInfo; checks: CodeChecksSummary }[];
  issues: CodeIssueInfo[];
  checks: { sha: string; summary: CodeChecksSummary }[];
  pushes: Extract<CodeWebhookEvent, { kind: "push" }>[];
};

export function createCodeIngest(
  db: Database,
  options: { providers?: CodeHostProviders; now?: () => Date } = {},
) {
  const connections = createConnections(db, options);
  const now = connections.now;

  return {
    // Claims and processes pending deliveries, oldest first.
    async processPending(limit = 20, signal?: AbortSignal) {
      const claimed = await db
        .update(s.codeWebhookDelivery)
        .set({
          leaseUntil: sql`now() + make_interval(secs => ${LEASE_MS / 1000})`,
          attempts: sql`${s.codeWebhookDelivery.attempts} + 1`,
        })
        .where(
          inArray(
            s.codeWebhookDelivery.id,
            db
              .select({ id: s.codeWebhookDelivery.id })
              .from(s.codeWebhookDelivery)
              .where(
                and(
                  eq(s.codeWebhookDelivery.status, "pending"),
                  or(
                    isNull(s.codeWebhookDelivery.leaseUntil),
                    lt(s.codeWebhookDelivery.leaseUntil, sql`now()`),
                  ),
                ),
              )
              .orderBy(asc(s.codeWebhookDelivery.receivedAt))
              .limit(limit)
              .for("update", { skipLocked: true }),
          ),
        )
        .returning();
      let processed = 0;
      let failed = 0;
      for (const delivery of claimed) {
        if (signal?.aborted) break;
        try {
          await processDelivery(delivery);
          processed++;
        } catch (error) {
          failed++;
          await releaseFailed(delivery, error);
        }
      }
      await prune();
      return { claimed: claimed.length, processed, failed };
    },
  };

  async function processDelivery(delivery: Delivery) {
    const [row] = await db
      .select()
      .from(s.codeConnection)
      .where(eq(s.codeConnection.id, delivery.connectionId));
    if (!row || row.archivedAt) return finish(delivery, "ignored", null);
    const { provider, connection } = connections.open(row);
    const events = provider.parseWebhook(delivery.event, delivery.payload);
    // Repositories this connection mirrors, by host id.
    const ids = [
      ...new Set(
        events.flatMap((e) =>
          "repository" in e ? [e.repository.externalId] : [],
        ),
      ),
    ];
    const repositories = ids.length
      ? await db
          .select()
          .from(s.codeRepository)
          .where(
            and(
              eq(s.codeRepository.organizationId, row.organizationId),
              eq(s.codeRepository.connectionId, row.id),
              inArray(s.codeRepository.externalId, ids),
            ),
          )
      : [];
    const byExternal = new Map(repositories.map((r) => [r.externalId, r]));
    const fetched = new Map<string, Fetched>();
    try {
      for (const event of events) {
        if (event.kind === "ping") continue;
        const repository = byExternal.get(event.repository.externalId);
        if (!repository) continue;
        const entry =
          fetched.get(repository.id) ??
          ({
            repository,
            pullRequests: [],
            issues: [],
            checks: [],
            pushes: [],
          } satisfies Fetched);
        fetched.set(repository.id, entry);
        await fetchFor(provider, connection, entry, event);
      }
    } catch (error) {
      await connections.markFailure(row, error);
      throw error;
    }
    const changed: string[] = [];
    await db.transaction(async (tx) => {
      await lock(tx, row.organizationId);
      if (!(await stillLeased(tx, delivery))) return;
      const touched = new Touched();
      for (const entry of fetched.values()) await apply(tx, entry, touched);
      await tx
        .update(s.codeConnection)
        .set({ lastWebhookAt: now() })
        .where(eq(s.codeConnection.id, row.id));
      touched.connectionIds.add(row.id);
      await tx
        .update(s.codeWebhookDelivery)
        .set({
          status: fetched.size ? "processed" : "ignored",
          processedAt: now(),
          leaseUntil: null,
          lastError: null,
        })
        .where(eq(s.codeWebhookDelivery.id, delivery.id));
      await writeCodeProjections(tx, row.organizationId, touched.toTouch());
      // Pull requests, reviews and checks are Definition of Done evidence.
      await followCodeEvidence(tx, row.organizationId, touched);
      changed.push(...touched.pullRequestIds);
    });
    if (changed.length)
      await afterCommit("pull_requests_changed", () =>
        codeSessionHooks().pullRequestsChanged(row.organizationId, changed),
      );
  }

  async function fetchFor(
    provider: CodeHostProvider,
    connection: CodeConnection,
    entry: Fetched,
    event: Exclude<CodeWebhookEvent, { kind: "ping" }>,
  ) {
    const ref = {
      externalId: entry.repository.externalId,
      fullName: entry.repository.fullName,
    };
    const pullRequest = async (number: number) => {
      if (entry.pullRequests.some((p) => p.info.number === number)) return;
      const info = await provider.getPullRequest(connection, ref, number);
      if (!info) return;
      const checks = info.headSha
        ? await provider.getChecks(connection, ref, info.headSha)
        : { state: "none" as const, runs: [] };
      entry.pullRequests.push({ info, checks });
    };
    switch (event.kind) {
      case "pull_request":
        return pullRequest(event.number);
      case "issue": {
        const info = await provider.getIssue(connection, ref, event.number);
        if (info) entry.issues.push(info);
        return;
      }
      case "checks": {
        if (!entry.checks.some((c) => c.sha === event.sha))
          entry.checks.push({
            sha: event.sha,
            summary: await provider.getChecks(connection, ref, event.sha),
          });
        for (const number of event.pullRequests) await pullRequest(number);
        return;
      }
      case "push":
        entry.pushes.push(event);
        return;
      case "repository":
        entry.repositoryInfo = await provider.getRepository(
          connection,
          ref.externalId,
        );
        return;
    }
  }

  async function stillLeased(tx: Tx, delivery: Delivery) {
    const [own] = await tx
      .select({ id: s.codeWebhookDelivery.id })
      .from(s.codeWebhookDelivery)
      .where(
        and(
          eq(s.codeWebhookDelivery.id, delivery.id),
          eq(s.codeWebhookDelivery.status, "pending"),
          eq(s.codeWebhookDelivery.attempts, delivery.attempts),
        ),
      )
      .for("update");
    return !!own;
  }

  async function finish(
    delivery: Delivery,
    status: "ignored",
    error: string | null,
  ) {
    await db
      .update(s.codeWebhookDelivery)
      .set({ status, processedAt: now(), leaseUntil: null, lastError: error })
      .where(
        and(
          eq(s.codeWebhookDelivery.id, delivery.id),
          eq(s.codeWebhookDelivery.attempts, delivery.attempts),
        ),
      );
  }

  // Retried later with backoff; given up after MAX_ATTEMPTS (the
  // reconciliation repairs what it would have changed).
  async function releaseFailed(delivery: Delivery, error: unknown) {
    const message =
      error instanceof CodeHostError
        ? error.message
        : error instanceof Error
          ? error.message.slice(0, 500)
          : "Processing failed.";
    const retryable = !(error instanceof CodeHostError) || error.retryable;
    const last = delivery.attempts >= MAX_ATTEMPTS || !retryable;
    const delay = Math.min(30_000 * 2 ** (delivery.attempts - 1), 30 * 60_000);
    await db
      .update(s.codeWebhookDelivery)
      .set(
        last
          ? {
              status: "failed",
              leaseUntil: null,
              lastError: message,
              processedAt: now(),
            }
          : {
              leaseUntil: new Date(now().getTime() + delay),
              lastError: message,
            },
      )
      .where(
        and(
          eq(s.codeWebhookDelivery.id, delivery.id),
          eq(s.codeWebhookDelivery.attempts, delivery.attempts),
        ),
      );
  }

  async function prune() {
    await db
      .delete(s.codeWebhookDelivery)
      .where(
        and(
          inArray(s.codeWebhookDelivery.status, [
            "processed",
            "ignored",
            "failed",
          ]),
          lt(
            s.codeWebhookDelivery.receivedAt,
            new Date(now().getTime() - RETENTION_MS),
          ),
        ),
      );
  }
}

// Applies what was read from the host for one repository. Shared with
// reconciliation and the outbox.
export async function apply(tx: Tx, entry: Fetched, touched: Touched) {
  const repository = entry.repository;
  if (entry.repositoryInfo)
    await updateRepository(tx, repository, entry.repositoryInfo, touched);
  const projects = await repositoryProjects(
    tx,
    repository.organizationId,
    repository.id,
  );
  // A repository no project uses any more keeps its mirror but links no
  // new work.
  const detecting = projects.length > 0;
  for (const { sha, summary } of entry.checks)
    await upsertChecks(tx, repository, sha, summary, touched);
  for (const { info, checks } of entry.pullRequests) {
    await upsertChecks(tx, repository, info.headSha, checks, touched);
    const { id } = await upsertPullRequest(tx, repository, info, touched);
    if (detecting) {
      await linkNamedItems(
        tx,
        repository,
        "pull_request",
        id,
        [info.title, info.body, info.headBranch],
        { label: `#${info.number}`, url: info.webUrl },
        touched,
      );
      await linkHeadBranch(tx, repository, info, id, touched);
    }
  }
  for (const issue of entry.issues) {
    const { id } = await upsertIssue(tx, repository, issue, touched);
    if (detecting)
      await linkNamedItems(
        tx,
        repository,
        "issue",
        id,
        [issue.title, issue.body],
        { label: `#${issue.number}`, url: issue.webUrl },
        touched,
      );
  }
  for (const push of entry.pushes) {
    if (push.deleted) {
      await upsertBranch(
        tx,
        repository,
        { name: push.branch, deleted: true },
        touched,
      );
      continue;
    }
    // Branches are mirrored only when they name an item (or already are).
    const named = detecting
      ? await itemsNamedIn(tx, repository.organizationId, repository.id, [
          push.branch,
        ])
      : [];
    const [known] = await tx
      .select({ id: s.codeBranch.id })
      .from(s.codeBranch)
      .where(
        and(
          eq(s.codeBranch.organizationId, repository.organizationId),
          eq(s.codeBranch.repositoryId, repository.id),
          eq(s.codeBranch.name, push.branch),
        ),
      );
    if ((named.length || known) && push.headSha) {
      const branchId = await upsertBranch(
        tx,
        repository,
        { name: push.branch, headSha: push.headSha },
        touched,
      );
      if (branchId && detecting)
        await linkNamedItems(
          tx,
          repository,
          "branch",
          branchId,
          [push.branch],
          { label: push.branch, url: null },
          touched,
        );
    }
    if (detecting)
      for (const commit of push.commits.slice(0, 100)) {
        const items = await itemsNamedIn(
          tx,
          repository.organizationId,
          repository.id,
          [commit.message],
        );
        if (!items.length) continue;
        const commitId = await upsertCommit(
          tx,
          repository,
          commit,
          push.branch,
        );
        await linkNamedItems(
          tx,
          repository,
          "commit",
          commitId,
          [commit.message],
          { label: commit.sha.slice(0, 12), url: commit.webUrl },
          touched,
        );
      }
  }
}

// A pull request's head branch is linked to whatever the pull request is
// linked to by key, so an item shows the branch its pull request comes
// from.
async function linkHeadBranch(
  tx: Tx,
  repository: RepositoryRow,
  info: CodePullRequestInfo,
  pullRequestId: string,
  touched: Touched,
) {
  if (!info.headBranch || info.state !== "open") return;
  const links = await tx
    .select()
    .from(s.codeWorkLink)
    .where(
      and(
        eq(s.codeWorkLink.organizationId, repository.organizationId),
        eq(s.codeWorkLink.target, "pull_request"),
        eq(s.codeWorkLink.targetId, pullRequestId),
        isNull(s.codeWorkLink.unlinkedAt),
      ),
    );
  if (!links.length) return;
  const branchId = await upsertBranch(
    tx,
    repository,
    { name: info.headBranch, headSha: info.headSha },
    touched,
  );
  if (!branchId) return;
  for (const link of links)
    await addLink(
      tx,
      {
        organizationId: repository.organizationId,
        workItemId: link.workItemId,
        projectId: link.projectId,
        repositoryId: repository.id,
        target: "branch",
        targetId: branchId,
        source: "key",
        createdById: SYSTEM_ACTOR,
        ref: info.headBranch,
        url: null,
      },
      touched,
    );
}

export type { Fetched };
