import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { configureAnalytics } from "@lictory/core/lib/analytics/client";
import { trackCtaClick } from "@lictory/marketing/lib/cta-analytics";
import { tryUrl } from "@lictory/marketing/lib/get-started";

const global = globalThis as { window?: unknown };

function fakePostHog() {
  const captured: [string, Record<string, unknown>][] = [];
  global.window = {
    posthog: {
      __loaded: true,
      capture: (event: string, properties: Record<string, unknown>) =>
        captured.push([event, properties]),
    },
  };
  return captured;
}

afterEach(() => {
  delete global.window;
  configureAnalytics(null);
});

void test("a call to action click reports which one, where, on which kind of page, and its destination", () => {
  configureAnalytics({
    projectToken: "phc_test",
    host: "https://eu.i.posthog.com",
    consent: "cookieless",
  });
  const captured = fakePostHog();
  trackCtaClick(
    { cta: "get_started", placement: "final", page: "comparison" },
    tryUrl,
  );
  assert.deepEqual(captured, [
    [
      "cta_clicked",
      {
        cta: "get_started",
        placement: "final",
        page_type: "comparison",
        href: tryUrl,
        analytics_version: 1,
        source: "client",
      },
    ],
  ]);
});

void test("without analytics settings a click sends nothing", () => {
  configureAnalytics(null);
  const captured = fakePostHog();
  trackCtaClick(
    { cta: "github", placement: "open_source", page: "home" },
    tryUrl,
  );
  assert.deepEqual(captured, []);
});
