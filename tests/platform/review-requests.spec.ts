import { test, expect } from "@playwright/test";
import { seedItem, seedWorkspace, signIn } from "../helpers/seed";
import { controlZeroConnection } from "../helpers/zero-socket";

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
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Request review" }).click();
  await dialog
    .getByRole("button", { name: "Request Engineering and QA reviews" })
    .click();
  // The popover closes only once the server accepted every request.
  await expect(dialog).toBeHidden();
  await expect(page.getByText("0 / 2 approved")).toBeVisible();
  const reviews = page.getByRole("list", { name: "Requested reviews" });
  await expect(reviews.getByRole("listitem")).toHaveCount(2);
  for (const discipline of ["Engineering", "QA"]) {
    const row = reviews.getByRole("listitem").filter({
      has: page.getByText(discipline, { exact: true }),
    });
    await expect(row).toContainText("Requested");
    await expect(row.getByText(`Anyone in ${discipline}`)).toBeVisible();
  }
  // Once every other discipline is asked, the shortcut is no longer offered.
  await page.getByRole("button", { name: "Request review" }).click();
  await expect(
    dialog.getByRole("button", { name: /^Request .* reviews$/ }),
  ).toHaveCount(0);
});

test("a refused request keeps the popover open and names what was requested", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Review refusals",
    key: "RRF",
    users: ["Dana Product", "Eli Engineer", "Fay Tester"],
    disciplines: { 1: "Engineering", 2: "QA" },
  });
  await seedItem(seeded, {
    title: "Refund partial captures",
    description: "# Behavior\n\nA partial capture can be refunded.",
  });
  const zero = await controlZeroConnection(page);
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.itemPath(1));
  // The second request names a discipline the server does not know.
  let requests = 0;
  zero.rewrite((mutation) => {
    if (mutation.command.type === "requestReview" && ++requests === 2)
      mutation.command.disciplineId = crypto.randomUUID();
  });
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Request review" }).click();
  await dialog
    .getByRole("button", { name: "Request Engineering and QA reviews" })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Requested Engineering. QA was not requested:",
  );
  await expect(dialog).toBeVisible();
  await expect(page.getByText("0 / 1 approved")).toBeVisible();
});
