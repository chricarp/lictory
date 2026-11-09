import type { MetadataRoute } from "next";

import { absoluteUrl } from "@lictory/docs/lib/site";
import { source } from "@lictory/docs/lib/source";

export const dynamic = "force-static";

// No lastmod: deployments check out a single commit, so a build cannot know
// when a page last changed, and search engines distrust a lastmod that is
// always the build time.
export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: absoluteUrl(page.url),
    changeFrequency: "weekly",
    priority: page.url === "/" ? 1 : 0.7,
  }));
}
