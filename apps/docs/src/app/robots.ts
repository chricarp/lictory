import type { MetadataRoute } from "next";

import { absoluteUrl } from "@lictory/docs/lib/site";

export const dynamic = "force-static";

// Every crawler, search engines and AI assistants alike, may read the whole
// documentation, as on lictory.com. Not pages: the analytics relay, and
// /markdown/, the internal target of the public `<page>.md` URLs.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/relay/", "/markdown/"] },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
