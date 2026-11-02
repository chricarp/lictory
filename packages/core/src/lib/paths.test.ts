import assert from "node:assert/strict";
import { test } from "node:test";
import { paths, safeCallbackPath } from "@lictory/core/lib/paths";

void test("workspace paths live at the root of the app host", () => {
  assert.equal(paths.org("acme"), "/acme");
  assert.equal(paths.inbox("acme"), "/acme/inbox");
  assert.equal(paths.account(), "/account");
  assert.equal(
    paths.account("/acme/inbox"),
    "/account?returnTo=%2Facme%2Finbox",
  );
  assert.equal(paths.newOrganization, "/new-organization");
  assert.equal(paths.items("acme", "PAY"), "/acme/pay/items");
  assert.equal(
    paths.item("acme", "PAY", "PAY-12", new URLSearchParams("pr=1")),
    "/acme/pay/items/PAY-12?pr=1",
  );
  assert.equal(paths.board("acme", "PAY", "core"), "/acme/pay/board?team=core");
  assert.equal(
    paths.projectSettings("acme", "PAY", "teams"),
    "/acme/pay/settings/teams",
  );
});

void test("callbacks accept only relative paths inside the app", () => {
  for (const [input, expected] of [
    ["/acme/pay/epics?item=1#x", "/acme/pay/epics?item=1#x"],
    ["/account", "/account"],
    ["/", "/"],
    ["/invitation?id=abc", "/invitation?id=abc"],
    // Links from the previous URL layout.
    ["/app", "/"],
    ["/app/acme/inbox", "/acme/inbox"],
    ["/app/account?returnTo=%2F", "/account?returnTo=%2F"],
  ] as const)
    assert.equal(safeCallbackPath(input), expected, input);
  for (const input of [
    null,
    undefined,
    "",
    "acme",
    "https://evil.example/acme",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
    "/sign-in?callbackUrl=/x",
    "/welcome",
    "/api/auth/sign-out",
    "/zero/sync",
    "/app/sign-in",
  ])
    assert.equal(safeCallbackPath(input), "/", String(input));
});
