import { expect, type Page } from "@playwright/test";

// The item header's toggle, named by what it shows: "3 discussions" (and
// ", 1 blocking readiness"), or "Discussions" when none is open.
export const discussionsToggle = (page: Page) =>
  page.getByRole("button", {
    name: /^(?:\d+ discussions?|Discussions)(?:,|$)/,
  });

// Specifications discuss in a panel beside the text (a sheet on narrow
// frames), opened from the item header. Opens it unless it is open already
// and waits until a discussion can be started.
export async function openDiscussions(page: Page) {
  const toggle = discussionsToggle(page);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("textbox", { name: "Start a discussion" }),
  ).toBeVisible();
}
