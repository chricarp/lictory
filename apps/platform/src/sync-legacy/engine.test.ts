import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SyncEngine, type Rejection } from "@lictory/platform/sync-legacy/engine";
import { IndexedPersistence, type Queued } from "@lictory/platform/sync-legacy/persistence";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";

void test("application rejections are transient; uncertain changes and authored drafts stay recoverable", async (t) => {
  const fetchBefore = globalThis.fetch;
  const navigatorBefore = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const network = { onLine: true };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: network,
  });
  const store = new IndexedPersistence();
  const user = crypto.randomUUID();
  const scope = { organizationId: crypto.randomUUID() };
  const engine = new SyncEngine(user, scope, store);
  const owner = engine.owner;
  const status: Command = {
    type: "updateWorkItem",
    workItemId: "item",
    statusId: "started",
  };
  const priority: Command = {
    type: "updateWorkItem",
    workItemId: "item",
    priority: "high",
  };
  const queued = (command: Command = status, enqueuedAt = 1): Queued => ({
    mutation: {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: scope.organizationId,
      command,
    },
    enqueuedAt,
    attempts: 0,
    nextAttempt: 0,
    blocked: false,
  });
  const sent: string[] = [];
  const events: Rejection[] = [];
  engine.subscribeRejections((event) => events.push(event));
  let response: "reject" | "network" | "accept" = "reject";
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      const mutation = JSON.parse(init.body as string) as Queued["mutation"];
      sent.push(mutation.id);
      if (response === "network") throw new Error("Connection interrupted.");
      if (
        response === "reject" &&
        !(
          mutation.command.type === "updateWorkItem" &&
          mutation.command.priority
        )
      )
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
        projectMembers: [],
        disciplines: [],
        teams: [],
        types: [],
        projectTypes: [],
        statuses: [],
        iterations: [],
        delivery: { connections: [], targets: [] },
        readiness: [],
      },
    });
  };
  try {
    await t.test(
      "forgettable rejection notifies once, rolls back, and lets later properties save",
      async () => {
        const rejected = queued();
        const later = queued(priority, 2);
        await store.put(owner, rejected);
        await store.put(owner, later);
        await engine.sync();
        assert.deepEqual(sent, [rejected.mutation.id, later.mutation.id]);
        assert.deepEqual(events, [
          {
            mutationId: rejected.mutation.id,
            message: "The item is not ready to start.",
          },
        ]);
        assert.deepEqual(await store.queue(owner), []);
        assert.equal(engine.getSnapshot().status, "synced");
        assert.equal(engine.getSnapshot().error, undefined);
        const reloaded = new SyncEngine(user, scope, store);
        reloaded.subscribeRejections((event) => events.push(event));
        await reloaded.sync();
        assert.equal(events.length, 1);
        assert.equal(sent.length, 2);
      },
    );
    await t.test(
      "legacy rejected properties are cleaned even offline without feedback; explicit retention is respected",
      async () => {
        const legacy = { ...queued(), blocked: true, error: "Old failure" };
        const retained = {
          ...queued(),
          blocked: true,
          error: "Retained failure",
          forgettable: false,
        };
        const otherOwner = `${owner}-other`;
        await store.put(owner, legacy);
        await store.put(owner, retained);
        await store.put(otherOwner, legacy);
        network.onLine = false;
        const reloaded = new SyncEngine(user, scope, store);
        reloaded.subscribeRejections((event) => events.push(event));
        await reloaded.sync();
        assert.deepEqual(
          (await store.queue(owner)).map((q) => q.mutation.id),
          [retained.mutation.id],
        );
        assert.equal((await store.queue(otherOwner)).length, 1);
        assert.equal(events.length, 1);
        network.onLine = true;
        await reloaded.sync();
        assert.equal(reloaded.getSnapshot().status, "synced");
        assert.equal(events.length, 1);
        await store.purge(otherOwner);
        await store.purge(owner);
      },
    );
    await t.test(
      "authored text is retained without replaying rejection events on reload",
      async () => {
        const draft = queued({
          type: "replyToThread",
          workItemId: "item",
          threadId: "thread",
          messageId: crypto.randomUUID(),
          body: "Keep my draft",
        });
        await store.put(owner, draft);
        await engine.sync();
        assert.equal(
          (await store.queue(owner))[0]!.mutation.command.type,
          "replyToThread",
        );
        const count = events.length;
        const reloaded = new SyncEngine(user, scope, store);
        reloaded.subscribeRejections((event) => events.push(event));
        await reloaded.sync();
        assert.equal(events.length, count);
        assert.equal(reloaded.getSnapshot().status, "synced");
        await store.purge(owner);
      },
    );
    await t.test(
      "confirmed rejection rejects the caller before discarding, so an editor keeps its draft",
      async () => {
        await assert.rejects(
          engine.mutateConfirmed(status),
          /not ready to start/,
        );
        await engine.sync();
        assert.deepEqual(await store.queue(owner), []);
      },
    );
    await t.test(
      "network uncertainty survives manual retries and blocks later commands until reconciled",
      async () => {
        response = "network";
        const uncertain = queued();
        await store.put(owner, uncertain);
        await engine.sync();
        let pending = await store.queue(owner);
        assert.equal(pending[0]!.uncertain, true);
        await store.put(owner, { ...pending[0]!, attempts: 5, blocked: true });
        await store.put(owner, queued(priority, 2));
        await engine.sync();
        const count = sent.length;
        const eventCount = events.length;
        response = "reject";
        await engine.retryPending();
        assert.equal(sent.length, count + 1);
        assert.equal(sent.at(-1), uncertain.mutation.id);
        pending = await store.queue(owner);
        assert.equal(pending.length, 2);
        assert.equal(pending[0]!.attempts, 0);
        assert.equal(pending[0]!.uncertain, true);
        assert.equal(engine.getSnapshot().status, "failed");
        assert.equal(events.length, eventCount);
        const reloaded = new SyncEngine(user, scope, store);
        await reloaded.sync();
        assert.equal((await store.queue(owner)).length, 2);
        response = "accept";
        await reloaded.retryPending();
        assert.deepEqual(
          sent.slice(-2),
          pending.map((q) => q.mutation.id),
        );
        assert.deepEqual(await store.queue(owner), []);
        assert.equal(reloaded.getSnapshot().status, "synced");
      },
    );
  } finally {
    globalThis.fetch = fetchBefore;
    if (navigatorBefore)
      Object.defineProperty(globalThis, "navigator", navigatorBefore);
    else Reflect.deleteProperty(globalThis, "navigator");
    await store.purge(owner);
  }
});
