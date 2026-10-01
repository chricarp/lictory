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
  const posthogRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("posthog")) posthogRequests.push(request.url());
  });

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
  expect(posthogRequests).toEqual([]);

  await page.getByRole("button", { name: "Privacy preferences" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Analytics", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Accept All" }).click();
  await expect(dialog).toBeHidden();
  expect(await storedConsents(page)).toMatchObject({ measurement: true });

  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Accept All" })).toBeHidden();
});
