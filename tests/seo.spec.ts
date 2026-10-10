import { test, expect } from "@playwright/test";

test("search engines and AI assistants can discover the public website", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const rules = await robots.text();
  for (const agent of ["*", "Googlebot", "Bingbot", "GPTBot", "ClaudeBot"])
    expect(rules).toContain(`User-Agent: ${agent}`);
  expect(rules).toContain("Disallow: /api/");
  // Workspace links stay fetchable so unfurlers can read their noindex previews.
  expect(rules).not.toMatch(/Disallow: \/app/);
  expect(rules).toMatch(/Sitemap: https?:\/\/[^/]+\/sitemap\.xml/);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/privacy", "/terms-of-service", "/sign-up"])
    expect(sitemap).toContain(`${path}</loc>`);
  expect(sitemap).not.toMatch(/\/(app|home|sign-in)<\/loc>/);

  const index = await request.get("/llms.txt");
  expect(index.headers()["content-type"]).toContain("text/plain");
  const overview = await index.text();
  expect(overview).toMatch(/^# Lictory\n\n> /);
  expect(overview).toContain("/llms-full.txt");
  const full = await (await request.get("/llms-full.txt")).text();
  expect(full).toContain("| Approvals bound to a specific revision | Yes |");
  expect(full).toContain("### Do we have to leave Jira or Linear?");
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
      "SoftwareApplication",
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

test("account flows stay out of search results except sign-up", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow",
  );
  await page.goto("/sign-up?callbackUrl=%2Fapp");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index, follow",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/sign-up$/,
  );
});
