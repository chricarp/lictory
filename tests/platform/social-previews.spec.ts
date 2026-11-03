import { test, expect } from "@playwright/test";
import { platformOrigin } from "../helpers/app-urls";

// The app host's document handler names only the kind of page in link
// previews: never the organization, project, item or query.
test("app links expose only page categories to anonymous recipients", async ({
  page,
  request,
}) => {
  const path = "/confidential/acquisition/epics/SECRET-42?tab=review";
  const response = await request.get(path, {
    headers: { "User-Agent": "Slackbot-LinkExpanding 1.0" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const html = await response.text();
  expect(html).toContain('content="Epic in Lictory"');
  expect(html).toContain('content="noindex, nofollow"');
  const tags = html.match(/<meta[^>]+>/g)?.join(" ") ?? "";
  expect(tags).not.toMatch(/confidential|acquisition|SECRET-42|tab=review/);
  // Preview images are static platform files: no website needed, no data.
  const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  expect(image).toBe(`${platformOrigin}/social/epic.png`);
  const rendered = await request.get(image!);
  expect(rendered.status()).toBe(200);
  expect(rendered.headers()["content-type"]).toContain("image/");
  // A person following the link signs in and comes back to it.
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Sign in to Lictory" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/callbackUrl=.*SECRET-42/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Epic in Lictory",
  );
});
