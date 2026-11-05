import { test, expect } from "@playwright/test";
import { createWorkspace } from "../helpers/onboarding-helpers";
import packageJson from "../../package.json" with { type: "json" };
import { appHome } from "../helpers/app-urls";
import { clientAddress } from "../helpers/client-address";
import { people, seedPeople, signIn } from "../helpers/workspace-people";

// The persistent workspace shell: switching organizations, navigation,
// local history on first paint and resizable panes.
const version = packageJson.version;
const multiOrgEmail = people.multiOrg[1];
const loadingEmail = people.loading[1];
const revisitEmail = people.revisit[1];
const panesEmail = people.panes[1];
// Give independent browser scenarios distinct client addresses. Production auth
// throttles rapid sign-ins by IP; unrelated tests must not share that budget.
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});
test.beforeAll(() => seedPeople("multiOrg", "loading", "revisit", "panes"));

test("an existing member can create and switch to another organization", async ({
  page,
}) => {
  await signIn(page, multiOrgEmail);
  // Choosing a handle is required before entering the app.
  await expect(page).toHaveURL(/\/welcome\?next=/);
  const handle = page.getByLabel("Handle");
  await expect(handle).toHaveValue("taylor_rivera");
  // A handle seeded by this file: another file's people may not exist yet.
  await handle.fill(people.loading[2]);
  await expect(page.getByText("That handle is already taken.")).toBeVisible();
  await handle.fill("@Taylor_R");
  await expect(page.getByText("@taylor_r is available.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(appHome);
  await page.goto("/welcome");
  await expect(page).toHaveURL(appHome);
  // The app host's root is the signed-in entry page, never the landing page.
  await page.goto("/");
  await expect(page).toHaveURL(appHome);
  await expect(
    page.getByRole("button", { name: "Create a workspace", exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "First Team",
    project: "First project",
    key: "ONE",
  });
  const firstOrganization = new URL(page.url()).pathname.replace(
    /\/one\/proposals$/,
    "",
  );

  await page.getByRole("button", { name: "First Team" }).first().click();
  await page.getByRole("link", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/new-organization$/);
  await createWorkspace(page, {
    organization: "Second Team",
    project: "Second project",
    key: "TWO",
  });
  expect(new URL(page.url()).pathname).not.toContain(firstOrganization);

  // The built version remains discoverable in the mobile navigation drawer.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(
    page.getByText(`Lictory v${version}`, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Close navigation" })
    .click({ position: { x: 380, y: 20 } });
  await page.setViewportSize(viewport);

  await page.getByRole("button", { name: "Second Team" }).first().click();
  await page.getByRole("button", { name: "First Team" }).first().click();
  // Switching organizations lands on Litto, the home page.
  await expect(page).toHaveURL(
    new RegExp(`${firstOrganization}/intelligence$`),
  );
});

test("navigation commits immediately inside the persistent shell and shows a loading state while the page loads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, loadingEmail);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Loading states",
    project: "Loading project",
    key: "LDS",
  });
  await expect(page).toHaveURL(/\/lds\/proposals$/);
  const rail = page.getByRole("navigation", { name: "Workspace" });
  const board = rail.getByRole("link", { name: "Board", exact: true });
  await expect(board).toBeVisible();
  const railNode = await rail.elementHandle();
  // Hold the Board page's code (requested on hover intent and on click) to
  // observe the pending navigation.
  let release!: () => void;
  let codeHeld = false;
  const slowCode = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/assets/board-*.js", async (route) => {
    codeHeld = true;
    await slowCode;
    await route.continue();
  });
  const loading = page.getByRole("main").getByRole("status", {
    name: /^Loading (page|board)$/,
  });
  try {
    await board.click();
    await expect(page).toHaveURL(/\/board$/);
    await expect.poll(() => codeHeld).toBe(true);
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("aria-busy", "true");
    // The shell stays mounted while the page loads.
    expect(await railNode.evaluate((node) => node.isConnected)).toBe(true);
  } finally {
    // Release intercepted requests even when an assertion fails.
    release();
  }
  await expect(loading).toBeHidden();
  await page.unroute("**/assets/board-*.js");
  await expect(
    page.getByRole("heading", { name: "Loading project", exact: true }),
  ).toBeVisible();
  await expect(board).toHaveAttribute("aria-current", "page");
  expect(await railNode.evaluate((node) => node.isConnected)).toBe(true);
});

