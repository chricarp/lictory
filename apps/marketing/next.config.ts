import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import { platformHref, platformUrl } from "./src/lib/platform";

// The website imports sources from other workspaces (`@lictory/ui`,
// `@lictory/core`), so bundling and file tracing start at the monorepo root.
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const applicationPages = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/welcome",
  "/auth-error",
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // A self-contained server (`.next/standalone/apps/marketing/server.js`) for
  // container images; public files and static chunks are copied next to it.
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  // PostHog's SDK posts to paths with a trailing slash (`/relay/e/`). The default
  // redirect would cost every analytics request a round trip through the relay.
  skipTrailingSlashRedirect: true,
  // Content-addressed, pre-sized artwork is served directly, without image transforms.
  async headers() {
    return [
      {
        source: "/illustrations/:asset*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  // The landing page used to be reachable at /home by signed-in people. The
  // website has no session any more, so the alias would only duplicate "/".
  // Application pages moved to their own origin; links shared or emailed
  // before the split keep working (the query string is preserved).
  async redirects() {
    return [
      { source: "/home", destination: "/", permanent: true },
      { source: "/app", destination: platformHref("/"), permanent: true },
      {
        source: "/app/:path*",
        destination: `${platformUrl}/:path*`,
        permanent: true,
      },
      ...applicationPages.map((source) => ({
        source,
        destination: `${platformUrl}${source}`,
        permanent: true,
      })),
    ];
  },
  // Markdown versions of public pages for AI assistants live at `<page>.md`.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/guides.md", destination: "/markdown/guides" },
        { source: "/guides/:slug.md", destination: "/markdown/guides/:slug" },
        {
          source: "/compare/:product.md",
          destination: "/markdown/compare/:product",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
