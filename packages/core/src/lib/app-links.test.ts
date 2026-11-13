import assert from "node:assert/strict";
import { test } from "node:test";
import { labelNamesTarget, parseAppLink } from "@lictory/core/lib/app-links";

const origin = "https://app.example.test";

void test("work item addresses in this organization name the item by key", () => {
  assert.deepEqual(parseAppLink("/acme/items/PAY-142", "acme"), {
    kind: "item",
    key: "PAY-142",
    whole: true,
  });
  assert.deepEqual(parseAppLink("/acme/pay/items/pay-7", "acme"), {
    kind: "item",
    key: "PAY-7",
    whole: true,
  });
  assert.deepEqual(
    parseAppLink(`${origin}/acme/items/PAY-142`, "acme", origin),
    { kind: "item", key: "PAY-142", whole: true },
  );
  // A place within the item (a pull request, a discussion) is not the item.
  assert.deepEqual(parseAppLink("/acme/pay/items/PAY-12?pr=1", "acme"), {
    kind: "item",
    key: "PAY-12",
    whole: false,
  });
  assert.equal(parseAppLink("/acme/items/PAY-142#x", "acme")?.whole, false);
});

void test("other organizations, hosts and routes are left alone", () => {
  assert.equal(parseAppLink("/globex/items/PAY-142", "acme"), undefined);
  assert.equal(
    parseAppLink("https://evil.test/acme/items/PAY-142", "acme", origin),
    undefined,
  );
  assert.equal(parseAppLink("//evil.test/acme/items/PAY-1", "acme"), undefined);
  assert.equal(parseAppLink("/acme/pay/board", "acme"), undefined);
  assert.equal(parseAppLink("/acme/items/not-a-key", "acme"), undefined);
  // The project segment must be the key's project.
  assert.equal(parseAppLink("/acme/ops/items/PAY-1", "acme"), undefined);
  assert.equal(parseAppLink("mailto:a@b.test", "acme"), undefined);
  assert.equal(parseAppLink(undefined, "acme"), undefined);
});

void test("page addresses keep the exact version they cite", () => {
  assert.deepEqual(parseAppLink("/acme/spaces/docs/pages/p_1", "acme"), {
    kind: "page",
    id: "p_1",
    whole: true,
  });
  assert.deepEqual(
    parseAppLink("/acme/spaces/docs/pages/p_1?commit=c_9", "acme"),
    { kind: "page", id: "p_1", commitId: "c_9", whole: true },
  );
  assert.equal(
    parseAppLink("/acme/spaces/docs/pages/p_1/history", "acme")?.whole,
    false,
  );
  assert.equal(
    parseAppLink("/acme/spaces/docs/pages/p_1?comment=x", "acme")?.whole,
    false,
  );
  assert.equal(parseAppLink("/acme/spaces/docs", "acme"), undefined);
});

void test("a chip replaces link text only when the text names the target", () => {
  const item = { key: "LICT-6", title: "Track a story through an iteration" };
  assert.equal(labelNamesTarget("LICT-6", item), true);
  assert.equal(
    labelNamesTarget("LICT-6, Track a story through an iteration", item),
    true,
  );
  assert.equal(
    labelNamesTarget("track a story through an iteration", item),
    true,
  );
  assert.equal(labelNamesTarget("LICT-60", item), false);
  assert.equal(labelNamesTarget("blocking discussion", item), false);
  assert.equal(labelNamesTarget("Failure behavior", item), false);
  assert.equal(
    labelNamesTarget("/acme/items/LICT-6", item, "/acme/items/LICT-6"),
    true,
  );

  const page = { title: "Test" };
  assert.equal(labelNamesTarget("Test", page), true);
  assert.equal(labelNamesTarget("Test (version 3)", page), true);
  assert.equal(labelNamesTarget("Testing notes", page), false);
  assert.equal(labelNamesTarget("the test plan", page), false);
});
