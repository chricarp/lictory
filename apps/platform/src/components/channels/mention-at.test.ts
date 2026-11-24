import assert from "node:assert/strict";
import { test } from "node:test";
import { remarkMentionAt } from "@lictory/platform/components/channels/mention-at";

void test("a mention's @ moves into its link, so it renders as one chip", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Thanks @" },
          {
            type: "link",
            url: "agent:forge",
            children: [{ type: "text", value: "forge" }],
          },
          { type: "text", value: " and email@" },
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", value: "site" }],
          },
        ],
      },
    ],
  };
  remarkMentionAt()(tree);
  const [paragraph] = tree.children;
  assert.deepEqual(paragraph!.children, [
    { type: "text", value: "Thanks " },
    {
      type: "link",
      url: "agent:forge",
      children: [
        { type: "text", value: "@" },
        { type: "text", value: "forge" },
      ],
    },
    { type: "text", value: " and email@" },
    {
      type: "link",
      url: "https://example.com",
      children: [{ type: "text", value: "site" }],
    },
  ]);
});
