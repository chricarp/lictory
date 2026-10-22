import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { directory } from "@lictory/core/domain/service";
import {
  projectionDrift,
  projectionService,
} from "@lictory/core/domain/projection-reader.test-helper";
import { createFakeProvider } from "@lictory/core/delivery/fake-provider";
import { DeliveryError } from "@lictory/core/delivery/provider";
import { createDeliveryService } from "@lictory/core/delivery/service";
import { rebuildProjections } from "@lictory/core/domain/projections";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_delivery_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const sync = projectionService(db);
let created = false;
process.env.DELIVERY_CREDENTIALS_KEY = "delivery-test-key";

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

// An organization with an epic, two stories (one not ready) and a subtask,
// connected to a fake Jira with Epic/Story/Subtask mapped.
async function fixture(
  onPublicationCompleted?: NonNullable<
    Parameters<typeof createDeliveryService>[1]
  >["onPublicationCompleted"],
) {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: userId, name: "Owner", email: `${userId}@example.test` },
    { id: reviewerId, name: "Reviewer", email: `${reviewerId}@example.test` },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Acme",
    slug: `acme-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  });
  await db.insert(s.member).values([
    {
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "owner",
      createdAt: new Date(),
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: reviewerId,
      role: "member",
      createdAt: new Date(),
    },
  ]);
  await seedOrganization(db, organizationId);
  const command = (command: Command, actor = userId) =>
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
  // The project hands its work off to Jira.
  await command({
    type: "updateProject",
    projectId,
    deliveryMode: "external",
  });
  const dir = await directory(db, userId, organizationId);
  const types = Object.fromEntries(
    dir.types.map((t) => [t.name, t.id]),
  ) as Record<"Epic" | "Story" | "Task" | "Bug" | "Subtask", string>;
  const create = async (
    typeId: string,
    title: string,
    parentId: string | null,
  ) => {
    const workItemId = crypto.randomUUID();
    await command({
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId,
      parentId,
      title,
      description: `${title} body\n\n## Acceptance criteria\n\n- [ ] Works`,
    });
    return workItemId;
  };
  const epic = await create(types.Epic, "Safe retries", null);
  const story = await create(types.Story, "Reuse transaction ID", epic);
  const draft = await create(types.Story, "Timeout copy", epic);
  const subtask = await create(types.Subtask, "Add column", story);
  // Readiness is server-maintained evidence; tests set the outcome directly.
  // Shortcuts around the domain repair the projections the way an operator
  // would, so the projection invariant still holds for this organization.
  const setReady = async (id: string, ready = true) => {
    await db
      .update(s.workItem)
      .set({ refinementState: ready ? "ready" : "refinement" })
      .where(eq(s.workItem.id, id));
    await rebuildProjections(db, organizationId);
  };
  await setReady(epic);
  await setReady(story);

  const fake = createFakeProvider();
  let clock = Date.now();
  const delivery = createDeliveryService(db, {
    providers: { jira_cloud: fake.provider },
    appUrl: "https://lictory.test",
    now: () => new Date(clock),
    onPublicationCompleted,
  });
  // `publish` only reserves the export; the worker processes it. Tests run
  // that step inline, the way the worker does after the commit signal.
  const service = {
    ...delivery,
    // What the mutation does: reserve the export for the worker.
    reserve: (...args: Parameters<typeof delivery.publish>) =>
      delivery.publish(...args),
    async publish(...args: Parameters<typeof delivery.publish>) {
      const requested = await delivery.publish(...args);
      assert.equal(requested.status, "running");
      return delivery.process(requested.id);
    },
  };
  const { connectionId } = await service.connect(userId, {
    organizationId,
    name: "Acme Jira",
    baseUrl: "https://acme.atlassian.net",
    email: "bot@acme.test",
    apiToken: "token",
  });
  await service.setTarget(userId, {
    organizationId,
    connectionId,
    projectId,
    projectKey: "EXT",
    typeMapping: {
      [types.Epic]: "epic",
      [types.Story]: "story",
      [types.Subtask]: "subtask",
    },
  });
  const links = () =>
    db
      .select()
      .from(s.workItemExternalLink)
      .where(eq(s.workItemExternalLink.organizationId, organizationId));
  const linkOf = async (workItemId: string) =>
    (await links()).find((l) => l.workItemId === workItemId);
  const revise = async (workItemId: string, content: string) => {
    const latest = (
      await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, workItemId))
    ).sort((a, b) => b.number - a.number)[0]!;
    await db.insert(s.specificationRevision).values({
      organizationId,
      workItemId,
      number: latest.number + 1,
      title: latest.title,
      content,
      authorId: userId,
    });
    await rebuildProjections(db, organizationId);
  };
  return {
    organizationId,
    userId,
    reviewerId,
    projectId,
    connectionId,
    command,
    types,
    epic,
    story,
    draft,
    subtask,
    fake,
    service,
    setReady,
    links,
    linkOf,
    revise,
    advance: (ms: number) => void (clock += ms),
  };
}

