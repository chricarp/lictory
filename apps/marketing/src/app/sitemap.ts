import type { MetadataRoute } from "next";

export const dynamic = "force-static";

import {
  absoluteUrl,
  marketingImage,
  publicPages,
} from "@lictory/marketing/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPages.map((page) => ({
    url: absoluteUrl(page.path),
    // Search engines trust lastmod only when it is accurate, so pages without a
    // known change date omit it rather than reporting the build time.
    ...("lastModified" in page ? { lastModified: page.lastModified } : {}),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
    ...(page.path === "/"
      ? { images: [absoluteUrl(marketingImage.path)] }
      : {}),
  }));
}
