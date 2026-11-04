import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker from "./worker";

const env = {
  SITE_KIND: "marketing" as const,
  SITE_URL: "https://lictory.com",
  ASSETS: {
    fetch: (request: Request) =>
      Promise.resolve(
        new Response(`asset ${new URL(request.url).pathname}`, {
          status: 404,
        }),
      ),
  },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Records the Worker's outgoing requests instead of sending them. */
function captureFetch(response = () => new Response("ok")) {
  const sent: Request[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Request(input, init));
    return Promise.resolve(response());
  };
  return sent;
}

void test("www redirects to the canonical origin with the path and query", async () => {
  for (const [request, siteUrl, destination] of [
    [
      "https://www.lictory.com/guides/definition-of-ready?ref=shared",
      "https://lictory.com",
      "https://lictory.com/guides/definition-of-ready?ref=shared",
    ],
    [
      "https://www.example.org/guides?ref=shared",
      "https://example.org",
      "https://example.org/guides?ref=shared",
    ],
  ] as const) {
    const response = await worker.fetch(new Request(request), {
      ...env,
      SITE_URL: siteUrl,
    });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), destination);
  }
});

void test("former application and account paths are ordinary website paths", async () => {
  const sent = captureFetch();
  for (const path of [
    "/app",
    "/app/acme/pay/epics/PAY-1",
    "/sign-in?next=%2Fapp",
    "/sign-up",
    "/reset-password?token=t",
    "/verify-email",
    "/welcome",
    "/auth-error",
  ]) {
    const response = await worker.fetch(
      new Request(`https://lictory.com${path}`),
      env,
    );
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("Location"), null, path);
  }
  assert.equal(sent.length, 0);
});

void test("the analytics relay forwards to PostHog without cookies", async () => {
  const sent = captureFetch(
    () =>
      new Response("{}", {
        headers: { "Set-Cookie": "ph=1", "Content-Type": "application/json" },
      }),
  );
  const response = await worker.fetch(
    new Request("https://lictory.com/relay/e/?ip=0&ver=1", {
      method: "POST",
      body: "event",
      headers: {
        Cookie: "lictory_analytics_consent=1; session=secret",
        Authorization: "Bearer secret",
        "Content-Type": "text/plain",
        Origin: "https://lictory.com",
        "CF-Connecting-IP": "192.0.2.7",
        "X-Forwarded-For": "198.51.100.1",
      },
    }),
    { ...env, POSTHOG_HOST: "https://eu.i.posthog.com" },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(sent.length, 1);
  const [upstream] = sent;
  assert.equal(upstream!.url, "https://eu.i.posthog.com/e/?ip=0&ver=1");
  assert.equal(upstream!.method, "POST");
  assert.equal(await upstream!.text(), "event");
  assert.equal(upstream!.headers.get("cookie"), null);
  assert.equal(upstream!.headers.get("authorization"), null);
  assert.equal(upstream!.headers.get("origin"), "https://lictory.com");
  // Only Cloudflare's view of the visitor, for PostHog's cookieless hash.
  assert.equal(upstream!.headers.get("x-forwarded-for"), "192.0.2.7");

  // SDK assets come from the regional asset host.
  await worker.fetch(new Request("https://lictory.com/relay/static/array.js"), {
    ...env,
    POSTHOG_HOST: "https://eu.i.posthog.com",
  });
  assert.equal(sent[1]!.url, "https://eu-assets.i.posthog.com/static/array.js");
});

void test("the analytics relay sends nothing while PostHog is not configured", async () => {
  const sent = captureFetch();
  for (const [path, host] of [
    ["/relay/e/", undefined],
    ["/relay/e/", ""],
    ["/relay", "https://eu.i.posthog.com"],
  ] as const) {
    const response = await worker.fetch(
      new Request(`https://lictory.com${path}`, { method: "POST" }),
      { ...env, POSTHOG_HOST: host },
    );
    assert.equal(response.status, 404, path);
  }
  assert.equal(sent.length, 0);
});

void test("exported Markdown has a canonical HTML target and cannot be indexed at the internal asset path", async () => {
  const response = await worker.fetch(
    new Request("https://lictory.com/guides/definition-of-ready.md"),
    {
      ...env,
      ASSETS: { fetch: () => Promise.resolve(new Response("# Guide")) },
    },
  );
  assert.equal(
    response.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
  assert.equal(
    response.headers.get("Link"),
    '<https://lictory.com/guides/definition-of-ready>; rel="canonical"',
  );
  assert.equal(
    (
      await worker.fetch(
        new Request("https://lictory.com/markdown/guides.md"),
        env,
      )
    ).status,
    404,
  );
});

void test("the documentation serves only its static files, with the website's security headers", async () => {
  const sent = captureFetch();
  const docs = {
    ...env,
    SITE_KIND: "docs" as const,
    SITE_URL: "https://docs.lictory.com",
    POSTHOG_HOST: "https://eu.i.posthog.com",
    ASSETS: {
      fetch: (request: Request) =>
        Promise.resolve(
          new Response(`asset ${new URL(request.url).pathname}`, {
            headers: { "Content-Type": "text/html" },
          }),
        ),
    },
  };
  // No relay behind the documentation, and no website redirects.
  for (const path of ["/api/search", "/zero/sync", "/relay/e/", "/home"]) {
    const response = await worker.fetch(
      new Request(`https://docs.lictory.com${path}`),
      docs,
    );
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), `asset ${path}`);
  }
  assert.equal(sent.length, 0);
  const page = await worker.fetch(
    new Request("https://docs.lictory.com/self-hosting/install"),
    docs,
  );
  assert.equal(page.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(page.headers.get("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(
    page.headers.get("Strict-Transport-Security"),
    "max-age=63072000; includeSubDomains",
  );
  assert.equal(page.headers.get("X-Robots-Tag"), null);
  assert.equal(page.headers.get("Cache-Control"), null);
});