void test("exporting an epic creates ready items parents-first and skips the rest", async () => {
  const f = await fixture();
  const preview = await f.service.preview(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.deepEqual(
    preview.entries.map((e) => [e.title, e.action]),
    [
      ["Safe retries", "create"],
      ["Reuse transaction ID", "create"],
      ["Add column", "create"],
      ["Timeout copy", "not_ready"],
    ],
  );
  // Preview writes nothing.
  assert.equal((await f.links()).length, 0);

  const publication = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.equal(publication.status, "completed");
  assert.equal(publication.results[f.draft]!.outcome, "skipped");
  const epic = (await f.linkOf(f.epic))!;
  const story = (await f.linkOf(f.story))!;
  const subtask = (await f.linkOf(f.subtask))!;
  assert.equal(await f.linkOf(f.draft), undefined);
  assert.equal(epic.status, "synced");
  assert.equal(f.fake.items.get(story.externalId!)!.parentId, epic.externalId);
  assert.equal(
    f.fake.items.get(subtask.externalId!)!.parentId,
    story.externalId,
  );
  assert.equal(f.fake.items.get(epic.externalId!)!.typeId, "epic");
  assert.match(
    f.fake.items.get(story.externalId!)!.content,
    /Acceptance criteria/,
  );
  assert.ok(
    story.publishedRevisionId && story.payloadHash && story.externalUpdatedAt,
  );

  // Clients see links and an audit entry through the normal sync read.
  const page = await sync.read(f.userId, {
    organizationId: f.organizationId,
    projectId: f.projectId,
    workItemId: f.story,
  });
  const entities = page.changes.flatMap((c) =>
    c.operation === "upsert" ? [c.entity] : [],
  );
  const link = entities.find(
    (e) => e.type === "externalLink" && e.workItemId === f.story,
  );
  assert.equal(
    link?.type === "externalLink" && link.externalKey,
    story.externalKey,
  );
  assert.ok(
    entities.some((e) => e.type === "activity" && e.action === "exported"),
  );
  const projected = await db
    .select()
    .from(s.syncEntity)
    .where(eq(s.syncEntity.organizationId, f.organizationId));
  assert.ok(
    projected.some(
      (row) => row.type === "externalLink" && row.workItemId === null,
    ),
  );
});

void test("an epic that is not ready refuses the whole export", async () => {
  const f = await fixture();
  await f.setReady(f.epic, false);
  await assert.rejects(
    f.service.publish(f.userId, {
      organizationId: f.organizationId,
      rootId: f.epic,
    }),
    /PAY-1 is not ready, so it and its children cannot be exported/,
  );
  assert.equal((await f.links()).length, 0);
  assert.equal(f.fake.items.size, 0);
  // Selecting a not-ready story directly is refused too.
  await assert.rejects(
    f.service.publish(f.userId, {
      organizationId: f.organizationId,
      itemIds: [f.draft],
    }),
    /Nothing can be exported/,
  );
});

void test("re-exporting skips unchanged items and updates changed ones in place", async () => {
  const f = await fixture();
  await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  const size = f.fake.items.size;
  f.fake.calls.length = 0;
  const again = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.deepEqual(
    [
      again.results[f.epic]!.outcome,
      again.results[f.story]!.outcome,
      again.results[f.subtask]!.outcome,
    ],
    ["unchanged", "unchanged", "unchanged"],
  );
  assert.ok(
    !f.fake.calls.includes("updateItem") &&
      !f.fake.calls.includes("createItem"),
  );

  await f.revise(
    f.story,
    "Reuse the ID\n\n## Acceptance criteria\n\n- [ ] Same ID on retry",
  );
  const preview = await f.service.preview(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.equal(
    preview.entries.find((e) => e.workItemId === f.story)!.action,
    "update",
  );
  const updated = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.story],
  });
  assert.equal(updated.results[f.story]!.outcome, "updated");
  assert.equal(updated.results[f.story]!.revisionNumber, 2);
  assert.equal(f.fake.items.size, size);
  const link = (await f.linkOf(f.story))!;
  assert.match(f.fake.items.get(link.externalId!)!.content, /Same ID on retry/);
});

