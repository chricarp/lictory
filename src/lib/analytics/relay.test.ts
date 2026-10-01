import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { posthogHosts, relayTarget } from "./relay";

void describe("PostHog first-party relay", () => {
  void test("cloud ingestion and SDK assets go to their regional hosts", () => {
    const eu = "https://eu.i.posthog.com";
    assert.equal(
      relayTarget("/e/", "?ip=0&ver=1", eu),
      "https://eu.i.posthog.com/e/?ip=0&ver=1",
    );
    assert.equal(
      relayTarget("/static/array.js", "", eu),
      "https://eu-assets.i.posthog.com/static/array.js",
    );
    assert.equal(
      relayTarget("/array/phc_x/config.js", "", "https://us.i.posthog.com/"),
      "https://us-assets.i.posthog.com/array/phc_x/config.js",
    );
    assert.equal(posthogHosts(eu).ui, "https://eu.posthog.com");
  });

  void test("self-hosted instances serve everything from one origin", () => {
    const host = "https://analytics.example.com";
    assert.equal(
      relayTarget("/static/array.js", "", host),
      "https://analytics.example.com/static/array.js",
    );
    assert.equal(posthogHosts(host).ui, host);
  });

  void test("the relay cannot be steered to another origin or path", () => {
    const eu = "https://eu.i.posthog.com";
    assert.equal(relayTarget("//evil.example.com/x", "", eu), null);
    assert.equal(relayTarget("/../admin", "", eu), null);
    assert.equal(relayTarget("/e/@evil.example.com", "", eu), null);
    assert.equal(relayTarget("e", "", eu), null);
  });
});
