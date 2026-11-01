import { test, expect } from "@playwright/test";

test("search engines and AI assistants can discover the public website", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const rules = await robots.text();
  for (const agent of ["*", "Googlebot", "Bingbot", "GPTBot", "ClaudeBot"])
    expect(rules).toContain(`User-Agent: ${agent}`);
  expect(rules).toContain("Disallow: /relay/");
  expect(rules).toContain("Disallow: /markdown/");
  expect(rules).not.toContain("Host:");
  // Old workspace links stay fetchable: they redirect to the application, whose
  // noindex previews unfurlers must still read.
  expect(rules).not.toMatch(/Disallow: \/app/);
  expect(rules).toMatch(/Sitemap: https?:\/\/[^/]+\/sitemap\.xml/);
  expect(rules).toMatch(/Sitemap: https?:\/\/[^/]+\/guides\/feed\.xml/);

  const feed = await request.get("/guides/feed.xml");
  expect(feed.headers()["content-type"]).toContain("application/rss+xml");
  expect(await feed.text()).toMatch(
    /<link>https?:\/\/[^/]+\/guides\/definition-of-ready<\/link>/,
  );

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/privacy", "/terms-of-service"])
    expect(sitemap).toContain(`${path}</loc>`);
  // Account pages live on the application origin, outside this sitemap.
  expect(sitemap).not.toMatch(/\/(app|home|sign-in|sign-up)<\/loc>/);
  expect(sitemap).toContain("/og/marketing</image:loc>");

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(await manifest.json()).toMatchObject({
    name: "Lictory",
    start_url: "/",
  });

  const index = await request.get("/llms.txt");
  expect(index.headers()["content-type"]).toContain("text/plain");
  const overview = await index.text();
  expect(overview).toMatch(/^# Lictory\n\n> /);
  expect(overview).toContain("/llms-full.txt");
  expect(overview).toContain("/guides/definition-of-ready.md)");
  const full = await (await request.get("/llms-full.txt")).text();
  expect(full).toContain("| Approvals bound to a specific revision | Yes |");
  expect(full).toContain("### Do we have to leave Jira or Linear?");
  expect(full).toContain("### Lictory vs Jira");
});

test("guides and comparisons have Markdown versions for AI assistants", async ({
  page,
  request,
}) => {
  const guide = await request.get("/guides/definition-of-ready.md");
  expect(guide.status()).toBe(200);
  expect(guide.headers()["content-type"]).toContain("text/markdown");
  // Search engines index the HTML page, not the Markdown copy.
  expect(guide.headers().link).toMatch(
    /^<https?:\/\/[^/]+\/guides\/definition-of-ready>; rel="canonical"$/,
  );
  expect(await guide.text()).toMatch(
    /^# Definition of Ready: a checklist your team can prove\n/,
  );

  const comparison = await (await request.get("/compare/jira.md")).text();
  expect(comparison).toContain(
    "| Approvals bound to a specific revision | Yes |",
  );
  expect(comparison).toContain("## Frequently asked questions");
  expect((await request.get("/guides.md")).status()).toBe(200);
  expect((await request.get("/compare/unknown.md")).status()).toBe(404);

  await page.goto("/guides/definition-of-ready");
  await expect(
    page.locator('link[rel="alternate"][type="text/markdown"]'),
  ).toHaveAttribute("href", /\/guides\/definition-of-ready\.md$/);
  await expect(
    page.locator('link[rel="alternate"][type="application/rss+xml"]'),
  ).toHaveAttribute("href", /\/guides\/feed\.xml$/);
});

test("the landing page describes itself with structured data", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index, follow",
  );
  await expect(
    page.locator('link[rel="alternate"][href$="/llms.txt"]'),
  ).toHaveCount(1);
  const { "@graph": graph } = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ??
      "{}",
  ) as {
    "@graph": { "@type": string; mainEntity?: { name: string }[] }[];
  };
  expect(graph.map((node) => node["@type"])).toEqual(
    expect.arrayContaining([
      "Organization",
      "WebSite",
      "WebApplication",
      "FAQPage",
    ]),
  );
  // Structured answers match the questions visitors read on the page.
  const questions = graph.find(
    (node) => node["@type"] === "FAQPage",
  )!.mainEntity!;
  for (const { name } of questions)
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeAttached();

  // The full comparison is in the page for crawlers, even while collapsed.
  await expect(
    page.getByRole("rowheader", {
      name: "Estimates, burndown, velocity",
      includeHidden: true,
    }),
  ).toBeAttached();
});

test("legal notices have their own previews and breadcrumbs", async ({
  page,
}) => {
  await page.goto("/privacy");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    /\/privacy$/,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Privacy Notice · Lictory",
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#08090b",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  const { "@graph": graph } = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ??
      "{}",
  ) as {
    "@graph": {
      "@type": string;
      itemListElement?: { name: string }[];
    }[];
  };
  const breadcrumb = graph.find((node) => node["@type"] === "BreadcrumbList");
  expect(breadcrumb?.itemListElement?.map(({ name }) => name)).toEqual([
    "Lictory",
    "Privacy Notice",
  ]);
});

test("guides and comparisons are linked, indexable and described", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const footer = page.getByRole("navigation", { name: "Footer", exact: true });
  await footer.getByRole("link", { name: "Lictory vs Jira" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Lictory vs Jira" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/^Lictory vs Jira: /);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/compare\/jira$/,
  );
  await expect(
    page.getByRole("rowheader", {
      name: "Approvals bound to a specific revision",
    }),
  ).toBeVisible();
  const compareGraph = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ??
      "{}",
  ) as { "@graph": { "@type": string }[] };
  expect(compareGraph["@graph"].map((node) => node["@type"])).toEqual(
    expect.arrayContaining(["WebPage", "BreadcrumbList", "FAQPage"]),
  );

  // Each comparison and guide has its own social card.
  const card = page.locator('meta[property="og:image"]').first();
  const cardUrl = new URL((await card.getAttribute("content"))!);
  const image = await request.get(cardUrl.pathname + cardUrl.search);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");

  await page.goto("/guides");
  await page
    .getByRole("link", { name: /Definition of Ready: a checklist/ })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Definition of Ready: a checklist your team can prove",
  );
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", {
      name: "Guides",
    }),
  ).toBeVisible();
  const guideGraph = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ??
      "{}",
  ) as { "@graph": { "@type": string; datePublished?: string }[] };
  expect(
    guideGraph["@graph"].find((node) => node["@type"] === "Article")
      ?.datePublished,
  ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
    "content",
    "article",
  );

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of [
    "/guides",
    "/guides/definition-of-ready",
    "/compare/linear",
  ])
    expect(sitemap).toContain(`${path}</loc>`);
});
