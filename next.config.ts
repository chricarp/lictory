import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // PostHog's SDK posts to paths with a trailing slash (`/relay/e/`). The default
  // redirect would cost every analytics request a round trip through the relay.
  skipTrailingSlashRedirect: true,
  // Native document converter for Lictory Intelligence Context: loaded from
  // node_modules at runtime instead of being bundled.
  serverExternalPackages: ["@firecrawl/anydoc"],
};

export default nextConfig;
