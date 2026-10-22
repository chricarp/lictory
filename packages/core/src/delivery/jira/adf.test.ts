import assert from "node:assert/strict";
import { test } from "node:test";

import { markdownToAdf } from "@lictory/core/delivery/jira/adf";

void test("specifications convert to ADF with acceptance criteria as a task list", () => {
  const doc = markdownToAdf(
    [
      "## Problem",
      "",
      "Retries **must** reuse the `txId`. See [spec](https://x.test).",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] Retry reuses the ID",
      "- [x] Timeout after 30s",
    ].join("\n"),
  );
  assert.equal(doc.type, "doc");
  assert.equal(doc.version, 1);
  const [heading, paragraph, , tasks] = doc.content;
  assert.deepEqual(heading, {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Problem" }],
  });
  assert.deepEqual(paragraph!.content, [
    { type: "text", text: "Retries " },
    { type: "text", text: "must", marks: [{ type: "strong" }] },
    { type: "text", text: " reuse the " },
    { type: "text", text: "txId", marks: [{ type: "code" }] },
    { type: "text", text: ". See " },
    {
      type: "text",
      text: "spec",
      marks: [{ type: "link", attrs: { href: "https://x.test" } }],
    },
    { type: "text", text: "." },
  ]);
  assert.equal(tasks!.type, "taskList");
  assert.deepEqual(
    tasks!.content!.map((i) => [i.attrs!.state, i.content![0]!.text]),
    [
      ["TODO", "Retry reuses the ID"],
      ["DONE", "Timeout after 30s"],
    ],
  );
  const ids = tasks!.content!.map((i) => i.attrs!.localId);
  assert.equal(new Set([tasks!.attrs!.localId, ...ids]).size, 3);
});

void test("lists, code, quotes and tables map to their ADF nodes", () => {
  const doc = markdownToAdf(
    "1. one\n2. two\n\n```ts\nconst a = 1;\n```\n\n> note\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
  );
  assert.deepEqual(
    doc.content.map((n) => n.type),
    ["orderedList", "codeBlock", "blockquote", "table"],
  );
  assert.deepEqual(doc.content[1], {
    type: "codeBlock",
    attrs: { language: "ts" },
    content: [{ type: "text", text: "const a = 1;" }],
  });
  const table = doc.content[3]!;
  assert.equal(table.content![0]!.content![0]!.type, "tableHeader");
  assert.equal(table.content![1]!.content![0]!.type, "tableCell");
});

void test("empty specifications produce a valid empty document", () => {
  assert.deepEqual(markdownToAdf(""), { type: "doc", version: 1, content: [] });
});
