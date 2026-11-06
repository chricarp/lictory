import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { MouseEvent, ReactElement } from "react";

import { configureAnalytics } from "@lictory/core/lib/analytics/client";
import { TrackedLink } from "@lictory/marketing/components/marketing/tracked-link";
import { repositoryUrl } from "@lictory/marketing/lib/get-started";

const global = globalThis as { window?: unknown };

afterEach(() => {
  delete global.window;
  configureAnalytics(null);
});

void test("clicking a tracked link reports the CTA and still runs its own handler", () => {
  configureAnalytics({
    projectToken: "phc_test",
    host: "https://eu.i.posthog.com",
    consent: "cookieless",
  });
  const captured: [string, Record<string, unknown>][] = [];
  global.window = {
    posthog: {
      __loaded: true,
      capture: (event: string, properties: Record<string, unknown>) =>
        captured.push([event, properties]),
    },
  };
  let handled = 0;
  const link = TrackedLink({
    href: repositoryUrl,
    tracking: { cta: "github", placement: "open_source" },
    onClick: () => handled++,
    children: "View on GitHub",
  }) as ReactElement<{
    href: string;
    onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  }>;

  // The destination is untouched and the click is not prevented.
  assert.equal(link.props.href, repositoryUrl);
  let prevented = false;
  link.props.onClick({
    preventDefault: () => (prevented = true),
  } as unknown as MouseEvent<HTMLAnchorElement>);

  assert.equal(handled, 1);
  assert.equal(prevented, false);
  assert.deepEqual(
    captured.map(([event, { cta, placement, href }]) => ({
      event,
      cta,
      placement,
      href,
    })),
    [
      {
        event: "cta_clicked",
        cta: "github",
        placement: "open_source",
        href: repositoryUrl,
      },
    ],
  );
});
