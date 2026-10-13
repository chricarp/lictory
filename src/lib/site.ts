// Public facts about the website shared by metadata, structured data, robots,
// the sitemap and llms.txt, so search engines and AI assistants read one story.

/** The canonical public origin. Never derived from a request Host header. */
export const siteUrl = new URL(
  process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
).origin;

export function absoluteUrl(path: string) {
  return new URL(path, siteUrl).toString();
}

export const siteName = "Lictory";
export const siteTitle = "Lictory: requirements, reviewed like code";
export const siteTagline = "Requirements, reviewed like code.";

export const siteDescription =
  "Lictory turns rough product intent into approved, implementation-ready specifications, then delivers the work natively or publishes it to Jira and Linear.";

/** A self-contained summary that still makes sense when quoted on its own. */
export const siteSummary =
  "Lictory is a work-management platform for software teams built around collaborative, review-driven requirements refinement. Product, engineering and QA review specifications the way developers review code: with immutable revisions, diffs, anchored discussion threads, actionable suggestions, approvals bound to a specific revision and evidence-based readiness checks. Approved work is then delivered natively in Lictory (boards, backlog, sprints and cycles) or published to Jira or Linear.";

/** Public, indexable pages. Signed-in and authentication pages are excluded. */
export const publicPages = [
  {
    path: "/source",
    title: "Source code",
    description: "Get the corresponding source for this Lictory deployment.",
    changeFrequency: "monthly",
    priority: 0.3,
  },
  {
    path: "/",
    title: siteTitle,
    description: siteDescription,
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/sign-up",
    title: "Create your Lictory account",
    description: "Start refining specifications with your team for free.",
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/privacy",
    title: "Privacy Notice",
    description:
      "How Lictory processes account, collaboration and technical data, and how to exercise your privacy rights.",
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    path: "/terms-of-service",
    title: "Terms of Service",
    description:
      "Terms for using Lictory’s collaborative requirements review and work-management service.",
    changeFrequency: "yearly",
    priority: 0.3,
  },
] as const;
