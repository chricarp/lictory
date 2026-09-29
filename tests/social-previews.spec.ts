import { test, expect } from "@playwright/test";

test("social previews expose only page categories to anonymous recipients", async ({
  page,
  request,
}) => {
  const path = "/app/confidential/acquisition/epics/SECRET-42?tab=review";
  const response = await request.get(path, {
    headers: { "User-Agent": "Slackbot-LinkExpanding 1.0" },
  });
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('content="Epic in Lictory"');
  expect(html).toContain('content="noindex, nofollow"');
  const tags = html.match(/<meta[^>]+>/g)?.join(" ") ?? "";
  expect(tags).not.toMatch(/confidential|acquisition|SECRET-42|tab=review/);
  expect(tags).toContain("/og/epic");
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Sign in to Lictory" }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp("SECRET-42"));
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Epic in Lictory",
  );
  for (const kind of [
    "marketing",
    "workspace",
    "epic",
    "story",
    "item",
    "project",
    "board",
    "backlog",
    "iteration",
    "reviews",
    "view",
  ]) {
    const image = await request.get(`/og/${kind}`);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    const png = await image.body();
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  }
  expect((await request.get("/og/confidential-title")).status()).toBe(404);
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/og\/marketing$/,
  );
});
