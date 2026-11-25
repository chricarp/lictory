import { test, expect, type Page } from "@playwright/test";
import * as s from "@lictory/core/db/schema";
import { paths } from "@lictory/core/lib/paths";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";
import { clientAddress } from "../helpers/client-address";

// The software factory shell: the organization rail, the sidebar's sections
// in their order, Home's lists, the module placeholders, the command
// palette, the resizable sidebar and the phone drawer.
let seeded: Seeded;
let other: Seeded;
const reviewTitle = "Refunds over the API";
const startedTitle = "Retry webhooks with the original key";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Factory floor",
    key: "FLR",
    users: ["Ada Floor", "Grace Floor"],
    settings: { deliveryMode: "native" },
  });
  const owner = seeded.owner;
  // Waiting on Ada: a review of the specification's current revision.
  const engineering = seeded.roster.disciplines.find(
    (d) => d.projectId === seeded.projectId && d.name === "Engineering",
  )!.id;
  await seeded.command({
    type: "setDisciplineMember",
    projectId: seeded.projectId,
    disciplineId: engineering,
    userId: owner.id,
    member: true,
  });
  const reviewed = await seedItem(seeded, { title: reviewTitle });
  const revision = await currentRevision(reviewed);
  await seeded.command({
    type: "requestReview",
    workItemId: reviewed,
    baseRevisionId: revision.id,
    reviewId: crypto.randomUUID(),
    disciplineId: engineering,
    userId: owner.id,
    required: true,
  });
  // In flight: Ada's started work.
  const started = await seedItem(seeded, { type: "Task", title: startedTitle });
  await seeded.command({
    type: "updateWorkItem",
    workItemId: started,
    assigneeId: owner.id,
    statusId: seeded.roster.statuses.find(
      (status) =>
        status.projectId === seeded.projectId && status.category === "started",
    )!.id,
  });
  // A space with a page: Home lists the page, the palette writes new ones.
  const spaceId = crypto.randomUUID();
  await seeded.command({
    type: "createSpace",
    spaceId,
    name: "Runbooks",
    slug: `runbooks-${spaceId.slice(0, 8)}`,
  });
  await seeded.command({
    type: "createPage",
    spaceId,
    pageId: crypto.randomUUID(),
    title: "Rotate webhook secrets",
  });
  // A second organization Ada belongs to.
  other = await seedWorkspace({
    name: "Second floor",
    key: "SEC",
    users: ["Sam Second"],
  });
  await withDb((db) =>
    db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId: other.organizationId,
      userId: owner.id,
      role: "member",
      createdAt: new Date(),
    }),
  );
});

// Screenshots kept with the test's results, as visual evidence.
async function snapshot(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: "image/png" });
}

const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Workspace", exact: true });

