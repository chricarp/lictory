import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { DomainError } from "@lictory/core/domain/errors";
import { directory, executeMutation } from "@lictory/core/domain/service";
import {
  createFakeCodeHost,
  fakeCodeHosts,
} from "@lictory/core/code/fake-provider";
import { createCodeIngest, receiveWebhook } from "@lictory/core/code/ingest";
import { createCodeOutbox } from "@lictory/core/code/outbox";
import { codeProjectionDrift } from "@lictory/core/code/projections";
import { CodeHostError } from "@lictory/core/code/provider";
import { createCodeReconciler } from "@lictory/core/code/reconcile";
import { createCodeService } from "@lictory/core/code/service";
import {
  createCodeEvidence,
  createCodeMergeExecutor,
  resolveSessionWorkspace,
} from "@lictory/core/code/ports";
import type { CodePullRequestEntity } from "@lictory/core/code/entities";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_code_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
process.env.DELIVERY_CREDENTIALS_KEY = "code-test-key";

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

// An organization with Payments (PAY) and Operations (OPS), an owner, an
// engineer in Payments, a member without disciplines, a connected fake
// GitHub and acme/pay serving Payments only.
async function fixture() {
  const organizationId = crypto.randomUUID();
  const owner = await user("Ada Owner");
  const engineer = await user("Grace Engineer");
  const outsider = await user("Linus Member");
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Acme",
    slug: `acme-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [
      [owner, "owner"],
      [engineer, "member"],
      [outsider, "member"],
    ].map(([userId, role]) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId: userId!,
      role: role!,
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  const command = (command: Command, actor = owner) =>
    executeMutation(
      db,
      { userId: actor },
      {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId,
        command,
      },
    );
  const pay = crypto.randomUUID();
  const ops = crypto.randomUUID();
  await command({
    type: "createProject",
    projectId: pay,
    name: "Payments",
    key: "PAY",
  });
  await command({
    type: "createProject",
    projectId: ops,
    name: "Operations",
    key: "OPS",
  });
  const roster = await directory(db, owner, organizationId);
  const engineering = roster.disciplines.find(
    (d) => d.projectId === pay && d.name === "Engineering",
  )!;
  await command({
    type: "setDisciplineMember",
    projectId: pay,
    disciplineId: engineering.id,
    userId: engineer,
    member: true,
  });
  const task = roster.types.find((t) => t.name === "Task")!.id;
  const item = async (projectId: string, title: string) => {
    const workItemId = crypto.randomUUID();
    await command({
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId: task,
      parentId: null,
      title,
    });
    return workItemId;
  };
  const pay1 = await item(pay, "Refunds over the API");
  const ops1 = await item(ops, "Rotate keys");

  const host = createFakeCodeHost();
  const repo = host.addRepository("acme/pay");
  const providers = fakeCodeHosts(host);
  const service = createCodeService(db, {
    providers,
    appUrl: "https://lictory.test",
  });
  const ingest = createCodeIngest(db, { providers });
  const outbox = createCodeOutbox(db, { providers });
  const reconciler = createCodeReconciler(db, { providers });
  const connected = await service.connect(
    { userId: owner },
    {
      organizationId,
      provider: "github",
      authKind: "token",
      baseUrl: "https://github.com",
      credential: { token: "github_pat_test" },
    },
  );
  const { repositoryId } = await service.linkRepository(
    { userId: owner },
    {
      organizationId,
      connectionId: connected.connectionId,
      repository: "acme/pay",
      projectId: pay,
    },
  );
  const deliver = async (
    event: string,
    payload: Record<string, unknown>,
    deliveryId?: string,
  ) => {
    const signed = host.webhook(
      connected.webhookSecret!,
      event,
      payload,
      deliveryId,
    );
    const result = await receiveWebhook(
      db,
      { connectionId: connected.connectionId, ...signed },
      { providers },
    );
    await ingest.processPending();
    return result;
  };
  const prEntity = async (number: number) => {
    const [row] = await db
      .select({ data: s.codeEntity.data })
      .from(s.codeEntity)
      .innerJoin(
        s.codePullRequest,
        eq(s.codeEntity.key, sql_key(s.codePullRequest.id)),
      )
      .where(
        and(
          eq(s.codePullRequest.organizationId, organizationId),
          eq(s.codePullRequest.number, number),
        ),
      );
    return row?.data as unknown as CodePullRequestEntity | undefined;
  };
  const links = async (workItemId: string) =>
    (await service.workItemCode({ userId: owner }, organizationId, workItemId))
      .links;
  return {
    organizationId,
    owner,
    engineer,
    outsider,
    pay,
    ops,
    pay1,
    ops1,
    host,
    repo,
    providers,
    service,
    ingest,
    outbox,
    reconciler,
    connectionId: connected.connectionId,
    secret: connected.webhookSecret!,
    repositoryId,
    deliver,
    prEntity,
    links,
  };
}

// code_entity keys are `${type}:${id}`.
const sql_key = (column: typeof s.codePullRequest.id) =>
  sql<string>`'codePullRequest:' || ${column}`;

const refusal =
  (category: DomainError["category"], pattern?: RegExp) => (error: unknown) =>
    error instanceof DomainError &&
    error.category === category &&
    (!pattern || pattern.test(error.message));

void test("connecting stores the credential encrypted; the projection carries no secret", async () => {
  const f = await fixture();
  const [row] = await db
    .select()
    .from(s.codeConnection)
    .where(eq(s.codeConnection.id, f.connectionId));
  assert.ok(row && !row.encryptedCredential.includes("github_pat_test"));
  const rows = await db
    .select({ data: s.codeEntity.data })
    .from(s.codeEntity)
    .where(eq(s.codeEntity.organizationId, f.organizationId));
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes("github_pat_test"));
  assert.ok(!serialized.includes(f.secret));
  assert.ok(serialized.includes(`/api/code/webhooks/${f.connectionId}`));
  // Only administrators connect hosts.
  await assert.rejects(
    f.service.connect(
      { userId: f.engineer },
      {
        organizationId: f.organizationId,
        provider: "github",
        authKind: "token",
        baseUrl: "",
        credential: { token: "x" },
      },
    ),
    refusal("forbidden"),
  );
  // A rejected credential is reported, nothing is stored.
  await assert.rejects(
    f.service.connect(
      { userId: f.owner },
      {
        organizationId: f.organizationId,
        provider: "github",
        authKind: "token",
        baseUrl: "",
        credential: { token: "bad" },
      },
    ),
    refusal(
      "validation",
      /^GitHub rejected this token\. Check that it was copied whole/,
    ),
  );
  // A host that never answers names the address to check.
  f.host.fail(
    "verify",
    new CodeHostError("unavailable", "unreachable", undefined, true),
  );
  await assert.rejects(
    f.service.connect(
      { userId: f.owner },
      {
        organizationId: f.organizationId,
        provider: "github",
        authKind: "token",
        baseUrl: "https://github.invalid.test",
        credential: { token: "good" },
      },
    ),
    refusal(
      "validation",
      /^GitHub at https:\/\/github\.invalid\.test did not answer\. Check the host address/,
    ),
  );
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("webhooks: good signatures are stored once, bad and replayed ones change nothing", async () => {
  const f = await fixture();
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "pay-1-refunds",
    title: "PAY-1: refunds, see OPS-1",
  });
  const payload = {
    action: "opened",
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  };
  assert.deepEqual(await f.deliver("pull_request", payload, "delivery-1"), {
    status: "accepted",
  });
  // The same delivery again: a duplicate.
  assert.deepEqual(await f.deliver("pull_request", payload, "delivery-1"), {
    status: "duplicate",
  });
  // Signed with another secret: refused before anything is stored.
  const forged = f.host.webhook(
    "not-the-secret",
    "pull_request",
    payload,
    "delivery-2",
  );
  assert.deepEqual(
    await receiveWebhook(
      db,
      { connectionId: f.connectionId, ...forged },
      { providers: f.providers },
    ),
    { status: "rejected", reason: "signature" },
  );
  // An unknown connection looks the same as a bad signature from outside.
  assert.equal(
    (
      await receiveWebhook(
        db,
        { connectionId: crypto.randomUUID(), ...forged },
        { providers: f.providers },
      )
    ).status,
    "rejected",
  );
  const deliveries = await db
    .select()
    .from(s.codeWebhookDelivery)
    .where(eq(s.codeWebhookDelivery.connectionId, f.connectionId));
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]!.status, "processed");

  // Mirrored, and linked by key only within the repository's projects.
  const entity = await f.prEntity(pr.number);
  assert.equal(entity?.title, "PAY-1: refunds, see OPS-1");
  assert.deepEqual(
    entity?.links.map((l) => l.workItemId),
    [f.pay1],
  );
  assert.deepEqual(await f.links(f.ops1), []);
  const pay1 = await f.links(f.pay1);
  assert.deepEqual(pay1.map((l) => l.target).sort(), [
    "branch",
    "pull_request",
  ]);
  assert.ok(pay1.every((l) => l.source === "key"));
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("mirrors are the host's: older data never overwrites newer, commands never edit them", async () => {
  const f = await fixture();
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "pay-1-a",
    title: "PAY-1 first",
  });
  const payload = {
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  };
  await f.deliver("pull_request", payload);
  f.host.updatePullRequest(f.repo.externalId, pr.number, {
    title: "PAY-1 renamed",
  });
  await f.deliver("pull_request", payload);
  assert.equal((await f.prEntity(pr.number))?.title, "PAY-1 renamed");
  // A late copy of the old state (as a reordered reconciliation would
  // read it) is ignored.
  const stale = { ...f.host.repos.get(f.repo.externalId)!.prs.get(pr.number)! };
  stale.title = "PAY-1 first";
  stale.updatedAt = new Date(stale.updatedAt.getTime() - 60_000);
  const { upsertPullRequest, Touched } =
    await import("@lictory/core/code/store");
  const [repository] = await db
    .select()
    .from(s.codeRepository)
    .where(eq(s.codeRepository.id, f.repositoryId));
  await db.transaction((tx) =>
    upsertPullRequest(tx, repository!, stale, new Touched()),
  );
  const [stored] = await db
    .select()
    .from(s.codePullRequest)
    .where(eq(s.codePullRequest.repositoryId, f.repositoryId));
  assert.equal(stored!.title, "PAY-1 renamed");
  // Linking and commenting leave the mirror as the host reported it.
  await f.service.comment(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      pullRequestId: stored!.id,
      body: "Looks good",
    },
  );
  await f.outbox.processDue();
  const [after] = await db
    .select()
    .from(s.codePullRequest)
    .where(eq(s.codePullRequest.id, stored!.id));
  assert.equal(after!.title, "PAY-1 renamed");
  assert.equal(after!.hostUpdatedAt.getTime(), stored!.hostUpdatedAt.getTime());
});

void test("unlinking is recorded and key detection does not link the same code again", async () => {
  const f = await fixture();
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "feature-x",
    title: "PAY-1 work",
  });
  const payload = {
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  };
  await f.deliver("pull_request", payload);
  const [link] = (await f.links(f.pay1)).filter(
    (l) => l.target === "pull_request",
  );
  assert.ok(link);
  // Someone without "Change properties" in Payments cannot unlink.
  await assert.rejects(
    f.service.unlinkCode({ userId: f.outsider }, f.organizationId, link.id),
    refusal("forbidden"),
  );
  await f.service.unlinkCode({ userId: f.engineer }, f.organizationId, link.id);
  f.host.updatePullRequest(f.repo.externalId, pr.number, {
    title: "PAY-1 work, again PAY-1",
  });
  await f.deliver("pull_request", payload);
  assert.deepEqual(
    (await f.links(f.pay1)).filter((l) => l.target === "pull_request"),
    [],
  );
  const rows = await db
    .select()
    .from(s.codeWorkLink)
    .where(eq(s.codeWorkLink.workItemId, f.pay1));
  const unlinked = rows.find((r) => r.target === "pull_request")!;
  assert.equal(unlinked.unlinkedById, f.engineer);
  const activity = await db
    .select({ action: s.activity.action })
    .from(s.activity)
    .where(eq(s.activity.workItemId, f.pay1));
  assert.ok(activity.some((a) => a.action === "code_unlinked"));
  // A person can still link it again on purpose.
  await f.service.linkCode(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      workItemId: f.pay1,
      repositoryId: f.repositoryId,
      target: "pull_request",
      ref: `#${pr.number}`,
    },
  );
  assert.equal(
    (await f.links(f.pay1)).find((l) => l.target === "pull_request")?.source,
    "manual",
  );
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("tenant isolation: another organization's members read and write nothing", async () => {
  const f = await fixture();
  const g = await fixture();
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "pay-1-x",
    title: "PAY-1",
  });
  await f.deliver("pull_request", {
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  });
  const [stored] = await db
    .select()
    .from(s.codePullRequest)
    .where(eq(s.codePullRequest.repositoryId, f.repositoryId));
  const stranger = { userId: g.owner };
  await assert.rejects(
    f.service.listPullRequests(stranger, { organizationId: f.organizationId }),
    refusal("forbidden"),
  );
  // Ids from another organization are not found in one's own.
  await assert.rejects(
    g.service.getPullRequest({ userId: g.owner }, g.organizationId, stored!.id),
    refusal("not_found"),
  );
  await assert.rejects(
    g.service.merge(
      { userId: g.owner },
      {
        organizationId: g.organizationId,
        pullRequestId: stored!.id,
        expectedHeadSha: stored!.headSha,
      },
    ),
    refusal("not_found"),
  );
  await assert.rejects(
    g.service.linkCode(
      { userId: g.owner },
      {
        organizationId: g.organizationId,
        workItemId: g.pay1,
        repositoryId: f.repositoryId,
        target: "pull_request",
        ref: "#1",
      },
    ),
    refusal("not_found"),
  );
  // A delivery for f's connection, signed with g's secret, is refused.
  const forged = g.host.webhook(g.secret, "pull_request", {
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  });
  assert.equal(
    (
      await receiveWebhook(
        db,
        { connectionId: f.connectionId, ...forged },
        { providers: f.providers },
      )
    ).status,
    "rejected",
  );
  assert.deepEqual(await g.links(g.pay1), []);
});

