import { test, expect, type Page } from "@playwright/test";
import { password, seedWorkspace, signIn, type Seeded } from "../helpers/seed";
import { inApp } from "../helpers/app-urls";
import { useClientAddress } from "../helpers/client-address";

// Workspace pages wait for the session check before they render: a slow
// check shows a loading screen, never a blank page, and a check that gets no
// answer ends in an error with a retry. Account pages (sign-in) never wait
// for it: the form is usable at once.
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
