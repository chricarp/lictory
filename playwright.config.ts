import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 90_000,
  outputDir: "/tmp/lictory-playwright-results",
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run dev --port 3001",
    url: "http://localhost:3001/sign-in",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
