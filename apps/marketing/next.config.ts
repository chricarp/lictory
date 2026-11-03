import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import { platformHref, platformUrl } from "./src/lib/platform";
import { setting } from "./src/lib/setting";

// The website imports sources from other workspaces (`@lictory/ui`,
// `@lictory/core`), so bundling and file tracing start at the monorepo root.
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));
const staticExport = process.env.MARKETING_STATIC_EXPORT === "true";

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
  distDir: setting(process.env.NEXT_DIST_DIR) ?? ".next",
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
  // Application pages moved to their own origin; links shared or emailed
  // before the split keep working (the query string is preserved).
  async redirects() {
    if (staticExport) return [];
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.lictory.com" }],
        destination: "https://lictory.com/:path*",
        permanent: true,
      },
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
    if (staticExport) return { beforeFiles: [], afterFiles: [], fallback: [] };
    return {
      beforeFiles: [
        {
          source: "/relay/:path*",
          destination: `${setting(process.env.API_ORIGIN) ?? (process.env.NODE_ENV === "production" ? "http://api:3002" : "http://localhost:3002")}/relay/:path*`,
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
