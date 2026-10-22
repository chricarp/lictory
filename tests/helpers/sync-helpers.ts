import { expect, type Page } from "@playwright/test";

// Workspace commands resolve once applied locally; Zero sends them to the
// server in the background. Reloading before the server answered would leave
// the outcome to Zero's replay, so tests wait until the workspace reports no
// change awaiting the server and a live connection.
export async function waitUntilSaved(page: Page) {
  const status = page.locator("[data-sync-status]").first();
  // Pages outside a workspace (onboarding, account) send no workspace changes
  // that a reload could interrupt.
  if ((await status.count()) === 0) return;
  await expect(status, "Workspace changes were not saved.").toHaveAttribute(
    "data-pending",
    "0",
    { timeout: 15_000 },
  );
  await expect(status).toHaveAttribute("data-sync-status", /^(idle|busy)$/);
}

export async function reloadWhenSaved(page: Page) {
  await waitUntilSaved(page);
  await page.reload();
}
