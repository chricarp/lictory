import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { createWorkspace } from "../helpers/onboarding-helpers";
import { illustrationAssets } from "@lictory/ui/illustration-assets";
import { appHome } from "../helpers/app-urls";

const email = "illustration-states@example.test";
const password = "Local-test-password-123";

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client);
    const id = crypto.randomUUID();
    const inserted = await db
      .insert(s.user)
      .values({
        id,
        name: "Illustration Test",
        email,
        emailVerified: true,
        handle: "illustration_states",
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length)
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: await hashPassword(password),
      });
  } finally {
    await client.end();
  }
});

test("empty states load compact static artwork and remain actionable", async ({
  page,
  request,
}) => {
  // Each production asset is small and immutable, with no transformation endpoint.
  for (const url of Object.values(illustrationAssets)) {
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/webp");
    expect(response.headers()["cache-control"]).toContain("immutable");
    expect((await response.body()).byteLength).toBeLessThan(25_000);
  }
  const optimizedRequests: string[] = [];
  page.on("request", (r) => {
    // Artwork is served as built: never through an image transformation.
    if (/\/(_next|_vercel|cdn-cgi)\/image/.test(r.url()))
      optimizedRequests.push(r.url());
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(appHome);
  await page.getByRole("button", { name: /^Create a workspace/ }).click();
  await createWorkspace(page, {
    organization: "Illustration States",
    project: "Design",
    key: "ART",
    planning: "manual",
  });
  const projectUrl = page.url();
  const workspace = projectUrl.replace(/\/art\/epics$/, "");
  const artwork = page.locator('img[src^="/illustrations/"]');
  await expect(
    page.getByRole("heading", { name: "No epics yet" }),
  ).toBeVisible();
  await expect(artwork).toHaveAttribute("src", illustrationAssets.proposal);
  await expect(artwork).toHaveAttribute("alt", "");
  await expect
    .poll(() =>
      artwork.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth,
      ),
    )
    .toBe(384);
  await page.getByRole("link", { name: "Reviews", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No reviews waiting for you" }),
  ).toBeVisible();
  await expect(artwork).toHaveAttribute(
    "src",
    illustrationAssets.personalReview,
  );
  for (const [view, label, kind] of [
    ["needs-review", "Needs review", "teamReview"],
    ["blocked", "Blocked", "blocked"],
    ["ready", "Ready for development", "ready"],
    ["drafts", "Drafts", "drafts"],
    ["updated", "Recently updated", "updated"],
  ] as const) {
    await page.goto(`${workspace}/art/views/${view}`);
    await expect(
      page.getByRole("heading", { name: `Nothing in “${label}”` }),
    ).toBeVisible();
    await expect(artwork).toHaveAttribute("src", illustrationAssets[kind]);
    await expect
      .poll(() =>
        artwork.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth,
        ),
      )
      .toBe(384);
    const filter = page.getByRole("textbox", {
      name: "Filter by title or identifier",
    });
    await filter.fill("missing");
    await expect(
      page.getByRole("heading", { name: "No matching items" }),
    ).toBeVisible();
    await expect(artwork).toHaveAttribute("src", illustrationAssets.search);
    await filter.fill("");
    await expect(artwork).toHaveAttribute("src", illustrationAssets[kind]);
  }
  await page.screenshot({ path: "/tmp/lictory-views-updated.png" });
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /^No active (sprint|cycle|iteration)$/ }),
  ).toBeVisible();
  await expect(artwork).toHaveAttribute("src", illustrationAssets.planning);
  await page.getByRole("button", { name: "Plan in the backlog" }).click();
  await expect(
    page.getByRole("heading", { name: "Nothing planned yet" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "You're all caught up" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "To do", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nothing needs your attention" }),
  ).toBeVisible();
  await page.goto(projectUrl);
  await page
    .getByRole("textbox", { name: "Filter by title or identifier" })
    .fill("missing");
  await expect(
    page.getByRole("heading", { name: "No matching items" }),
  ).toBeVisible();
  await expect(artwork).toHaveAttribute("src", illustrationAssets.search);
  await page
    .getByRole("textbox", { name: "Filter by title or identifier" })
    .fill("");
  await page.getByRole("button", { name: "Create an Epic C" }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("First proposal");
  await page.getByRole("button", { name: "Create & open" }).click();
  await expect(
    page.getByRole("heading", { name: "First proposal" }),
  ).toBeVisible();
  await expect(
    page.locator(`img[src="${illustrationAssets.proposal}"]`),
  ).toHaveCount(0);
  await page.goto(`${workspace}/art/epics/ART-999999`);
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  await expect(artwork).toHaveAttribute("src", illustrationAssets.search);
  expect(optimizedRequests).toEqual([]);
});

test("missing pages and sign-in recovery stay readable on narrow light and dark screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/missing-illustration-page");
    await expect(
      page.getByRole("heading", { name: "This page does not exist" }),
    ).toBeVisible();
    const art = page.locator('img[src^="/illustrations/"]');
    await expect
      .poll(() =>
        art.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth,
        ),
      )
      .toBe(384);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    await page.getByRole("button", { name: "Go home" }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/auth-error");
    await expect(
      page.getByRole("heading", { name: "Sign-in interrupted" }),
    ).toBeVisible();
    await expect(art).toHaveAttribute("src", illustrationAssets.recovery);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});
