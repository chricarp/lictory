import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import type { ProposedChild } from "@lictory/core/contracts/decomposition";
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
    projectId = crypto.randomUUID(),
    workItemId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: userId, name: "Author", email: `${userId}@test.invalid` },
    { id: reviewerId, name: "Reviewer", email: `${reviewerId}@test.invalid` },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Breakdown",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [userId, reviewerId].map((id, index) => ({
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
  await command({
    type: "setDisciplineMember",
    projectId,
    disciplineId: qa.id,
    userId: reviewerId,
    member: true,
  });
  const epic = roster.types.find((type) => type.name === "Epic")!,
    task = roster.types.find((type) => type.name === "Task")!;
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
  return {
    organizationId,
    projectId,
    workItemId,
    userId,
    reviewerId,
    task,
    epic,
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
  const [revision] = await db
    .select()
    .from(s.specificationRevision)
    .where(eq(s.specificationRevision.workItemId, child.workItemId));
  assert.equal(revision!.content, child.description);
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
