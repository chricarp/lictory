import assert from "node:assert/strict";
import { test } from "node:test";
import { APICallError, RetryError } from "ai";
import {
  describeProviderError,
  isProviderError,
} from "@lictory/core/ai/analyzer";

const call = (statusCode?: number) =>
  new APICallError({
    message: "provider failure with a secret body",
    url: "https://api.example.test/v1/responses",
    requestBodyValues: {},
    statusCode,
  });
const retried = (last: unknown) =>
  new RetryError({
    message: "Failed after 3 attempts.",
    reason: "maxRetriesExceeded",
    errors: [last, last, last],
  });

void test("provider failures say what to do, after the SDK's retries too", () => {
  assert.match(
    describeProviderError(retried(call()), "Retry"),
    /could not reach the AI provider\. Retry later/,
  );
  assert.match(
    describeProviderError(retried(call(401)), "Retry"),
    /rejected the configured credentials/,
  );
  assert.match(
    describeProviderError(call(429), "Retry"),
    /rate limiting requests\. Retry in a few minutes/,
  );
  assert.match(
    describeProviderError(call(404), "Retry"),
    /configured AI model is unavailable/,
  );
  // Raw provider messages never reach people.
  assert.doesNotMatch(describeProviderError(call(500), "Retry"), /secret/);
});

void test("only AI provider calls count as provider failures", () => {
  assert.equal(isProviderError(call(500)), true);
  assert.equal(isProviderError(retried(call())), true);
  assert.equal(isProviderError(new Error("database unavailable")), false);
});
