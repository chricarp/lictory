import assert from "node:assert/strict";
import { test } from "node:test";
import type { Entities } from "@lictory/core/contracts/optimistic";
import type { Command, Entity } from "@lictory/core/contracts/protocol";
import {
  RecoveryStore,
  authoredText,
  carriesAuthoredText,
  clearRecoveryFor,
  effectPresent,
  recoveryKey,
  recoveryScope,
  recoveryText,
} from "@lictory/platform/data/recovery";

class MemoryStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
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

const reply: Command = {
  type: "replyToThread",
  workItemId: "item",
  threadId: "thread",
  messageId: "00000000-0000-4000-8000-000000000010",
  body: "Retries reuse the original transaction ID.",
};
const edit: Command = {
  type: "updateSpecification",
  workItemId: "item",
  baseRevisionId: "rev-1",
  title: "Refunds",
  content: "## Failure behavior\nRetry up to 3 times.",
};

void test("recovery entries are scoped per person and organization", () => {
  assert.equal(recoveryKey("u1", "o1"), "lictory:recovery:u1:o1");
  const storage = new MemoryStorage();
  const mine = new RecoveryStore(storage, recoveryKey("u1", "o1"));
  const other = new RecoveryStore(storage, recoveryKey("u2", "o1"));
  mine.put({ id: "m1", organizationId: "o1", command: reply });
  assert.equal(mine.list().length, 1);
  assert.equal(other.list().length, 0);
});

void test("the store keeps readable entries, tolerates corrupt data and notifies", () => {
  const storage = new MemoryStorage();
  const key = recoveryKey("u1", "o1");
  storage.setItem(
    key,
    JSON.stringify([
      { nonsense: true },
      {
        id: "m1",
        organizationId: "o1",
        command: reply,
        createdAt: 1,
        state: "rejected",
        error: "No access.",
      },
    ]),
  );
  const store = new RecoveryStore(storage, key);
  assert.deepEqual(
    store.list().map((e) => e.id),
    ["m1"],
  );
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);
  store.put({ id: "m2", organizationId: "o1", command: edit });
  store.reject("m2", "Conflict.");
  store.remove("m1");
  unsubscribe();
  assert.equal(notified, 3);
  assert.deepEqual(
    store.list().map((e) => [e.id, e.state, e.error]),
    [["m2", "rejected", "Conflict."]],
  );
  storage.setItem(key, "{not json");
  store.reload();
  assert.deepEqual(store.list(), []);
});

void test("only composed text is kept for recovery", () => {
  assert.ok(carriesAuthoredText(reply));
  assert.ok(carriesAuthoredText(edit));
  assert.ok(
    !carriesAuthoredText({
      type: "updateWorkItem",
      workItemId: "item",
      priority: "low",
    }),
  );
  assert.ok(
    !carriesAuthoredText({
      type: "cancelReview",
      workItemId: "i",
      reviewId: "r",
    }),
  );
  assert.deepEqual(
    authoredText(edit).map((f) => f.label),
    ["Title", "Specification"],
  );
  assert.equal(
    recoveryText(reply),
    "Retries reuse the original transaction ID.",
  );
  assert.equal(
    recoveryText(edit),
    "Title\nRefunds\n\nSpecification\n## Failure behavior\nRetry up to 3 times.",
  );
});

void test("entries whose effect already synchronized are recognized", () => {
  const message = {
    type: "message",
    id: "00000000-0000-4000-8000-000000000010",
    organizationId: "o1",
    threadId: "thread",
    authorId: "u1",
    body: "Retries reuse the original transaction ID.",
    createdAt: "2026-01-01",
  } as Entity;
  const revision = {
    type: "revision",
    id: "rev-2",
    organizationId: "o1",
    workItemId: "item",
    number: 2,
    title: "Refunds",
    content: "## Failure behavior\nRetry up to 3 times.\n",
    changeSummary: null,
    authorId: "u1",
    createdAt: "2026-01-01",
  } as Entity;
  const entities: Entities = {
    [`message:${message.id}`]: message,
    "revision:rev-2": revision,
  };
  assert.ok(effectPresent(reply, entities));
  assert.ok(effectPresent(edit, entities));
  assert.ok(!effectPresent(reply, {}));
  assert.ok(!effectPresent({ ...edit, content: "Something else" }, entities));
  assert.equal(recoveryScope(reply), "item");
  assert.equal(
    recoveryScope({
      type: "createWorkItem",
      projectId: "p",
      workItemId: "00000000-0000-4000-8000-000000000011",
      typeId: "t",
      parentId: null,
      title: "New",
    }),
    undefined,
  );
});

void test("signing out removes a person's kept text and branch drafts only", () => {
  const storage = new MemoryStorage();
  storage.setItem("lictory:recovery:u1:o1", "[]");
  storage.setItem("lictory:branch-draft:u1:o1:item:branch", "{}");
  storage.setItem("lictory:recovery:u2:o1", "[]");
  storage.setItem("lictory-appearance", "dark");
  clearRecoveryFor("u1", storage);
  assert.deepEqual([...storage.values.keys()].sort(), [
    "lictory-appearance",
    "lictory:recovery:u2:o1",
  ]);
});

void test("a rejected breakdown proposal stays recoverable until its exact scope is synchronized", () => {
  const proposedChildren = [
    {
      workItemId: "00000000-0000-4000-8000-000000000042",
      typeId: "task",
      title: "Safe retries",
      description: "Keep transaction IDs.",
    },
  ];
  const command: Command = {
    type: "commitBranch",
    workItemId: "item",
    branchId: "branch",
    baseCommitId: "old",
    title: "Retries",
    content: "Behavior",
    message: "Propose tasks",
    proposedChildren,
  };
  const commit = {
    type: "specCommit",
    id: "commit",
    organizationId: "org",
    workItemId: "item",
    title: "Retries",
    content: "Behavior",
    message: "Propose tasks",
    proposedChildren: [],
    parentIds: ["old"],
    authorId: "user",
    revisionId: null,
    createdAt: "2026-01-01",
  } as const;
  assert.match(recoveryText(command), /Keep transaction IDs/);
  assert.equal(
    effectPresent(command, {
      "specCommit:commit": {
        ...commit,
        parentIds: ["old"],
        proposedChildren: [],
      },
    }),
    false,
  );
  assert.equal(
    effectPresent(command, {
      "specCommit:commit": { ...commit, parentIds: ["old"], proposedChildren },
    }),
    true,
  );
});
