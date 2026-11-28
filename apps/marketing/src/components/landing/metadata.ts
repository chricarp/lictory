import type { Metadata } from "next";

import {
  absoluteUrl,
  guidesFeedPath,
  indexableRobots,
  siteDescription,
  siteTitle,
} from "@lictory/marketing/lib/site";
import { socialMetadata } from "@lictory/marketing/lib/social-preview";

// Next.js writes a "/" metadata URL resolved against metadataBase as the bare
// origin (https://lictory.com), while the sitemap and JSON-LD name the home
// page https://lictory.com/. With no metadataBase, Next.js keeps an absolute
// URL string exactly as given, so this page builds its URLs with absoluteUrl,
// like the sitemap, and the canonical matches its sitemap entry.
export const landingMetadata: Metadata = {
  metadataBase: null,
  ...socialMetadata("marketing"),
  title: { absolute: siteTitle },
  description: siteDescription,
  robots: indexableRobots,
  keywords: [
    "requirements management",
    "requirements review",
    "specification review",
    "product requirements",
    "acceptance criteria",
    "definition of ready",
    "engineering readiness",
    "agile refinement",
    "backlog refinement",
    "Jira alternative",
    "Linear alternative",
  ],
  alternates: {
    canonical: absoluteUrl("/"),
    // Plain-text overview for AI assistants (https://llmstxt.org).
    types: {
      "text/plain": [
        { url: absoluteUrl("/llms.txt"), title: "Lictory for LLMs" },
      ],
      "application/rss+xml": [
        { url: absoluteUrl(guidesFeedPath), title: "Guides" },
      ],
    },
  },
};
