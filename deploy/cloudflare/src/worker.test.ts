import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker";

const env = {
  SITE_KIND: "marketing" as const,
  SITE_URL: "https://lictory.com",
  PLATFORM_URL: "https://app.lictory.com",
  BACKEND_ORIGIN: "https://app.lictory.com",
  ASSETS: { fetch: () => Promise.resolve(new Response("static")) },
};

void test("legacy account links and www retain the path and query on the canonical origin", async () => {
  for (const [path, destination] of [
    [
      "https://www.lictory.com/guides/definition-of-ready?ref=shared",
      "https://lictory.com/guides/definition-of-ready?ref=shared",
    ],
    [
      "https://lictory.com/sign-in?next=%2Fapp",
      "https://app.lictory.com/sign-in?next=%2Fapp",
    ],
    [
      "https://lictory.com/app//evil.example/path",
      "https://app.lictory.com//evil.example/path",
    ],
  ] as const) {
    const response = await worker.fetch(new Request(path), env);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), destination);
  }
});

void test("www redirects to the configured website origin, whatever its domain", async () => {
  const response = await worker.fetch(
    new Request("https://www.example.org/guides?ref=shared"),
    { ...env, SITE_URL: "https://example.org" },
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("Location"),
    "https://example.org/guides?ref=shared",
  );
});

void test("the platform edge hides internal mutations and rejects foreign WebSocket origins before fetching", async () => {
  for (const path of ["/api/zero", "/api/zero/query", "/api/zero/mutate"])
    assert.equal(
      (
        await worker.fetch(new Request(`https://app.lictory.com${path}`), {
          ...env,
          SITE_KIND: "platform",
        })
      ).status,
      404,
    );
  const response = await worker.fetch(
    new Request("https://app.lictory.com/zero/sync/v1/connect", {
      headers: { Upgrade: "websocket", Origin: "https://foreign.example" },
    }),
    { ...env, SITE_KIND: "platform" },
  );
  assert.equal(response.status, 403);
});

void test("exported Markdown has a canonical HTML target and cannot be indexed at the internal asset path", async () => {
  const response = await worker.fetch(
    new Request("https://lictory.com/guides/definition-of-ready.md"),
    env,
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

void test("SPA documents preserve private social previews without echoing workspace identifiers", async () => {
  const response = await worker.fetch(
    new Request(
      "https://app.lictory.com/private-organization/items/secret-item",
    ),
    {
      ...env,
      SITE_KIND: "platform",
      ASSETS: {
        fetch: () =>
          Promise.resolve(
            new Response("<html><head><!--app-head--></head></html>", {
              headers: { "Content-Type": "text/html", ETag: "static" },
            }),
          ),
      },
    },
  );
  const html = await response.text();
  assert.ok(html.includes("Work item in Lictory"));
  // The bundle carries no installation settings; the Worker supplies them.
  assert.ok(
    html.includes(
      '<script type="application/json" id="lictory-config">{"siteUrl":"https://lictory.com","analytics":null}</script>',
    ),
  );
  assert.ok(!html.includes("private-organization"));
  assert.ok(!html.includes("secret-item"));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(response.headers.get("ETag"), null);
});

void test("the documentation serves only its static files, with the website's security headers", async () => {
  const docs = {
    ...env,
    SITE_KIND: "docs" as const,
    SITE_URL: "https://docs.lictory.com",
    ASSETS: {
      fetch: (request: Request) =>
        Promise.resolve(
          new Response(`asset ${new URL(request.url).pathname}`, {
            headers: { "Content-Type": "text/html" },
          }),
        ),
    },
  };
  // No backend behind the documentation, and no website redirects.
  for (const path of ["/api/search", "/zero/sync", "/relay/e/", "/sign-in"]) {
    const response = await worker.fetch(
      new Request(`https://docs.lictory.com${path}`),
      docs,
    );
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), `asset ${path}`);
  }
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
