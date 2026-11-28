import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// The desktop smoke test (tests/smoke.spec.ts), separate from the web
// suites: it needs the Electron binary (`bun run setup`) and a display
// (xvfb-run on Linux). Run `bun run build` first.
export default defineConfig({
  testDir: "./tests",
  outputDir: path.join(os.tmpdir(), "lictory-desktop-test-results"),
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
});