void test("external edits are never overwritten without confirmation", async () => {
  const f = await fixture();
  await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  const link = (await f.linkOf(f.epic))!;
  f.fake.editExternally(link.externalId!, "title", "Edited in Jira");
  await f.revise(f.epic, "New epic content");

  const preview = await f.service.preview(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  assert.deepEqual(preview.entries[0]!.conflict, ["title"]);
  const blocked = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  assert.equal(blocked.results[f.epic]!.outcome, "conflict");
  assert.match(
    blocked.results[f.epic]!.message!,
    /changed in Jira since the last export \(summary\)/,
  );
  assert.equal(f.fake.items.get(link.externalId!)!.title, "Edited in Jira");
  assert.equal((await f.linkOf(f.epic))!.status, "conflict");

  const confirmed = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
    overwriteItemIds: [f.epic],
  });
  assert.equal(confirmed.results[f.epic]!.outcome, "updated");
  assert.equal(f.fake.items.get(link.externalId!)!.title, "Safe retries");
  assert.equal((await f.linkOf(f.epic))!.status, "synced");
});

void test("a parent held as a conflict still anchors its exported children", async () => {
  const f = await fixture();
  await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  const epic = (await f.linkOf(f.epic))!;
  f.fake.editExternally(epic.externalId!, "content", "Edited in Jira");
  await f.revise(f.epic, "Epic v2");
  await f.revise(f.story, "Story v2");
  const run = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.equal(run.results[f.epic]!.outcome, "conflict");
  assert.equal(run.results[f.story]!.outcome, "updated");
  assert.equal(run.status, "partial");
});

void test("a partial failure keeps successes and the failed item can be exported again", async () => {
  const f = await fixture();
  const rejected = new DeliveryError(
    "validation",
    "Jira rejected the request: components: Component is required.",
  );
  f.fake.failNext("createItem", rejected, (p) => p?.lictoryItemId === f.story);
  const partial = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.results[f.epic]!.outcome, "created");
  assert.equal(partial.results[f.story]!.outcome, "failed");
  assert.equal(
    partial.results[f.story]!.message,
    "PAY-2 was not exported. Jira rejected the request: components: Component is required.",
  );
  // Children of a failed parent are skipped, not orphaned at the top level.
  assert.match(partial.results[f.subtask]!.message!, /its parent was not/);
  assert.equal(await f.linkOf(f.story), undefined);
  assert.equal(f.fake.items.size, 1);

  const fixed = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.equal(fixed.status, "completed");
  assert.equal(fixed.results[f.epic]!.outcome, "unchanged");
  assert.equal(f.fake.items.size, 3);
});

void test("a failing parent skips its whole subtree", async () => {
  const f = await fixture();
  f.fake.failNext(
    "createItem",
    new DeliveryError("permission", "No create permission."),
  );
  const failed = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.equal(failed.status, "failed");
  assert.equal(f.fake.items.size, 0);
  assert.equal((await f.links()).length, 0);
});

