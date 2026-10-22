import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  previewKind,
  socialMetadata,
} from "@lictory/marketing/lib/social-preview";

void describe("public social previews", () => {
  for (const [path, kind] of [
    ["/app/secret/pay/epics/PAY-1", "epic"],
    ["/app/secret/pay/stories/PAY-2", "story"],
    ["/app/secret/items/PAY-2", "item"],
    ["/app/secret/teams/id/board", "board"],
    ["/app/secret/teams/id/backlog", "backlog"],
    ["/app/secret/teams/id/iterations/id", "iteration"],
    ["/app/secret/pay/reviews", "reviews"],
    ["/app/secret/pay/views/id", "view"],
    ["/app/secret/pay", "project"],
    ["/app/secret/settings", "workspace"],
    ["/app/secret/inbox?title=Confidential", "workspace"],
  ] as const) {
    void test(`classifies ${path} without looking up an entity`, () => {
      assert.equal(previewKind(path), kind);
    });
  }

  void test("metadata never echoes identifiers, query strings, or workspace names", () => {
    const first = socialMetadata(
      previewKind(
        "/app/acquisition/secret/stories/SECRET-42?title=Merger#comment",
      ),
    );
    const second = socialMetadata(
      previewKind("/app/public/demo/stories/DEMO-1"),
    );
    assert.deepEqual(first, second);
    assert.doesNotMatch(
      JSON.stringify(first),
      /acquisition|secret|SECRET-42|Merger|comment/,
    );
    assert.deepEqual(first.robots, { index: false, follow: false });
  });
});
