import { test, expect, type Page } from "@playwright/test";

function storedConsents(page: Page) {
  return page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("c15t") ?? "null") as {
      consents?: Record<string, boolean>;
    } | null;
    return stored?.consents;
  });
}

test.use({ storageState: { cookies: [], origins: [] } });

test("visitors choose analytics consent and can reopen their choice", async ({
  page,
}) => {
  await page.goto("/");
  const reject = page.getByRole("button", { name: "Reject All" });
  await expect(reject).toBeVisible();
  await reject.focus();
  await page.keyboard.press("Enter");
  await expect(reject).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "Accept All" })).toBeHidden();
  expect(await storedConsents(page)).toMatchObject({
    necessary: true,
    measurement: false,
  });
  // Without consent PostHog may run cookieless, but never sets its identifier.
  const cookies = await page.context().cookies();
  expect(cookies.filter((cookie) => cookie.name.startsWith("ph_"))).toEqual([]);

  await page.getByRole("button", { name: "Privacy preferences" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Analytics", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Accept All" }).click();
  await expect(dialog).toBeHidden();
  expect(await storedConsents(page)).toMatchObject({ measurement: true });

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept All" })).toBeHidden();
});

test("the analytics relay stays closed while analytics is not configured", async ({
  request,
}) => {
  // Browser tests build without a PostHog project, so nothing is forwarded.
  for (const method of ["get", "post"] as const) {
    const response = await request[method]("/relay/e/");
    expect(response.status()).toBe(404);
    expect(response.headers()["set-cookie"]).toBeUndefined();
  }
});
