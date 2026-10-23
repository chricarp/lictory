import { test, expect, type Page } from "@playwright/test";
import { marketingOrigin, platformOrigin } from "../helpers/app-urls";
import { seedWorkspace, signIn, type Seeded } from "../helpers/seed";

// The website cannot see the application's session; a non-identifying hint
// cookie on the shared domain (here: localhost) switches its calls to action.

let seeded: Seeded;

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.190" });
});

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Signed In Hint",
    key: "SIH",
    users: ["Hana Hint"],
  });
});

async function expectSignedOutWebsite(page: Page) {
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Sign up" })).toBeVisible();
  await expect(banner.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(
    banner.getByRole("link", { name: "Open workspace" }),
  ).toHaveCount(0);
}

test("the website offers the workspace to someone signed in to the application", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${marketingOrigin}/`);
  await expectSignedOutWebsite(page);

  await signIn(page, seeded.owner.email);
  const hint = (await page.context().cookies(platformOrigin)).find(
    (cookie) => cookie.name === "lictory_signed_in",
  );
  expect(hint?.value).toBe("1");
  expect(hint?.httpOnly).toBe(false);

  await page.goto(`${marketingOrigin}/`);
  const banner = page.getByRole("banner");
  const open = banner.getByRole("link", { name: "Open workspace" });
  await expect(open).toBeVisible();
  expect(new URL((await open.getAttribute("href"))!).href).toBe(
    new URL("/", platformOrigin).href,
  );
  await expect(banner.getByRole("link", { name: "Sign up" })).toHaveCount(0);
  await expect(banner.getByRole("link", { name: "Log in" })).toHaveCount(0);
  const hero = page.getByRole("region", {
    name: /Better specs\.\s*Fewer meetings\./,
  });
  await expect(
    hero.getByRole("link", { name: "Open workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Start for free" })).toHaveCount(
    0,
  );

  // Following it lands in the signed-in application.
  await open.click();
  await expect(page).toHaveURL(new RegExp(`^${platformOrigin}/${seeded.slug}`));

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto(`${marketingOrigin}/`);
  await expectSignedOutWebsite(page);
});
