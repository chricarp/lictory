import type { Page } from "@playwright/test";

// ui-sdk keeps empty live regions on the page for its own announcements (a
// button that stays busy, a result count). A page-wide alert or status means
// the application's own.
const own = (page: Page) => page.locator(":not([data-ui-sdk-announcer])");

export const appAlert = (page: Page) => page.getByRole("alert").and(own(page));

export const appStatus = (page: Page) =>
  page.getByRole("status").and(own(page));
