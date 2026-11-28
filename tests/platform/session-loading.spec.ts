import { test, expect, type Page } from "@playwright/test";
import {
  password,
  seedItem,
  seedWorkspace,
  signIn,
  type Seeded,
} from "../helpers/seed";
import { inApp } from "../helpers/app-urls";
import { useClientAddress } from "../helpers/client-address";

// Workspace pages wait for the session check before they render: a slow
// check shows a loading screen, never a blank page, and a check that gets no
// answer ends in an error with a retry. Account pages (sign-in) never wait
// for it: the form is usable at once. Requests lost on the way (a network
// change aborts every request in flight) never leave a blank page or a form
// that stays busy.
let seeded: Seeded;

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Slow lines",
    key: "SLW",
    users: ["Ada Slow"],
  });
});

test.beforeEach(async ({ page }) => {
  await useClientAddress(page);
});

// Holds every session check until `release` is called.
async function holdSession(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  await page.route(
    (url) => url.pathname === "/api/session",
    async (route) => {
      held += 1;
      await released;
      // The page may have given up on the request already.
      await route.continue().catch(() => undefined);
    },
  );
  return { release, held: () => held };
}

const loading = (page: Page) =>
  page.getByRole("status", { name: "Loading Lictory" });

test("a slow session check never holds the sign-in form", async ({ page }) => {
  // Signed out: the form is usable at once, before the check answers.
  const session = await holdSession(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(seeded.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await expect.poll(session.held).toBeGreaterThan(0);
  await expect(loading(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  session.release();
  await expect(page).toHaveURL(inApp);

  // Signed in: the form shows while the check is slow, and the answer
  // continues the person to the destination they asked for.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const again = await holdSession(page);
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent("/account")}`);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect.poll(again.held).toBeGreaterThan(0);
  again.release();
  await expect(page).toHaveURL(/\/account$/);
});

test("a slow session check shows a loading screen on workspace pages", async ({
  page,
}) => {
  await signIn(page, seeded.owner.email);
  const session = await holdSession(page);
  await page.goto(seeded.projectPath("/items"));
  await expect(loading(page)).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  session.release();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(loading(page)).toHaveCount(0);
});

test("a session check without an answer offers a retry", async ({ page }) => {
  await page.clock.install();
  const session = await holdSession(page);
  await page.goto("/");
  await expect(loading(page)).toBeVisible();
  await expect.poll(session.held).toBe(1);
  // Past the session check's timeout.
  await page.clock.fastForward(16_000);
  await expect(
    page.getByRole("heading", { name: "Couldn’t reach the server" }),
  ).toBeVisible();
  await expect(loading(page)).toHaveCount(0);

  // The server answers again: signed out, the retry reaches the sign-in form.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  session.release();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

// The entry script of the built platform document (its static module graph:
// when one request of it fails, the browser runs none of the app).
const entryScript = (url: URL) =>
  /^\/assets\/index-[\w-]+\.js$/.test(url.pathname);

test("a page whose code fails to load reloads, then says so instead of staying blank", async ({
  page,
}) => {
  // Every load fails: three reloads, then a message with a reload button.
  let failed = 0;
  await page.route(entryScript, async (route) => {
    failed += 1;
    await route.abort("connectionreset");
  });
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Lictory didn’t load" }),
  ).toBeVisible();
  expect(failed).toBe(4);

  // The connection is back: the button loads the page.
  await page.unroute(entryScript);
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();

  // The button started the count again: the next failed load reloads
  // instead of showing the message.
  await page.route(entryScript, (route) => route.abort("connectionreset"), {
    times: 1,
  });
  await page.goto("/sign-in?callbackUrl=%2Faccount");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lictory didn’t load" }),
  ).toHaveCount(0);
});

// Stylesheets that lazy chunks load (the document links only its own).
const lazyStyles = (url: URL) =>
  /^\/assets\/(?!index-)[\w-]+\.css$/.test(url.pathname);

test("a lazy chunk lost on the way reloads the page instead of ending in an error", async ({
  page,
}) => {
  await seedItem(seeded, { title: "Styled specification" });
  await signIn(page, seeded.owner.email);
  let failed = 0;
  await page.route(
    lazyStyles,
    async (route) => {
      failed += 1;
      await route.abort("connectionreset");
    },
    { times: 1 },
  );
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents += 1;
  });
  await page.goto(seeded.itemPath(1));
  // Writing opens the live editor, its own chunk with its own styles.
  await page.getByRole("button", { name: /Describe the intent/ }).click();
  await expect.poll(() => failed).toBe(1);
  // The page reloads itself once the stylesheet failed.
  await expect.poll(() => documents).toBe(2);
  await expect(
    page.getByRole("heading", { name: "Styled specification", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The workspace could not be opened" }),
  ).toHaveCount(0);
});

test("a sign-in request that gets no answer is sent again, and a second failure is shown", async ({
  page,
}) => {
  const signInRequest = "**/api/auth/sign-in/email";
  let failed = 0;
  await page.route(signInRequest, async (route) => {
    failed += 1;
    await route.abort("connectionreset");
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(seeded.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn’t reach Lictory" }),
  ).toHaveText("Couldn’t reach Lictory. Check your connection and try again.");
  expect(failed).toBe(2);
  await expect(submit).toBeEnabled();

  // One request lost on the way: the second one signs the person in.
  await page.unroute(signInRequest);
  await page.route(signInRequest, (route) => route.abort("connectionreset"), {
    times: 1,
  });
  await submit.click();
  await expect(page).toHaveURL(inApp);
});
