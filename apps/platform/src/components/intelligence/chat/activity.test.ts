import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changesOf,
  describeStep,
  subjectText,
  summarizeChanges,
  summarizeSteps,
  type Lookup,
} from "@lictory/platform/components/intelligence/chat/activity";

const names: Record<string, string> = {
  "project:p1": "Payments",
  "member:u1": "Ada Lovelace",
  "status:s1": "In progress",
};

const lookup: Lookup = {
  item: ({ id, key }) =>
    id === "item-1" || key?.toUpperCase() === "PAY-142"
      ? {
          id: "item-1",
          key: "PAY-142",
          title: "Checkout retries",
          href: "/app/acme/pay/stories/PAY-142",
        }
      : undefined,
  name: (kind, id) => names[`${kind}:${id}`],
};

void test("tool calls read as actions on named items, not capability names", () => {
  const step = describeStep(
    "getWorkItem",
    { organizationId: "org", key: "pay-142" },
    { ok: true, result: { item: { id: "item-1", key: "PAY-142" } } },
    undefined,
    lookup,
  );
  assert.equal(step.kind, "read");
  assert.equal(step.running, "Reading work item");
  assert.equal(step.done, "Read work item");
  assert.equal(subjectText(step.subject!), "PAY-142 Checkout retries");
  assert.equal(step.outcome.items[0]?.href, "/app/acme/pay/stories/PAY-142");
});

void test("inputs name people, statuses and items instead of ids", () => {
  const step = describeStep(
    "updateWorkItem",
    {
      organizationId: "org",
      mutationId: "m1",
      workItemId: "item-1",
      assigneeId: "u1",
      statusId: "s1",
      estimate: 3,
    },
    { ok: true, result: { mutationId: "m1" } },
    undefined,
    lookup,
  );
  assert.equal(step.kind, "write");
  assert.equal(step.done, "Updated work item");
  assert.equal(subjectText(step.subject!), "PAY-142 Checkout retries");
  assert.deepEqual(step.fields, [
    ["Assignee", "Ada Lovelace"],
    ["Status", "In progress"],
    ["Estimate", "3"],
  ]);
});

void test("searches show the query and how much came back", () => {
  const step = describeStep(
    "listWorkItems",
    { organizationId: "org", projectId: "p1", query: "retry" },
    {
      ok: true,
      result: {
        total: 40,
        items: [
          { id: "item-1", key: "PAY-142", title: "Checkout retries" },
          { id: "item-2", key: "PAY-143", title: "Refunds" },
        ],
      },
    },
    undefined,
    lookup,
  );
  assert.equal(step.kind, "search");
  assert.equal(subjectText(step.subject!), "“retry”");
  assert.equal(step.outcome.summary, "2 of 40 work items");
  assert.deepEqual(step.fields, [["Project", "Payments"]]);
});

void test("pagination, unset flags and unreadable ids stay in the raw data", () => {
  const step = describeStep(
    "mergePullRequest",
    {
      organizationId: "org",
      workItemId: "item-1",
      pullRequestId: "005c3a80-7ef3-488c-ae25-56f3be7b69d6",
      includeArchived: false,
      offset: 0,
      limit: 50,
      message: "Ship it",
    },
    undefined,
    undefined,
    lookup,
  );
  assert.equal(step.action, "Merge pull request");
  assert.deepEqual(step.fields, [["Message", "Ship it"]]);
});

void test("failures carry the capability's message", () => {
  const step = describeStep(
    "mergePullRequest",
    { organizationId: "org" },
    {
      ok: false,
      error: { message: "Engineering approval is stale. Review revision 14." },
    },
    undefined,
    lookup,
  );
  assert.equal(
    step.outcome.error,
    "Engineering approval is stale. Review revision 14.",
  );
  const errored = describeStep("getWorkItem", {}, undefined, "Timeout", lookup);
  assert.equal(errored.outcome.error, "Timeout");
});

void test("changes list each touched subject once and never count reads or failures", () => {
  const created = describeStep(
    "createWorkItem",
    { organizationId: "org", title: "Checkout retries" },
    { ok: true, result: { workItemId: "item-1" } },
    undefined,
    lookup,
  );
  const updated = describeStep(
    "updateWorkItem",
    { workItemId: "item-1", statusId: "s1" },
    { ok: true, result: {} },
    undefined,
    lookup,
  );
  const read = describeStep(
    "getWorkItem",
    { key: "PAY-142" },
    { ok: true, result: {} },
    undefined,
    lookup,
  );
  const failed = describeStep(
    "createLabel",
    { name: "urgent" },
    { ok: false, error: { message: "Exists" } },
    undefined,
    lookup,
  );
  const ok = { failed: false, declined: false, done: true };
  const changes = changesOf([
    { step: created, ...ok },
    { step: read, ...ok },
    { step: updated, ...ok },
    { step: failed, ...ok, failed: true },
  ]);
  assert.deepEqual(
    changes.map((c) => `${c.verb} ${subjectText(c.subject)}`),
    ["Created PAY-142 Checkout retries"],
  );
  assert.equal(
    summarizeSteps([
      { step: { kind: "read" }, failed: false, declined: false },
      { step: { kind: "write" }, failed: false, declined: false },
      { step: { kind: "write" }, failed: true, declined: false },
    ]),
    "3 steps · 1 change · 1 failed",
  );
});

void test("bulk changes summarize by verb, most frequent first", () => {
  const subject = (text: string) => ({ kind: "text" as const, text });
  assert.equal(
    summarizeChanges([
      { verb: "Created", subject: subject("a") },
      { verb: "Updated", subject: subject("b") },
      { verb: "Updated", subject: subject("c") },
      { verb: "Updated", subject: subject("d") },
    ]),
    "3 updated · 1 created",
  );
});
