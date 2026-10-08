import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Embed the checked-out version in the build, including client components.
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // PostHog's SDK posts to paths with a trailing slash (`/relay/e/`). The default
  // redirect would cost every analytics request a round trip through the relay.
  skipTrailingSlashRedirect: true,
  // Native document converter for Lictory Intelligence Context: loaded from
  // node_modules at runtime instead of being bundled.
  serverExternalPackages: ["@firecrawl/anydoc"],
};

export default nextConfig;
