import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatReference,
  parseReferenceTarget,
  referencesInDocument,
  referencesInMarkdown,
} from "@lictory/core/contracts/references";

void test("round-trip through Markdown keeps identity and pinned commits", () => {
  const markdown = [
    formatReference({ kind: "item", id: "w1" }, "PAY-2"),
    formatReference(
      { kind: "page", id: "p1", commitId: "c9" },
      "Payments [service]",
    ),
    formatReference({ kind: "decision", id: "d1" }, "Reuse the ID"),
    "[[page:p2]]",
  ].join(" and ");
  assert.deepEqual(referencesInMarkdown(markdown), [
    { kind: "item", id: "w1", label: "PAY-2" },
    { kind: "page", id: "p1", commitId: "c9", label: "Payments service" },
    { kind: "decision", id: "d1", label: "Reuse the ID" },
    { kind: "page", id: "p2", label: "p2" },
  ]);
});

void test("code, mentions and ordinary links are not references", () => {
  const markdown =
    "`[x](item:a)`\n\n```md\n[y](page:b)\n```\n\n@[ada](mention:u1) [docs](https://example.com) [z](item:c@d)";
  assert.deepEqual(referencesInMarkdown(markdown), []);
  assert.equal(parseReferenceTarget("item:c@d"), undefined);
  assert.deepEqual(parseReferenceTarget("page:p@c"), {
    kind: "page",
    id: "p",
    commitId: "c",
  });
});

void test("document references carry their top-level block, once per block", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "b1" },
        content: [
          { type: "workItemRef", attrs: { workItemId: "w1", key: "PAY-1" } },
          { type: "workItemRef", attrs: { workItemId: "w1", key: "PAY-1" } },
        ],
      },
      {
        type: "bulletList",
        attrs: { id: "b2" },
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "pageRef", attrs: { pageId: "p1" } }],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(referencesInDocument(doc), [
    { kind: "item", id: "w1", blockId: "b1" },
    { kind: "page", id: "p1", blockId: "b2" },
  ]);
});
