import { defineConfig } from "@playwright/test";
import { consentStatePath } from "./tests/consent-setup";
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/consent-setup.ts",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  outputDir: "/tmp/lictory-playwright-results",
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
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
