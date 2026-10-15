import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Embed the checked-out version in the build, including client components.
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // PostHog's SDK posts to paths with a trailing slash (`/relay/e/`). The default
  // redirect would cost every analytics request a round trip through the relay.
  skipTrailingSlashRedirect: true,
  // Workspace pages are thin wrappers around the client store; reusing their
  // payload for a short time makes revisits instant instead of a server
  // round trip per click.
  experimental: {
    staleTimes: { dynamic: 30 },
  },
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
  // Native document converter for Lictory Intelligence Context: loaded from
  // node_modules at runtime instead of being bundled.
  serverExternalPackages: ["@firecrawl/anydoc"],
};

export default nextConfig;
