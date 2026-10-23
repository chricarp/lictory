import { test, expect } from "@playwright/test";
import {
  newPerson,
  seedItem,
  seedWorkspace,
  signIn,
  type Seeded,
} from "../helpers/seed";

// The SPA serves every address from one document: a hard load or reload of
// any nested route must render that route directly, and addresses that do
// not exist must say so instead of falling back to the home page.

let seeded: Seeded;
let teamId: string;

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Deep Links",
    key: "DL",
    users: ["Dana Links"],
  });
  await seedItem(seeded, {
    title: "Refund webhooks",
    description: "# Behavior\n\nWebhooks are signed.",
  });
  teamId = crypto.randomUUID();
  await seeded.command({
    type: "createTeam",
    projectId: seeded.projectId,
    teamId,
    name: "Payments core",
  });
});

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.150" });
});

test("nested routes render directly on load and reload", async ({ page }) => {
  await signIn(page, seeded.owner.email);

  await page.goto(seeded.itemPath(1));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Refund webhooks", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Webhooks are signed.")).toBeVisible();

  const item = `${seeded.itemPath(1)}?branches=1`;
  await page.goto(item);
  await expect(
    page.getByRole("heading", { name: "Branches & pull requests" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "New branch name" }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${item.replace("?", "\\?")}$`));
  await expect(
    page.getByRole("heading", { name: "Branches & pull requests" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "New branch name" }),
  ).toBeVisible();

  const teams = seeded.projectPath("/settings/teams");
  await page.goto(teams);
  await expect(page.getByLabel("Team name Payments core")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${teams}$`));
  await expect(page.getByLabel("Team name Payments core")).toBeVisible();

  const members = `/${seeded.slug}/settings/members`;
  await page.goto(members);
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${members}$`));
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toBeVisible();

  const board = seeded.projectPath(`/board?team=${teamId}`);
  await page.goto(board);
  await expect(
    page.getByRole("button", { name: "Payments core", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/board\\?team=${teamId}$`));
  await expect(
    page.getByRole("button", { name: "Payments core", exact: true }),
  ).toBeVisible();

  // The document for every route is the same SPA shell, never cached.
  const response = await page.request.get(item);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.text()).toContain('<div id="root">');
});

test("unknown addresses explain that they do not exist", async ({ page }) => {
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.projectPath("/no-such-page"));
  await expect(
    page.getByRole("heading", { name: "This page does not exist" }),
  ).toBeVisible();
  await expect(
    page.getByText("Deep Links project has no page at this address."),
  ).toBeVisible();

  await page.goto(seeded.itemPath(999));
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();

  await page.goto(`/no-such-workspace-${crypto.randomUUID().slice(0, 6)}`);
  await expect(
    page.getByRole("heading", { name: "This workspace was not found" }),
  ).toBeVisible();

  // A workspace that exists but the person does not belong to looks the same.
  const other = await seedWorkspace({
    name: "Someone Else",
    key: "SE",
    users: ["Sam Else"],
  });
  await page.goto(other.itemPath(1));
  await expect(
    page.getByRole("heading", { name: "This workspace was not found" }),
  ).toBeVisible();
  await expect(page.getByText("Someone Else")).toHaveCount(0);
});

test("signed-in people skip the signed-out account pages", async ({ page }) => {
  await signIn(page, seeded.owner.email);
  for (const path of ["/sign-in", "/sign-up", "/forgot-password"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/${seeded.slug}(/|$)`));
  }
  // A requested destination is honored instead of the home page.
  const target = seeded.itemPath(1);
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(target)}`);
  await expect(page).toHaveURL(target);
  await expect(
    page.getByRole("heading", { name: "Refund webhooks" }),
  ).toBeVisible();
});

test("an anonymous deep link signs in and returns to the same place", async ({
  browser,
}) => {
  const { context, page } = await newPerson(browser, "192.0.2.151");
  try {
    const target = `${seeded.itemPath(1)}?branches=1`;
    await page.goto(target);
    await expect(page).toHaveURL(
      `/sign-in?callbackUrl=${encodeURIComponent(target)}`,
    );
    await page.getByLabel("Email", { exact: true }).fill(seeded.owner.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Seeded-test-password-123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(target);
    await expect(
      page.getByRole("heading", { name: "Branches & pull requests" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "New branch name" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
