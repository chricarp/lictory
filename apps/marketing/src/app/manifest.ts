import type { MetadataRoute } from "next";

import {
  siteDescription,
  siteName,
  siteThemeColor,
} from "@lictory/marketing/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteName,
    short_name: siteName,
    description: siteDescription,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: siteThemeColor,
    theme_color: siteThemeColor,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
