import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Entity } from "@lictory/core/contracts/protocol";
import {
  CapabilityError,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { seedOrganization } from "@lictory/core/domain/organization";
import {
  projectedEntities,
  projectionDrift,
} from "@lictory/core/domain/projection-reader.test-helper";
import { directory, executeMutation } from "@lictory/core/domain/service";
import type { SampleProject } from "@lictory/core/domain/sample-project";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_sample_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
const as = (userId: string): CapabilityContext => ({
  db,
  principal: { userId, surface: "web" },
  effects: {
    track: (event, properties) => tracked.push({ event, properties }),
    trackFailure: () => undefined,
  },
});

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

// An organization after onboarding: its owner, a member and a first project
// with the delivery mode chosen in setup.
async function workspace(deliveryMode: "native" | "external" = "native") {
  const ownerId = await user("Owner");
  const memberId = await user("Member");
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [ownerId, memberId].map((userId, index) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: index === 0 ? "owner" : "member",
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  const projectId = crypto.randomUUID();
  await executeMutation(
    db,
    { userId: ownerId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createProject",
        projectId,
        name: "Payments",
        key: "PAY",
        setup: {
          deliveryMode,
          readinessPolicy: "block",
          estimateScale: deliveryMode === "native" ? "fibonacci" : "none",
          iterationMode: deliveryMode === "native" ? "manual" : "off",
          iterationWeeks: 2,
          iterationStartDay: 1,
          invitations: 0,
          aiEnabled: false,
        },
      },
    },
  );
  return { ownerId, memberId, organizationId, projectId };
}

const createSample = (
  userId: string,
  organizationId: string,
  fromProjectId?: string,
) =>
  invoke(as(userId), "createSampleProject", {
    organizationId,
    ...(fromProjectId ? { fromProjectId } : {}),
  }) as Promise<SampleProject>;

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => assert.fail("expected a refusal"),
    (e: unknown) => e,
  );
  assert.ok(error instanceof CapabilityError, String(error));
  return error;
}

async function itemEntities(organizationId: string, sample: SampleProject) {
  return (
    await projectedEntities(db, {
      organizationId,
      projectId: sample.projectId,
      workItemId: sample.workItemId,
    })
  ).entities;
}
const ofType = <T extends Entity["type"]>(entities: Entity[], type: T) =>
  entities.filter((e): e is Extract<Entity, { type: T }> => e.type === type);
const check = (entities: Entity[], key: string) =>
  ofType(entities, "readiness")[0]!.checks.find((c) => c.key === key);

