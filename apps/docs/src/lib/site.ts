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

export function absoluteUrl(path: string) {
  return new URL(path, site.url).toString();
}

/** The `.md` URL of a page's Markdown version (served by the Worker). */
export function markdownPath(url: string) {
  return url === "/" ? "/index.md" : `${url}.md`;
}

/** The website's social card, shared by every documentation page. */
export const socialImage = {
  url: `${site.website}/og/marketing`,
  width: 1200,
  height: 630,
  alt: "Lictory: requirements, reviewed like code",
} as const;

/** Search snippet policy for every documentation page. */
export const indexableRobots = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-snippet": -1,
    "max-image-preview": "large",
    "max-video-preview": -1,
  },
} as const;