void test("a crash between the external create and recording it is recovered, not duplicated", async () => {
  const f = await fixture();
  // Simulate the crash: Jira has the issue, Lictory only has the attempt.
  f.fake.failNext("linkBack", new DeliveryError("unavailable", "down"));
  await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  const link = (await f.linkOf(f.epic))!;
  await db
    .update(s.workItemExternalLink)
    .set({
      externalId: null,
      externalKey: null,
      externalUrl: null,
      status: "pending",
      createAttemptedAt: new Date(Date.now() - 10 * 60_000),
      payloadHash: null,
    })
    .where(eq(s.workItemExternalLink.id, link.id));
  await rebuildProjections(db, f.organizationId);
  await f.revise(f.epic, "Changed after the crash");
  const recovered = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  assert.equal(recovered.results[f.epic]!.outcome, "created");
  assert.equal(f.fake.items.size, 1);
  const after = (await f.linkOf(f.epic))!;
  assert.equal(after.externalId, link.externalId);
  assert.equal(
    f.fake.items.get(after.externalId!)!.content,
    "Changed after the crash",
  );
});

void test("an unconfirmable recent create attempt waits instead of creating a duplicate", async () => {
  const f = await fixture();
  await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  await db
    .delete(s.workItemExternalLink)
    .where(eq(s.workItemExternalLink.organizationId, f.organizationId));
  f.fake.items.clear();
  await db.insert(s.workItemExternalLink).values({
    organizationId: f.organizationId,
    workItemId: f.epic,
    connectionId: f.connectionId,
    createAttemptedAt: new Date(),
  });
  await rebuildProjections(db, f.organizationId);
  const waiting = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  assert.equal(waiting.status, "running");
  assert.equal(waiting.results[f.epic]!.outcome, "pending");
  assert.equal(f.fake.items.size, 0);
  f.advance(5 * 60_000);
  await f.service.processPending();
  const done = await f.service.publication(
    f.userId,
    f.organizationId,
    waiting.id,
  );
  assert.equal(done.status, "completed");
  assert.equal(f.fake.items.size, 1);
});

void test("a runner that dies mid-export is resumed after its lease without duplicating work", async () => {
  const f = await fixture();
  const requested = await f.service.reserve(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  assert.equal(requested.status, "running");
  // Runner A exports the epic, then dies inside the story's create: Jira has
  // the story, Lictory only the attempt marker and A's lease.
  const create = f.fake.provider.createItem.bind(f.fake.provider);
  let created!: () => void;
  const storyCreated = new Promise<void>((resolve) => (created = resolve));
  f.fake.provider.createItem = async (connection, target, payload) => {
    const item = await create(connection, target, payload);
    if (payload.lictoryItemId !== f.story) return item;
    created();
    return new Promise<never>(() => undefined);
  };
  void f.service.process(requested.id);
  await storyCreated;
  f.fake.provider.createItem = create;
  assert.equal(f.fake.items.size, 2);
  const crashed = await f.service.publication(
    f.userId,
    f.organizationId,
    requested.id,
  );
  assert.equal(crashed.results[f.epic]!.outcome, "created");
  assert.equal(crashed.results[f.story]!.outcome, "pending");
  assert.ok((await f.linkOf(f.story))!.createAttemptedAt);

  // A second worker leaves it alone while the lease holds...
  await f.service.processPending();
  assert.equal(f.fake.items.size, 2);
  // ...and resumes it once the lease has expired.
  f.advance(6 * 60_000);
  await f.service.processPending();
  const resumed = await f.service.publication(
    f.userId,
    f.organizationId,
    requested.id,
  );
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.results[f.epic]!.outcome, "created");
  assert.equal(resumed.results[f.story]!.outcome, "created");
  assert.equal(resumed.results[f.subtask]!.outcome, "created");
  // The story Jira already had was adopted, not created again.
  assert.equal(f.fake.items.size, 3);
  const story = (await f.linkOf(f.story))!;
  assert.equal(f.fake.items.get(story.externalId!)!.lictoryItemId, f.story);
  assert.equal(story.createAttemptedAt, null);
  assert.equal(
    f.fake.calls.filter((c) => c === "createItem").length,
    3,
    "epic and story by the first runner, subtask by the second",
  );
});

