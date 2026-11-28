import assert from "node:assert/strict";
import { test } from "node:test";
import { slackCredentialProblems } from "@lictory/core/channels/slack/credentials";

const valid = {
  appId: "A0123ABCDEF",
  clientId: "1234567890.1234567890",
  clientSecret: "0123456789abcdef0123456789abcdef",
  signingSecret: "fedcba9876543210fedcba9876543210",
};

void test("well-formed credentials have no problems", () => {
  assert.deepEqual(slackCredentialProblems(valid), []);
  assert.deepEqual(
    slackCredentialProblems({ ...valid, appId: ` ${valid.appId} ` }),
    [],
  );
});

void test("each malformed field is named, in form order", () => {
  assert.deepEqual(
    slackCredentialProblems({
      ...valid,
      clientSecret: "not a secret",
      appId: "B123",
    }).map((p) => p.field),
    ["appId", "clientSecret"],
  );
  assert.match(
    slackCredentialProblems({ ...valid, signingSecret: "" })[0]!.message,
    /Signing Secret is not in Slack's format/,
  );
});
