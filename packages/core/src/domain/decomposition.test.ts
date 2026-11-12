import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drainNotifications } from "@lictory/core/notifications/drain.test-helper";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import type {
  ChildChange,
  ProposedChild,
} from "@lictory/core/contracts/decomposition";
import {
  directory,
  executeMutation,
  snapshot,
} from "@lictory/core/domain/service";
import { seedOrganization } from "@lictory/core/domain/organization";
import { projectionDrift } from "@lictory/core/domain/projection-reader.test-helper";
import { pullRequestContext } from "@lictory/core/ai/context";
const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_breakdown_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
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
async function fixture() {
  const organizationId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    reviewerId = crypto.randomUUID(),
    productId = crypto.randomUUID(),
    projectId = crypto.randomUUID(),
    workItemId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: userId, name: "Author", email: `${userId}@test.invalid` },
    { id: reviewerId, name: "Reviewer", email: `${reviewerId}@test.invalid` },
    { id: productId, name: "Product", email: `${productId}@test.invalid` },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Breakdown",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [userId, reviewerId, productId].map((id, index) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId: id,
      role: index === 0 ? "owner" : "member",
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  const command = (
    command: Command,
    actor = userId,
    mutationId = crypto.randomUUID(),
  ) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id: mutationId, organizationId, command },
    );
  await command({
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  const roster = await directory(db, userId, organizationId);
  const qa = roster.disciplines.find(
    (discipline) =>
      discipline.projectId === projectId && discipline.name === "QA",
  )!;
  const product = roster.disciplines.find(
    (discipline) =>
      discipline.projectId === projectId && discipline.name === "Product",
  )!;
  await command({
    type: "setDisciplineMember",
    projectId,
    disciplineId: qa.id,
    userId: reviewerId,
    member: true,
  });
  await command({
    type: "setDisciplineMember",
    projectId,
    disciplineId: product.id,
    userId: productId,
    member: true,
  });
  const epic = roster.types.find((type) => type.name === "Epic")!,
    task = roster.types.find((type) => type.name === "Task")!,
    story = roster.types.find((type) => type.name === "Story")!;
  await command({
    type: "createWorkItem",
    projectId,
    workItemId,
    typeId: epic.id,
    parentId: null,
    title: "Safe retries",
    description: "Retries reuse the original transaction ID.",
  });
  const read = () =>
    db.transaction((tx) =>
      snapshot(tx, { organizationId, projectId, workItemId }),
    );
  const branch = async (name: string, fromBranchId?: string) => {
    const branchId = crypto.randomUUID();
    await command({
      type: "createBranch",
      workItemId,
      branchId,
      name,
      fromBranchId,
    });
    return branchId;
  };
  const head = async (branchId: string) =>
    (
      await db
        .select()
        .from(s.specificationBranch)
        .where(eq(s.specificationBranch.id, branchId))
    )[0]!;
  const commit = async (
    branchId: string,
    children: ProposedChild[],
    content = "Retries reuse the original transaction ID.",
  ) => {
    const current = await head(branchId);
    await command({
      type: "commitBranch",
      workItemId,
      branchId,
      baseCommitId: current.headId,
      title: "Safe retries",
      content,
      proposedChildren: children,
      message: "Propose delivery breakdown",
    });
  };
  const pr = async (branchId: string) => {
    const pullRequestId = crypto.randomUUID(),
      main = (await read()).find(
        (entity) => entity.type === "specBranch" && entity.name === "main",
      )!;
    await command({
      type: "createPullRequest",
      workItemId,
      pullRequestId,
      sourceId: branchId,
      targetId: main.id,
      title: "Review breakdown",
      description: "Review child scope",
      draft: false,
    });
    await command({
      type: "requestPullRequestReview",
      workItemId,
      pullRequestId,
      disciplineId: qa.id,
      required: true,
    });
    return pullRequestId;
  };
  const heads = async (pullRequestId: string) => {
    const current = (await read()).find(
      (entity) => entity.type === "pullRequest" && entity.id === pullRequestId,
    )!;
    assert.equal(current.type, "pullRequest");
    return {
      sourceHeadId: (await head(current.sourceId)).headId,
      targetHeadId: (await head(current.targetId)).headId,
    };
  };
  const approve = async (pullRequestId: string) => {
    const review = (await read()).find(
      (entity) =>
        entity.type === "prReview" && entity.pullRequestId === pullRequestId,
    )!;
    await command(
      {
        type: "decidePullRequest",
        workItemId,
        pullRequestId,
        reviewId: review.id,
        decision: "approve",
        ...(await heads(pullRequestId)),
      },
      reviewerId,
    );
  };
  const merge = async (
    pullRequestId: string,
    mutationId = crypto.randomUUID(),
  ) =>
    command(
      {
        type: "mergePullRequest",
        workItemId,
        pullRequestId,
        ...(await heads(pullRequestId)),
      },
      userId,
      mutationId,
    );
  // A review of main's current revision, decided outside any pull request.
  const approveMain = async (disciplineId: string, reviewer: string) => {
    const latest = (await read())
      .filter((entity) => entity.type === "revision")
      .sort((a, b) => b.number - a.number)[0]!;
    const base = { workItemId, baseRevisionId: latest.id },
      reviewId = crypto.randomUUID();
    await command({
      type: "requestReview",
      ...base,
      reviewId,
      disciplineId,
      userId: reviewer,
      required: true,
    });
    await command(
      { type: "decideReview", ...base, reviewId, decision: "approve" },
      reviewer,
    );
  };
  const approvals = async () =>
    (await read()).filter((entity) => entity.type === "approval");
  return {
    organizationId,
    projectId,
    workItemId,
    userId,
    reviewerId,
    productId,
    qa,
    product,
    approveMain,
    approvals,
    task,
    epic,
    story,
    command,
    read,
    branch,
    head,
    commit,
    pr,
    approve,
    merge,
    heads,
  };
}
void test("breakdown-only PRs preserve proposals, stale changed approvals and materialize children atomically once", async () => {
  const f = await fixture(),
    branchId = await f.branch("engineering/breakdown");
  const child: ProposedChild = {
    workItemId: crypto.randomUUID(),
    typeId: f.task.id,
    title: "Reuse transaction identifiers",
    description: "Persist the transaction identifier before the first attempt.",
  };
  await f.commit(branchId, [child]);
  assert.equal(
    (
      await db
        .select()
        .from(s.workItem)
        .where(eq(s.workItem.id, child.workItemId))
    ).length,
    0,
  );
  const pullRequestId = await f.pr(branchId);
  const context = await db.transaction((tx) =>
    pullRequestContext(tx, f.organizationId, {
      pullRequestId,
    } as typeof s.aiRun.$inferSelect),
  );
  assert.equal(context?.context.proposed.children[0]?.title, child.title);
  await f.approve(pullRequestId);
  child.description += " Keep the same identifier on retries.";
  await f.commit(branchId, [child]);
  await assert.rejects(
    f.merge(pullRequestId),
    /approve the current merge result/,
  );
  await f.approve(pullRequestId);
  const mutationId = crypto.randomUUID();
  const mergeCommand: Command = {
    type: "mergePullRequest",
    workItemId: f.workItemId,
    pullRequestId,
    ...(await f.heads(pullRequestId)),
  };
  await f.command(mergeCommand, f.userId, mutationId);
  assert.equal(
    (await f.command(mergeCommand, f.userId, mutationId)).replayed,
    true,
  );
  // Retry the original command, including the inspected heads, replays its receipt.
  const receipt = (
    await db
      .select()
      .from(s.syncMutation)
      .where(eq(s.syncMutation.id, mutationId))
  )[0];
  assert.ok(receipt);
  const children = await db
    .select()
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, f.organizationId),
        eq(s.workItem.parentId, f.workItemId),
      ),
    );
  assert.equal(children.length, 1);
  const parent = (await f.read()).find(
    (entity) => entity.type === "workItem" && entity.id === f.workItemId,
  )!;
  assert.equal(parent.type, "workItem");
  assert.equal(parent.revisionNumber, 2);
  assert.equal(children[0]!.sourceRevisionId, parent.revisionId);
  // Merging made the merger the child's creator, not its owner: a status
  // change by someone else reaches explicit watchers, not the merger.
  await db.insert(s.workItemWatcher).values({
    organizationId: f.organizationId,
    workItemId: children[0]!.id,
    userId: f.reviewerId,
    watching: true,
  });
  const [started] = await db
    .select()
    .from(s.workflowStatus)
    .where(
      and(
        eq(s.workflowStatus.organizationId, f.organizationId),
        eq(s.workflowStatus.projectId, f.projectId),
        eq(s.workflowStatus.category, "started"),
      ),
    );
  await f.command(
    {
      type: "updateWorkItem",
      workItemId: children[0]!.id,
      statusId: started!.id,
    },
    f.productId,
  );
  await drainNotifications(db);
  const statusNotices = await db
    .select()
    .from(s.notification)
    .where(
      and(
        eq(s.notification.organizationId, f.organizationId),
        eq(s.notification.kind, "status_changed"),
      ),
    );
  assert.deepEqual(
    statusNotices.map((n) => n.userId),
    [f.reviewerId],
  );
  const [revision] = await db
    .select()
    .from(s.specificationRevision)
    .where(eq(s.specificationRevision.workItemId, child.workItemId));
  assert.equal(revision!.content, child.description);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});
