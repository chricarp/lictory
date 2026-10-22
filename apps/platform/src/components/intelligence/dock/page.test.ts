import assert from "node:assert/strict";
import { test } from "node:test";
import { pageOf } from "@lictory/platform/components/intelligence/dock/page";

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
  ];
  for (const [path, kind] of cases) assert.equal(pageOf(path).kind, kind, path);
});
