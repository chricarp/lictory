import { defineConfig } from "@playwright/test";

// The laptop trial (deploy/try.sh) running the images of a published release.
// Not part of `bun run test:e2e`, which builds the checkout's own code: CI
// starts the trial first, then runs
//
//   bunx playwright test --config tests/try/playwright.config.ts
//
// with LICTORY_TRY_URL, LICTORY_TRY_MAIL_URL and the administrator's
// LICTORY_TRY_EMAIL / LICTORY_TRY_PASSWORD.
export default defineConfig({
  testDir: ".",
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: "/tmp/lictory-playwright-try",
  use: {
    baseURL: process.env.LICTORY_TRY_URL ?? "http://localhost",
    headless: true,
    screenshot: "only-on-failure",
  },
});