void test("the sample is a labelled project of ordinary, projected domain history authored by the person, with nothing approved", async () => {
  const w = await workspace();
  const sample = await createSample(w.ownerId, w.organizationId, w.projectId);
  assert.equal(sample.projectKey, "SAMPLE");
  assert.equal(sample.workItemKey, "SAMPLE-1");

  const roster = await directory(db, w.ownerId, w.organizationId);
  const project = roster.projects.find((p) => p.id === sample.projectId)!;
  assert.equal(project.sample, true);
  assert.equal(project.name, "Sample project");
  assert.equal(project.readinessPolicy, "block", "follows the source project");
  assert.equal(
    roster.projects.find((p) => p.id === w.projectId)!.sample,
    false,
  );
  // Nobody was invented: the project's only member is the person.
  assert.deepEqual(
    roster.projectMembers
      .filter((m) => m.projectId === sample.projectId)
      .map((m) => m.userId),
    [w.ownerId],
  );

  const entities = await itemEntities(w.organizationId, sample);
  const revisions = ofType(entities, "revision").sort(
    (a, b) => a.number - b.number,
  );
  assert.deepEqual(
    revisions.map((r) => r.number),
    [1, 2, 3],
  );
  const item = (
    await projectedEntities(db, { organizationId: w.organizationId })
  ).entities.find((e) => e.type === "workItem" && e.id === sample.workItemId);
  assert.ok(item?.type === "workItem");
  assert.equal(item.refinementState, "in_review");
  assert.equal(item.mainProtected, false);

  // An open blocking discussion anchored to a quote of the current revision.
  const [thread] = ofType(entities, "thread");
  assert.ok(thread);
  assert.equal(thread.status, "open");
  assert.equal(thread.blocking, true);
  assert.equal(thread.revisionId, revisions[2]!.id);
  assert.match(
    JSON.stringify(thread.anchor),
    /reuses the original payment request/,
  );
  assert.equal(ofType(entities, "decision").length, 1);
  assert.equal(ofType(entities, "review")[0]?.status, "requested");

  // A pull request awaiting review, by the person, with the review copied.
  const [pull] = ofType(entities, "pullRequest");
  assert.equal(pull?.status, "open");
  assert.equal(pull?.authorId, w.ownerId);
  assert.ok(ofType(entities, "prReview").every((r) => r.decision === null));

  // Readiness shows what is missing; nothing is approved anywhere.
  assert.equal(check(entities, "no_blocking_threads")?.passed, false);
  assert.equal(check(entities, "reviews_requested")?.passed, true);
  assert.equal(check(entities, "reviews_approved")?.passed, false);
  assert.equal(
    (
      await db
        .select()
        .from(s.approval)
        .where(eq(s.approval.organizationId, w.organizationId))
    ).length,
    0,
  );

  // Every write went through the command boundary as the person: receipts,
  // activity and no AI runs (Lictory Intelligence is off).
  const receipts = await db
    .select()
    .from(s.syncMutation)
    .where(eq(s.syncMutation.organizationId, w.organizationId));
  assert.ok(receipts.length >= 12);
  assert.ok(receipts.every((r) => r.userId === w.ownerId));
  assert.ok(ofType(entities, "activity").every((a) => a.actorId === w.ownerId));
  assert.equal(
    (
      await db
        .select()
        .from(s.aiRun)
        .where(eq(s.aiRun.organizationId, w.organizationId))
    ).length,
    0,
  );

  // A Space page of the sample references the item.
  const [space] = await db
    .select()
    .from(s.space)
    .where(eq(s.space.id, sample.spaceId));
  assert.equal(space?.projectId, sample.projectId);
  const references = await db
    .select()
    .from(s.pageReference)
    .where(
      and(
        eq(s.pageReference.organizationId, w.organizationId),
        eq(s.pageReference.pageId, sample.pageId),
      ),
    );
  assert.ok(references.some((r) => r.targetId === sample.workItemId));

  assert.deepEqual(await projectionDrift(db, w.organizationId), []);
  assert.ok(
    tracked.some(
      (t) =>
        t.event === "sample_project_created" &&
        t.properties?.project_id === sample.projectId,
    ),
  );
  assert.ok(!tracked.some((t) => t.event === "work_item_created"));
});

void test("resolving the sample's blocking discussion updates readiness, and the person's own approval makes it ready", async () => {
  const w = await workspace();
  const sample = await createSample(w.ownerId, w.organizationId);
  const before = await itemEntities(w.organizationId, sample);
  const [thread] = ofType(before, "thread");
  await executeMutation(
    db,
    { userId: w.ownerId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: w.organizationId,
      command: {
        type: "setThreadState",
        workItemId: sample.workItemId,
        threadId: thread!.id,
        resolved: true,
        blocking: true,
      },
    },
  );
  const resolved = await itemEntities(w.organizationId, sample);
  assert.equal(check(resolved, "no_blocking_threads")?.passed, true);
  assert.equal(check(resolved, "reviews_approved")?.passed, false);
  // The discussion and its message are kept.
  assert.equal(ofType(resolved, "thread")[0]?.status, "resolved");
  assert.equal(ofType(resolved, "message").length, 1);

  const revision = ofType(resolved, "revision").sort(
    (a, b) => b.number - a.number,
  )[0]!;
  await executeMutation(
    db,
    { userId: w.ownerId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: w.organizationId,
      command: {
        type: "decideReview",
        workItemId: sample.workItemId,
        baseRevisionId: revision.id,
        reviewId: ofType(resolved, "review")[0]!.id,
        decision: "approve",
      },
    },
  );
  const item = (
    await projectedEntities(db, { organizationId: w.organizationId })
  ).entities.find((e) => e.type === "workItem" && e.id === sample.workItemId);
  assert.ok(item?.type === "workItem");
  assert.equal(item.refinementState, "ready");
  assert.deepEqual(await projectionDrift(db, w.organizationId), []);
});

