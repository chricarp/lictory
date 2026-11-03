import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import { configuredOrigin } from "./src/lib/origin";

// The website imports sources from other workspaces (`@lictory/ui`,
// `@lictory/core`), so bundling and file tracing start at the monorepo root.
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));
const staticExport = process.env.MARKETING_STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // A self-contained server (`.next/standalone/apps/marketing/server.js`) for
  // container images; public files and static chunks are copied next to it.
  output: staticExport ? "export" : "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  // PostHog's SDK posts to paths with a trailing slash (`/relay/e/`). The default
  // redirect would cost every analytics request a round trip through the relay.
  skipTrailingSlashRedirect: true,
  // Content-addressed, pre-sized artwork is served directly, without image transforms.
  async headers() {
    if (staticExport) return [];
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
  async redirects() {
    if (staticExport) return [];
    const siteOrigin = configuredOrigin(
      process.env.SITE_URL,
      "http://localhost:3100",
    );
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: `www.${new URL(siteOrigin).hostname}` }],
        destination: `${siteOrigin}/:path*`,
        permanent: true,
      },
      { source: "/home", destination: "/", permanent: true },
    ];
  },
  // Markdown versions of public pages for AI assistants live at `<page>.md`.
  async rewrites() {
    if (staticExport) return { beforeFiles: [], afterFiles: [], fallback: [] };
    return {
      beforeFiles: [
        {
          source: "/relay/:path*",
          destination: `${process.env.API_ORIGIN ?? (process.env.NODE_ENV === "production" ? "http://api:3002" : "http://localhost:3002")}/relay/:path*`,
        },
        { source: "/guides.md", destination: "/markdown/guides.md" },
        {
          source: "/guides/:slug.md",
          destination: "/markdown/guides/:slug.md",
        },
        {
          source: "/compare/:product.md",
          destination: "/markdown/compare/:product.md",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
