import type { Metadata } from "next";

import { socialMetadata } from "~/lib/social-preview";

// Served at "/" for anonymous visitors and at "/home" for everyone; "/" stays
// canonical so search engines index the page once.
export const landingMetadata: Metadata = {
  ...socialMetadata("marketing"),
  title: { absolute: "Lictory: requirements, reviewed like code" },
  description:
    "Lictory turns rough product intent into approved, implementation-ready specifications, then delivers the work natively or publishes it to Jira and Linear.",
  alternates: { canonical: "/" },
};