void test("a runner that lost its lease records nothing and stops", async () => {
  const f = await fixture();
  const requested = await f.service.reserve(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  // Runner A stalls inside the epic's create long enough to lose its lease.
  const create = f.fake.provider.createItem.bind(f.fake.provider);
  let stalled!: () => void;
  const inside = new Promise<void>((resolve) => (stalled = resolve));
  let resume!: () => void;
  const unblocked = new Promise<void>((resolve) => (resume = resolve));
  f.fake.provider.createItem = async (connection, target, payload) => {
    const item = await create(connection, target, payload);
    if (payload.lictoryItemId === f.epic) {
      stalled();
      await unblocked;
      // Its late outcome differs from what the owner recorded.
      throw new DeliveryError("validation", "Late rejection.");
    }
    return item;
  };
  const runnerA = f.service.process(requested.id);
  await inside;
  f.fake.provider.createItem = create;
  f.advance(6 * 60_000);
  // Runner B takes over and finishes the whole export, adopting the epic.
  await f.service.processPending();
  const settled = await f.service.publication(
    f.userId,
    f.organizationId,
    requested.id,
  );
  assert.equal(settled.status, "completed");
  const settledAt = settled.finishedAt;
  resume();
  await runnerA;
  const after = await f.service.publication(
    f.userId,
    f.organizationId,
    requested.id,
  );
  assert.deepEqual(after.results, settled.results);
  assert.deepEqual(after.finishedAt, settledAt);
  assert.equal(f.fake.items.size, 3);
});

void test("an interrupted runner hands the remaining items to the next one at once", async () => {
  const f = await fixture();
  const requested = await f.service.reserve(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  const stop = new AbortController();
  const create = f.fake.provider.createItem.bind(f.fake.provider);
  f.fake.provider.createItem = async (connection, target, payload) => {
    // Shutdown arrives while the epic is being created.
    stop.abort();
    return create(connection, target, payload);
  };
  const interrupted = await f.service.process(requested.id, {
    signal: stop.signal,
  });
  f.fake.provider.createItem = create;
  assert.equal(interrupted.status, "running");
  assert.equal(interrupted.leaseUntil, null);
  assert.equal(interrupted.results[f.epic]!.outcome, "created");
  assert.equal(interrupted.results[f.story]!.outcome, "pending");
  await f.service.processPending();
  const done = await f.service.publication(
    f.userId,
    f.organizationId,
    requested.id,
  );
  assert.equal(done.status, "completed");
  assert.equal(f.fake.items.size, 3);
});

void test("linking an existing issue requires confirmation before the first overwrite", async () => {
  const f = await fixture();
  const existingId = f.fake.seed({ key: "EXT-99", title: "Imported story" });
  await f.service.linkExisting(f.userId, {
    organizationId: f.organizationId,
    workItemId: f.epic,
    externalKey: "EXT-99",
  });
  const preview = await f.service.preview(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  assert.deepEqual(preview.entries[0]!.conflict, ["linked"]);
  const blocked = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  assert.equal(blocked.results[f.epic]!.outcome, "conflict");
  assert.equal(f.fake.items.get(existingId)!.title, "Imported story");
  const confirmed = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
    overwriteItemIds: [f.epic],
  });
  assert.equal(confirmed.results[f.epic]!.outcome, "updated");
  assert.equal(f.fake.items.size, 1);
  assert.equal(f.fake.items.get(existingId)!.title, "Safe retries");
  // The same external issue cannot be linked twice.
  await assert.rejects(
    f.service.linkExisting(f.userId, {
      organizationId: f.organizationId,
      workItemId: f.story,
      externalKey: "EXT-99",
    }),
    /already linked|another Lictory item/,
  );
  await f.service.unlink(f.userId, {
    organizationId: f.organizationId,
    workItemId: f.epic,
    connectionId: f.connectionId,
  });
  assert.equal(await f.linkOf(f.epic), undefined);
  assert.ok(f.fake.items.has(existingId));
});

void test("exporting and configuring delivery are authorized on the server", async () => {
  const f = await fixture();
  await assert.rejects(
    f.service.publish(f.reviewerId, {
      organizationId: f.organizationId,
      rootId: f.epic,
    }),
    /cannot hand work off/,
  );
  await assert.rejects(
    f.service.connect(f.reviewerId, {
      organizationId: f.organizationId,
      name: "x",
      baseUrl: "https://other.atlassian.net",
      email: "a",
      apiToken: "b",
    }),
    /administrator/,
  );
  const outsider = crypto.randomUUID();
  await db.insert(s.user).values({
    id: outsider,
    name: "Outsider",
    email: `${outsider}@example.test`,
  });
  await assert.rejects(
    f.service.preview(outsider, {
      organizationId: f.organizationId,
      rootId: f.epic,
    }),
    /access has been removed/,
  );
  // Credentials are stored encrypted and never reach the directory.
  const [row] = await db
    .select()
    .from(s.deliveryConnection)
    .where(and(eq(s.deliveryConnection.organizationId, f.organizationId)));
  assert.ok(!row!.encryptedCredential.includes("token"));
  const dir = await directory(db, f.reviewerId, f.organizationId);
  assert.equal(dir.delivery.connections.length, 1);
  assert.ok(!JSON.stringify(dir).includes(row!.encryptedCredential));
});

void test("publication observers fire once at settlement, survive observer failures and include resumed exports", async () => {
  const completed: { id: string; status: string; requester: string }[] = [];
  const f = await fixture((publication) => {
    completed.push({
      id: publication.id,
      status: publication.status,
      requester: publication.requestedById,
    });
    throw new Error("Analytics unavailable");
  });
  const first = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  assert.equal(first.status, "completed");
  assert.equal(completed.length, 1);
  await f.service.process(first.id);
  assert.equal(completed.length, 1);
  await db
    .delete(s.workItemExternalLink)
    .where(eq(s.workItemExternalLink.organizationId, f.organizationId));
  f.fake.items.clear();
  await db.insert(s.workItemExternalLink).values({
    organizationId: f.organizationId,
    workItemId: f.epic,
    connectionId: f.connectionId,
    createAttemptedAt: new Date(),
  });
  await rebuildProjections(db, f.organizationId);
  const waiting = await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    itemIds: [f.epic],
  });
  assert.equal(waiting.status, "running");
  assert.equal(completed.length, 1);
  f.advance(5 * 60_000);
  await f.service.processPending();
  assert.deepEqual(completed[1], {
    id: waiting.id,
    status: "completed",
    requester: f.userId,
  });
  await f.service.processPending();
  assert.equal(completed.length, 2);
});

