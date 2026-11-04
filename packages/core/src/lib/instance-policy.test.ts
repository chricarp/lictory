import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountCreationProblem,
  accountOrigin,
  canCreateOrganization,
  instancePolicy,
  isInstanceAdmin,
  type AccountOrigin,
} from "@lictory/core/lib/instance-policy";

void test("an unconfigured installation takes invitations only and reserves organizations to administrators", () => {
  assert.deepEqual(instancePolicy({}), {
    signUpMode: "invite",
    allowedEmailDomains: [],
    organizationCreation: "administrators",
  });
  // Empty variables count as unset.
  assert.equal(
    instancePolicy({ LICTORY_SIGNUP_MODE: " " }).signUpMode,
    "invite",
  );
});

void test("invalid policy settings stop the server instead of opening it", () => {
  assert.throws(
    () => instancePolicy({ LICTORY_SIGNUP_MODE: "public" }),
    /LICTORY_SIGNUP_MODE must be one of: invite, closed, open/,
  );
  assert.throws(
    () => instancePolicy({ LICTORY_ORGANIZATION_CREATION: "admins" }),
    /LICTORY_ORGANIZATION_CREATION/,
  );
  assert.throws(
    () => instancePolicy({ LICTORY_ALLOWED_EMAIL_DOMAINS: "acme" }),
    /not a domain/,
  );
  assert.deepEqual(
    instancePolicy({
      LICTORY_ALLOWED_EMAIL_DOMAINS: "Acme.com, @eu.acme.com acme.com",
    }).allowedEmailDomains,
    ["acme.com", "eu.acme.com"],
  );
});

const decide = (
  env: Record<string, string>,
  origin: AccountOrigin,
  email: string,
  invited = false,
) =>
  accountCreationProblem(instancePolicy(env), { origin, email, invited })
    ?.code ?? null;

void test("each sign-up mode decides self-service accounts", () => {
  const open = { LICTORY_SIGNUP_MODE: "open" };
  const invite = { LICTORY_SIGNUP_MODE: "invite" };
  const closed = { LICTORY_SIGNUP_MODE: "closed" };
  assert.equal(decide(open, "self-service", "a@x.test"), null);
  assert.equal(
    decide(invite, "self-service", "a@x.test"),
    "signup_invitation_required",
  );
  assert.equal(decide(invite, "self-service", "a@x.test", true), null);
  // Closed means closed, even with an invitation.
  assert.equal(
    decide(closed, "self-service", "a@x.test", true),
    "signup_closed",
  );
});

void test("administrators create any account; the company identity provider is the directory", () => {
  const closed = {
    LICTORY_SIGNUP_MODE: "closed",
    LICTORY_ALLOWED_EMAIL_DOMAINS: "acme.com",
  };
  assert.equal(decide(closed, "administrator", "contractor@else.test"), null);
  assert.equal(decide(closed, "identity-provider", "ada@acme.com"), null);
  // Domains still bound what the provider may provision.
  assert.equal(
    decide(closed, "identity-provider", "ada@else.test"),
    "signup_domain_not_allowed",
  );
});

void test("allowed domains apply to self-service accounts before the mode", () => {
  const env = {
    LICTORY_SIGNUP_MODE: "open",
    LICTORY_ALLOWED_EMAIL_DOMAINS: "acme.com",
  };
  assert.equal(decide(env, "self-service", "Ada@ACME.com"), null);
  assert.equal(
    decide(env, "self-service", "ada@acme.com.evil.test"),
    "signup_domain_not_allowed",
  );
  assert.equal(
    decide(env, "self-service", "ada@sub.acme.com"),
    "signup_domain_not_allowed",
  );
});

void test("Better Auth provisioning sources map to account origins", () => {
  assert.equal(accountOrigin({ method: "admin" }, "oidc"), "administrator");
  assert.equal(
    accountOrigin({ method: "oauth", oauth: { providerId: "oidc" } }, "oidc"),
    "identity-provider",
  );
  assert.equal(
    accountOrigin({ method: "oauth", oauth: { providerId: "google" } }, "oidc"),
    "self-service",
  );
  assert.equal(
    accountOrigin({ method: "email-password" }, "oidc"),
    "self-service",
  );
});

void test("organization creation follows the policy, and deactivated accounts create nothing", () => {
  const reserved = instancePolicy({});
  const everyone = instancePolicy({
    LICTORY_ORGANIZATION_CREATION: "everyone",
  });
  const member = { instanceAdmin: false, deactivatedAt: null };
  const admin = { instanceAdmin: true, deactivatedAt: null };
  const deactivatedAdmin = { instanceAdmin: true, deactivatedAt: new Date() };
  assert.equal(canCreateOrganization(reserved, member), false);
  assert.equal(canCreateOrganization(reserved, admin), true);
  assert.equal(canCreateOrganization(everyone, member), true);
  assert.equal(canCreateOrganization(everyone, deactivatedAdmin), false);
  assert.equal(isInstanceAdmin(deactivatedAdmin), false);
  assert.equal(canCreateOrganization(reserved, null), false);
});
