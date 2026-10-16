import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "../db/schema";
import { createSyncService, directory } from "../sync/server/service";
import { seedOrganization } from "../sync/server/organization";
import { PROTOCOL, type Command } from "../sync/shared/protocol";
import { dispatchNotificationEmails } from "./email";
import { mentionToken } from "./mentions";
import { createNotificationService } from "./service";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_notify_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const sync = createSyncService(db);
const notifications = createNotificationService(db);
let created = false;
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

// Owner (project administrator, Product), a reviewer (Engineering, QA) and a
// bystander organization member with no involvement in the project.
async function fixture() {
  const organizationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  const bystanderId = crypto.randomUUID();
  await db.insert(s.user).values(
    [
      [ownerId, "Olivia Owner"],
      [reviewerId, "Rhea Reviewer"],
      [bystanderId, "Ben Bystander"],
    ].map(([id, name]) => ({
      id: id!,
      name: name!,
      email: `${id}@example.test`,
    })),
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Acme",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [ownerId, reviewerId, bystanderId].map((userId, i) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: i === 0 ? "owner" : "member",
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  const command = (command: Command, actor = ownerId) =>
    sync.mutate(actor, {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command,
    });
  const projectId = crypto.randomUUID();
  await command({
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  const teamId = crypto.randomUUID();
  await command({ type: "createTeam", projectId, teamId, name: "Checkout" });
  const dir = await directory(db, ownerId, organizationId);
  const roles = Object.fromEntries(
    dir.disciplines
      .filter((d) => d.projectId === projectId)
      .map((d) => [d.name, d.id]),
  ) as Record<"Product" | "Engineering" | "QA", string>;
  for (const disciplineId of [roles.Engineering, roles.QA])
    await command({
      type: "setDisciplineMember",
      projectId,
      disciplineId,
      userId: reviewerId,
      member: true,
    });
  const storyType = dir.types.find((t) => t.name === "Story")!.id;
  const statuses = dir.statuses.filter((x) => x.projectId === projectId);
  const itemId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId,
    workItemId: itemId,
    typeId: storyType,
    teamId,
    parentId: null,
    title: "Safe retries",
    description: "Avoid duplicate payments after timeout.",
  });
  const latest = async () =>
    (
      await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, itemId))
    ).sort((a, b) => b.number - a.number)[0]!;
  const inbox = async (userId: string) =>
    (await notifications.list(userId, { organizationId })).items;
  const kinds = async (userId: string) =>
    (await inbox(userId)).map((n) => n.kind).sort();
  return {
    organizationId,
    ownerId,
    reviewerId,
    bystanderId,
    roles,
    projectId,
    teamId,
    statuses,
    itemId,
    command,
    latest,
    inbox,
    kinds,
  };
}

