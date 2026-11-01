import { test, expect } from "@playwright/test";

// The application's documents point their social previews at these images,
// so the website serves every category, including workspace ones.
test("social preview images exist for every public page category", async ({
  page,
  request,
}) => {
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
    expect(image.headers()["cache-control"]).toContain("public");
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
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Lictory: build the right thing, then build it fast",
  );
});
