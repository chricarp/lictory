import assert from "node:assert/strict";
import { test } from "node:test";
import { posthogServerConfig } from "@lictory/core/lib/analytics/config";
import { createLogProvider } from "@lictory/core/lib/otel";

const server = {
  POSTHOG_PROJECT_TOKEN: "phc_server",
  POSTHOG_HOST: "https://eu.i.posthog.com",
};

void test("server log export is on with only the server PostHog names", async () => {
  assert.deepEqual(posthogServerConfig(server), {
    token: "phc_server",
    host: "https://eu.i.posthog.com",
  });
  const provider = createLogProvider(server);
  assert.ok(provider);
  await provider.shutdown();
});

void test("server analytics stays off without the server PostHog names", () => {
  const unset = [
    {},
    { POSTHOG_PROJECT_TOKEN: "", POSTHOG_HOST: "  " },
    { POSTHOG_PROJECT_TOKEN: "phc_server" },
    { POSTHOG_HOST: "https://eu.i.posthog.com" },
    // Build-time names belong to browser bundles; server code ignores them.
    {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_public",
      NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
      VITE_POSTHOG_PROJECT_TOKEN: "phc_public",
      VITE_POSTHOG_HOST: "https://eu.i.posthog.com",
    },
  ];
  for (const source of unset) {
    assert.equal(posthogServerConfig(source), undefined);
    assert.equal(createLogProvider(source), null);
  }
});