void test("opening a pull request is idempotent, even when the host's answer is lost", async () => {
  const f = await fixture();
  // The engineer asks for a branch for PAY-1, then a pull request.
  const branch = await f.service.createBranch(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      workItemId: f.pay1,
      mutationId: "branch-1",
    },
  );
  assert.equal(branch.branchName, "pay-1-refunds-over-the-api");
  // The same request again returns the same write.
  const again = await f.service.createBranch(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      workItemId: f.pay1,
      mutationId: "branch-1",
    },
  );
  assert.equal(again.writeId, branch.writeId);
  assert.equal(again.replayed, true);
  await f.outbox.processDue();
  assert.ok(
    f.host.repos.get(f.repo.externalId)!.branches.has(branch.branchName),
  );

  // The host opens the pull request but the answer never arrives.
  f.host.fail(
    "openPullRequest",
    new CodeHostError("unavailable", "Timed out."),
    true,
  );
  const opened = await f.service.openPullRequest(
    { userId: f.engineer, surface: "mcp", agentName: "Forge" },
    {
      organizationId: f.organizationId,
      workItemId: f.pay1,
      head: branch.branchName,
      mutationId: "pr-1",
    },
  );
  assert.equal((await f.outbox.processDue()).failed, 1);
  const [waiting] = await db
    .select()
    .from(s.codeWrite)
    .where(eq(s.codeWrite.id, opened.writeId));
  assert.equal(waiting!.status, "queued");
  assert.match(waiting!.lastError ?? "", /Timed out/);
  // The retry finds the pull request the host already opened.
  await db
    .update(s.codeWrite)
    .set({ nextAttemptAt: new Date(0) })
    .where(eq(s.codeWrite.id, opened.writeId));
  await f.outbox.processDue();
  const prs = [...f.host.repos.get(f.repo.externalId)!.prs.values()];
  assert.equal(prs.length, 1);
  assert.equal(prs[0]!.title, "PAY-1: Refunds over the API");
  assert.match(prs[0]!.body, /Lictory: \[PAY-1\]\(https:\/\/lictory\.test\//);
  const [done] = await db
    .select()
    .from(s.codeWrite)
    .where(eq(s.codeWrite.id, opened.writeId));
  assert.equal(done!.status, "succeeded");
  const entity = await f.prEntity(prs[0]!.number);
  assert.equal(entity?.openedById, f.engineer);
  assert.equal(entity?.openedVia, "Forge");
  const pay1 = await f.links(f.pay1);
  assert.deepEqual(pay1.map((l) => [l.target, l.source]).sort(), [
    ["branch", "lictory"],
    ["pull_request", "lictory"],
  ]);
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("outbox: permanent failures stay visible with the host's reason, notify, and can be retried", async () => {
  const f = await fixture();
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "pay-1-x",
    title: "PAY-1",
  });
  await f.deliver("pull_request", {
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  });
  const [stored] = await db
    .select()
    .from(s.codePullRequest)
    .where(eq(s.codePullRequest.repositoryId, f.repositoryId));
  f.host.fail(
    "comment",
    new CodeHostError(
      "permission",
      "The connection's account lacks permission.",
    ),
  );
  const first = await f.service.comment(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      pullRequestId: stored!.id,
      body: "First",
    },
  );
  const second = await f.service.comment(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      pullRequestId: stored!.id,
      body: "Second",
    },
  );
  const sent = await f.outbox.processDue();
  assert.deepEqual([sent.succeeded, sent.failed], [1, 1]);
  const writes = await db
    .select()
    .from(s.codeWrite)
    .where(eq(s.codeWrite.pullRequestId, stored!.id));
  const failed = writes.find((w) => w.id === first.writeId)!;
  assert.equal(failed.status, "failed");
  assert.match(failed.lastError!, /lacks permission/);
  assert.equal(
    writes.find((w) => w.id === second.writeId)!.status,
    "succeeded",
  );
  // The failure is projected, so the item and pull request show it.
  const projected = await db
    .select()
    .from(s.codeEntity)
    .where(eq(s.codeEntity.key, `codeWrite:${failed.id}`));
  assert.equal(projected[0]?.facet, "failed");
  // The requester is told.
  const events = await db
    .select()
    .from(s.notificationEvent)
    .where(eq(s.notificationEvent.organizationId, f.organizationId));
  assert.ok(
    events.some((e) =>
      (e.notices as { kind: string }[]).some(
        (n) => n.kind === "code_write_failed",
      ),
    ),
  );
  // Retry sends it again; a comment posted twice is prevented by its marker.
  await f.service.retryWrite(
    { userId: f.engineer },
    f.organizationId,
    failed.id,
  );
  await f.outbox.processDue();
  const comments = f.host.comments(f.repo.externalId, pr.number);
  assert.equal(comments.length, 2);
  assert.ok(
    comments.every((c) => c.body.includes("— Grace Engineer, from Lictory")),
  );
  await assert.rejects(
    f.service.retryWrite({ userId: f.engineer }, f.organizationId, failed.id),
    refusal("conflict", /already succeeded/),
  );
  // A comment whose answer was lost is found by its marker, not posted again.
  f.host.fail("comment", new CodeHostError("unavailable", "Timed out."), true);
  const lost = await f.service.comment(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      pullRequestId: stored!.id,
      body: "Third",
    },
  );
  await f.outbox.processDue();
  await db
    .update(s.codeWrite)
    .set({ nextAttemptAt: new Date(0) })
    .where(eq(s.codeWrite.id, lost.writeId!));
  await f.outbox.processDue();
  assert.equal(f.host.comments(f.repo.externalId, pr.number).length, 3);
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("merging: authorized, refused for unmet rules and a moved head, and the mirror follows the host", async () => {
  const f = await fixture();
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "pay-1-x",
    title: "PAY-1",
  });
  f.host.setChecks(f.repo.externalId, pr.headSha, [
    { name: "ci", state: "pending", url: null },
  ]);
  const payload = {
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  };
  // The linked item's assignee hears about the merge through their agents.
  await db
    .update(s.workItem)
    .set({ assigneeId: f.engineer })
    .where(eq(s.workItem.id, f.pay1));
  await f.deliver("pull_request", payload);
  const [stored] = await db
    .select()
    .from(s.codePullRequest)
    .where(eq(s.codePullRequest.repositoryId, f.repositoryId));
  const merge = (userId: string, expectedHeadSha = pr.headSha) =>
    f.service.merge(
      { userId },
      {
        organizationId: f.organizationId,
        pullRequestId: stored!.id,
        expectedHeadSha,
      },
    );
  // Without "Change properties" in a project the repository serves.
  await assert.rejects(merge(f.outsider), refusal("forbidden"));
  // Checks still running.
  await assert.rejects(merge(f.engineer), refusal("conflict", /still running/));
  // Checks go green (a check_suite webhook names the head).
  f.host.setChecks(f.repo.externalId, pr.headSha, [
    { name: "ci", state: "success", url: null },
  ]);
  await f.deliver("check_suite", {
    repository: f.host.repositoryPayload(f.repo.externalId),
    check_suite: {
      head_sha: pr.headSha,
      pull_requests: [{ number: pr.number }],
    },
  });
  assert.equal((await f.prEntity(pr.number))?.checks.state, "success");
  const evidence = createCodeEvidence(db);
  assert.equal(
    (await evidence.checksForSha(f.organizationId, f.repositoryId, pr.headSha))
      .passed,
    true,
  );
  // A head the person did not inspect.
  await assert.rejects(
    merge(f.engineer, "f".repeat(40)),
    refusal("conflict", /new commits/),
  );
  const queued = await merge(f.engineer);
  // Asking again while it is queued returns the same write.
  assert.equal((await merge(f.engineer)).writeId, queued.writeId);
  await f.outbox.processDue();
  const merged = await f.prEntity(pr.number);
  assert.equal(merged?.state, "merged");
  // A replayed webhook tells nobody twice (agent events, identifiers only).
  await f.deliver("pull_request", payload);
  const notices = (
    await db
      .select({ notices: s.notificationEvent.notices })
      .from(s.notificationEvent)
      .where(eq(s.notificationEvent.organizationId, f.organizationId))
  ).flatMap((e) => e.notices);
  const mergedNotices = notices.filter(
    (n) => n.kind === "code_pull_request_merged",
  );
  assert.equal(mergedNotices.length, 1);
  assert.deepEqual(mergedNotices[0]!.userIds, [f.engineer]);
  assert.equal(mergedNotices[0]!.workItemId, f.pay1);
  assert.equal(
    (mergedNotices[0]!.detail as { pullRequestTitle?: string })
      .pullRequestTitle,
    "PAY-1",
  );
  const [linked] = await evidence.linkedPullRequests(f.organizationId, f.pay1);
  assert.equal(linked?.merged, true);
  // Merged: merging again changes nothing, closing is refused.
  assert.deepEqual((await merge(f.engineer)).result, {
    unchanged: true,
    state: "merged",
  });
  await assert.rejects(
    f.service.setPullRequestState(
      { userId: f.engineer },
      {
        organizationId: f.organizationId,
        pullRequestId: stored!.id,
        state: "closed",
      },
    ),
    refusal("conflict", /merged/),
  );
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("autopilot merges are attributed to the policy and need its administrator", async () => {
  const f = await fixture();
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "pay-1-x",
    title: "PAY-1",
  });
  await f.deliver("pull_request", {
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  });
  const [stored] = await db
    .select()
    .from(s.codePullRequest)
    .where(eq(s.codePullRequest.repositoryId, f.repositoryId));
  const executor = createCodeMergeExecutor(db, { providers: f.providers });
  await assert.rejects(
    executor.enqueueMerge({
      organizationId: f.organizationId,
      pullRequestId: stored!.id,
      expectedHeadSha: pr.headSha,
      policy: { projectId: f.pay, configuredById: f.engineer },
      idempotencyKey: "autopilot-1",
    }),
    refusal("forbidden", /no longer administers/),
  );
  await assert.rejects(
    executor.enqueueMerge({
      organizationId: f.organizationId,
      pullRequestId: stored!.id,
      expectedHeadSha: pr.headSha,
      policy: { projectId: f.ops, configuredById: f.owner },
      idempotencyKey: "autopilot-2",
    }),
    refusal("forbidden", /does not serve/),
  );
  const queued = await executor.enqueueMerge({
    organizationId: f.organizationId,
    pullRequestId: stored!.id,
    expectedHeadSha: pr.headSha,
    policy: { projectId: f.pay, configuredById: f.owner },
    idempotencyKey: "autopilot-3",
  });
  const [write] = await db
    .select()
    .from(s.codeWrite)
    .where(eq(s.codeWrite.id, queued.writeId!));
  assert.equal(write!.performedVia, "Autopilot · policy set by Ada Owner");
  assert.equal(write!.requestedById, f.owner);
});

