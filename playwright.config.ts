import { defineConfig } from "@playwright/test";
import { consentStatePath } from "./tests/consent-setup";

// Browser workflows run against production builds started by
// scripts/test-e2e.ts: the platform behind a local stand-in for the production
// edge proxy (SPA assets, API, Zero), the marketing site on its own origin and
// the documentation's static export behind its Cloudflare Worker.
const platformURL = process.env.E2E_PLATFORM_URL ?? "http://localhost:3001";
const marketingURL = process.env.E2E_MARKETING_URL ?? "http://localhost:3101";
const docsURL = process.env.E2E_DOCS_URL ?? "http://localhost:3201";

export default defineConfig({
  globalSetup: "./tests/consent-setup.ts",
  workers: 1,
  // One CI retry absorbs runner timing noise; a pass on retry is still
  // reported as flaky so the underlying race gets fixed, not hidden.
  retries: process.env.CI ? 1 : 0,
  // Report each test as it finishes so a hanging test is visible in CI logs.
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 90_000,
  // A broken step should fail in seconds, not consume the whole test timeout
  // (twice, with the retry). Known-slow waits pass their own timeout.
  expect: { timeout: 15_000 },
  // Separate per port offset: Playwright empties this directory on start.
  outputDir: `/tmp/lictory-playwright-results${process.env.E2E_PORT_OFFSET ? `-${process.env.E2E_PORT_OFFSET}` : ""}`,
  use: {
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    storageState: consentStatePath,
  },
  projects: [
    {
      name: "platform",
      testDir: "./tests/platform",
      use: { baseURL: platformURL },
    },
    {
      name: "marketing",
      testDir: "./tests/marketing",
      use: { baseURL: marketingURL },
    },
    {
      name: "docs",
      testDir: "./tests/docs",
      use: { baseURL: docsURL },
    },
  ],
});
