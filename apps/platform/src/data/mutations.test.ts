import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROTOCOL,
  type Command,
  type Mutation,
} from "@lictory/core/contracts/protocol";
import {
  MutationRejected,
  PendingTracker,
  createMutationRunner,
  rejectionOf,
  type MutationCall,
  type MutationOutcome,
  type Rejection,
} from "@lictory/platform/data/mutations";
import { RecoveryStore } from "@lictory/platform/data/recovery";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const comment: Command = {
  type: "createThread",
  workItemId: "item",
  baseRevisionId: "rev",
  threadId: "00000000-0000-4000-8000-000000000001",
  messageId: "00000000-0000-4000-8000-000000000002",
  body: "What happens when the provider times out?",
  blocking: true,
  section: "Failure behavior",
};
const property: Command = {
  type: "updateWorkItem",
  workItemId: "item",
  priority: "high",
};
let next = 0;
const mutation = (command: Command): Mutation => ({
  protocol: PROTOCOL,
  id: `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
  organizationId: "org",
  command,
});

// A controllable Zero mutator call.
function deferredCall() {
  let settle!: (outcome: MutationOutcome) => void;
  const server = new Promise<MutationOutcome>((resolve) => (settle = resolve));
  const call: MutationCall = {
    client: Promise.resolve({ type: "success" }),
    server,
  };
  return { call, settle };
}

function setup() {
  const storage = new MemoryStorage();
  const recovery = new RecoveryStore(storage, "lictory:recovery:user:org");
  const pending = new PendingTracker();
  const rejections: Rejection[] = [];
  const calls: { mutation: Mutation; settle: (o: MutationOutcome) => void }[] =
    [];
  const runner = createMutationRunner({
    apply: (m) => {
      const { call, settle } = deferredCall();
      calls.push({ mutation: m, settle });
      return call;
    },
    pending,
    recovery,
    onRejected: (r) => rejections.push(r),
  });
  return { storage, recovery, pending, rejections, calls, runner };
}

const appError = (
  details: unknown,
): Extract<MutationOutcome, { type: "error" }> => ({
  type: "error",
  error: { type: "app", message: "Rejected", details },
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

void test("authored text is stored before sending and cleared once the server accepts it", async () => {
  const { storage, recovery, pending, runner, calls, rejections } = setup();
  const m = mutation(comment);
  await runner.run(m);
  assert.equal(calls.length, 1);
  // Persisted before the server answered, so a closed tab keeps it.
  assert.deepEqual(
    recovery.list().map((e) => [e.id, e.state]),
    [[m.id, "pending"]],
  );
  assert.ok(
    storage
      .getItem("lictory:recovery:user:org")
      ?.includes("provider times out"),
  );
  assert.equal(pending.snapshot().length, 1);
  calls[0]!.settle({ type: "success" });
  await flush();
  assert.equal(recovery.list().length, 0);
  assert.equal(storage.getItem("lictory:recovery:user:org"), null);
  assert.equal(pending.snapshot().length, 0);
  assert.equal(rejections.length, 0);
});

void test("a rejected comment keeps its text for recovery and reports one notice", async () => {
  const { recovery, pending, runner, calls, rejections } = setup();
  const m = mutation(comment);
  await runner.run(m);
  calls[0]!.settle(
    appError({ category: "conflict", message: "The specification changed." }),
  );
  await flush();
  assert.equal(pending.snapshot().length, 0);
  const [entry] = recovery.list();
  assert.equal(entry?.state, "rejected");
  assert.equal(entry?.error, "The specification changed.");
  assert.equal(entry?.command.type, "createThread");
  assert.deepEqual(rejections, [
    {
      mutationId: m.id,
      command: comment,
      message: "The specification changed.",
      recoverable: true,
    },
  ]);
  // Recovered entries survive a reload (a new store over the same storage).
  recovery.reload();
  assert.equal(recovery.list()[0]?.state, "rejected");
});

void test("rejected property changes roll back with a notice but keep nothing", async () => {
  const { recovery, runner, calls, rejections } = setup();
  await runner.run(mutation(property));
  assert.equal(recovery.list().length, 0);
  calls[0]!.settle(
    appError({ category: "forbidden", message: "You cannot change this." }),
  );
  await flush();
  assert.equal(recovery.list().length, 0);
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0]?.recoverable, false);
});

void test("confirmed mutations throw the domain details and leave the draft to the caller", async () => {
  const { recovery, runner, calls, rejections } = setup();
  const m = mutation(comment);
  const confirmed = runner.confirm(m);
  await flush();
  calls[0]!.settle(
    appError({
      category: "conflict",
      message: "Rebase onto revision 4.",
      currentRevisionId: "rev-4",
    }),
  );
  await assert.rejects(confirmed, (error: unknown) => {
    assert.ok(error instanceof MutationRejected);
    assert.equal(error.message, "Rebase onto revision 4.");
    assert.equal(error.mutationId, m.id);
    assert.deepEqual(error.details, {
      category: "conflict",
      message: "Rebase onto revision 4.",
      currentRevisionId: "rev-4",
      issues: undefined,
    });
    return true;
  });
  assert.equal(recovery.list().length, 0);
  assert.equal(rejections.length, 0);
});

void test("confirmed mutations resolve with their id after the server accepted them", async () => {
  const { runner, calls } = setup();
  const m = mutation(property);
  const confirmed = runner.confirm(m);
  await flush();
  calls[0]!.settle({ type: "success" });
  assert.equal(await confirmed, m.id);
});

void test("writes refused by Zero (offline) are reported as unavailable", () => {
  assert.deepEqual(
    rejectionOf({
      type: "error",
      error: { type: "zero", message: "Zero is offline" },
    }).category,
    "unavailable",
  );
  assert.deepEqual(rejectionOf(appError(undefined)), {
    category: "server",
    message: "Rejected",
  });
  assert.equal(
    rejectionOf(appError({ category: "nonsense", message: "x" })).category,
    "server",
  );
});
