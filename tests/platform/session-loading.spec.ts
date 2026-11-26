import { test, expect, type Page } from "@playwright/test";
import { seedWorkspace, signIn, type Seeded } from "../helpers/seed";
import { useClientAddress } from "../helpers/client-address";

// Every page waits for the session check before it renders. A slow check
// shows a loading screen, never a blank page; a check that gets no answer
// ends in an error with a retry.
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

test("a slow session check shows a loading screen, then the page", async ({
  page,
}) => {
  const session = await holdSession(page);
  await page.goto("/sign-in");
  await expect(loading(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  session.release();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(loading(page)).toHaveCount(0);

  // Signed in, a workspace address waits the same way.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await signIn(page, seeded.owner.email);
  const again = await holdSession(page);
  await page.goto(seeded.projectPath("/items"));
  await expect(loading(page)).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  again.release();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(loading(page)).toHaveCount(0);
});

test("a session check without an answer offers a retry", async ({ page }) => {
  await page.clock.install();
  const session = await holdSession(page);
  await page.goto("/sign-in");
  await expect(loading(page)).toBeVisible();
  await expect.poll(session.held).toBe(1);
  // Past the session check's timeout.
  await page.clock.fastForward(16_000);
  await expect(
    page.getByRole("heading", { name: "Couldn’t reach the server" }),
  ).toBeVisible();
  await expect(loading(page)).toHaveCount(0);

  // The server answers again.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  session.release();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