void test("reconciliation backfills a linked repository and repairs missed events", async () => {
  const f = await fixture();
  f.host.pushBranch(f.repo.externalId, "pay-1-backfill");
  f.host.pushBranch(f.repo.externalId, "unrelated");
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "pay-1-backfill",
    title: "Backfill",
  });
  const issue = f.host.addIssue(f.repo.externalId, "Crash on PAY-1 retry", "", [
    "bug",
  ]);
  // Nothing was delivered: the reconciliation finds it.
  assert.equal(await f.reconciler.syncRepository(f.repositoryId), "synced");
  const pay1 = await f.links(f.pay1);
  assert.deepEqual(pay1.map((l) => l.target).sort(), [
    "branch",
    "issue",
    "pull_request",
  ]);
  assert.ok(
    !pay1.some(
      (l) => l.summary.target === "branch" && l.summary.name === "unrelated",
    ),
  );
  // Only branches that name an item are mirrored.
  const branches = await f.service.listBranches(
    { userId: f.outsider },
    { organizationId: f.organizationId, projectId: f.pay },
  );
  assert.deepEqual(
    branches.map((b) => [b.name, b.workItemIds]),
    [["pay-1-backfill", [f.pay1]]],
  );
  assert.equal((await f.prEntity(pr.number))?.state, "open");
  // Not due again until its interval passes.
  const [synced] = await db
    .select()
    .from(s.codeRepository)
    .where(eq(s.codeRepository.id, f.repositoryId));
  assert.ok(synced!.syncDueAt!.getTime() > Date.now() + 5 * 60_000);
  assert.ok(synced!.lastSyncedAt);
  // Importing the issue makes a Lictory work item and keeps it linked.
  const [mirrored] = await db
    .select()
    .from(s.codeIssue)
    .where(
      and(
        eq(s.codeIssue.repositoryId, f.repositoryId),
        eq(s.codeIssue.number, issue.number),
      ),
    );
  await assert.rejects(
    f.service.importIssue(
      { userId: f.engineer },
      {
        organizationId: f.organizationId,
        issueId: mirrored!.id,
        projectId: f.ops,
      },
    ),
    refusal("validation", /does not serve/),
  );
  const imported = await f.service.importIssue(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      issueId: mirrored!.id,
      projectId: f.pay,
    },
  );
  assert.equal(imported.imported, true);
  const [item] = await db
    .select()
    .from(s.workItem)
    .where(eq(s.workItem.id, imported.workItemId));
  assert.equal(item!.title, "Crash on PAY-1 retry");
  const again = await f.service.importIssue(
    { userId: f.engineer },
    {
      organizationId: f.organizationId,
      issueId: mirrored!.id,
      projectId: f.pay,
    },
  );
  assert.deepEqual(again, { workItemId: imported.workItemId, imported: false });
  assert.deepEqual(
    (await f.links(imported.workItemId)).map((l) => [l.target, l.source]),
    [["issue", "import"]],
  );
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});