test("Home, the rail, the sections and the palette form one shell @smoke", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await signIn(page, seeded.owner.email);
  await page.goto(paths.org(seeded.slug));

  // Home is the organization's index: what waits on me and what I have
  // started, from synchronized state.
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();
  const waiting = page.getByRole("region", { name: "Waiting on you" });
  await expect(
    waiting.getByRole("link", { name: new RegExp(reviewTitle) }),
  ).toBeVisible();
  await expect(waiting).toContainText("Review requested");
  const flight = page.getByRole("region", { name: "In flight" });
  await expect(
    flight.getByRole("link", { name: new RegExp(startedTitle) }),
  ).toBeVisible();
  // An empty section is not shown: nothing is ready to start here.
  await expect(
    page.getByRole("region", { name: "Ready to start" }),
  ).toBeHidden();
  // A factory without code, runners, agents or channels starts with its
  // setup, derived from its data: two people already belong to it.
  const setup = page.getByRole("region", { name: "Set up Factory floor" });
  await expect(setup).toContainText("1 of 5 done");
  await expect(setup.getByRole("link", { name: "Add runner" })).toHaveAttribute(
    "href",
    `/${seeded.slug}/factory/runners`,
  );
  await expect(
    page
      .getByRole("region", { name: "Recently edited pages" })
      .getByRole("link", { name: /Rotate webhook secrets/ }),
  ).toBeVisible();
  await snapshot(page, "Home");
  await expect(
    sidebar(page).getByRole("link", { name: "Home" }),
  ).toHaveAttribute("aria-current", "page");

  // The sections keep their order: the single-row destinations (Home,
  // Inbox, Factory, Code), the project's work, Spaces, then the
  // conversations, whose lists grow.
  expect(
    await sidebar(page)
      .locator("[data-nav-section]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-nav-section")),
      ),
  ).toEqual([
    "home",
    "inbox",
    "factory",
    "code",
    "projects",
    "spaces",
    "channels",
    "direct-messages",
  ]);

  // Every organization I belong to is on the rail; the current one is marked.
  const rail = page.getByRole("navigation", { name: "Organizations" });
  await expect(
    rail.getByRole("link", { name: "Factory floor", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    rail.getByRole("link", { name: "Second floor", exact: true }),
  ).toBeVisible();

  // Module sections link to their pages. Code, with no host connected yet,
  // explains how to connect one.
  await sidebar(page).getByRole("link", { name: "All channels" }).click();
  await expect(page).toHaveURL(paths.channels(seeded.slug));
  await expect(
    page.getByRole("heading", { name: "Channels", level: 1 }),
  ).toBeVisible();
  await sidebar(page).getByRole("link", { name: "Factory", exact: true }).click();
  await expect(page).toHaveURL(paths.factory(seeded.slug));
  await expect(
    page.getByRole("heading", { name: "Factory", level: 1, exact: true }),
  ).toBeVisible();
  // Agents and runners are the Factory page's tabs; the sidebar row stays
  // current on them.
  await page
    .getByRole("main")
    .getByRole("link", { name: "Agents", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(`${paths.factory(seeded.slug)}/agents`);
  await expect(
    sidebar(page).getByRole("link", { name: "Factory", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await sidebar(page).getByRole("link", { name: "Code", exact: true }).click();
  await expect(page).toHaveURL(paths.code(seeded.slug));
  await expect(
    page.getByRole("heading", { name: "Code", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Connect a code host")).toBeVisible();

  // The palette is keyboard first: open, type, choose.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search" });
  await expect(search).toBeFocused();
  // Before typing it suggests the modules.
  await expect(
    palette.getByRole("option", { name: "Go to Home" }),
  ).toBeVisible();
  await search.fill("home");
  await expect(
    palette.getByRole("option", { name: "Go to Home" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(paths.org(seeded.slug));

  // Jump to a project by name.
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("Factory floor project");
  await palette
    .getByRole("option", { name: /^Factory floor project/ })
    .first()
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `${paths.project(seeded.slug, "FLR")}/(refinement|board|items)$`,
    ),
  );

  // Write a page in a space from the palette.
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("new page");
  await palette.getByRole("option", { name: "New page in Runbooks" }).click();
  const newPage = page.getByRole("dialog", { name: "New page" });
  await expect(newPage).toBeVisible();
  await expect(page).not.toHaveURL(/new=page/);
  await newPage.getByRole("button", { name: "Cancel" }).click();

  // Switch the appearance from the palette.
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("dark");
  await palette
    .getByRole("option", { name: "Switch to dark appearance" })
    .click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await snapshot(page, "Dark appearance");
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("light appearance");
  await palette
    .getByRole("option", { name: "Switch to light appearance" })
    .click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

  // Switch organization from the palette, then back from the rail.
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("Second floor");
  await palette.getByRole("option", { name: "Switch to Second floor" }).click();
  await expect(page).toHaveURL(paths.org(other.slug));
  await expect(
    rail.getByRole("link", { name: "Second floor", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await rail.getByRole("link", { name: "Factory floor", exact: true }).click();
  await expect(page).toHaveURL(paths.org(seeded.slug));
});

test("the sidebar resizes, folds to icons and returns", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await signIn(page, seeded.owner.email);
  await page.goto(paths.org(seeded.slug));
  const aside = page.locator("aside[data-sidebar]");
  await expect(aside).toHaveAttribute("data-sidebar", "full");
  const width = async () => Math.round((await aside.boundingBox())!.width);
  const start = await width();
  const edge = page.getByRole("separator", { name: "Resize sidebar" });
  await edge.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(width).toBe(start + 32);
  // The width is remembered.
  await page.reload();
  await expect.poll(width).toBe(start + 32);
  await page.getByRole("separator", { name: "Resize sidebar" }).dblclick();
  await expect.poll(width).toBe(start);

  // A section folds under its caption; the choice survives a reload.
  const spacesCaption = sidebar(page).getByRole("button", {
    name: "Spaces",
    exact: true,
  });
  await spacesCaption.click();
  await expect(
    sidebar(page).getByRole("link", { name: "All spaces" }),
  ).toBeHidden();
  await page.reload();
  await expect(
    sidebar(page).getByRole("link", { name: "All spaces" }),
  ).toBeHidden();
  await sidebar(page)
    .getByRole("button", { name: "Spaces", exact: true })
    .click();
  await expect(
    sidebar(page).getByRole("link", { name: "All spaces" }),
  ).toBeVisible();

  // Collapsed, the sidebar keeps every section as an icon and the rail
  // gives way to the organization menu.
  await page.getByRole("button", { name: "Collapse app sidebar" }).click();
  await expect(aside).toHaveAttribute("data-sidebar", "compact");
  await snapshot(page, "Compact sidebar");
  await expect(
    page.getByRole("navigation", { name: "Organizations" }),
  ).toHaveCount(0);
  for (const name of ["Home", "Inbox", "All channels", "Factory", "Code"])
    await expect(
      sidebar(page).getByRole("link", { name, exact: true }),
    ).toBeVisible();
  await page.getByRole("button", { name: "Expand app sidebar" }).click();
  await expect(aside).toHaveAttribute("data-sidebar", "full");
});

test("the sidebar keeps its place across navigation", async ({ page }) => {
  // Short enough that Spaces sits below the fold.
  await page.setViewportSize({ width: 1440, height: 560 });
  await signIn(page, seeded.owner.email);
  await page.goto(paths.spaces(seeded.slug));
  const nav = sidebar(page);
  const top = () => nav.evaluate((el) => el.scrollTop);
  // A space and then one of its pages, opened from the page: the sidebar
  // never scrolls by itself, so Channels stays in view.
  await page
    .getByRole("main")
    .getByRole("link", { name: /Runbooks/ })
    .first()
    .click();
  await page
    .getByRole("link", { name: "Rotate webhook secrets" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Rotate webhook secrets" }),
  ).toBeVisible();
  expect(await top()).toBe(0);
  await expect(
    nav.getByRole("link", { name: "All channels" }),
  ).toBeInViewport();
});

test("the first Tab stop skips the navigation to the page", async ({
  page,
}) => {
  await signIn(page, seeded.owner.email);
  await page.goto(paths.board(seeded.slug, "FLR"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // From the top of the document.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  // The next Tab stop is in the page, not the sidebar.
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("main")),
  ).toBe(true);
});

test("on a phone the navigation is a drawer with the rail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, seeded.owner.email);
  await page.goto(paths.org(seeded.slug));
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();
  await expect(sidebar(page)).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("navigation", { name: "Organizations" }),
  ).toBeVisible();
  // It slides fully into view from the left edge.
  await expect
    .poll(async () => Math.round((await drawer.boundingBox())?.x ?? -1))
    .toBe(0);
  await snapshot(page, "Phone drawer");
  // Escape closes it; choosing a page closes it too.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(paths.inbox(seeded.slug));
  await expect(drawer).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("inside the desktop app the shell sits under the app's own title bar and follows its navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  // The bridge the desktop app's preload exposes.
  await page.addInitScript(() => {
    const listeners: ((path: string) => void)[] = [];
    const badges: number[] = [];
    Object.assign(window, {
      lictoryDesktop: {
        platform: "darwin",
        version: "0.0.0-test",
        notify: () => undefined,
        setBadge: (count: number) => badges.push(count),
        onNavigate: (listener: (path: string) => void) => {
          listeners.push(listener);
          return () => listeners.splice(listeners.indexOf(listener), 1);
        },
      },
      desktopTest: {
        navigate: (path: string) => listeners.forEach((l) => l(path)),
        badges,
      },
    });
  });
  await signIn(page, seeded.owner.email);
  await page.goto(paths.org(seeded.slug));
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();
  // The desktop app draws the title bar (window buttons, Windows controls)
  // above the page's view, so the page leaves no room for them and moves no
  // window: the rail starts at the top and headers are ordinary.
  const rail = page.getByRole("navigation", { name: "Organizations" });
  expect((await rail.boundingBox())!.y).toBeLessThan(16);
  const header = page.locator("[data-page-header]");
  expect(
    await header.evaluate(
      (node) =>
        getComputedStyle(node).getPropertyValue("app-region") ||
        getComputedStyle(node).getPropertyValue("-webkit-app-region"),
    ),
  ).not.toBe("drag");
  // A deep link or notification click navigates inside the app; other
  // origins are refused.
  await page.evaluate((path) => {
    (
      window as unknown as { desktopTest: { navigate: (p: string) => void } }
    ).desktopTest.navigate(path);
  }, paths.inbox(seeded.slug));
  await expect(page).toHaveURL(paths.inbox(seeded.slug));
  await page.evaluate(() => {
    (
      window as unknown as { desktopTest: { navigate: (p: string) => void } }
    ).desktopTest.navigate("https://example.com/elsewhere");
  });
  await expect(page).toHaveURL(paths.inbox(seeded.slug));
  // The dock badge counts mentions and direct messages (none yet), through
  // the desktop bridge, its only caller.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { desktopTest: { badges: number[] } }).desktopTest
          .badges,
    ),
  ).toContain(0);
});
