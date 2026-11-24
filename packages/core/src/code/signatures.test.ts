import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  hmacSignature,
  verifyBitbucketWebhook,
  verifyGitHubWebhook,
  verifyGitLabWebhook,
} from "@lictory/core/code/signatures";

const secret = "0123456789abcdef0123456789abcdef";
const body = JSON.stringify({ action: "opened", number: 1 });

void test("GitHub: a body signed with the secret is accepted and named by its delivery", () => {
  const verified = verifyGitHubWebhook(
    {
      headers: {
        "x-hub-signature-256": hmacSignature(secret, body),
        "x-github-delivery": "d-1",
        "x-github-event": "pull_request",
      },
      body,
    },
    secret,
  );
  assert.deepEqual(verified, { deliveryId: "d-1", event: "pull_request" });
});

void test("GitHub: a wrong secret, a changed body, a missing or malformed signature are refused", () => {
  const headers = {
    "x-hub-signature-256": hmacSignature(secret, body),
    "x-github-delivery": "d-1",
    "x-github-event": "pull_request",
  };
  assert.equal(verifyGitHubWebhook({ headers, body }, "another-secret"), null);
  assert.equal(
    verifyGitHubWebhook({ headers, body: `${body} ` }, secret),
    null,
  );
  assert.equal(
    verifyGitHubWebhook(
      { headers: { ...headers, "x-hub-signature-256": undefined }, body },
      secret,
    ),
    null,
  );
  assert.equal(
    verifyGitHubWebhook(
      { headers: { ...headers, "x-hub-signature-256": "sha1=abc" }, body },
      secret,
    ),
    null,
  );
  // The legacy SHA-1 header alone is not accepted.
  assert.equal(
    verifyGitHubWebhook(
      {
        headers: {
          "x-hub-signature": `sha1=${createHmac("sha1", secret).update(body).digest("hex")}`,
          "x-github-delivery": "d-1",
          "x-github-event": "push",
        },
        body,
      },
      secret,
    ),
    null,
  );
  // An empty secret never verifies anything.
  assert.equal(
    verifyGitHubWebhook(
      {
        headers: { ...headers, "x-hub-signature-256": hmacSignature("", body) },
        body,
      },
      "",
    ),
    null,
  );
});

void test("GitLab: the token must equal the secret; the event UUID names the delivery", () => {
  const headers = {
    "x-gitlab-token": secret,
    "x-gitlab-event": "Merge Request Hook",
    "x-gitlab-event-uuid": "uuid-1",
  };
  assert.deepEqual(verifyGitLabWebhook({ headers, body }, secret), {
    deliveryId: "uuid-1",
    event: "Merge Request Hook",
  });
  assert.equal(
    verifyGitLabWebhook(
      { headers: { ...headers, "x-gitlab-token": "x" }, body },
      secret,
    ),
    null,
  );
  assert.equal(
    verifyGitLabWebhook(
      { headers: { ...headers, "x-gitlab-token": `${secret}0` }, body },
      secret,
    ),
    null,
  );
  assert.equal(
    verifyGitLabWebhook(
      { headers: { ...headers, "x-gitlab-token": undefined }, body },
      secret,
    ),
    null,
  );
});

void test("GitLab without an event UUID: identical retries share one delivery id", () => {
  const headers = { "x-gitlab-token": secret, "x-gitlab-event": "Push Hook" };
  const first = verifyGitLabWebhook({ headers, body }, secret);
  const again = verifyGitLabWebhook({ headers, body }, secret);
  assert.ok(first?.deliveryId.startsWith("body:"));
  assert.equal(first?.deliveryId, again?.deliveryId);
});

void test("Bitbucket: X-Hub-Signature is an HMAC of the body", () => {
  const headers = {
    "x-hub-signature": hmacSignature(secret, body),
    "x-request-uuid": "req-1",
    "x-event-key": "pullrequest:created",
  };
  assert.deepEqual(verifyBitbucketWebhook({ headers, body }, secret), {
    deliveryId: "req-1",
    event: "pullrequest:created",
  });
  assert.equal(verifyBitbucketWebhook({ headers, body }, "other"), null);
  assert.equal(
    verifyBitbucketWebhook(
      { headers: { ...headers, "x-request-uuid": undefined }, body },
      secret,
    ),
    null,
  );
});
