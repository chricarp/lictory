import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeOrganizationHandle,
  organizationHandleProblem,
  suggestOrganizationHandle,
} from "@lictory/core/lib/organization-handles";

void test("organization handles normalize to a single URL namespace", () => {
  assert.equal(normalizeOrganizationHandle("  Acme-Team  "), "acme-team");
  for (const handle of ["acme", "acme-team", "acme_team", "acme123"])
    assert.equal(organizationHandleProblem(handle), null);
});

void test("organization handles reject unsafe URLs and static app routes", () => {
  for (const handle of [
    "ab",
    "1acme",
    "acme/team",
    "acme?x",
    "acme#x",
    "acme%2f",
    "acme team",
    "acme--team",
    "acme-_team",
    "acme_",
    "a".repeat(31),
    "account",
    "invitation",
    "new-organization",
    "sign-in",
    "sign-up",
    "forgot-password",
    "reset-password",
    "verify-email",
    "welcome",
    "auth-error",
    "api",
    "zero",
    "relay",
    "assets",
    "brand",
    "illustrations",
  ])
    assert.notEqual(organizationHandleProblem(handle), null, handle);
});

void test("organization handle suggestions are readable and editable", () => {
  assert.equal(suggestOrganizationHandle("Acme Inc."), "acme-inc");
  assert.equal(suggestOrganizationHandle("Équipe de Zoë"), "equipe-de-zoe");
  assert.equal(suggestOrganizationHandle("123 Acme"), "acme");
  const long = suggestOrganizationHandle("a".repeat(29) + " testing");
  assert.equal(organizationHandleProblem(long), null);
});
