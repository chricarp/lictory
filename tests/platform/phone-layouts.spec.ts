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

  // Settings: a phone names the current section in one select that lists
  // every section in full (a sideways strip cut words at its edges), and
  // choosing one opens it.
  await page.goto(paths.projectSettings(seeded.slug, "PHL"));
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  const section = sections.getByRole("combobox", { name: "Settings section" });
  await expect(section).toContainText("General");
  await expect(sections.getByRole("link")).toHaveCount(0);
  await section.click();
  await page.getByRole("option", { name: "Labels & milestones" }).click();
  await expect(page).toHaveURL(/\/settings\/labels$/);
  await expect(section).toContainText("Labels & milestones");
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

test("on a phone a row's key and title wrap as one line, the Inbox filters fold into one button and an agent's owner is never cut", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await seedWorkspace({
    name: "Phone rows",
    key: "PHK",
    users: ["Annemarie Oyelaran-Castellanos"],
    settings: { iterationMode: "off" },
  });
  const started = await seedItem(seeded, {
    type: "Task",
    title: "Run the database migration on staging before the refund backfill",
  });
  await seeded.command({
    type: "updateWorkItem",
    workItemId: started,
    assigneeId: seeded.owner.id,
    statusId: seeded.roster.statuses.find(
      (status) =>
        status.projectId === seeded.projectId && status.category === "started",
    )!.id,
  });
  const agentId = crypto.randomUUID();
  await withDb((db) =>
    createAgent(
      db,
      seeded.owner.id,
      seeded.organizationId,
      {
        name: "Forge",
        handle: `forge${crypto.randomUUID().slice(0, 6)}`,
        kind: "runner",
        harness: "claude-code",
        access: "write",
      },
      agentId,
    ),
  );
  await signIn(page, seeded.owner.email);

  // Home: a wrapped title continues under its key, not in a column beside
  // it.
  await page.goto(paths.org(seeded.slug));
  const row = page
    .getByRole("region", { name: "In flight" })
    .locator("[data-list-row]")
    .filter({ hasText: "Run the database migration" });
  const key = row.getByText("PHK-1", { exact: true });
  await expect(key).toBeVisible();
  const keyLeft = await key.evaluate((e) => e.getBoundingClientRect().left);
  const lines = await row
    .getByRole("link", { name: /Run the database migration/ })
    .evaluate((link) => [...link.getClientRects()].map((r) => r.left));
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.at(-1)!).toBeLessThanOrEqual(keyLeft + 1);
  await fits(page, 390);

  // Inbox: one Filters button on the first row; the filters open under it.
  await page.goto(paths.inbox(seeded.slug, "updates"));
  const filters = page.getByRole("button", { name: "Filters" });
  await expect(filters).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /^Type: / })).toBeHidden();
  await filters.click();
  await expect(page.getByRole("button", { name: /^Type: / })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark all read" }),
  ).toBeVisible();
  await fits(page, 390);

  // The agent page: the accountable person's name is whole; the
  // explanation beside it wraps instead.
  await page.goto(`${paths.factory(seeded.slug)}/agents/${agentId}`);
  const owner = page
    .getByRole("main")
    .getByText("Annemarie Oyelaran-Castellanos", { exact: true })
    .first();
  await expect(owner).toBeVisible();
  expect(await owner.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await fits(page, 390);
});
