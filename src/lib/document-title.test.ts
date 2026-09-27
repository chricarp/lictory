import assert from "node:assert/strict";
import { test } from "node:test";
import { workspaceTitle } from "./document-title";
import type { Project } from "./work-items";

const organization = { name: "Northstar" };
const project = { key: "PAY", name: "Payments" } as Project;
const title = (
  pathname: string,
  extra: Partial<Parameters<typeof workspaceTitle>[1]> = {},
) =>
  workspaceTitle(pathname, {
    organization,
    project: undefined,
    item: undefined,
    ...extra,
  });

void test("organization surfaces name the organization", () => {
  assert.equal(title("/app/northstar"), "Northstar · Lictory");
  assert.equal(title("/app/northstar/inbox"), "Inbox · Northstar · Lictory");
  assert.equal(
    title("/app/northstar/settings"),
    "Settings · Northstar · Lictory",
  );
  assert.equal(title("/app/northstar/account"), "Account · Lictory");
});

void test("project surfaces name the project", () => {
  assert.equal(title("/app/northstar/pay", { project }), "Payments · Lictory");
  assert.equal(
    title("/app/northstar/pay/epics", { project }),
    "Epics · Payments · Lictory",
  );
  assert.equal(
    title("/app/northstar/pay/stories?status=draft".split("?")[0]!, {
      project,
    }),
    "Work items · Payments · Lictory",
  );
  assert.equal(
    title("/app/northstar/pay/reviews", { project }),
    "Needs my review · Payments · Lictory",
  );
  assert.equal(
    title("/app/northstar/pay/views/blocked", { project }),
    "Blocked · Payments · Lictory",
  );
});

void test("item pages lead with the identifier and title", () => {
  assert.equal(
    title("/app/northstar/pay/epics/PAY-12", {
      project,
      item: { number: 12, title: "Partial cancellation" },
    }),
    "PAY-12 Partial cancellation · Payments · Lictory",
  );
  // Before the store has the item, the identifier from the URL is enough.
  assert.equal(
    title("/app/northstar/pay/stories/pay-3", { project }),
    "PAY-3 · Payments · Lictory",
  );
  // A UUID right after creation adds nothing useful.
  assert.equal(
    title("/app/northstar/pay/stories/3f1a8e1e-9d1c-4d34-9a3e-0f1e2d3c4b5a", {
      project,
    }),
    "Payments · Lictory",
  );
  assert.equal(title("/app/northstar/items/pay-7"), "PAY-7 · Lictory");
});
