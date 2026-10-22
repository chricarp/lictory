import {
  test,
  expect,
  type APIResponse,
  type Page,
  type Request,
} from "@playwright/test";
import { consentStatePath } from "./consent-setup";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { createWorkspace } from "./onboarding-helpers";
import { reloadWhenSaved } from "./sync-helpers";
import { paths } from "@lictory/core/lib/paths";
import packageJson from "../package.json" with { type: "json" };
const version = packageJson.version;
const email = "project@example.test";
const reviewerEmail = "engineer@example.test";
const multiOrgEmail = "multi-org@example.test";
const loadingEmail = "loading@example.test";
const revisitEmail = "revisit@example.test";
const password = "Local-test-password-123";
// Give independent browser scenarios distinct client addresses. Production auth
// throttles rapid sign-ins by IP; unrelated tests must not share that budget.
test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(testInfo.line % 254) + 1}`,
  });
});
test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  // Taylor has no handle yet, so signing in must pass the handle step.
  for (const [name, mail, handle] of [
    ["Alex Morgan", email, "alex_morgan"],
    ["Riley Chen", reviewerEmail, "riley_chen"],
    ["Taylor Rivera", multiOrgEmail, null],
    ["Jordan Lee", loadingEmail, "jordan_lee"],
    ["Casey Park", revisitEmail, "casey_park"],
  ] as const) {
    const id = crypto.randomUUID();
    // A worker restarted after a failure re-runs this hook on the same database.
    const inserted = await db
      .insert(s.user)
      .values({ id, name, email: mail, emailVerified: true, handle })
      .onConflictDoNothing()
      .returning({ id: s.user.id });
    if (!inserted.length) continue;
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(password),
    });
  }
  await client.end();
});

test("an existing member can create and switch to another organization", async ({
  page,
}) => {
  await signIn(page, multiOrgEmail);
  // Choosing a handle is required before entering the app.
  await expect(page).toHaveURL(/\/welcome\?next=/);
  const handle = page.getByLabel("Handle");
  await expect(handle).toHaveValue("taylor_rivera");
  await handle.fill("riley_chen");
  await expect(page.getByText("That handle is already taken.")).toBeVisible();
  await handle.fill("@Taylor_R");
  await expect(page.getByText("@taylor_r is available.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/app$/);
  // Signed-in visitors skip the marketing page.
  const home = await page.request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toMatch(/\/app$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/app$/);
  // The landing page stays reachable at /home and leads back to the app.
  await page.goto("/home");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await header.getByRole("link", { name: "Lictory home" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await header.getByRole("link", { name: "Open Lictory" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "First Team",
    project: "First project",
    key: "ONE",
  });
  const firstOrganization = new URL(page.url()).pathname.replace(
    /\/one\/epics$/,
    "",
  );

  await page.getByRole("button", { name: "First Team" }).first().click();
  await page.getByRole("link", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/app\/new-organization$/);
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
  // Switching organizations lands on Lictory Intelligence, the home page.
  await expect(page).toHaveURL(
    new RegExp(`${firstOrganization}/intelligence$`),
  );
});
async function signIn(page: Page, loginEmail = email) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(loginEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/(app|welcome)/);
  // Dev-mode compilation can delay hydration; interact only once scripts settled.
  await page.waitForLoadState("networkidle");
}

test("account settings load outside an organization with an older session", async ({
  page,
}) => {
  await signIn(page);

  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const [user] = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(eq(s.user.email, email));
  await db
    .update(s.session)
    .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000) })
    .where(eq(s.session.userId, user!.id));
  await client.end();

  await page.goto("/app/account");

  await expect(page).toHaveURL(/\/app\/account$/);
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  await expect(
    page.getByText("1 active session", { exact: true }),
  ).toBeVisible();
});

test("appearance preference applies immediately, persists, and follows the system", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page, reviewerEmail);
  await page.goto("/app/account");
  const html = page.locator("html");
  const appearance = page.getByRole("radiogroup", { name: "Mode" });
  await expect(appearance.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(html).not.toHaveClass(/\bdark\b/);

  // System follows the OS as it changes.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).not.toHaveClass(/\bdark\b/);

  const saved = page.waitForResponse("**/api/appearance");
  await appearance.getByRole("radio", { name: "Dark" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  expect((await saved).ok()).toBe(true);

  // Stored on the account: a fresh browser context without local state gets it.
  const other = await page
    .context()
    .browser()!
    .newContext({ storageState: consentStatePath });
  const fresh = await other.newPage();
  await signIn(fresh, reviewerEmail);
  await fresh.goto("/app/account");
  await expect(fresh.locator("html")).toHaveClass(/\bdark\b/);
  await expect(
    fresh
      .getByRole("radiogroup", { name: "Mode" })
      .getByRole("radio", { name: "Dark" }),
  ).toBeChecked();
  await other.close();

  // Keyboard: arrow keys move the selection.
  await appearance.getByRole("radio", { name: "Dark" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(appearance.getByRole("radio", { name: "Light" })).toBeChecked();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).not.toHaveClass(/\bdark\b/);

  // Reset for other tests sharing this user.
  const reset = page.waitForResponse("**/api/appearance");
  await page.keyboard.press("ArrowLeft");
  await expect(appearance.getByRole("radio", { name: "System" })).toBeChecked();
  await reset;
});

test("theme applies immediately in both modes and persists on the account", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page, reviewerEmail);
  await page.goto("/app/account");
  const html = page.locator("html");
  const themes = page.getByRole("radiogroup", { name: "Theme" });
  await expect(themes.getByRole("radio", { name: "Lictory" })).toBeChecked();
  await expect(html).toHaveAttribute("data-theme", "lictory");
  const background = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lictoryLight = await background();

  const saved = page.waitForResponse("**/api/appearance");
  await themes.getByRole("radio", { name: "Nord" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(html).toHaveAttribute("data-theme", "nord");
  await expect(themes.getByRole("radio", { name: "Nord" })).toBeChecked();
  // Nord Snow Storm in light, Polar Night in dark.
  await expect.poll(background).toBe("rgb(236, 239, 244)");
  expect(lictoryLight).not.toBe("rgb(236, 239, 244)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe("rgb(46, 52, 64)");

  // Stored on the account: a fresh browser context without local state gets it.
  const other = await page
    .context()
    .browser()!
    .newContext({ storageState: consentStatePath });
  const fresh = await other.newPage();
  await signIn(fresh, reviewerEmail);
  await fresh.goto("/app/account");
  await expect(fresh.locator("html")).toHaveAttribute("data-theme", "nord");
  await expect(
    fresh
      .getByRole("radiogroup", { name: "Theme" })
      .getByRole("radio", { name: "Nord" }),
  ).toBeChecked();
  await other.close();

  // Keyboard: arrow keys move the selection; reset for other tests.
  await themes.getByRole("radio", { name: "Nord" }).focus();
  const reset = page.waitForResponse("**/api/appearance");
  await page.keyboard.press("ArrowRight");
  await expect(themes.getByRole("radio", { name: "Lictory" })).toBeChecked();
  expect((await reset).ok()).toBe(true);
  await expect(html).toHaveAttribute("data-theme", "lictory");
});

test("prefetched navigation commits immediately and shows a loading state while the server responds", async ({
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
    finish: false,
  });
  // Observe prefetch before the Board link mounts. The route-tree probe alone
  // does not contain the loading UI needed to commit a pending navigation.
  const isBoardPrefetch = (request: Request) => {
    const headers = request.headers();
    return (
      new URL(request.url()).pathname.endsWith("/board") &&
      headers["next-router-prefetch"] === "1" &&
      !headers["next-router-segment-prefetch"]
    );
  };
  // Buffer prefetch so completion is observable even if the browser would
  // otherwise leave the RSC stream open after consuming its loading UI.
  let prefetchDelivered!: (response: APIResponse) => void;
  const boardPrefetch = new Promise<APIResponse>(
    (resolve) => (prefetchDelivered = resolve),
  );
  await page.route("**/app/**", async (route) => {
    if (isBoardPrefetch(route.request())) {
      const response = await route.fetch();
      await route.fulfill({ response });
      prefetchDelivered(response);
    } else {
      await route.continue();
    }
  });
  await page
    .getByRole("button", { name: "Skip and finish", exact: true })
    .click();
  await expect(page).toHaveURL(/\/lds\/epics$/);
  const rail = page.getByRole("navigation", { name: "Workspace" });
  const board = rail.getByRole("link", { name: "Board", exact: true });
  await expect(board).toBeVisible();
  // Hover prioritizes prefetch; network idle does not prove it has completed.
  await board.hover();
  expect((await boardPrefetch).ok()).toBe(true);
  await page.unroute("**/app/**");
  let release!: () => void;
  let navigationHeld = false;
  const slowServer = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/app/**", async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (
      new URL(request.url()).pathname.endsWith("/board") &&
      headers.rsc === "1" &&
      !headers["next-router-prefetch"]
    ) {
      navigationHeld = true;
      await slowServer;
    }
    await route.continue();
  });

  const loading = page.getByRole("main").getByRole("status", {
    name: /^Loading (page|board)$/,
  });
  try {
    await board.click();
    await expect(page).toHaveURL(/\/board$/, { timeout: 2_000 });
    await expect(loading).toBeVisible({ timeout: 2_000 });
    await expect(loading).toHaveAttribute("aria-busy", "true");
    await expect.poll(() => navigationHeld).toBe(true);
  } finally {
    // Release intercepted requests even when an assertion fails.
    release();
  }
  await expect(loading).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Loading project", exact: true }),
  ).toBeVisible();
  await expect(board).toHaveAttribute("aria-current", "page");
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
    await rail.getByRole("link", { name: "Epics", exact: true }).click();
    await expect(page).toHaveURL(/\/rvt\/epics$/);
    await page.getByRole("button", { name: "New epic", exact: true }).click();
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
  await expect(page).toHaveURL(/\/epics\/RVT-1$/);
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

test("work item panels collapse independently and persist across routes and reloads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, reviewerEmail);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Panel layout",
    project: "Panel project",
    key: "PNL",
  });

  await page.getByRole("button", { name: "New epic", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Focused epic");
  await page.getByRole("button", { name: "Create & open" }).click();
  await expect(page).toHaveURL(/\/epics\/PNL-1$/);
  const epicUrl = page.url();
  const filter = page.getByRole("textbox", {
    name: "Filter by title or identifier",
  });
  const heading = page.getByRole("heading", { name: "Focused epic" });
  const initialWidth = (await heading.boundingBox())!.width;
  await page.getByRole("button", { name: "Hide work item list" }).click();
  await expect(filter).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Show work item list" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("navigation", { name: "Workspace" }),
  ).toBeVisible();
  expect((await heading.boundingBox())!.width).toBeGreaterThan(initialWidth);

  const collapseSidebar = page.getByRole("button", {
    name: "Collapse app sidebar",
  });
  await collapseSidebar.focus();
  await page.keyboard.press("Enter");
  const expandSidebar = page.getByRole("button", {
    name: "Expand app sidebar",
  });
  await expect(expandSidebar).toBeFocused();
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await expect(rail).toBeVisible();
  for (const name of [
    "Inbox",
    "Epics",
    "Work items",
    "Reviews",
    "Board",
    "Backlog",
    "Needs review",
    "Blocked",
    "Ready for development",
    "Drafts",
    "Recently updated",
    "Organization settings",
  ]) {
    await expect(rail.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(
    rail.getByRole("link", { name: "Epics", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: "Switch project: Panel project" })
    .click();
  await expect(
    page.getByRole("option", { name: /Panel project/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Switch organization: Panel layout" })
    .click();
  await expect(
    page.getByRole("button", { name: "Panel layout", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(
    page.getByRole("link", { name: "Account settings" }),
  ).toBeVisible();
  await expect(
    page.getByText(`Lictory v${version}`, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await rail.getByRole("link", { name: "Work items", exact: true }).click();
  await expect(page).toHaveURL(/\/pnl\/stories$/);
  await expect(
    rail.getByRole("link", { name: "Work items", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(expandSidebar).toBeVisible();
  await rail.getByRole("link", { name: "Epics", exact: true }).click();
  await page.getByRole("link", { name: /Focused epic/ }).click();
  await expect(heading).toBeVisible();
  await test.info().attach("Focused work item", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.reload();
  await expect(expandSidebar).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show work item list" }),
  ).toBeVisible();
  await expect(filter).toBeHidden();

  // A full list remains accessible through the breadcrumb even when collapsed.
  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Epics", exact: true })
    .click();
  await expect(filter).toBeVisible();
  await page.getByRole("link", { name: /Focused epic/ }).click();
  await expect(filter).toBeHidden();
  await page.getByRole("button", { name: "Show work item list" }).click();
  await expect(filter).toBeVisible();
  await expect(expandSidebar).toBeVisible();
  await expandSidebar.click();
  await expect(collapseSidebar).toBeFocused();

  // The same list preference applies to stories and other non-epic types.
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: /Work items/ })
    .click();
  await expect(page).toHaveURL(/\/pnl\/stories$/);
  await page.keyboard.press("c");
  await page
    .getByRole("dialog", { name: /^Create/ })
    .getByRole("button", { name: /^Type:/ })
    .click();
  await page.getByRole("option", { name: /^Story/ }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Focused story");
  await page.getByRole("button", { name: "Create & open" }).click();
  await expect(page).toHaveURL(/\/stories\/PNL-2$/);
  await page.getByRole("button", { name: "Hide work item list" }).click();
  await page.goto(epicUrl);
  await expect(
    page.getByRole("button", { name: "Show work item list" }),
  ).toBeVisible();
  await expect(filter).toBeHidden();

  // Desktop preferences do not interfere with the mobile navigation drawer.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Show work item list" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Workspace" }).last(),
  ).toBeVisible();
  // Click the exposed backdrop, outside the 260px navigation drawer.
  await page
    .getByRole("button", { name: "Close navigation" })
    .click({ position: { x: 380, y: 100 } });
  await expect(heading).toBeVisible();

  // Layout controls still work if storage reads succeed but writes are blocked.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await page.getByRole("button", { name: "Show work item list" }).click();
  await expect(filter).toBeVisible();
  await page.getByRole("button", { name: "Hide work item list" }).click();
  await expect(filter).toBeHidden();
});

test("epic and story refinement: create, review, block, branch, PR, approve, stale, ready", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  // Onboarding: organization, then project with a key.
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await page.getByLabel("Project", { exact: true }).fill("Payments");
  await expect(page.getByLabel("Key", { exact: true })).toHaveValue("PAYM");
  await createWorkspace(page, {
    organization: "Northstar",
    project: "Payments",
    key: "PAY",
  });
  const workspacePath = new URL(page.url()).pathname;

  // Personal settings leave the organization shell without losing the return
  // destination.
  // Hold the account response to exercise navigation while the menu's Link
  // is still pending. Closing the popover eagerly unmounts that Link.
  let releaseAccount!: () => void;
  const accountResponse = new Promise<void>((resolve) => {
    releaseAccount = resolve;
  });
  let accountRequested!: () => void;
  const accountRequest = new Promise<void>((resolve) => {
    accountRequested = resolve;
  });
  await page.route("**/app/account?**", async (route) => {
    accountRequested();
    await accountResponse;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(
      page.getByText(`Lictory v${version}`, { exact: true }),
    ).toBeVisible();
    const accountLink = page.getByRole("link", { name: "Account settings" });
    await accountLink.click();
    await accountRequest;
    await expect(accountLink).toBeVisible();
  } finally {
    releaseAccount();
  }
  await expect(page).toHaveURL(
    `http://localhost:3001${paths.account(workspacePath)}`,
  );
  await page.unroute("**/app/account?**");
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3001${workspacePath}`);

  // 1. Create an Epic through quick create (keyboard: c).
  await page.keyboard.press("c");
  await page
    .getByRole("dialog", { name: /^Create/ })
    .getByRole("button", { name: /^Type:/ })
    .click();
  await page.getByRole("option", { name: /^Epic/ }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Partial cancellation");
  await page.getByRole("button", { name: "Create & open" }).click();
  await expect(page).toHaveURL(/\/pay\/epics\/PAY-1$/);
  await expect(
    page.getByRole("heading", { name: "Partial cancellation" }),
  ).toBeVisible();

  // 2. Edit Epic content (creates revision 2).
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification" })
    .fill(
      "# Intent\n\nMerchants need to cancel part of a settled transaction.\n\n## Behavior\n\nCancellation reuses the original transaction ID.",
    );
  await page.getByRole("button", { name: /Save revision 2/ }).click();
  await expect(page.getByText("Revision 2 ·").first()).toBeVisible();

  // 3. Create a Story from the dialog, searching and linking its Epic inline.
  await page.keyboard.press("c");
  await page
    .getByRole("dialog", { name: /^Create/ })
    .getByRole("button", { name: /^Type:/ })
    .click();
  await page.getByRole("option", { name: /^Story/ }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Define cancellation API");
  const epicCombobox = page.getByRole("combobox", { name: "Epic: None" });
  await epicCombobox.fill("Partial");
  await page.getByRole("option", { name: /Partial cancellation/ }).click();
  const description = page.getByRole("textbox", { name: "Description" });
  const initialDescriptionHeight = await description.evaluate(
    (textarea) => textarea.getBoundingClientRect().height,
  );
  await description.fill(
    Array.from(
      { length: 24 },
      (_, index) =>
        `Behavior note ${index + 1}: preserve cancellation context.`,
    ).join("\n"),
  );
  await expect
    .poll(() =>
      description.evaluate(
        (textarea) => textarea.getBoundingClientRect().height,
      ),
    )
    .toBeGreaterThan(initialDescriptionHeight);
  expect(
    await description.evaluate((textarea) =>
      Math.ceil(textarea.getBoundingClientRect().height),
    ),
  ).toBeLessThanOrEqual(320);
  await page
    .getByRole("dialog", { name: "Create story" })
    .getByRole("button", { name: "Create Story", exact: true })
    .click();
  await expect(
    page.getByText("Story “Define cancellation API” created"),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Create story" })
    .getByRole("button", { name: "Close" })
    .last()
    .click();

  // Create a second Story inline within the Epic.
  await page.getByRole("button", { name: "Add story" }).click();
  await page
    .getByRole("textbox", { name: "New story title" })
    .fill("Handle provider callback");
  await page.keyboard.press("Enter");
  await expect(page.getByText("PAY-2")).toBeVisible();
  await expect(page.getByText("PAY-3")).toBeVisible();
  await expect(page.getByText("0/2 ready")).toBeVisible();

  // Reorder stories: drag handle is keyboard-accessible (Alt+Arrow).
  await page
    .getByRole("button", { name: /Reorder Handle provider callback/ })
    .focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(async () =>
      (await page.locator("section ul li a").allTextContents()).slice(0, 2),
    )
    .toEqual(["Handle provider callback", "Define cancellation API"]);

  // 4. Open a Story without losing context (Epic stays in breadcrumb).
  await page.getByRole("link", { name: "Define cancellation API" }).click();
  await expect(page).toHaveURL(/\/pay\/stories\/PAY-2\?epic=[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toContainText("Partial cancellation");
  const epicFilter = new URL(page.url()).searchParams.get("epic");
  expect(epicFilter).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Handle provider callback" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/pay/stories/PAY-3\\?epic=${epicFilter}$`),
  );
  await page.getByRole("link", { name: "Define cancellation API" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/pay/stories/PAY-2\\?epic=${epicFilter}$`),
  );

  // 5. Inline status/priority/owner.
  await page
    .getByRole("button", { name: /^Priority:/ })
    .first()
    .click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(
    page.getByRole("button", { name: "Priority: High" }).first(),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: /^Assignee:/ })
    .first()
    .click();
  await page.getByRole("option", { name: /Alex Morgan \(me\)/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Assignee: Alex Morgan" }).first(),
  ).toBeVisible();
  // Refinement is the specification's lifecycle, separate from the team's
  // delivery status.
  await page
    .getByRole("button", { name: /^Refinement:/ })
    .first()
    .click();
  await page.getByRole("option", { name: "In refinement" }).click();
  await expect(
    page.getByRole("button", { name: "Refinement: In refinement" }).first(),
  ).toBeVisible();

  // Labels and milestone (non-material properties) with inline creation.
  await page.getByRole("button", { name: "Labels" }).first().click();
  await page.getByRole("button", { name: "New label" }).click();
  await page.getByRole("textbox", { name: "Label name" }).fill("payments");
  await page.getByRole("radio", { name: "purple" }).click();
  await page.getByRole("button", { name: "Create label" }).click();
  await expect(
    page.getByText("payments", { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^Milestone:/ })
    .first()
    .click();
  await page.getByRole("button", { name: "New milestone" }).click();
  await page
    .getByRole("textbox", { name: "Milestone name" })
    .fill("Q3 release");
  await page.getByRole("button", { name: "Create milestone" }).click();
  await expect(
    page.getByRole("button", { name: "Milestone: Q3 release" }).first(),
  ).toBeVisible();

  // Write the story specification with acceptance criteria.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification" })
    .fill(
      "# Behavior\n\nPOST /cancellations accepts a partial amount.\n\n## Acceptance criteria\n\n- [ ] Duplicate callbacks do not create duplicate cancellations",
    );
  const specificationEditor = page.getByRole("textbox", {
    name: "Specification",
  });
  await specificationEditor.evaluate((textarea: HTMLTextAreaElement) => {
    const start = textarea.value.indexOf("POST");
    textarea.setSelectionRange(start, start + 4);
  });
  const specificationToolbar = specificationEditor
    .locator("..")
    .getByRole("toolbar", { name: "Markdown formatting" });
  await specificationToolbar.getByRole("button", { name: "Bold (⌘B)" }).click();
  await expect(specificationEditor).toHaveValue(/\*\*POST\*\*/);
  await specificationToolbar.getByRole("button", { name: "Bold (⌘B)" }).click();
  await expect(specificationEditor).not.toHaveValue(/\*\*POST\*\*/);
  await specificationToolbar
    .getByRole("button", { name: "Preview Markdown" })
    .click();
  await expect(page.getByRole("heading", { name: "Behavior" })).toBeVisible();
  await page.getByRole("button", { name: "Continue writing" }).click();
  await page.getByRole("button", { name: /Save revision 2/ }).click();
  await expect(
    page.getByText("Duplicate callbacks do not create duplicate cancellations"),
  ).toBeVisible();

  // Invite the engineer so they can review.
  await page.getByRole("link", { name: "Organization settings" }).click();
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await page.getByLabel("Teammate email or username").fill("@riley_chen");
  await page.getByRole("button", { name: "Send invitation" }).click();
  const invitation = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  const reviewerContext = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "192.0.2.254" },
    storageState: consentStatePath,
  });
  const reviewer = await reviewerContext.newPage();
  await signIn(reviewer, reviewerEmail);
  await reviewer.goto(invitation);
  await reviewer.getByRole("button", { name: "Accept invitation" }).click();
  await expect(reviewer).toHaveURL(/\/app\/northstar/);

  // The administrator adds the engineer to the project in the Engineering
  // discipline. Until then the new member cannot even be asked to review.
  const orgSlug = page.url().split("/app/")[1]!.split("/")[0]!;
  await page.goto(paths.projectSettings(orgSlug, "PAY", "members"));
  await page.getByRole("button", { name: "Add people" }).click();
  await page.getByRole("option", { name: /Riley Chen/ }).click();
  const rileyDisciplines = page
    .getByLabel("Disciplines of Riley Chen")
    .getByRole("button", { name: "Engineering", exact: true });
  await rileyDisciplines.click();
  await expect(rileyDisciplines).toHaveAttribute("aria-pressed", "true");

  // 6. Request Engineering review from the story page.
  const storyUrl = `/app/${orgSlug}/pay/stories/PAY-2`;
  await page.goto(storyUrl);
  await page.getByRole("button", { name: "Request review" }).click();
  await expect(
    page.getByRole("button", { name: "Reviewing discipline" }),
  ).toContainText("Engineering");
  await page.getByRole("button", { name: "Reviewer", exact: true }).click();
  await page.getByRole("option", { name: /Riley Chen/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Request review" })
    .click();
  await expect(page.getByText("Requested", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refinement: In review" }).first(),
  ).toBeVisible();

  // 18. Reviewer uses Needs my review; row shows the request.
  await reviewer.goto(storyUrl.replace(/\/stories\/PAY-2$/, "/reviews"));
  await expect(
    reviewer.getByRole("link", { name: "Define cancellation API" }),
  ).toBeVisible();
  await reviewer.getByRole("link", { name: "Define cancellation API" }).click();
  await expect(reviewer).toHaveURL(/\/stories\/PAY-2$/);

  // Presence: both are on PAY-2, so each sees the other. A newly connected
  // viewer may wait for the next 20-second heartbeat from the existing viewer.
  await expect(
    page.getByText("Riley Chen is viewing", { exact: false }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    reviewer.getByText("Alex Morgan is viewing", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });

  // 7-8. Reviewer opens a blocking discussion anchored to the text; owner replies.
  await reviewer
    .getByRole("textbox", { name: "Start a discussion" })
    .fill("What happens when the provider answers after the client timeout?");
  await reviewer.getByText("Blocks readiness").click();
  await reviewer
    .getByRole("button", { name: "Post blocking discussion" })
    .click();
  await expect(
    page.getByText(
      "What happens when the provider answers after the client timeout?",
    ),
  ).toBeVisible();
  await expect(page.getByText("1 open · 1 blocking")).toBeVisible();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const replyBox = page.getByRole("textbox", { name: "Reply" });
  await replyBox.fill(
    "Late answers are acknowledged and reconciled against the original ID. cc ",
  );
  // Typing @ offers members; choosing one stores a mention token.
  await replyBox.pressSequentially("@ril");
  await expect(page.getByRole("option", { name: /@riley_chen/ })).toBeVisible();
  await page.getByRole("option", { name: /Riley Chen/ }).click();
  await expect(replyBox).toHaveValue(/@\[riley_chen\]\(mention:[^)]+\) $/);
  // Typing a full handle links it without using the list.
  await replyBox.pressSequentially("and @alex_morgan ");
  await expect(replyBox).toHaveValue(
    /@\[riley_chen\]\(mention:[^)]+\) and @\[alex_morgan\]\(mention:[^)]+\) $/,
  );
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(
    reviewer.getByText(
      "Late answers are acknowledged and reconciled against the original ID.",
    ),
  ).toBeVisible();
  await expect(reviewer.getByText("@riley_chen").first()).toBeVisible();

  // Inbox updates: the owner hears about the blocking discussion; the
  // reviewer about the review request and the mention (not also a reply).
  const orgPath = storyUrl.replace(/\/pay\/stories\/PAY-2$/, "");
  const ownerInbox = await page.context().newPage();
  await ownerInbox.goto(`${orgPath}/inbox`);
  await expect(
    ownerInbox.getByText("Riley Chen opened a blocking discussion on PAY-2"),
  ).toBeVisible();
  await ownerInbox.close();
  const reviewerInbox = await reviewerContext.newPage();
  // The old notifications URL lands in the Inbox.
  await reviewerInbox.goto(`${orgPath}/notifications`);
  await expect(reviewerInbox).toHaveURL(/\/inbox$/);
  await expect(
    reviewerInbox.getByText("Alex Morgan mentioned you on PAY-2"),
  ).toBeVisible();
  await expect(
    reviewerInbox.getByText(
      "Alex Morgan requested Engineering review of PAY-2",
    ),
  ).toBeVisible();
  await expect(
    reviewerInbox.getByText("Alex Morgan replied on PAY-2"),
  ).toHaveCount(0);
  await expect(
    reviewerInbox.getByRole("link", { name: /^Inbox/ }),
  ).toContainText("2");
  // The same review request is also current work in "To do".
  await reviewerInbox.getByRole("tab", { name: /^To do/ }).click();
  await expect(reviewerInbox.getByText("Review requested")).toBeVisible();
  await reviewerInbox.getByRole("tab", { name: /^Updates/ }).click();
  await reviewerInbox.getByRole("button", { name: "Mark all read" }).click();
  await expect(reviewerInbox.getByText("You're all caught up")).toBeVisible();
  await expect(
    reviewerInbox.getByRole("link", { name: /^Inbox/ }),
  ).not.toContainText("2");
  // Preferences: email is an option of an enabled notification only.
  await reviewerInbox
    .getByRole("link", { name: "Notification settings" })
    .click();
  const mentionSwitch = reviewerInbox.getByRole("switch", {
    name: "Mentioned",
    exact: true,
  });
  const mentionRow = reviewerInbox
    .getByRole("listitem")
    .filter({ has: mentionSwitch });
  await expect(mentionSwitch).toHaveAttribute("aria-checked", "true");
  await expect(
    mentionRow.getByRole("checkbox", { name: "Also send an email" }),
  ).toBeChecked();
  const savedPreference = reviewerInbox.waitForResponse(
    (r) =>
      r.url().endsWith("/api/notifications") && r.request().method() === "POST",
  );
  await mentionSwitch.click();
  expect((await savedPreference).ok()).toBe(true);
  await expect(
    mentionRow.getByRole("checkbox", { name: "Also send an email" }),
  ).toHaveCount(0);
  await reviewerInbox.reload();
  await expect(
    reviewerInbox.getByRole("switch", { name: "Mentioned", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await reviewerInbox
    .getByRole("switch", { name: "Mentioned", exact: true })
    .click();
  await reviewerInbox.close();

  // Collaborators resolve overlapping commits against the exact new head.
  await page.getByRole("button", { name: /Branches & pull requests/ }).click();
  await page
    .getByRole("textbox", { name: "New branch name" })
    .fill("conflict-lab");
  await page
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  await expect(page).toHaveURL(/\?branch=[^&]+$/);
  const conflictBranchUrl = page.url();
  await page.getByRole("combobox", { name: "Invite collaborator" }).click();
  await page.getByRole("option", { name: "Riley Chen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove Riley Chen", exact: true }),
  ).toBeVisible();
  await reviewer.goto(conflictBranchUrl);
  await expect(
    reviewer.getByRole("textbox", { name: "Branch specification" }),
  ).toBeVisible();
  const sourceText = await page
    .getByRole("textbox", { name: "Branch specification" })
    .inputValue();
  await page
    .getByRole("textbox", { name: "Branch specification" })
    .fill(sourceText.replace("partial amount", "bounded amount"));
  await reviewer
    .getByRole("textbox", { name: "Branch specification" })
    .fill(sourceText.replace("partial amount", "specified amount"));
  await page
    .getByRole("textbox", { name: "Commit message" })
    .fill("Bound the amount");
  await page
    .getByRole("button", { name: "Commit changes", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Commit message" }),
  ).toHaveValue("");
  await reviewer
    .getByRole("textbox", { name: "Commit message" })
    .fill("Resolve amount wording");
  await expect(
    reviewer.getByText("Another commit overlaps your edits", { exact: false }),
  ).toBeVisible();
  await reviewer
    .getByRole("button", { name: "Resolve & commit", exact: true })
    .click();
  await reviewer
    .getByRole("button", { name: "Keep theirs", exact: true })
    .click();
  await reviewer
    .getByRole("button", { name: "Commit resolution", exact: true })
    .click();
  await expect(
    reviewer.getByRole("textbox", { name: "Branch specification" }),
  ).toHaveValue(/bounded amount/);
  await expect(
    reviewer.getByRole("textbox", { name: "Commit message" }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Delete branch", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\?branches=1$/);
  await page.getByRole("button", { name: /Main · revision 2/ }).click();
  await reviewer.goto(storyUrl);

  // 9-12. The owner commits on a branch; Engineering reviews the PR.
  await expect(
    reviewer.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    reviewer.getByRole("button", { name: "Suggest", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Branches & pull requests/ }).click();
  await page
    .getByRole("textbox", { name: "New branch name" })
    .fill("cancellation-timeouts");
  await page
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  await expect(page).toHaveURL(/\?branch=/);
  const branchUrl = page.url();
  await page
    .getByRole("textbox", { name: "Branch specification" })
    .fill(
      "# Behavior\n\nPOST /cancellations accepts a partial amount.\n\nLate provider responses are reconciled against the original transaction ID.\n\n## Acceptance criteria\n\n- [ ] Duplicate callbacks do not create duplicate cancellations",
    );
  await page
    .getByRole("textbox", { name: "Commit message" })
    .fill("Define cancellation timeouts");
  await page
    .getByRole("button", { name: "Commit changes", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Commit message" }),
  ).toHaveValue("");
  // The branch draft is durable locally and main still shows revision 2.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Branch specification" }),
  ).toHaveValue(/Late provider responses/);
  await page
    .getByRole("button", { name: "Open pull request", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Pull request title" })
    .fill("Clarify cancellation timeouts and retries");
  await page
    .getByRole("textbox", { name: "Pull request description" })
    .fill("Review late provider responses and duplicate callbacks.");
  await page
    .getByRole("button", { name: "Create draft PR", exact: true })
    .click();
  await expect(page).toHaveURL(/\?pr=/);
  const prUrl = page.url();
  await expect(
    page.getByRole("button", { name: "Merge pull request", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Ready for review", exact: true })
    .click();
  await reviewer.goto(prUrl);
  await reviewer.getByRole("tab", { name: "Changes", exact: true }).click();
  await expect(
    reviewer.getByText(/Late provider responses/).first(),
  ).toBeVisible();
  await reviewer.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Merge pull request", exact: true })
    .click();
  await expect(
    page.getByText("Merged. The reviewed content is recorded", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Main · revision 3/ }).click();
  await reviewer.getByRole("button", { name: /Main · revision 3/ }).click();
  await expect(page.getByText("Revision 3 ·").first()).toBeVisible();
  await expect(page.getByText("1 / 1 approved")).toBeVisible();
  // Deleting a merged PR keeps the automatic branch cleanup activity.
  await page.goto(prUrl);
  await page
    .getByRole("button", { name: "Delete pull request", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\?branches=1$/);
  await expect(
    page.getByRole("button", {
      name: /Clarify cancellation timeouts and retries/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("listitem").filter({
      hasText: "Lictory automatically deleted branch cancellation-timeouts",
    }),
  ).toHaveCount(1);
  await page.goto(branchUrl);
  await expect(page.getByText("This branch is unavailable.")).toBeVisible();
  await page.getByRole("button", { name: /Main · revision 3/ }).click();

  // 13-14. Owner changes the specification → approval becomes outdated.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification" })
    .fill(
      "# Behavior\n\nPOST /cancellations accepts a partial amount up to the settled total.\n\nLate provider responses are reconciled against the original transaction ID.\n\n## Acceptance criteria\n\n- [ ] Duplicate callbacks do not create duplicate cancellations",
    );
  await page
    .getByRole("textbox", { name: "Change summary" })
    .fill("Bound the amount");
  await page.getByRole("button", { name: /Save revision 4/ }).click();
  await expect(page.getByText("0 / 1 approved")).toBeVisible();
  await page.getByRole("button", { name: /earlier approval/ }).click();
  await expect(page.getByText(/approved revision 3 · outdated/)).toBeVisible();
  // Reviewer sees what changed since their approval.
  await expect(
    reviewer.getByText(/Changed since you last looked: revision 3 → 4/),
  ).toBeVisible();
  await reviewer.getByRole("button", { name: "View changes" }).click();
  await expect(
    reviewer.getByText("up to the settled total").first(),
  ).toBeVisible();
  await reviewer.getByRole("button", { name: "Close comparison" }).click();

  // 15-16. Resolve the blocking discussion, approve again → readiness passes → Ready.
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(
    page.getByText("No open discussions.", { exact: false }),
  ).toBeVisible();
  await reviewer.getByRole("button", { name: "Approve revision 4" }).click();
  await expect(page.getByText("1 / 1 approved")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refinement: Ready" }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(
      "All checks pass; this specification is ready for development.",
    ),
  ).toBeVisible();

  // 17. Navigate quickly between stories via keyboard in the split view.
  await page.goto(storyUrl.replace(/\/PAY-2$/, ""));
  await page.getByRole("link", { name: "Define cancellation API" }).hover();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stories\/PAY-(2|3)$/);
  // URL-persisted filters: filter by label, reload, filter still applied.
  await page.goto(storyUrl.replace(/\/PAY-2$/, "?label=") + "");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Labels" }).click();
  await page.getByRole("option", { name: "payments" }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/label=/);
  await expect(
    page.getByRole("link", { name: "Define cancellation API" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Handle provider callback" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Handle provider callback" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Define cancellation API" }),
  ).toBeVisible();
  // Cross-project identifier route.
  await page.goto(storyUrl.replace(/\/pay\/stories\/PAY-2$/, "/items/PAY-1"));
  await expect(page).toHaveURL(/\/pay\/epics\/PAY-1$/);
  await page.keyboard.press("Meta+k");
  await page.getByRole("textbox", { name: "Search" }).fill("PAY-1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/epics\/PAY-1$/);
  await expect(page.getByText("1/2 ready")).toBeVisible();

  // 19. Offline queue survives reload; reconnect propagates.
  await page.goto(storyUrl);
  await expect(
    page.getByRole("toolbar", { name: "Markdown formatting" }),
  ).toBeVisible();
  await page.route("**/api/sync**", (route) =>
    route.abort("internetdisconnected"),
  );
  await page
    .getByRole("textbox", { name: "Start a discussion" })
    .fill("Pending comment survives reload");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const pendingDiscussion = page
    .getByRole("article", { name: "discussion" })
    .getByText("Pending comment survives reload");
  await expect(pendingDiscussion).toBeVisible();
  await page.reload();
  await expect(pendingDiscussion).toBeVisible();
  await page
    .getByRole("button", {
      name: /Everything is saved|Saving|Reconnecting|offline|Sync needs your help/,
    })
    .click();
  const syncDialog = page.getByRole("dialog", { name: "Workspace sync" });
  await expect(syncDialog).toContainText("trying again automatically");
  await expect(syncDialog.getByText("Technical details")).toBeVisible();
  await expect(syncDialog.locator("pre")).toHaveCount(0);
  await page.unroute("**/api/sync**");
  await syncDialog
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  await expect(
    reviewer
      .getByRole("article", { name: "discussion" })
      .getByText("Pending comment survives reload"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Everything is saved" }),
  ).toBeVisible({ timeout: 30_000 });

  // Inbox for the owner mentions the item; archive/restore round trip.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(reviewer.getByText("Archived", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(reviewer.getByText("Archived", { exact: true })).toHaveCount(0);
  // History keeps both transitions.
  await expect(reviewer.getByText("restored this item")).toBeVisible();

  await page.screenshot({
    path: "/tmp/lictory-story-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/lictory-story-mobile.png" });
  // Main stays protected after readiness. A restore creates a fresh revision.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore revision 3", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm restore revision 3", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close comparison", exact: true })
    .click();
  await expect(page.getByText("Revision 5 ·").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    reviewer.getByRole("button", { name: "Approve revision 5", exact: true }),
  ).toBeVisible();
  await reviewerContext.close();
});

test("native delivery: plan a sprint, move cards on the board, readiness gates starting, complete with carry-over", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, multiOrgEmail);
  await page
    .getByRole("button", { name: /First Team|Second Team/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Create organization" }).click();
  await createWorkspace(page, {
    organization: "Delivery Co",
    project: "Checkout",
    key: "CHK",
    planning: "manual",
  });

  // A Task (plain work) and a Story (specification) through quick create.
  for (const [type, title] of [
    ["Task", "Add payment method column"],
    ["Story", "Save a card for later"],
  ] as const) {
    await page.keyboard.press("c");
    await page
      .getByRole("dialog", { name: /^Create/ })
      .getByRole("button", { name: /^Type:/ })
      .click();
    await page.getByRole("option", { name: new RegExp(`^${type}`) }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
    await page
      .getByRole("button", { name: `Create ${type}`, exact: true })
      .click();
    await expect(page.getByText(`${type} “${title}” created`)).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // Plan: create a sprint and drag both items into it, then start it.
  await page.getByRole("link", { name: "Backlog & sprints" }).click();
  await page.getByRole("button", { name: "New sprint" }).click();
  const sprint = page.locator("section[aria-label='Iteration']").first();
  await expect(sprint.getByText("Iteration 1")).toBeVisible();
  for (const title of ["Add payment method column", "Save a card for later"]) {
    await page.locator("[data-row]", { hasText: title }).dragTo(sprint);
    await expect(sprint.getByText(title)).toBeVisible();
  }
  await sprint.getByRole("button", { name: "Start" }).click();
  await expect(sprint.getByText("Active", { exact: true })).toBeVisible();

  // Board: a second member session sees the same board state.
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.getByRole("link", { name: "Board" }).click();
  const column = (name: string) =>
    page.locator("div.w-\\[272px\\]").filter({
      has: page.locator("span.truncate", {
        hasText: new RegExp(`^${name}$`),
      }),
    });
  await page
    .locator("[data-card]", { hasText: "Add payment method column" })
    .dragTo(column("In Progress"));
  await expect(
    column("In Progress").getByText("Add payment method column"),
  ).toBeVisible();
  // Warn (default): the Story starts, and the early start is surfaced.
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("In Progress"));
  await expect(
    page.getByText(/started before its specification is ready/),
  ).toBeVisible();
  await reloadWhenSaved(page);
  await expect(
    column("In Progress").getByText("Save a card for later"),
  ).toBeVisible();

  // Block: the project now requires a ready specification to start work.
  await page.getByRole("link", { name: "Project settings" }).click();
  await page.getByRole("link", { name: "Readiness", exact: true }).click();
  await page.getByRole("radio", { name: /^Block/ }).click();
  await expect(page.getByRole("radio", { name: /^Block/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Everything is saved" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("Todo"));
  await expect(column("Todo").getByText("Save a card for later")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Everything is saved" }),
  ).toBeVisible();
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("In Progress"));
  await expect(page.getByText(/requires a ready specification/)).toBeVisible();
  await expect(column("Todo").getByText("Save a card for later")).toBeVisible();

  // Cards open a preview docked over the board instead of leaving it.
  const storyCard = page.locator("[data-card]", {
    hasText: "Save a card for later",
  });
  const taskCard = page.locator("[data-card]", {
    hasText: "Add payment method column",
  });
  await storyCard.click();
  const storyPreview = page.getByRole("complementary", {
    name: "Preview of CHK-2",
  });
  await expect(
    storyPreview.getByRole("heading", { name: "Save a card for later" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/board\?(.*&)?item=CHK-2/);
  await expect(storyPreview.getByText("Readiness checks")).toBeVisible();
  // Another card swaps the content in place, and its status can be changed
  // from the preview.
  await taskCard.click();
  const taskPreview = page.getByRole("complementary", {
    name: "Preview of CHK-1",
  });
  await expect(
    taskPreview.getByRole("heading", { name: "Add payment method column" }),
  ).toBeVisible();
  await expect(storyPreview).toBeHidden();
  await taskPreview
    .getByRole("button", { name: "Status: In Progress" })
    .click();
  await page.getByRole("option", { name: /^Todo/ }).click();
  await expect(
    column("Todo").getByText("Add payment method column"),
  ).toBeVisible();
  await taskPreview.getByRole("button", { name: "Status: Todo" }).click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  await expect(
    column("In Progress").getByText("Add payment method column"),
  ).toBeVisible();
  // The close icon, an outside click and Escape all dismiss it; a reload
  // keeps it open.
  await taskPreview.getByRole("button", { name: "Close preview" }).click();
  await expect(taskPreview).toBeHidden();
  await expect(page).not.toHaveURL(/item=/);
  await storyCard.click();
  await reloadWhenSaved(page);
  await expect(
    storyPreview.getByRole("heading", { name: "Save a card for later" }),
  ).toBeVisible();
  await page.getByRole("heading", { name: "Checkout", exact: true }).click();
  await expect(storyPreview).toBeHidden();
  await storyCard.click();
  await page.keyboard.press("Escape");
  await expect(storyPreview).toBeHidden();

  // The detail picker checks readiness before queueing: a blocked transition keeps
  // the status, explains why in a toast, and leaves the item usable.
  await storyCard.click();
  await storyPreview.getByRole("link", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/stories\/CHK-2$/);
  const detailProperties = page
    .getByRole("heading", { name: "Properties", exact: true })
    .locator("..");
  await detailProperties.getByRole("button", { name: "Status: Todo" }).click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  const rejectionToast = page.locator('[data-slot="toast"]', {
    hasText: "Change not applied",
  });
  await expect(rejectionToast).toContainText(/CHK-2 is not ready to start/);
  await expect(
    detailProperties.getByRole("button", { name: "Status: Todo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The workspace could not be synced" }),
  ).toBeHidden();
  await detailProperties.getByRole("button", { name: /^Priority:/ }).click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(
    detailProperties.getByRole("button", { name: "Priority: High" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Everything is saved", exact: true }),
  ).toBeVisible();
  await expect(rejectionToast).toHaveCount(1);
  await page.reload();
  await expect(
    detailProperties.getByRole("button", { name: "Status: Todo" }),
  ).toBeVisible();
  await expect(
    detailProperties.getByRole("button", { name: "Priority: High" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Everything is saved", exact: true })
    .click();
  const syncDialog = page.getByRole("dialog", { name: "Workspace sync" });
  await expect(syncDialog.getByText("Technical details")).toBeHidden();
  await syncDialog.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(
    detailProperties.getByRole("button", { name: "Priority: High" }),
  ).toBeVisible();
  await expect(
    detailProperties.getByRole("button", { name: "Status: Todo" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Board", exact: true }).click();

  // Finish the task, complete the sprint, carry the story to the backlog.
  await page
    .locator("[data-card]", { hasText: "Add payment method column" })
    .dragTo(column("Done"));
  await expect(
    column("Done").getByText("Add payment method column"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Backlog & sprints" }).click();
  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("option", { name: "Backlog" }).click();
  const backlog = page.locator("section[aria-label='Backlog']");
  await expect(backlog.getByText("Save a card for later")).toBeVisible();
  await page.getByRole("link", { name: /Iteration 1/ }).click();
  await expect(page.getByRole("heading", { name: "Burndown" })).toBeVisible();
  await expect(page.getByText("Carried over")).toBeVisible();
});

test("a shared private link preserves its destination after sign-in and denies nonmembers", async ({
  page,
}) => {
  // A real organization owned by someone else, not just an unknown slug.
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client);
    const [owner] = await db
      .select({ id: s.user.id })
      .from(s.user)
      .where(eq(s.user.email, reviewerEmail));
    const organizationId = crypto.randomUUID();
    await db.insert(s.organization).values({
      id: organizationId,
      name: "Confidential acquisition team",
      slug: "unavailable-private-team",
      createdAt: new Date(),
    });
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: owner!.id,
      role: "owner",
      createdAt: new Date(),
    });
  } finally {
    await client.end();
  }
  const destination =
    "/app/unavailable-private-team/pay/epics/PAY-42?tab=review";
  await page.goto(destination);
  await expect(
    page.getByRole("heading", { name: "Sign in to Lictory" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Lictory" }),
  ).toBeHidden();
  await expect(page).toHaveURL(
    new RegExp("/app/unavailable-private-team/pay/epics/PAY-42\\?tab=review$"),
  );
  await expect(
    page.getByRole("heading", { name: "This workspace was not found" }),
  ).toBeVisible();
});
