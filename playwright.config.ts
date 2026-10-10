import { defineConfig } from "@playwright/test";
import { consentStatePath } from "./tests/consent-setup";
export default defineConfig({
  testDir: "./tests",
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
  outputDir: "/tmp/lictory-playwright-results",
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    storageState: consentStatePath,
  },
  webServer: {
    command: "bun run build && bun run start --port 3001",
    url: "http://localhost:3001/sign-in",
    reuseExistingServer: false,
    timeout: 180_000,
    // Keep browser tests from sending events to a PostHog project configured in .env.
    env: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "" },
  },
});