void test("organization administrators own Jira connections; project administrators choose their project's target", async () => {
  const f = await fixture();
  const input = {
    organizationId: f.organizationId,
    name: "Second site",
    baseUrl: "https://second.atlassian.net",
    email: "bot@acme.test",
    apiToken: "second-secret-token",
  };
  // Credentials are organization administration, never delegated.
  await assert.rejects(f.service.connect(f.reviewerId, input), /administrator/);
  await assert.rejects(
    f.service.disconnect(f.reviewerId, f.organizationId, f.connectionId),
    /administrator/,
  );
  // A project member cannot change where the project hands off…
  await assert.rejects(
    f.service.setTarget(f.reviewerId, {
      organizationId: f.organizationId,
      connectionId: f.connectionId,
      projectId: f.projectId,
      projectKey: "EXT",
      typeMapping: {},
    }),
    /project's administrators/,
  );
  await assert.rejects(
    f.service.listProjects(
      f.reviewerId,
      f.organizationId,
      f.connectionId,
      undefined,
      f.projectId,
    ),
    /project/,
  );
  // …a project administrator can, for their own project only.
  await f.command({
    type: "setProjectMember",
    projectId: f.projectId,
    userId: f.reviewerId,
    role: "admin",
  });
  await f.service.listProjects(
    f.reviewerId,
    f.organizationId,
    f.connectionId,
    undefined,
    f.projectId,
  );
  await f.service.setTarget(f.reviewerId, {
    organizationId: f.organizationId,
    connectionId: f.connectionId,
    projectId: f.projectId,
    projectKey: "EXT",
    typeMapping: { [f.types.Story]: "story", [f.types.Epic]: "epic" },
  });
  const billing = crypto.randomUUID();
  await f.command({
    type: "createProject",
    projectId: billing,
    name: "Billing",
    key: "BIL",
  });
  await assert.rejects(
    f.service.setTarget(f.reviewerId, {
      organizationId: f.organizationId,
      connectionId: f.connectionId,
      projectId: billing,
      projectKey: "EXT",
      typeMapping: {},
    }),
    /project's administrators/,
  );
  const dir = await directory(db, f.reviewerId, f.organizationId);
  assert.deepEqual(
    dir.delivery.targets.map((t) => t.projectId),
    [f.projectId],
  );
  assert.ok(!JSON.stringify(dir).includes("secret-token"));
  const audit = await db
    .select()
    .from(s.configurationAudit)
    .where(eq(s.configurationAudit.organizationId, f.organizationId));
  assert.ok(
    audit.some(
      (a) => a.actorId === f.reviewerId && a.action === "setDeliveryTarget",
    ),
  );
  await f.service.removeTarget(f.reviewerId, f.organizationId, f.projectId);
  assert.equal(
    (await directory(db, f.userId, f.organizationId)).delivery.targets.length,
    0,
  );
});