void test("session workspaces: repository-scoped credentials for people who can work with the code", async () => {
  const f = await fixture();
  const workspace = await resolveSessionWorkspace(
    db,
    {
      organizationId: f.organizationId,
      userId: f.engineer,
      repositoryId: f.repositoryId,
      branch: "pay-1-x",
    },
    { providers: f.providers },
  );
  assert.equal(workspace.cloneUrl, "https://github.example/acme/pay.git");
  assert.equal(workspace.credential.longLived, true);
  await assert.rejects(
    resolveSessionWorkspace(
      db,
      {
        organizationId: f.organizationId,
        userId: f.outsider,
        repositoryId: f.repositoryId,
        branch: "x",
      },
      { providers: f.providers },
    ),
    refusal("forbidden"),
  );
});

void test("disconnecting removes the connection's rows from browsers and reconnecting restores them", async () => {
  const f = await fixture();
  const pr = f.host.openPullRequest(f.repo.externalId, {
    head: "pay-1-x",
    title: "PAY-1",
  });
  await f.deliver("pull_request", {
    repository: f.host.repositoryPayload(f.repo.externalId),
    pull_request: { number: pr.number },
  });
  await f.service.disconnect(
    { userId: f.owner },
    f.organizationId,
    f.connectionId,
  );
  const left = await db
    .select({ type: s.codeEntity.type })
    .from(s.codeEntity)
    .where(eq(s.codeEntity.organizationId, f.organizationId));
  assert.deepEqual(left, []);
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
  const restored = await f.service.connect(
    { userId: f.owner },
    {
      organizationId: f.organizationId,
      provider: "github",
      authKind: "token",
      baseUrl: "https://github.com",
      credential: { token: "github_pat_new" },
    },
  );
  assert.equal(restored.connectionId, f.connectionId);
  assert.equal((await f.links(f.pay1)).length, 2);
  assert.deepEqual(await codeProjectionDrift(db, f.organizationId), []);
});
