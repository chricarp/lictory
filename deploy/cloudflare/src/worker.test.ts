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
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("Location"), destination);
  }
});

void test("every other form of a page URL redirects permanently to the canonical one", async () => {
  for (const kind of ["marketing", "docs"] as const) {
    const origin =
      kind === "marketing" ? "https://lictory.com" : "https://docs.lictory.com";
    for (const [path, destination] of [
      ["/compare/jira/", "/compare/jira"],
      ["/compare/jira.html", "/compare/jira"],
      ["/guides/?ref=shared", "/guides?ref=shared"],
      ["/index", "/"],
      ["/index.html", "/"],
      ["/guides/index.html", "/guides"],
      ["//", "/"],
    ] as const) {
      const response = await worker.fetch(new Request(`${origin}${path}`), {
        ...env,
        SITE_KIND: kind,
        SITE_URL: origin,
      });
      assert.equal(response.status, 301, `${kind} ${path}`);
      assert.equal(
        response.headers.get("Location"),
        `${origin}${destination}`,
        `${kind} ${path}`,
      );
    }
  }
  // In one hop from www.
  const response = await worker.fetch(
    new Request("https://www.lictory.com/compare/jira/"),
    env,
  );
  assert.equal(
    response.headers.get("Location"),
    "https://lictory.com/compare/jira",
  );
  const home = await worker.fetch(
    new Request("https://lictory.com/home?a=1"),
    env,
  );
  assert.equal(home.status, 301);
  assert.equal(home.headers.get("Location"), "https://lictory.com/?a=1");
});

void test("the exported not-found pages answer 404, never 200 with noindex", async () => {
  const requested: string[] = [];
  const assets = {
    ...env,
    ASSETS: {
      fetch: (request: Request) => {
        requested.push(new URL(request.url).pathname);
        return Promise.resolve(
          new Response("<title>Page not found</title>", {
            headers: { "Content-Type": "text/html" },
          }),
        );
      },
    },
  };
  for (const path of ["/404", "/_not-found", "/_not-found.txt"]) {
    const response = await worker.fetch(
      new Request(`https://lictory.com${path}`),
      assets,
    );
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), "<title>Page not found</title>");
  }
  assert.deepEqual(requested, ["/404", "/404", "/404"]);
});

void test("router payloads are not indexable; robots.txt and llms.txt are", async () => {
  const assets = {
    ...env,
    ASSETS: { fetch: () => Promise.resolve(new Response("payload")) },
  };
  for (const path of [
    "/index.txt",
    "/compare/jira.txt",
    "/guides/__next._tree.txt",
  ]) {
    const response = await worker.fetch(
      new Request(`https://lictory.com${path}`),
      assets,
    );
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex", path);
  }
  for (const path of ["/robots.txt", "/llms.txt", "/llms-full.txt", "/"]) {
    const response = await worker.fetch(
      new Request(`https://lictory.com${path}`),
      assets,
    );
    assert.equal(response.headers.get("X-Robots-Tag"), null, path);
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

void test("comparison, alternatives and roundup pages have exported Markdown versions", async () => {
  const requested: string[] = [];
  const assets = {
    ...env,
    ASSETS: {
      fetch: (request: Request) => {
        requested.push(new URL(request.url).pathname);
        return Promise.resolve(new Response("# Page"));
      },
    },
  };
  for (const path of [
    "/compare/lictory-vs-plane",
    "/alternatives/jira",
    "/self-hosted-jira-alternative",
    "/best-requirements-management-tools",
  ]) {
    const response = await worker.fetch(
      new Request(`https://lictory.com${path}.md`),
      assets,
    );
    assert.equal(
      response.headers.get("Content-Type"),
      "text/markdown; charset=utf-8",
      path,
    );
    assert.equal(
      response.headers.get("Link"),
      `<https://lictory.com${path}>; rel="canonical"`,
    );
  }
  assert.deepEqual(requested, [
    "/markdown/compare/lictory-vs-plane.md",
    "/markdown/alternatives/jira.md",
    "/markdown/self-hosted-jira-alternative.md",
    "/markdown/best-requirements-management-tools.md",
  ]);
});

void test("the documentation relays analytics like the website, and only when PostHog is configured", async () => {
  const sent = captureFetch();
  const docs = {
    ...env,
    SITE_KIND: "docs" as const,
    SITE_URL: "https://docs.lictory.com",
  };
  const response = await worker.fetch(
    new Request("https://docs.lictory.com/relay/e/?ip=0", {
      method: "POST",
      body: "event",
      headers: { Cookie: "c15t=1", "CF-Connecting-IP": "192.0.2.7" },
    }),
    { ...docs, POSTHOG_HOST: "https://eu.i.posthog.com" },
  );
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, "https://eu.i.posthog.com/e/?ip=0");
  assert.equal(sent[0]!.headers.get("cookie"), null);
  assert.equal(sent[0]!.headers.get("x-forwarded-for"), "192.0.2.7");

  const unconfigured = await worker.fetch(
    new Request("https://docs.lictory.com/relay/e/", { method: "POST" }),
    docs,
  );
  assert.equal(unconfigured.status, 404);
  assert.equal(sent.length, 1);
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
  // No backend and no website redirects (the relay is tested above).
  for (const path of ["/api/search", "/zero/sync", "/home"]) {
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

void test("documentation pages have Markdown versions with a canonical HTML target", async () => {
  const requested: string[] = [];
  const docs = {
    ...env,
    SITE_KIND: "docs" as const,
    SITE_URL: "https://docs.lictory.com",
    ASSETS: {
      fetch: (request: Request) => {
        requested.push(new URL(request.url).pathname);
        return Promise.resolve(new Response("# Page"));
      },
    },
  };
  for (const [path, canonical] of [
    [
      "/self-hosting/install.md",
      "https://docs.lictory.com/self-hosting/install",
    ],
    ["/index.md", "https://docs.lictory.com/"],
  ] as const) {
    const response = await worker.fetch(
      new Request(`https://docs.lictory.com${path}`),
      docs,
    );
    assert.equal(
      response.headers.get("Content-Type"),
      "text/markdown; charset=utf-8",
    );
    assert.equal(
      response.headers.get("Link"),
      `<${canonical}>; rel="canonical"`,
    );
  }
  assert.deepEqual(requested, [
    "/markdown/self-hosting/install.md",
    "/markdown/index.md",
  ]);
  const internal = await worker.fetch(
    new Request("https://docs.lictory.com/markdown/index.md"),
    docs,
  );
  assert.equal(internal.status, 404);
});
