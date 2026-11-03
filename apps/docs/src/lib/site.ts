// Production builds set SITE_URL; empty or unset falls back to the
// development server, never a public domain.
function origin(value: string | undefined) {
  const configured = value?.trim();
  if (!configured) return "http://localhost:3200";
  return new URL(configured).origin;
}

/** Public facts the documentation links to. */
export const site = {
  name: "Lictory Docs",
  description:
    "Documentation for Lictory: collaborative, review-driven requirements refinement with native or Jira delivery. Concepts, a team guide and self-hosting.",
  /** Canonical origin, fixed at build time (the pages are prerendered). */
  url: origin(process.env.SITE_URL),
  website: "https://lictory.com",
  repository: "https://github.com/chricarp/lictory",
} as const;
