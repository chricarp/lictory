import assert from "node:assert/strict";
import { test } from "node:test";
import { pageOf } from "@lictory/platform/components/intelligence/dock/page";

void test("the dock recognizes where the person is from the route", () => {
  const cases: [string, string][] = [
    ["/app/acme", "home"],
    ["/app/acme/inbox", "inbox"],
    ["/app/acme/intelligence/123", "intelligence"],
    ["/app/acme/items/PAY-1", "item"],
    ["/app/acme/pay", "project"],
    ["/app/acme/pay/stories", "items"],
    ["/app/acme/pay/stories/PAY-142", "item"],
    ["/app/acme/pay/epics/PAY-7", "item"],
    ["/app/acme/pay/board", "board"],
    ["/app/acme/pay/iterations/abc", "iteration"],
    ["/app/acme/pay/teams/abc", "team"],
    ["/app/acme/pay/views/blocked", "view"],
    ["/app/acme/pay/settings/workflow", "project-settings"],
  ];
  for (const [path, kind] of cases) assert.equal(pageOf(path).kind, kind, path);
});