void test("only projects that hand work off export it", async () => {
  const f = await fixture();
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    deliveryMode: "native",
  });
  await assert.rejects(
    f.service.preview(f.userId, {
      organizationId: f.organizationId,
      rootId: f.epic,
    }),
    /delivers its work in Lictory/,
  );
  await assert.rejects(
    f.service.linkExisting(f.userId, {
      organizationId: f.organizationId,
      workItemId: f.story,
      externalKey: "EXT-1",
    }),
    /delivers its work in Lictory/,
  );
});

void test("status sync reads Jira status and assignee back without writing either system's owned fields", async () => {
  const f = await fixture();
  await f.service.publish(f.userId, {
    organizationId: f.organizationId,
    rootId: f.epic,
  });
  const story = (await f.linkOf(f.story))!;
  const before = { ...story };
  const writes = f.fake.calls.filter((c) =>
    ["createItem", "updateItem", "linkBack"].includes(c),
  ).length;
  f.fake.progressExternally(
    story.externalId!,
    "In Progress",
    "in_progress",
    "Dana",
  );
  const result = await f.service.refreshProject(
    f.userId,
    f.organizationId,
    f.projectId,
  );
  assert.equal(result.failedConnections, 0);
  const after = (await f.linkOf(f.story))!;
  assert.equal(after.externalStatus, "In Progress");
  assert.equal(after.externalStatusCategory, "in_progress");
  assert.equal(after.externalAssignee, "Dana");
  // Lictory-owned export state is untouched, and nothing was written to Jira.
  assert.equal(after.payloadHash, before.payloadHash);
  assert.equal(after.publishedRevisionId, before.publishedRevisionId);
  assert.equal(
    f.fake.calls.filter((c) =>
      ["createItem", "updateItem", "linkBack"].includes(c),
    ).length,
    writes,
  );
  // The item's own Lictory status never follows Jira.
  const [item] = await db
    .select()
    .from(s.workItem)
    .where(eq(s.workItem.id, f.story));
  const statuses = (await directory(db, f.userId, f.organizationId)).statuses;
  assert.notEqual(
    statuses.find((x) => x.id === item!.statusId)?.category,
    "started",
  );
  // A routine check that finds nothing new does not churn the projections.
  const changes = async () =>
    (
      await db
        .select({ key: s.syncEntity.key, updatedAt: s.syncEntity.updatedAt })
        .from(s.syncEntity)
        .where(eq(s.syncEntity.organizationId, f.organizationId))
    )
      .map((r) => `${r.key}@${r.updatedAt.toISOString()}`)
      .sort()
      .join();
  const logged = await changes();
  await f.service.refreshPending();
  assert.equal(await changes(), logged);
  // An issue deleted in Jira is reported, not silently dropped.
  f.fake.items.delete(story.externalId!);
  await f.service.refreshPending();
  assert.match((await f.linkOf(f.story))!.lastError ?? "", /no longer exists/);
  // Native projects have nothing to sync.
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    deliveryMode: "native",
  });
  await assert.rejects(
    f.service.refreshProject(f.userId, f.organizationId, f.projectId),
    /delivers its work in Lictory/,
  );
});

void test("projections equal a rebuild from the domain", async () => {
  const drift: string[] = [];
  for (const { id } of await db
    .select({ id: s.organization.id })
    .from(s.organization))
    drift.push(...(await projectionDrift(db, id)));
  assert.deepEqual(drift, []);
});
