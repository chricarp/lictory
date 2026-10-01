import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SyncEngine } from "./engine";
import { IndexedPersistence, type Queued } from "./persistence";
import { PROTOCOL } from "../shared/protocol";

void test("rejected status changes remain inspectable while later priority changes save, including after reload", async () => {
  const fetchBefore = globalThis.fetch;
  const navigatorBefore = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  const store = new IndexedPersistence();
  const user = crypto.randomUUID();
  const scope = { organizationId: crypto.randomUUID() };
  const engine = new SyncEngine(user, scope, store);
  const queued = (priority: boolean): Queued => ({
    mutation: {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: scope.organizationId,
      command: priority
        ? { type: "updateWorkItem", workItemId: "item", priority: "high" }
        : { type: "updateWorkItem", workItemId: "item", statusId: "started" },
    },
    enqueuedAt: priority ? 2 : 1,
    attempts: 0,
    nextAttempt: 0,
    blocked: false,
  });
  const rejected = queued(false);
  const priority = queued(true);
  const sent: string[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      assert.equal(typeof init.body, "string");
      const mutation = JSON.parse(init.body as string) as Queued["mutation"];
      sent.push(mutation.id);
      if (mutation.id === rejected.mutation.id)
        return Response.json(
          {
            error: {
              category: "validation",
              message: "The item is not ready to start.",
            },
          },
          { status: 422 },
        );
      return Response.json({
        protocol: PROTOCOL,
        mutationId: mutation.id,
        cursor: "1",
      });
    }
    return Response.json({
      protocol: PROTOCOL,
      changes: [],
      nextCursor: "1",
      hasMore: false,
      directory: {
        organizations: [],
        projects: [],
        members: [],
        roles: [],
        teams: [],
        types: [],
        iterations: [],
        delivery: { connections: [], targets: [] },
      },
    });
  };
  try {
    await store.put(engine.owner, rejected);
    await store.put(engine.owner, priority);
    await engine.sync();
    assert.deepEqual(sent, [rejected.mutation.id, priority.mutation.id]);
    const pending = await store.queue(engine.owner);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.mutation.id, rejected.mutation.id);
    assert.equal(pending[0]!.blocked, true);
    assert.equal(engine.getSnapshot().error, "The item is not ready to start.");

    const reloaded = new SyncEngine(user, scope, store);
    const nextPriority = queued(true);
    await store.put(engine.owner, nextPriority);
    await reloaded.sync();
    assert.deepEqual(sent, [
      rejected.mutation.id,
      priority.mutation.id,
      nextPriority.mutation.id,
    ]);
    assert.equal((await store.queue(engine.owner)).length, 1);

    // An exhausted transport retry may already have committed. It remains an
    // ordering barrier until its outcome is recovered or the user discards it.
    await store.put(engine.owner, { ...pending[0]!, attempts: 5 });
    await store.put(engine.owner, queued(true));
    await reloaded.sync();
    assert.equal(sent.length, 3);
    assert.equal((await store.queue(engine.owner)).length, 2);
  } finally {
    globalThis.fetch = fetchBefore;
    if (navigatorBefore)
      Object.defineProperty(globalThis, "navigator", navigatorBefore);
    else Reflect.deleteProperty(globalThis, "navigator");
    await store.purge(engine.owner);
  }
});
