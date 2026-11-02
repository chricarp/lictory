import type { MetadataRoute } from "next";

export const dynamic = "force-static";

import {
  siteDescription,
  siteName,
  siteThemeColors,
} from "@lictory/marketing/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteName,
    short_name: siteName,
    description: siteDescription,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: siteThemeColors.light,
    theme_color: siteThemeColors.light,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
