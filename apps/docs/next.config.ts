import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

// Builds read the shared theme from packages/ui, so file tracing starts at the
// monorepo root, as for the website.
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

// The documentation (docs.lictory.com) is always a static export: Cloudflare
// serves the files, and search downloads a prebuilt index (/search.json).
const nextConfig: NextConfig = {
  output: "export",
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  reactStrictMode: true,
};

export default createMDX()(nextConfig);