test("revisiting a work item paints its local history on the first frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, revisitEmail);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Revisits",
    project: "Revisit project",
    key: "RVT",
  });
  const rail = page.getByRole("navigation", { name: "Workspace" });
  const watch = page.getByRole("button", { name: /^Watch(ing)?$/ });
  for (const title of ["First epic", "Second epic"]) {
    await rail.getByRole("link", { name: "All items", exact: true }).click();
    await expect(page).toHaveURL(/\/rvt\/items$/);
    await page.getByRole("button", { name: "New item", exact: true }).click();
    await page
      .getByRole("button", { name: "Type: Story", exact: true })
      .click();
    await page.getByRole("option", { name: /^Epic/ }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
    await page.getByRole("button", { name: "Create & open" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/^Revision 1 ·/).first()).toBeVisible();
    await expect(watch).toBeVisible();
  }
  // Record every painted frame of the revisit in which the first epic's
  // heading is shown without the rest of its page.
  await page.evaluate(() => {
    const gaps: string[] = [];
    let frames = 0;
    (window as unknown as { revisit: unknown }).revisit = {
      gaps,
      frames: () => frames,
    };
    const sample = () => {
      frames++;
      const main = document.querySelector("main");
      const shown = [...(main?.querySelectorAll("h1") ?? [])].some(
        (h) => h.textContent?.trim() === "First epic",
      );
      if (shown) {
        const text = main!.textContent ?? "";
        const watching = [...main!.querySelectorAll("button")].some((b) =>
          /^Watch(ing)?$/.test(b.textContent?.trim() ?? ""),
        );
        if (!text.includes("Revision 1 ·"))
          gaps.push(`frame ${frames}: revision`);
        if (!watching) gaps.push(`frame ${frames}: watch`);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // A slower device makes every intermediate render observable.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.getByRole("link", { name: /First epic/ }).click();
  await expect(page).toHaveURL(/\/items\/RVT-1(\?.*)?$/);
  await expect(page.getByRole("heading", { name: "First epic" })).toBeVisible();
  const frames = () =>
    page.evaluate(() =>
      (
        window as unknown as { revisit: { frames: () => number } }
      ).revisit.frames(),
    );
  const settled = (await frames()) + 30;
  await expect.poll(frames).toBeGreaterThan(settled);
  expect(
    await page.evaluate(
      () => (window as unknown as { revisit: { gaps: string[] } }).revisit.gaps,
    ),
  ).toEqual([]);
});

test("panes resize by dragging or keyboard, snap, fold, reset and persist", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, panesEmail);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Pane widths",
    project: "Pane project",
    key: "PWD",
  });
  await page.getByRole("button", { name: "New proposal", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Resizable story");
  await page.getByRole("button", { name: "Create & open" }).click();
  await expect(page).toHaveURL(/\/items\/PWD-1(\?.*)?$/);

  const list = page.locator("[data-work-item-list]");
  const rail = page.locator("[data-desktop-item-panel]");
  const listEdge = page.getByRole("separator", {
    name: "Resize work item list",
  });
  const railEdge = page.getByRole("separator", {
    name: "Resize review and details",
  });
  const width = async (pane: typeof list) =>
    Math.round((await pane.boundingBox())!.width);
  const drag = async (edge: typeof listEdge, dx: number) => {
    const box = (await edge.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 6 });
    return {
      release: () => page.mouse.up(),
    };
  };

  // The list's header and the item's header share one bottom border.
  const bottom = async (header: typeof list) => {
    const box = (await header.boundingBox())!;
    return box.y + box.height;
  };
  const itemHeader = page.locator("header", {
    has: page.getByRole("navigation", { name: "Breadcrumb" }),
  });
  expect(await bottom(list.locator("header"))).toBe(await bottom(itemHeader));

  // Dragging the list's edge widens it and the document gives up the room.
  const listDefault = await width(list);
  await (await drag(listEdge, 40)).release();
  await expect.poll(() => width(list)).toBe(listDefault + 40);
  await expect(listEdge).toHaveAttribute(
    "aria-valuenow",
    String(listDefault + 40),
  );

  // A drag that ends near the default settles on it.
  await (await drag(listEdge, -35)).release();
  await expect.poll(() => width(list)).toBe(listDefault);

  // Arrow keys move the edge in 16px steps; the width survives a reload.
  await listEdge.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(list)).toBe(listDefault + 32);
  await page.reload();
  await expect.poll(() => width(list)).toBe(listDefault + 32);

  // Esc during a drag puts the edge back where the drag started.
  const cancelled = await drag(listEdge, 12);
  await expect.poll(() => width(list)).toBe(listDefault + 44);
  await page.keyboard.press("Escape");
  await cancelled.release();
  await expect.poll(() => width(list)).toBe(listDefault + 32);

  // Double-click returns to the responsive default.
  await listEdge.dblclick();
  await expect.poll(() => width(list)).toBe(listDefault);

  // The review rail resizes from its own edge, independently of the list.
  const railDefault = await width(rail);
  await (await drag(railEdge, -40)).release();
  await expect.poll(() => width(rail)).toBe(railDefault + 40);
  await expect.poll(() => width(list)).toBe(listDefault);

  // Dragging the list well past its minimum folds it away; the toggle
  // brings it back at the width it had.
  await (await drag(listEdge, -400)).release();
  await expect(list).toBeHidden();
  await expect(listEdge).toBeHidden();
  await page.getByRole("button", { name: "Show work item list" }).click();
  await expect.poll(() => width(list)).toBe(listDefault);

  // Phones keep the drawers; nothing to drag there.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(listEdge).toBeHidden();
  await expect(railEdge).toBeHidden();
});
