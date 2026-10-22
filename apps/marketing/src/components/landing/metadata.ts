import type { Metadata } from "next";

import {
  guidesFeedPath,
  siteDescription,
  siteTitle,
} from "@lictory/marketing/lib/site";
import { socialMetadata } from "@lictory/marketing/lib/social-preview";

export const landingMetadata: Metadata = {
  ...socialMetadata("marketing"),
  title: { absolute: siteTitle },
  description: siteDescription,
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
    canonical: "/",
    // Plain-text overview for AI assistants (https://llmstxt.org).
    types: {
      "text/plain": [{ url: "/llms.txt", title: "Lictory for LLMs" }],
      "application/rss+xml": [{ url: guidesFeedPath, title: "Guides" }],
    },
  },
};
