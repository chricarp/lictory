import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyticsSettings,
  legalLinks,
  publicConfigTag,
  readPublicConfig,
  type PublicConfig,
} from "@lictory/core/lib/public-config";

// A document holding exactly what the server wrote, read the way a browser
// parses a <script type="application/json"> data block.
function documentWith(html: string) {
  const match =
    /<script type="application\/json" id="([^"]+)">(.*?)<\/script>/s.exec(html);
  return {
    getElementById: (id: string) =>
      match?.[1] === id ? ({ textContent: match[2]! } as HTMLElement) : null,
  };
}

void test("the browser reads back the configuration the server wrote", () => {
  const config: PublicConfig = {
    siteUrl: "https://www.example.org",
    legal: {
      termsUrl: "https://www.example.org/legal/terms",
      privacyUrl: "https://www.example.org/privacy",
    },
    analytics: {
      projectToken: "phc_test",
      host: "https://eu.i.posthog.com",
      consent: "strict",
    },
  };
  assert.deepEqual(
    readPublicConfig(
      documentWith(publicConfigTag(config)),
      "https://app.example.org",
    ),
    config,
  );
});

void test("configuration values can never close the element or inject markup", () => {
  const tag = publicConfigTag({
    siteUrl: "https://example.org",
    legal: { termsUrl: null, privacyUrl: null },
    analytics: {
      projectToken: "</script><script>alert(1)</script>&",
      host: "https://posthog.example.org",
      consent: "cookieless",
    },
  });
  assert.equal(tag.match(/<\/script>/g)?.length, 1);
  assert.ok(!tag.includes("<script>alert"));
  assert.equal(
    readPublicConfig(documentWith(tag), "https://app.example.org").analytics
      ?.projectToken,
    "</script><script>alert(1)</script>&",
  );
});

void test("a document without valid configuration falls back to the page origin, no legal links and no analytics", () => {
  const origin = "https://app.example.org";
  const fallback = {
    siteUrl: origin,
    legal: { termsUrl: null, privacyUrl: null },
    analytics: null,
  };
  assert.deepEqual(readPublicConfig(documentWith(""), origin), fallback);
  for (const body of [
    "not json",
    "null",
    '{"siteUrl":"javascript:alert(1)","legal":{"termsUrl":"javascript:alert(1)","privacyUrl":"/privacy"},"analytics":{"projectToken":"x","host":"ftp://x"}}',
    '{"siteUrl":"","analytics":{"projectToken":"","host":"https://eu.i.posthog.com"}}',
  ])
    assert.deepEqual(
      readPublicConfig(
        documentWith(
          `<script type="application/json" id="lictory-config">${body}</script>`,
        ),
        origin,
      ),
      fallback,
    );
});

void test("analytics are configured only when both settings are non-empty", () => {
  assert.equal(analyticsSettings({}), null);
  assert.equal(
    analyticsSettings({
      POSTHOG_PROJECT_TOKEN: " ",
      POSTHOG_HOST: "https://h",
    }),
    null,
  );
  assert.equal(analyticsSettings({ POSTHOG_PROJECT_TOKEN: "phc" }), null);
  assert.deepEqual(
    analyticsSettings({
      POSTHOG_PROJECT_TOKEN: " phc ",
      POSTHOG_HOST: "https://eu.i.posthog.com",
    }),
    {
      projectToken: "phc",
      host: "https://eu.i.posthog.com",
      consent: "cookieless",
    },
  );
  assert.equal(
    analyticsSettings({
      POSTHOG_PROJECT_TOKEN: "phc",
      POSTHOG_HOST: "https://eu.i.posthog.com",
      ANALYTICS_CONSENT: "strict",
    })?.consent,
    "strict",
  );
});

void test("legal links come only from the operator's own absolute URLs", () => {
  // Unset: no links at all, never a fallback to another operator's terms.
  assert.deepEqual(legalLinks({}), { termsUrl: null, privacyUrl: null });
  assert.deepEqual(
    legalLinks({
      LEGAL_TERMS_URL: " https://example.org/terms ",
      LEGAL_PRIVACY_URL: " ",
    }),
    { termsUrl: "https://example.org/terms", privacyUrl: null },
  );
  for (const invalid of ["/privacy", "example.org/privacy", "javascript:x"])
    assert.deepEqual(legalLinks({ LEGAL_PRIVACY_URL: invalid }), {
      termsUrl: null,
      privacyUrl: null,
    });
});