void test("a second sample is refused, an archived sample is restored rather than recreated, and archiving keeps history", async () => {
  const w = await workspace();
  const sample = await createSample(w.ownerId, w.organizationId, w.projectId);
  const receiptsBefore = await db
    .select()
    .from(s.syncMutation)
    .where(eq(s.syncMutation.organizationId, w.organizationId));

  const again = await refusal(createSample(w.ownerId, w.organizationId));
  assert.equal(again.category, "conflict");
  assert.match(again.message, /already has the sample project SAMPLE/);
  // The refused run rolled back completely.
  assert.equal(
    (
      await db
        .select()
        .from(s.syncMutation)
        .where(eq(s.syncMutation.organizationId, w.organizationId))
    ).length,
    receiptsBefore.length,
  );
  assert.equal(
    (await directory(db, w.ownerId, w.organizationId)).projects.length,
    2,
  );

  // The same rule holds for the plain command.
  const direct = await executeMutation(
    db,
    { userId: w.ownerId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: w.organizationId,
      command: {
        type: "createProject",
        projectId: crypto.randomUUID(),
        name: "Another sample",
        key: "OTHER",
        sample: true,
      },
    },
  ).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(direct instanceof Error);
  assert.match(direct.message, /already has the sample project/);

  const archived = (await invoke(as(w.ownerId), "archiveSampleProject", {
    organizationId: w.organizationId,
  })) as { projectId: string; archivedSpaces: number };
  assert.equal(archived.projectId, sample.projectId);
  assert.equal(archived.archivedSpaces, 1);
  const roster = await directory(db, w.ownerId, w.organizationId);
  assert.ok(roster.projects.find((p) => p.id === sample.projectId)?.archivedAt);
  const [space] = await db
    .select()
    .from(s.space)
    .where(eq(s.space.id, sample.spaceId));
  assert.ok(space?.archivedAt);
  // History is intact: revisions, the discussion and the decision remain.
  assert.equal(
    (
      await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, sample.workItemId))
    ).length,
    3,
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.thread)
        .where(eq(s.thread.workItemId, sample.workItemId))
    ).length,
    1,
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.decision)
        .where(eq(s.decision.workItemId, sample.workItemId))
    ).length,
    1,
  );

  const afterArchive = await refusal(createSample(w.ownerId, w.organizationId));
  assert.match(afterArchive.message, /was archived\. Restore it/);
  assert.equal(
    (
      await refusal(
        invoke(as(w.ownerId), "archiveSampleProject", {
          organizationId: w.organizationId,
        }),
      )
    ).category,
    "not_found",
  );
  // Restoring is the ordinary command.
  await invoke(as(w.ownerId), "archiveProject", {
    organizationId: w.organizationId,
    projectId: sample.projectId,
    archived: false,
  });
  assert.equal(
    (await directory(db, w.ownerId, w.organizationId)).projects.find(
      (p) => p.id === sample.projectId,
    )?.archivedAt,
    null,
  );
  assert.deepEqual(await projectionDrift(db, w.organizationId), []);
});

void test("the sample is scoped to the person's organization and needs an administrator", async () => {
  const a = await workspace();
  const b = await workspace();
  // A member who does not administer the organization is refused.
  const member = await refusal(createSample(a.memberId, a.organizationId));
  assert.equal(member.category, "forbidden");
  // An administrator of another organization cannot create one here, nor
  // borrow a foreign project's settings.
  await refusal(createSample(b.ownerId, a.organizationId));
  const sample = await createSample(b.ownerId, b.organizationId, a.projectId);
  assert.equal(sample.deliveryMode, "native");
  assert.equal(
    (await directory(db, a.ownerId, a.organizationId)).projects.some(
      (p) => p.sample,
    ),
    false,
  );
  // Each organization has its own sample; archiving one leaves the other.
  await createSample(a.ownerId, a.organizationId);
  await refusal(
    invoke(as(b.ownerId), "archiveSampleProject", {
      organizationId: a.organizationId,
    }),
  );
  assert.equal(
    (await directory(db, a.ownerId, a.organizationId)).projects.find(
      (p) => p.sample,
    )?.archivedAt,
    null,
  );
  assert.deepEqual(await projectionDrift(db, a.organizationId), []);
  assert.deepEqual(await projectionDrift(db, b.organizationId), []);
});

void test("an externally delivered project gets an externally delivered sample", async () => {
  const w = await workspace("external");
  const sample = await createSample(w.ownerId, w.organizationId, w.projectId);
  assert.equal(sample.deliveryMode, "external");
  const project = (
    await directory(db, w.ownerId, w.organizationId)
  ).projects.find((p) => p.id === sample.projectId)!;
  assert.equal(project.deliveryMode, "external");
  assert.equal(project.iterationMode, "off");
  assert.equal(project.estimateScale, "none");
  const entities = await itemEntities(w.organizationId, sample);
  assert.equal(check(entities, "no_blocking_threads")?.passed, false);
  assert.deepEqual(await projectionDrift(db, w.organizationId), []);
});