void test("a multi-child breakdown materializes every child in order with its own projections", async () => {
  const f = await fixture(),
    branchId = await f.branch("engineering/multi-child-breakdown");
  const children: ProposedChild[] = Array.from({ length: 20 }, (_, i) => ({
    workItemId: crypto.randomUUID(),
    typeId: f.task.id,
    title: `Delivery step ${i + 1}`,
    description: `Step ${i + 1} keeps the original transaction ID.`,
  }));
  await f.commit(branchId, children);
  const pullRequestId = await f.pr(branchId);
  await f.approve(pullRequestId);
  await f.merge(pullRequestId);
  const rows = await db
    .select()
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, f.organizationId),
        eq(s.workItem.parentId, f.workItemId),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = children.map((child) => byId.get(child.workItemId)!);
  assert.equal(rows.length, children.length);
  // Numbers continue after the parent (PAY-1) in breakdown order, and ranks
  // keep that order on the backlog.
  assert.deepEqual(
    ordered.map((row) => row.number),
    children.map((_, i) => i + 2),
  );
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i - 1]!.rank < ordered[i]!.rank);
    assert.ok(ordered[i - 1]!.position < ordered[i]!.position);
  }
  const revisions = await db
    .select()
    .from(s.specificationRevision)
    .where(eq(s.specificationRevision.organizationId, f.organizationId));
  for (const child of children) {
    const own = revisions.filter((r) => r.workItemId === child.workItemId);
    assert.equal(own.length, 1);
    assert.equal(own[0]!.content, child.description);
  }
  const created = await db
    .select()
    .from(s.activity)
    .where(
      and(
        eq(s.activity.organizationId, f.organizationId),
        eq(s.activity.action, "created"),
      ),
    );
  assert.equal(
    created.filter((a) => children.some((c) => c.workItemId === a.workItemId))
      .length,
    children.length,
  );
  // Each child's item-scope projections (revision, activity, readiness) were
  // written from the one batched snapshot and match a fresh per-item read.
  const last = children.at(-1)!;
  const detail = await db.transaction((tx) =>
    snapshot(tx, {
      organizationId: f.organizationId,
      projectId: f.projectId,
      workItemId: last.workItemId,
    }),
  );
  assert.ok(
    detail.some(
      (e) => e.type === "readiness" && e.workItemId === last.workItemId,
    ),
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});
void test("a sibling PR carrying an accepted breakdown never duplicates the child", async () => {
  const f = await fixture(),
    first = await f.branch("first");
  const child: ProposedChild = {
    workItemId: crypto.randomUUID(),
    typeId: f.task.id,
    title: "Implement retries",
    description: "Use stable IDs.",
  };
  await f.commit(first, [child]);
  const sibling = await f.branch("sibling", first);
  await f.commit(
    sibling,
    [child],
    "Retries reuse the original transaction ID.\nTimeouts retain that identifier.",
  );
  const firstPR = await f.pr(first),
    siblingPR = await f.pr(sibling);
  await f.approve(firstPR);
  await f.merge(firstPR);
  await f.approve(siblingPR);
  await f.merge(siblingPR);
  const children = await db
    .select()
    .from(s.workItem)
    .where(eq(s.workItem.parentId, f.workItemId));
  assert.equal(children.length, 1);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});
