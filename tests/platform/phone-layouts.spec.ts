import { test, expect, type Locator, type Page } from "@playwright/test";
import { paths } from "@lictory/core/lib/paths";
import { createAgent } from "@lictory/core/factory/agents";
import { clientAddress } from "../helpers/client-address";
import { seedItem, seedWorkspace, signIn, withDb } from "../helpers/seed";

// Phones and zoomed screens: what does not fit says so and stays reachable,
// and nothing is cut off mid-word or replaced by an icon alone.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

async function seed(key: string) {
  const seeded = await seedWorkspace({
    name: `Phone ${key}`,
    key,
    users: ["Pia Product"],
    settings: { iterationMode: "off" },
  });
  await seedItem(seeded, {
    title: "Partial refunds",
    description: "# Behavior\n\nA refund may cover part of a payment.",
  });
  await seedItem(seeded, { type: "Task", title: "Refund endpoint" });
  return seeded;
}

const fits = (page: Page, width: number) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);

// Every part of the line lies inside it: a part cut by the line's edge
// (rather than wrapped or ended with an ellipsis) reaches past it.
async function expectWhole(line: Locator) {
  const overflow = await line.evaluate((element) => {
    const edge = element.getBoundingClientRect().right + 1;
    return [...element.querySelectorAll<HTMLElement>("*")]
      .filter((part) => part.getBoundingClientRect().right > edge)
      .map((part) => part.textContent);
  });
  expect(overflow).toEqual([]);
}

test("on a phone the settings sections, board columns and backlog states stay readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await seed("PHL");
  await signIn(page, seeded.owner.email);

  // Settings: the section strip says more sections lie beyond its edge, and
  // the arrow brings them into view.
  await page.goto(paths.projectSettings(seeded.slug, "PHL"));
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.locator('[aria-current="page"]')).toBeVisible();
  const scroller = sections.locator(".overflow-x-auto").first();
  const later = sections.locator('[data-scroll-cue="end"] button');
  await expect(sections.locator('[data-scroll-cue="start"]')).toHaveCount(0);
  await expect(later).toBeVisible();
  await later.click();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await expect(
    sections.locator('[data-scroll-cue="start"] button'),
  ).toBeVisible();
  await fits(page, 390);

  // Board: every column by name and count above the one in view; choosing
  // one brings it into view. No arrows float over the cards.
  await page.goto(paths.board(seeded.slug, "PHL"));
  const columns = page.getByRole("list", { name: "Board columns" });
  const backlog = columns.getByRole("button").filter({ hasText: "Backlog" });
  await expect(backlog).toContainText("2");
  await expect(backlog).toHaveAttribute("aria-pressed", "true");
  const inProgress = columns
    .getByRole("button")
    .filter({ hasText: "In Progress" });
  await inProgress.click();
  await expect(inProgress).toHaveAttribute("aria-pressed", "true");
  await expect(backlog).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Scroll to later columns" }),
  ).toBeHidden();
  await fits(page, 390);

  // Backlog: the states are words on a line of their own, as on desktop.
  await page.goto(paths.backlog(seeded.slug, "PHL"));
  const story = page
    .locator("[data-row]")
    .filter({ hasText: "Partial refunds" });
  await expect(story).toContainText("Draft");
  await expect(story).toContainText("Backlog");
  await expectWhole(story);
  await fits(page, 390);
});

test("at 320px list rows wrap their details instead of cutting them mid-word", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const seeded = await seed("PHR");
  await withDb((db) =>
    createAgent(db, seeded.owner.id, seeded.organizationId, {
      name: "Forge",
      handle: `forge${crypto.randomUUID().slice(0, 6)}`,
      kind: "runner",
      harness: "claude-code",
      access: "write",
    }),
  );
  await signIn(page, seeded.owner.email);
  await page.goto(`${paths.factory(seeded.slug)}/agents`);
  const row = page.locator("[data-list-row]").filter({ hasText: "Forge" });
  await expect(row).toContainText("Read and write");
  await expect(row).toContainText("Every project");
  await expectWhole(row);
  await fits(page, 320);
});

test("at 320px the item page fits the screen with its header actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const seeded = await seed("PHI");
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.itemPath(1));
  await expect(
    page.getByRole("heading", { name: "Partial refunds", level: 1 }),
  ).toBeVisible();
  await expectWhole(page.locator("header[data-page-header]").first());
  await fits(page, 320);
});
