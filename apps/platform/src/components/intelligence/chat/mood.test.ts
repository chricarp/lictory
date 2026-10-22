import assert from "node:assert/strict";
import { test } from "node:test";
import { ASK_QUESTIONS, RECOMMEND_ACTION } from "@lictory/core/intelligence/chat/shared";
import { answerMood } from "@lictory/platform/components/intelligence/chat/mood";

type Parts = Parameters<typeof answerMood>[0]["parts"];

const tool = (name: string, state: string, extra: object = {}) =>
  ({
    type: `tool-${name}`,
    toolCallId: `${name}-${state}`,
    state,
    input: {},
    ...extra,
  }) as unknown as Parts[number];
const text = (value: string, state: "streaming" | "done") =>
  ({ type: "text", text: value, state }) as Parts[number];
const mood = (parts: Parts, live = true) => answerMood({ parts }, live);

void test("everything a live answer does is one working state", () => {
  assert.equal(mood([]), "working");
  assert.equal(mood([tool("listWorkItems", "input-available")]), "working");
  assert.equal(mood([tool("createWorkItem", "input-streaming")]), "working");
  assert.equal(
    mood([tool("listWorkItems", "output-available"), text("Two", "streaming")]),
    "working",
  );
  // Preparing a question is still elaboration until it is asked.
  assert.equal(mood([tool(ASK_QUESTIONS, "input-streaming")]), "working");
});

void test("questions, recommendations and approvals waiting for the person are asking", () => {
  assert.equal(mood([tool(ASK_QUESTIONS, "input-available")], false), "asking");
  assert.equal(
    mood([tool(RECOMMEND_ACTION, "input-available")], false),
    "asking",
  );
  assert.equal(
    mood(
      [tool("createWorkItem", "approval-requested", { approval: { id: "a" } })],
      false,
    ),
    "asking",
  );
});

void test("answered and finished answers have no mood of their own", () => {
  assert.equal(
    mood(
      [tool(ASK_QUESTIONS, "output-available"), text("Thanks", "done")],
      false,
    ),
    undefined,
  );
  assert.equal(
    mood(
      [
        tool("createWorkItem", "approval-responded", {
          approval: { id: "a", approved: true },
        }),
      ],
      true,
    ),
    "working",
  );
  assert.equal(
    mood([tool("createWorkItem", "output-available")], false),
    undefined,
  );
});