void test("breakdown validation rejects disabled or invalid hierarchy types without shared work", async () => {
  const f = await fixture(),
    branch = await f.branch("invalid");
  const child: ProposedChild = {
    workItemId: crypto.randomUUID(),
    typeId: f.epic.id,
    title: "Invalid nested epic",
    description: "",
  };
  await assert.rejects(f.commit(branch, [child]), /enabled child type/);
  assert.equal(
    (
      await db
        .select()
        .from(s.workItem)
        .where(eq(s.workItem.id, child.workItemId))
    ).length,
    0,
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("accepting a breakdown revalidates enabled types and leaves the parent unchanged on failure", async () => {
  const f = await fixture(),
    branch = await f.branch("configuration-change");
  const child: ProposedChild = {
    workItemId: crypto.randomUUID(),
    typeId: f.task.id,
    title: "Retry task",
    description: "Stable IDs",
  };
  await f.commit(branch, [child]);
  const pr = await f.pr(branch);
  await f.approve(pr);
  await f.command({
    type: "setProjectType",
    projectId: f.projectId,
    typeId: f.task.id,
    enabled: false,
  });
  await assert.rejects(f.merge(pr), /enabled child type/);
  assert.equal(
    (
      await db
        .select()
        .from(s.workItem)
        .where(eq(s.workItem.id, child.workItemId))
    ).length,
    0,
  );
  const parent = (await f.read()).find(
    (entity) => entity.type === "workItem" && entity.id === f.workItemId,
  )!;
  assert.equal(parent.type, "workItem");
  assert.equal(parent.revisionNumber, 1);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});
void test("resolving a branch conflict without choosing children keeps the current head's breakdown", async () => {
  const f = await fixture(),
    branchId = await f.branch("agents/conflict");
  const start = (await f.head(branchId)).headId;
  const child: ProposedChild = {
    workItemId: crypto.randomUUID(),
    typeId: f.task.id,
    title: "Persist transaction identifiers",
    description: "Store the identifier before the first attempt.",
  };
  await f.commit(
    branchId,
    [child],
    "Retries reuse the original transaction ID and amount.",
  );
  const current = (await f.head(branchId)).headId;
  // An agent resolves an overlapping text edit from its stale starting
  // commit and omits proposedChildren.
  await f.command({
    type: "commitBranch",
    workItemId: f.workItemId,
    branchId,
    baseCommitId: start,
    expectedHeadId: current,
    title: "Safe retries",
    content: "Retries reuse the stored transaction ID and amount.",
    message: "Resolve overlapping edit",
  });
  const resolved = (await f.head(branchId)).headId;
  assert.notEqual(resolved, current);
  const [commit] = await db
    .select()
    .from(s.specificationCommit)
    .where(eq(s.specificationCommit.id, resolved));
  assert.equal(
    commit!.content,
    "Retries reuse the stored transaction ID and amount.",
  );
  assert.deepEqual(
    commit!.proposedChildren.map((c) => c.workItemId),
    [child.workItemId],
  );
});

async function existingChild(
  f: Awaited<ReturnType<typeof fixture>>,
  title: string,
  typeId = f.task.id,
  parentId: string | null = f.workItemId,
) {
  const id = crypto.randomUUID();
  await f.command({
    type: "createWorkItem",
    projectId: f.projectId,
    workItemId: id,
    typeId,
    parentId,
    title,
    description: `${title} description`,
  });
  return id;
}
const itemRow = async (id: string) =>
  (await db.select().from(s.workItem).where(eq(s.workItem.id, id)))[0]!;
async function changeOf(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  change: Partial<ChildChange>,
): Promise<ChildChange> {
  const entity = (await f.read()).find(
    (e) => e.type === "workItem" && e.id === id,
  )!;
  assert.equal(entity.type, "workItem");
  return {
    changeId: crypto.randomUUID(),
    workItemId: id,
    base: { revisionId: entity.revisionId, title: entity.title },
    ...change,
  };
}

void test("a reviewed breakdown renames, moves and archives existing children only on merge, once", async () => {
  const f = await fixture();
  const otherEpic = await existingChild(f, "Observability", f.epic.id, null);
  const [renamed, moved, archived] = [
    await existingChild(f, "Retry task"),
    await existingChild(f, "Timeout task"),
    await existingChild(f, "Obsolete task"),
  ];
  const branchId = await f.branch("agents/reorganize");
  const fresh: ProposedChild = {
    workItemId: crypto.randomUUID(),
    typeId: f.task.id,
    title: "Persist identifiers",
    description: "",
  };
  const changes = [
    await changeOf(f, renamed, {
      title: "Reuse transaction identifiers",
      description: "Persist before the first attempt.",
    }),
    await changeOf(f, moved, { parentId: otherEpic }),
    await changeOf(f, archived, { archive: true }),
  ];
  await f.commit(branchId, [fresh, ...changes]);
  // Proposing changes nothing shared.
  assert.equal((await itemRow(renamed)).title, "Retry task");
  assert.equal((await itemRow(moved)).parentId, f.workItemId);
  assert.equal((await itemRow(archived)).archivedAt, null);
  const pullRequestId = await f.pr(branchId);
  await f.approve(pullRequestId);
  // A breakdown-only change stales approval like any other result change.
  await f.commit(branchId, [fresh, ...changes.slice(0, 2)]);
  await assert.rejects(
    f.merge(pullRequestId),
    /approve the current merge result/,
  );
  await f.commit(branchId, [fresh, ...changes]);
  // A sibling branch carrying the same changes must not apply them twice.
  const later = await f.branch("later", branchId);
  await f.commit(
    later,
    [fresh, ...changes],
    "Retries reuse the original transaction ID.\nTimeouts keep it.",
  );
  const laterPR = await f.pr(later);
  await f.approve(pullRequestId);
  await f.merge(pullRequestId);

  const renamedRow = await itemRow(renamed);
  assert.equal(renamedRow.title, "Reuse transaction identifiers");
  const revisions = await db
    .select()
    .from(s.specificationRevision)
    .where(eq(s.specificationRevision.workItemId, renamed));
  assert.deepEqual(revisions.map((r) => r.number).sort(), [1, 2]);
  assert.equal(
    revisions.find((r) => r.number === 2)!.content,
    "Persist before the first attempt.",
  );
  assert.equal((await itemRow(moved)).parentId, otherEpic);
  assert.ok((await itemRow(archived)).archivedAt);
  assert.ok(await itemRow(fresh.workItemId));
  const [activity] = await db
    .select()
    .from(s.activity)
    .where(
      and(
        eq(s.activity.workItemId, moved),
        eq(s.activity.action, "breakdown_change_accepted"),
      ),
    );
  assert.equal(
    (activity!.detail as { pullRequestId: string }).pullRequestId,
    pullRequestId,
  );

  await f.approve(laterPR);
  await f.merge(laterPR);
  assert.equal(
    (
      await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, renamed))
    ).length,
    2,
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("merge refuses a change to a child edited since it was proposed and applies nothing", async () => {
  const f = await fixture();
  const renamed = await existingChild(f, "Retry task"),
    archived = await existingChild(f, "Obsolete task");
  const branchId = await f.branch("stale");
  await f.commit(branchId, [
    await changeOf(f, archived, { archive: true }),
    await changeOf(f, renamed, { title: "Reviewed title" }),
  ]);
  const pr = await f.pr(branchId);
  await f.approve(pr);
  const current = (await f.read()).find(
    (e) => e.type === "workItem" && e.id === renamed,
  )!;
  assert.equal(current.type, "workItem");
  await f.command({
    type: "updateSpecification",
    workItemId: renamed,
    baseRevisionId: current.revisionId,
    title: "Someone else's title",
    content: "Edited directly",
    summary: "Direct edit",
  });
  await assert.rejects(f.merge(pr), /PAY-\d+ changed since this change/);
  assert.equal((await itemRow(renamed)).title, "Someone else's title");
  assert.equal((await itemRow(archived)).archivedAt, null);
  const parent = (await f.read()).find(
    (e) => e.type === "workItem" && e.id === f.workItemId,
  )!;
  assert.equal(parent.type, "workItem");
  assert.equal(parent.revisionNumber, 1);
  // Unrelated commits on the branch are not blocked by the stale change.
  const [branchHead] = await db
    .select()
    .from(s.specificationCommit)
    .where(eq(s.specificationCommit.id, (await f.head(branchId)).headId));
  await f.commit(
    branchId,
    branchHead!.proposedChildren,
    "Retries reuse the original transaction ID.\nMore detail.",
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("breakdown changes cannot rewrite spec-backed text or work already underway", async () => {
  const f = await fixture();
  const story = await existingChild(f, "Retry story", f.story.id);
  const branchId = await f.branch("guarded");
  await assert.rejects(
    f.commit(branchId, [await changeOf(f, story, { title: "Renamed" })]),
    /own specification/,
  );
  const task = await existingChild(f, "Started task");
  const roster = await directory(db, f.userId, f.organizationId);
  const started = roster.statuses.find(
    (x) => x.projectId === f.projectId && x.category === "started",
  )!;
  await f.command({
    type: "updateWorkItem",
    workItemId: task,
    statusId: started.id,
  });
  await assert.rejects(
    f.commit(branchId, [await changeOf(f, task, { parentId: null })]),
    /accepted, underway or handed off/,
  );
  await assert.rejects(
    f.commit(branchId, [
      await changeOf(f, story, { parentId: null }),
      await changeOf(f, story, { archive: true }),
    ]),
    /one pending change per existing child/,
  );
  assert.equal((await itemRow(task)).parentId, f.workItemId);
  assert.equal((await itemRow(story)).parentId, f.workItemId);
});

const currentRevision = async (f: Awaited<ReturnType<typeof fixture>>) =>
  (await f.read())
    .filter((entity) => entity.type === "revision")
    .sort((a, b) => b.number - a.number)[0]!;
const reviewsApproved = async (f: Awaited<ReturnType<typeof fixture>>) => {
  const readiness = (await f.read()).find(
    (entity) =>
      entity.type === "readiness" && entity.workItemId === f.workItemId,
  );
  assert.equal(readiness?.type, "readiness");
  return readiness.checks.find((check) => check.key === "reviews_approved");
};

void test("a breakdown-only merge carries approvals of the unchanged specification text", async () => {
  const f = await fixture();
  const branchId = await f.branch("engineering/breakdown");
  await f.commit(branchId, [
    {
      workItemId: crypto.randomUUID(),
      typeId: f.task.id,
      title: "Reuse transaction identifiers",
      description: "Persist the identifier before the first attempt.",
    },
  ]);
  const pullRequestId = await f.pr(branchId);
  // Product approves main while Engineering's breakdown is in review; only
  // QA is asked to review the breakdown itself.
  await f.approveMain(f.product.id, f.productId);
  const approved = await currentRevision(f);
  await f.approve(pullRequestId);
  await f.merge(pullRequestId);

  const current = await currentRevision(f);
  assert.equal(current.number, approved.number + 1);
  const approvals = await f.approvals();
  const granted = approvals.filter((a) => a.status === "granted");
  // Product never reviewed the breakdown but approved this exact text.
  assert.deepEqual(
    granted.map((a) => [a.reviewerId, a.revisionId]).sort(),
    [
      [f.productId, current.id],
      [f.reviewerId, current.id],
    ].sort(),
  );
  // The approval of the earlier revision is history, not an invalidation.
  const earlier = approvals.find((a) => a.revisionId === approved.id)!;
  assert.equal(earlier.status, "stale");
  assert.equal(
    earlier.endReason,
    `Carried to revision ${current.number}: specification text unchanged`,
  );
  const reviews = (await f.read()).filter(
    (entity) =>
      entity.type === "review" &&
      entity.revisionId === current.id &&
      entity.status !== "cancelled",
  );
  assert.deepEqual(
    reviews
      .map((r) => (r.type === "review" ? [r.responsibility, r.status] : []))
      .sort(),
    [
      ["Product", "completed"],
      ["QA", "completed"],
    ],
  );
  assert.equal((await reviewsApproved(f))?.passed, true);
  // Nobody is told an approval of unchanged text was invalidated.
  await drainNotifications(db);
  const notified = await db
    .select()
    .from(s.notification)
    .where(
      and(
        eq(s.notification.organizationId, f.organizationId),
        eq(s.notification.kind, "approval_invalidated"),
      ),
    );
  assert.equal(notified.length, 0);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("a merge that changes the text still stales every earlier approval", async () => {
  const f = await fixture();
  const branchId = await f.branch("engineering/timeouts");
  await f.commit(
    branchId,
    [],
    "Retries reuse the original transaction ID. Timeouts cancel the attempt.",
  );
  const pullRequestId = await f.pr(branchId);
  await f.approveMain(f.product.id, f.productId);
  const approved = await currentRevision(f);
  await f.approve(pullRequestId);
  await f.merge(pullRequestId);

  const current = await currentRevision(f);
  const approvals = await f.approvals();
  const product = approvals.filter((a) => a.reviewerId === f.productId);
  assert.equal(product.length, 1);
  assert.equal(product[0]!.revisionId, approved.id);
  assert.equal(product[0]!.status, "stale");
  assert.equal(
    product[0]!.endReason,
    `Specification revised (revision ${current.number})`,
  );
  assert.equal((await reviewsApproved(f))?.passed, false);
});

void test("pull request approval supersedes a carried approval for the same responsibility", async () => {
  const f = await fixture();
  const branchId = await f.branch("engineering/breakdown");
  await f.commit(branchId, [
    {
      workItemId: crypto.randomUUID(),
      typeId: f.task.id,
      title: "Reuse transaction identifiers",
      description: "Persist the identifier before the first attempt.",
    },
  ]);
  const pullRequestId = await f.pr(branchId);
  await f.approveMain(f.qa.id, f.reviewerId);
  await f.approve(pullRequestId);
  await f.merge(pullRequestId);

  const current = await currentRevision(f);
  const onCurrent = (await f.approvals()).filter(
    (a) => a.revisionId === current.id,
  );
  assert.equal(onCurrent.filter((a) => a.status === "granted").length, 1);
  assert.deepEqual(
    onCurrent.filter((a) => a.status !== "granted").map((a) => a.endReason),
    ["Superseded by the merged pull request's approval"],
  );
  assert.equal((await reviewsApproved(f))?.passed, true);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});
