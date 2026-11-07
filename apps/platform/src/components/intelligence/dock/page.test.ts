import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pageOf,
  pageSuggestions,
  spacePageSuggestions,
} from "@lictory/platform/components/intelligence/dock/page";

void test("the dock recognizes where the person is from the route", () => {
  const cases: [string, string][] = [
    ["/acme", "home"],
    ["/acme/inbox", "inbox"],
    ["/acme/intelligence/123", "intelligence"],
    ["/acme/items/PAY-1", "item"],
    ["/acme/pay", "project"],
    ["/acme/pay/stories", "items"],
    ["/acme/pay/stories/PAY-142", "item"],
    ["/acme/pay/epics/PAY-7", "item"],
    ["/acme/pay/board", "board"],
    ["/acme/pay/iterations/abc", "iteration"],
    ["/acme/pay/teams/abc", "team"],
    ["/acme/pay/views/blocked", "view"],
    ["/acme/pay/settings/workflow", "project-settings"],
    ["/acme/spaces", "spaces"],
    ["/acme/spaces/handbook", "space"],
    ["/acme/spaces/handbook/pages/p1", "space-page"],
    ["/acme/spaces/handbook/pages/p1/history", "page-history"],
    ["/acme/spaces/handbook/pull-requests", "space-pull-requests"],
    ["/acme/spaces/handbook/settings", "space-settings"],
  ];
  for (const [path, kind] of cases) assert.equal(pageOf(path).kind, kind, path);
  assert.deepEqual(pageOf("/acme/spaces/handbook/pages/p1"), {
    kind: "space-page",
    label: "Page",
    space: "handbook",
    pageId: "p1",
  });
  assert.equal(pageOf("/acme/spaces/caf%C3%A9").space, "café");
  assert.deepEqual(pageOf("/acme/spaces/100%25off%/pages/p1"), {
    kind: "space-page",
    label: "Page",
    space: "100%25off%",
    pageId: "p1",
  });
});

void test("pages of Lictory Spaces get page suggestions, comparing with the work they mention", () => {
  const labels = spacePageSuggestions({
    items: [{ key: "PAY-2" }, { key: "PAY-3" }, { key: "PAY-4" }],
  }).map((s) => s.label);
  assert.deepEqual(labels, [
    "Summarize this page",
    "Draft proposals from this page",
    "Which work items does this page mention?",
    "Compare with PAY-2",
    "Compare with PAY-3",
  ]);
  assert.equal(spacePageSuggestions({ items: [] }).length, 3);
  for (const kind of ["spaces", "space", "page-history"] as const)
    assert.ok(
      pageSuggestions(kind, undefined).every(
        (s) => !s.prompt.includes("attention today"),
      ),
      kind,
    );
});
