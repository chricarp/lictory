import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { IndexedPersistence, type Queued } from "./persistence";
import { retryDelay } from "./reconciliation";
void test("IndexedDB persists checkpoint with entities, queue survives reload, and identities stay isolated", async () => {
  const a = new IndexedPersistence();
  const owner = crypto.randomUUID();
  const item: Queued = {
    mutation: {
      protocol: 1,
      id: crypto.randomUUID(),
      organizationId: "org",
      command: {
        type: "replyToThread",
        proposalId: "proposal",
        threadId: "thread",
        messageId: crypto.randomUUID(),
        body: "Keep this across reload",
      },
    },
    enqueuedAt: 10,
    attempts: 2,
    nextAttempt: 100,
    blocked: false,
  };
  await a.put(owner, item);
  await a.save(owner, {
    cursor: "9007199254740993",
    entities: {},
    directory: { organizations: [], products: [], members: [], groups: [] },
  });
  const reloaded = new IndexedPersistence();
  assert.deepEqual(await reloaded.queue(owner), [item]);
  assert.equal((await reloaded.load(owner))?.cursor, "9007199254740993");
  assert.deepEqual(await reloaded.queue("another-user"), []);
  const later = {
    ...item,
    mutation: { ...item.mutation, id: crypto.randomUUID() },
    enqueuedAt: 20,
  };
  await Promise.all([
    a.put(owner, later),
    reloaded.put(owner, { ...item, attempts: 3 }),
  ]);
  assert.deepEqual(
    (await a.queue(owner)).map((q) => q.enqueuedAt),
    [10, 20],
  );
  await reloaded.delete(owner, item.mutation.id);
  assert.deepEqual(
    (await a.queue(owner)).map((q) => q.mutation.id),
    [later.mutation.id],
  );
  assert.equal(retryDelay(1), 1000);
  assert.equal(retryDelay(3), 4000);
  assert.equal(retryDelay(10), 30000);
});

void test("access revocation purges every scope and pending command for only the affected identity", async () => {
  const store = new IndexedPersistence();
  const owner = crypto.randomUUID();
  const cache = {
    cursor: "2",
    entities: {},
    directory: { organizations: [], products: [], members: [], groups: [] },
  };
  await store.save(`${owner}:one`, cache);
  await store.save(`${owner}:two`, cache);
  await store.save(`different:${owner}`, cache);
  const item: Queued = {
    mutation: {
      protocol: 1,
      id: crypto.randomUUID(),
      organizationId: "org",
      command: { type: "createProduct", name: "Test", slug: "test" },
    },
    enqueuedAt: 1,
    attempts: 0,
    nextAttempt: 0,
    blocked: false,
  };
  await store.put(owner, item);
  await store.purge(owner);
  assert.equal(await store.load(`${owner}:one`), undefined);
  assert.equal(await store.load(`${owner}:two`), undefined);
  assert.deepEqual(await store.queue(owner), []);
  assert.ok(await store.load(`different:${owner}`));
});