void test("review workflow notifies the people it asks something of, never the actor", async () => {
  const f = await fixture();
  const first = await f.latest();
  const reviewId = crypto.randomUUID();
  await f.command({
    type: "requestReview",
    workItemId: f.itemId,
    baseRevisionId: first.id,
    reviewId,
    disciplineId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  const [request] = await f.inbox(f.reviewerId);
  assert.equal(request?.kind, "review_requested");
  assert.equal(request?.detail.itemKey, "PAY-1");
  assert.equal(request?.actorName, "Olivia Owner");
  assert.deepEqual(await f.kinds(f.ownerId), [], "actor is not notified");
  assert.deepEqual(
    await f.kinds(f.bystanderId),
    [],
    "uninvolved member is not notified",
  );
  // Review requests email by default.
  const queued = await db
    .select()
    .from(s.notificationEmail)
    .where(eq(s.notificationEmail.notificationId, request.id));
  assert.equal(queued[0]?.status, "pending");
  // A second required review keeps the item short of ready, so main stays
  // directly editable for the revision below.
  await f.command({
    type: "requestReview",
    workItemId: f.itemId,
    baseRevisionId: first.id,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.QA,
    userId: null,
    required: true,
  });

  await f.command(
    {
      type: "decideReview",
      workItemId: f.itemId,
      baseRevisionId: first.id,
      reviewId,
      decision: "approve",
    },
    f.reviewerId,
  );
  assert.ok((await f.kinds(f.ownerId)).includes("review_decided"));

  // A material revision stales the approval: the reviewer hears exactly that,
  // not an additional "revised" notice for the same change.
  await f.command({
    type: "updateSpecification",
    workItemId: f.itemId,
    baseRevisionId: first.id,
    title: "Safe retries",
    content: "# Safe retries\n\nRetries reuse the original transaction ID.",
  });
  const reviewerKinds = await f.kinds(f.reviewerId);
  assert.equal(
    reviewerKinds.filter((k) => k === "approval_invalidated").length,
    1,
  );
  assert.ok(!reviewerKinds.includes("specification_revised"));
});

void test("mentions reach members only once, and replies reach thread participants", async () => {
  const f = await fixture();
  const revision = await f.latest();
  const threadId = crypto.randomUUID();
  await f.command(
    {
      type: "createThread",
      workItemId: f.itemId,
      baseRevisionId: revision.id,
      threadId,
      messageId: crypto.randomUUID(),
      body: "What happens after a timeout?",
      section: "",
      blocking: true,
    },
    f.reviewerId,
  );
  assert.deepEqual(await f.kinds(f.ownerId), ["blocking_thread"]);
  const outsider = crypto.randomUUID();
  await db.insert(s.user).values({
    id: outsider,
    name: "Outsider",
    email: `${outsider}@example.test`,
  });
  await f.command({
    type: "replyToThread",
    workItemId: f.itemId,
    threadId,
    messageId: crypto.randomUUID(),
    body: `${mentionToken({ id: f.bystanderId, name: "Ben" })} and ${mentionToken({ id: f.reviewerId, name: "Rhea" })} and ${mentionToken({ id: outsider, name: "X" })}: we retry.`,
  });
  const [mention] = await f.inbox(f.bystanderId);
  assert.equal(mention?.kind, "mentioned");
  assert.match(String(mention?.detail.excerpt), /^@Ben and @Rhea/);
  // The reviewer participates and is mentioned: one notification, the mention.
  const reviewer = await f.kinds(f.reviewerId);
  assert.deepEqual(reviewer, ["mentioned"]);
  assert.equal(
    (await f.inbox(outsider)).length,
    0,
    "non-members never receive",
  );
});

void test("preferences resolve team over project over organization, and email follows in-app", async () => {
  const f = await fixture();
  const assign = (assigneeId: string | null) =>
    f.command({ type: "updateWorkItem", workItemId: f.itemId, assigneeId });
  await notifications.act(f.reviewerId, {
    action: "setPreferences",
    organizationId: f.organizationId,
    scope: "organization",
    scopeId: f.organizationId,
    rules: [{ kind: "assigned", inApp: false, email: false }],
  });
  await assign(f.reviewerId);
  assert.deepEqual(await f.kinds(f.reviewerId), []);
  await notifications.act(f.reviewerId, {
    action: "setPreferences",
    organizationId: f.organizationId,
    scope: "project",
    scopeId: f.projectId,
    rules: [{ kind: "assigned", inApp: true, email: true }],
  });
  await notifications.act(f.reviewerId, {
    action: "setPreferences",
    organizationId: f.organizationId,
    scope: "team",
    scopeId: f.teamId,
    rules: [{ kind: "assigned", inApp: true, email: false }],
  });
  await assign(null);
  await assign(f.reviewerId);
  const [n] = await f.inbox(f.reviewerId);
  assert.equal(n?.kind, "assigned");
  const emails = await db
    .select()
    .from(s.notificationEmail)
    .where(eq(s.notificationEmail.userId, f.reviewerId));
  assert.equal(emails.length, 0, "team rule disabled email");
  // Scope IDs from another organization are rejected.
  const other = await fixture();
  await assert.rejects(
    notifications.act(f.reviewerId, {
      action: "setPreferences",
      organizationId: f.organizationId,
      scope: "project",
      scopeId: other.projectId,
      rules: [{ kind: "assigned", inApp: false, email: false }],
    }),
    /unavailable/,
  );
});

void test("unwatching silences ambient updates but not direct requests", async () => {
  const f = await fixture();
  await f.command({
    type: "updateWorkItem",
    workItemId: f.itemId,
    assigneeId: f.reviewerId,
  });
  await notifications.act(f.reviewerId, {
    action: "watch",
    organizationId: f.organizationId,
    workItemId: f.itemId,
    watching: false,
  });
  const done = f.statuses.find((x) => x.category === "started")!.id;
  await f.command({
    type: "updateWorkItem",
    workItemId: f.itemId,
    statusId: done,
  });
  assert.deepEqual(await f.kinds(f.reviewerId), ["assigned"]);
  // A bystander who watches hears about status changes.
  await notifications.act(f.bystanderId, {
    action: "watch",
    organizationId: f.organizationId,
    workItemId: f.itemId,
    watching: true,
  });
  const todo = f.statuses.find((x) => x.category === "unstarted")!.id;
  await f.command({
    type: "updateWorkItem",
    workItemId: f.itemId,
    statusId: todo,
  });
  assert.deepEqual(await f.kinds(f.bystanderId), ["status_changed"]);
});

void test("inbox is scoped to the user and to current membership", async () => {
  const f = await fixture();
  await f.command({
    type: "updateWorkItem",
    workItemId: f.itemId,
    assigneeId: f.reviewerId,
  });
  const [n] = await f.inbox(f.reviewerId);
  // Another user cannot mark it read.
  await notifications.act(f.bystanderId, { action: "markRead", ids: [n!.id] });
  assert.equal((await f.inbox(f.reviewerId))[0]?.readAt, null);
  assert.equal((await notifications.unread(f.reviewerId))[f.organizationId], 1);
  await notifications.act(f.reviewerId, { action: "markRead", ids: [n!.id] });
  assert.equal(
    (await notifications.unread(f.reviewerId))[f.organizationId],
    undefined,
  );
  await db
    .delete(s.member)
    .where(
      and(
        eq(s.member.organizationId, f.organizationId),
        eq(s.member.userId, f.reviewerId),
      ),
    );
  assert.equal((await f.inbox(f.reviewerId)).length, 0);
});

void test("email outbox sends once, retries failures, and skips former members", async () => {
  const f = await fixture();
  await db.delete(s.notificationEmail);
  await f.command({
    type: "updateWorkItem",
    workItemId: f.itemId,
    assigneeId: f.reviewerId,
  });
  const sent: { to: string; subject: string; key: string }[] = [];
  let fail = true;
  const send = async (e: {
    to: string;
    subject: string;
    idempotencyKey: string;
  }) => {
    if (fail) throw new Error("SMTP unavailable");
    sent.push({ to: e.to, subject: e.subject, key: e.idempotencyKey });
  };
  let clock = new Date();
  const now = () => clock;
  assert.deepEqual(await dispatchNotificationEmails(db, { send, now }), {
    sent: 0,
    skipped: 0,
    failed: 0,
    retrying: 1,
  });
  // Not due yet: backoff holds it.
  assert.equal(
    (await dispatchNotificationEmails(db, { send, now })).retrying,
    0,
  );
  fail = false;
  clock = new Date(clock.getTime() + 5 * 60_000);
  assert.equal((await dispatchNotificationEmails(db, { send, now })).sent, 1);
  assert.equal((await dispatchNotificationEmails(db, { send, now })).sent, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, `${f.reviewerId}@example.test`);
  assert.match(sent[0]!.subject, /assigned PAY-1 to you: Safe retries/);

  await f.command({
    type: "updateWorkItem",
    workItemId: f.itemId,
    assigneeId: f.bystanderId,
  });
  await db
    .delete(s.member)
    .where(
      and(
        eq(s.member.organizationId, f.organizationId),
        eq(s.member.userId, f.bystanderId),
      ),
    );
  assert.equal(
    (await dispatchNotificationEmails(db, { send, now })).skipped,
    1,
  );
});

void test("iteration start and completion notify project members once", async () => {
  const f = await fixture();
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    iterationMode: "manual",
  });
  const iterationId = crypto.randomUUID();
  await f.command({
    type: "createIteration",
    projectId: f.projectId,
    iterationId,
    name: "Sprint 1",
    goal: null,
    startsAt: "2026-01-05",
    endsAt: "2026-01-19",
  });
  await f.command({
    type: "startIteration",
    projectId: f.projectId,
    iterationId,
  });
  await f.command({
    type: "completeIteration",
    projectId: f.projectId,
    iterationId,
    carryOverTo: null,
  });
  const reviewer = await f.inbox(f.reviewerId);
  assert.deepEqual(reviewer.map((n) => n.kind).sort(), [
    "iteration_completed",
    "iteration_started",
  ]);
  assert.equal(reviewer[0]!.detail.projectName, "Payments");
  assert.deepEqual(await f.kinds(f.ownerId), [], "the actor is not notified");
  assert.deepEqual(await f.kinds(f.bystanderId), [], "non-members are not");
});
