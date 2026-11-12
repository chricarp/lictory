import { test, expect, type Locator } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { createWorkspace } from "../helpers/onboarding-helpers";
import { appHome, inApp } from "../helpers/app-urls";
import { useClientAddress } from "../helpers/client-address";

// Sign-in and sign-up are rate limited per client address: this page
// authenticates from its own.
test.beforeEach(async ({ page }) => {
  await useClientAddress(page);
});

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

/** The accent stroke's color and the theme's interactive color (--ring). */
function accentColors(artwork: Locator) {
  return artwork.evaluate((element) => {
    const path = element.querySelector(".illo-accent");
    const probe = document.createElement("span");
    probe.style.color = "var(--ring)";
    element.append(probe);
    const ring = getComputedStyle(probe).color;
    probe.remove();
    return { stroke: path && getComputedStyle(path).stroke, ring };
  });
}

/** One animation per illustration: switching kinds replaces the previous one. */
async function expectArtwork(artwork: Locator, kind: string) {
  await expect(artwork).toHaveAttribute("data-illustration", kind);
  await expect(artwork).toHaveAttribute("aria-hidden", "true");
  await expect(artwork.locator("svg")).toHaveCount(1);
}

test("empty states show theme-aware artwork that reacts to the pointer and stays actionable", async ({
  page,
}) => {
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
  const workspace = projectUrl.replace(/\/art\/proposals$/, "");
  const artwork = page.locator("[data-illustration]");
  await expect(
    page.getByRole("heading", { name: "Start with a proposal" }),
  ).toBeVisible();
  await expectArtwork(artwork, "proposal");
  // The scene assembles once and rests; hovering plays its reaction, which
  // returns to the same resting frame.
  await expect(artwork).toHaveAttribute("data-state", "rest");
  await artwork.hover();
  await expect(artwork).toHaveAttribute("data-state", "react");
  await expect(artwork).toHaveAttribute("data-state", "rest");
  // The accent follows the theme's interactive color.
  const colors = await accentColors(artwork);
  expect(colors.stroke).toBe(colors.ring);
  await page.getByRole("link", { name: "Reviews", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No reviews waiting for you" }),
  ).toBeVisible();
  await expectArtwork(artwork, "personalReview");
  for (const [view, label, kind] of [
    ["needs-review", "Needs review", "teamReview"],
    ["blocked", "Blocked", "blocked"],
    ["ready", "Ready for delivery", "ready"],
    ["drafts", "Proposals", "drafts"],
    ["updated", "Recently updated", "updated"],
  ] as const) {
    await page.goto(`${workspace}/art/views/${view}`);
    await expect(
      page.getByRole("heading", { name: `Nothing in “${label}”` }),
    ).toBeVisible();
    await expectArtwork(artwork, kind);
    const filter = page.getByRole("textbox", {
      name: "Filter by title or identifier",
    });
    await filter.fill("missing");
    await expect(
      page.getByRole("heading", { name: "No matching items" }),
    ).toBeVisible();
    await expectArtwork(artwork, "search");
    await filter.fill("");
    await expectArtwork(artwork, kind);
  }
  await page.screenshot({ path: "/tmp/lictory-views-updated.png" });
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /^No active (sprint|cycle|iteration)$/ }),
  ).toBeVisible();
  await expectArtwork(artwork, "planning");
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
  await expectArtwork(artwork, "search");
  await page
    .getByRole("textbox", { name: "Filter by title or identifier" })
    .fill("");
  await page.getByRole("button", { name: "Create a proposal C" }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("First proposal");
  await page.getByRole("button", { name: "Create & open" }).click();
  await expect(
    page.getByRole("heading", { name: "First proposal" }),
  ).toBeVisible();
  await expect(artwork).toHaveCount(0);
  await page.goto(`${workspace}/art/items/ART-999999`);
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  await expectArtwork(artwork, "search");
});

test("missing pages and sign-in recovery stay readable on narrow light and dark screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  // Unknown top-level addresses on the app host are workspace handles: anyone
  // signed out is asked to sign in first (an address never reveals whether a
  // workspace exists). The site's own missing page is covered in
  // tests/marketing/not-found.spec.ts.
  await page.goto("/missing-illustration-page");
  await expect(page).toHaveURL(
    /\/sign-in\?callbackUrl=%2Fmissing-illustration-page$/,
  );
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Signing in returns to the requested address.
  await expect(page).toHaveURL(/\/missing-illustration-page$/);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/missing-illustration-page");
    await expect(
      page.getByRole("heading", { name: "This workspace was not found" }),
    ).toBeVisible();
    const art = page.locator("[data-illustration]");
    await expectArtwork(art, "search");
    // Reduced motion shows the resting frame at once and never reacts.
    await expect(art).toHaveAttribute("data-state", "rest");
    await art.hover();
    await expect(art).toHaveAttribute("data-state", "rest");
    // The same artwork takes the light or dark palette.
    const colors = await accentColors(art);
    expect(colors.stroke).toBe(colors.ring);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    await page.getByRole("button", { name: "Go to your workspace" }).click();
    // "/" forwards straight into the person's workspace, so the root may
    // already be gone when the address is read.
    await expect(page).not.toHaveURL(/missing-illustration-page/);
    await expect(page).toHaveURL(inApp);
    await page.goto("/auth-error");
    await expect(
      page.getByRole("heading", { name: "Sign-in interrupted" }),
    ).toBeVisible();
    await expectArtwork(art, "recovery");
    await page.getByRole("button", { name: "Try again" }).click();
    // "Try again" opens sign-in, which sends a signed-in person on to their
    // workspace, so /sign-in may already be gone when the address is read.
    await expect(page).not.toHaveURL(/auth-error/);
    await expect(page).toHaveURL(inApp);
  }
});
