import { test, expect } from "@playwright/test";
import { seedItem, seedWorkspace, signIn } from "../helpers/seed";

test("one action requests every other reviewing discipline", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Review requests",
    key: "RRQ",
    users: ["Ada Product", "Ben Engineer", "Cleo Tester"],
    disciplines: { 1: "Engineering", 2: "QA" },
  });
  await seedItem(seeded, {
    title: "Retry failed card payments",
    description: "# Behavior\n\nA failed charge is retried once.",
  });
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.itemPath(1));
  await page.getByRole("button", { name: "Request review" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Request Engineering and QA reviews" })
    .click();
  await expect(page.getByText("0 / 2 approved")).toBeVisible();
  await expect(page.getByText("Anyone in Engineering")).toBeVisible();
  await expect(page.getByText("Anyone in QA")).toBeVisible();
  // Once every other discipline is asked, the shortcut is no longer offered.
  await page.getByRole("button", { name: "Request review" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /^Request .* reviews$/ }),
  ).toHaveCount(0);
});
