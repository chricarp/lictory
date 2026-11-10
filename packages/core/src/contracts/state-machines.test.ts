import { test } from "node:test";
import assert from "node:assert/strict";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig, isPgEnum } from "drizzle-orm/pg-core";
import * as schema from "@lictory/core/db/schema";
import { DomainError, requireStep } from "@lictory/core/domain/errors";
import {
  commandSchema,
  refinementStates,
} from "@lictory/core/contracts/protocol";
import {
  chosenRefinementStates,
  iteration,
  pagePullRequest,
  pullRequestIsActive,
  pullRequestState,
  refinement,
  review,
  specificationPullRequest,
  stateMachine,
  statusColumns,
  suggestion,
  type StateMachine,
} from "@lictory/core/contracts/state-machines";

const door = stateMachine({
  name: "door",
  states: { open: "Open.", closed: "Closed.", sealed: "Sealed for good." },
  steps: {
    close: {
      does: "Close",
      from: ["open"],
      to: "closed",
      idempotent: true,
      refused: "A sealed door cannot be closed.",
    },
    knock: {
      does: "Knock",
      from: ["closed"],
      refused: (state) => `Nobody knocks on a door that is ${state}.`,
    },
    seal: {
      does: "Seal",
      from: ["closed"],
      to: "sealed",
      automatic: true,
      refused: "Only a closed door is sealed.",
    },
  },
});

void test("a step is allowed from its states and refused elsewhere in the table's words", () => {
  assert.equal(door.allows("open", "close"), true);
  assert.equal(door.refusal("open", "close"), undefined);
  assert.equal(
    door.refusal("sealed", "close"),
    "A sealed door cannot be closed.",
  );
  assert.equal(
    door.refusal("open", "knock"),
    "Nobody knocks on a door that is open.",
  );
});

void test("an idempotent step accepts the state it leads to without offering it", () => {
  assert.equal(door.refusal("closed", "close"), undefined);
  assert.equal(door.allows("closed", "close"), false);
  assert.deepEqual(door.available("closed"), ["knock"]);
});

void test("automatic steps are never offered and final states are derived", () => {
  assert.equal(door.allows("closed", "seal"), true);
  assert.equal(door.available("closed").includes("seal"), false);
  assert.deepEqual(door.final, ["sealed"]);
  assert.deepEqual(door.available("sealed"), []);
});

void test("the server refuses in the table's words and says the state is the reason", () => {
  assert.doesNotThrow(() => requireStep(door, "open", "close"));
  assert.throws(
    () => requireStep(door, "sealed", "close", "forbidden"),
    (error) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.category, "forbidden");
      assert.equal(error.message, "A sealed door cannot be closed.");
      assert.equal(error.kind, "invalid_state");
      return true;
    },
  );
});

void test("rules read as sentences", () => {
  assert.equal(
    door.rule("close", "knock"),
    "Close while the door is open (it becomes closed). Knock while the door is closed.",
  );
  assert.equal(
    review.rule("approve", "revoke", "cancel"),
    "While the review is requested, in progress, changes requested or completed: approve (it becomes completed); revoke a decision (it becomes requested); cancel (it becomes cancelled).",
  );
  assert.equal(
    refinement.rule("move"),
    "Move between draft, refinement and in review while the specification is draft, refinement or in review (it becomes draft, refinement or in review).",
  );
});

void test("declared machines end where the product says they end", () => {
  assert.deepEqual(specificationPullRequest.final, ["closed"]);
  assert.deepEqual(pagePullRequest.final, ["merged", "closed"]);
  assert.deepEqual(suggestion.final, ["merged"]);
  assert.deepEqual(review.final, ["cancelled"]);
  assert.deepEqual(iteration.final, ["completed"]);
  assert.deepEqual(refinement.final, []);
});

void test("pull requests: only open ones are reviewed and merged; closing differs by product", () => {
  for (const machine of [specificationPullRequest, pagePullRequest]) {
    assert.deepEqual(
      (["draft", "open", "merged", "closed"] as const).filter((state) =>
        machine.allows(state, "merge"),
      ),
      ["open"],
    );
    assert.equal(machine.allows("draft", "review"), false);
    assert.equal(machine.refusal("draft", "markDraft"), undefined);
    assert.equal(machine.available("closed").length, 0);
  }
  // A merged specification pull request can be removed from the item; a
  // merged page pull request is history.
  assert.equal(specificationPullRequest.allows("merged", "close"), true);
  assert.equal(
    pagePullRequest.refusal("merged", "close"),
    "A merged pull request is history and cannot be deleted.",
  );
  assert.equal(pullRequestState({ status: "open", deletedAt: null }), "open");
  assert.equal(
    pullRequestState({ status: "open", deletedAt: new Date() }),
    "closed",
  );
  assert.equal(pullRequestIsActive({ status: "draft" }), true);
  assert.equal(pullRequestIsActive({ status: "merged" }), false);
  assert.equal(
    pullRequestIsActive({ status: "open", deletedAt: "2026-11-09" }),
    false,
  );
});

void test("suggestions: a merged one never changes; a closed one can be reopened", () => {
  assert.deepEqual(suggestion.available("merged"), []);
  assert.deepEqual(suggestion.available("closed"), [
    "returnToDraft",
    "openForReview",
  ]);
  assert.equal(
    suggestion.refusal("closed", "update"),
    "This suggestion was closed; open a new one.",
  );
});

void test("ready is evidence: nobody can choose it and it cannot be moved away", () => {
  assert.deepEqual(refinement.targets("move"), chosenRefinementStates);
  assert.equal(refinement.available("ready").length, 0);
  assert.deepEqual(refinement.available("draft"), ["move"]);
  assert.deepEqual([...chosenRefinementStates, "ready"], [...refinementStates]);
  const option = commandSchema.options.find(
    (o) => o.shape.type.value === "updateWorkItem",
  )!;
  const chosen = (
    option.shape as unknown as {
      refinementState: { unwrap(): { options: string[] } };
    }
  ).refinementState.unwrap().options;
  assert.deepEqual(chosen, [...chosenRefinementStates]);
});

// The guard for new work: a status or state column cannot be added without
// saying how it moves.
void test("every stored status is a declared machine or names its owner", () => {
  const columns = new Map<string, readonly string[] | null>();
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) {
      if (/_(status|state)$/.test(value.enumName))
        columns.set(value.enumName, value.enumValues);
    } else if (is(value, PgTable)) {
      const table = getTableConfig(value);
      for (const column of table.columns)
        if (
          column.columnType === "PgText" &&
          (column.name === "status" || column.name === "state")
        )
          columns.set(`${table.name}.${column.name}`, null);
    }
  }
  assert.deepEqual(
    [...columns.keys()].sort(),
    Object.keys(statusColumns).sort(),
    "Declare how the new status moves in contracts/state-machines.ts (a state machine, or the owner of its writes).",
  );
  for (const [name, values] of columns) {
    const entry = statusColumns[name]!;
    if (!("steps" in entry)) {
      assert.ok(entry.owner.length > 0, name);
      continue;
    }
    const machine: StateMachine<string, string> = entry;
    const stored = Object.keys(machine.states).filter(
      (state) => !machine.derived.includes(state),
    );
    if (values) assert.deepEqual(stored.sort(), [...values].sort(), name);
    for (const [step, { from, to }] of Object.entries(machine.steps))
      for (const state of [
        ...from,
        ...(typeof to === "string" ? [to] : (to ?? [])),
      ])
        assert.ok(state in machine.states, `${name}: ${step} names ${state}`);
  }
});
