import { test, expect } from "@playwright/test";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
} from "../helpers/seed";

const longTitle =
  "Retry failed card payments without charging the customer twice when the provider times out";

test("the list beside an item keeps titles readable and previews items on hover", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Navigator",
    key: "NAVP",
    users: ["Ari Product", "Eve Engineer"],
    disciplines: { 0: "Product", 1: "Engineering" },
    settings: { deliveryMode: "native" },
  });
  await seedItem(seeded, { title: "Show the refund status" });
  const workItemId = await seedItem(seeded, {
    title: longTitle,
    description: "# Behavior\n\nA retry reuses the original transaction.",
  });
  const engineer = seeded.users[1]!;
  await seeded.command({
    type: "updateWorkItem",
    workItemId,
    priority: "high",
    assigneeId: engineer.id,
  });
  const revision = await currentRevision(workItemId);
  const base = { workItemId, baseRevisionId: revision.id };
  await seeded.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    disciplineId: seeded.roster.disciplines.find(
      (d) => d.projectId === seeded.projectId && d.name === "Engineering",
    )!.id,
    userId: engineer.id,
    required: true,
  });
  await seeded.command(
    {
      type: "createThread",
      ...base,
      threadId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      body: "Which timeout starts the retry?",
      blocking: true,
      section: "",
    },
    engineer.id,
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.itemPath(1));
  await expect(
    page.getByRole("heading", { name: "Show the refund status", level: 1 }),
  ).toBeVisible();

  const list = page.locator("[data-work-item-list]");
  const row = list.locator("[data-item-row]").filter({ hasText: longTitle });
  const title = row.getByRole("link", { name: longTitle });
  // The identifier sits under the title instead of eating into it.
  const titleBox = (await title.boundingBox())!;
  const idBox = (await row.getByText("NAVP-2", { exact: true }).boundingBox())!;
  expect(idBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);

  // Hovering previews what the list already knows, without opening the item.
  await title.hover();
  const preview = page.locator("[data-item-preview]");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(longTitle);
  await expect(preview).toContainText("High");
  await expect(preview).toContainText(engineer.name);
  await expect(preview).toContainText("Engineering");
  await expect(preview).toContainText("Awaiting review");
  await expect(preview).toContainText("1 blocker");
  await expect(page).toHaveURL(/\/items\/NAVP-1(\?.*)?$/);
  await test.info().attach("Work item preview", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  // Leaving the row ends the preview and its highlight; the row's status is
  // still a control.
  await expect(row).toHaveAttribute("data-focused", "true");
  await page
    .getByRole("heading", { name: "Show the refund status", level: 1 })
    .hover();
  await expect(preview).toBeHidden();
  await expect(row).not.toHaveAttribute("data-focused");
  await row.getByRole("button", { name: /^Status:/ }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Opening the item ends the preview too.
  await page
    .getByRole("heading", { name: "Show the refund status", level: 1 })
    .hover();
  await title.hover();
  await expect(preview).toBeVisible();
  await title.click();
  await expect(page).toHaveURL(/\/items\/NAVP-2(\?.*)?$/);
  await expect(preview).toBeHidden();
});
