// Social previews of shared platform links. Derived from the path only: never
// load workspace data or echo URL values into the document, so a preview
// reveals nothing a signed-out visitor could not already see.

export const previewLabels = {
  workspace: "Workspace",
  epic: "Epic",
  story: "Story",
  item: "Work item",
  project: "Project",
  board: "Board",
  backlog: "Backlog",
  iteration: "Iteration",
  reviews: "Reviews",
  view: "View",
} as const;
export type PreviewKind = keyof typeof previewLabels;

// Organization-level pages that are not projects.
const organizationPages = new Set([
  "settings",
  "account",
  "inbox",
  "notifications",
  "intelligence",
  "items",
]);

// Top-level application pages outside any organization.
const applicationPages = new Set([
  "sign-in",
  "sign-up",
  "forgot-password",
  "reset-password",
  "verify-email",
  "welcome",
  "auth-error",
  "account",
  "new-organization",
  "invitation",
]);

// Paths are `/[org]/...` (see the SPA URL map); top-level application pages
// (sign-in, account, invitation, ...) have no organization and read as the
// generic workspace.
export function previewKind(path: string): PreviewKind {
  const parts = path.split(/[?#]/, 1)[0]!.split("/").filter(Boolean);
  if (!parts.length || applicationPages.has(parts[0]!)) return "workspace";
  if (parts.length === 3 && parts[1] === "items") return "item";
  if (parts.length < 2 || organizationPages.has(parts[1]!)) return "workspace";
  const section = parts[2];
  if (section === undefined) return "project";
  if (section === "epics" && parts.length >= 4) return "epic";
  if (section === "stories" && parts.length >= 4) return "story";
  if (section === "reviews") return "reviews";
  if (section === "views") return "view";
  if (section === "board") return "board";
  if (section === "backlog") return "backlog";
  if (section === "iterations") return "iteration";
  if (section === "teams") {
    if (parts[4] === "board") return "board";
    if (parts[4] === "backlog") return "backlog";
  }
  return "workspace";
}

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

// The `<head>` additions for a platform document: title, description, Open
// Graph and Twitter cards pointing at the marketing site's preview images,
// and noindex. Every value comes from the closed vocabulary above.
export function socialPreviewHead(path: string, siteUrl: string) {
  const kind = previewKind(path);
  const title = `${previewLabels[kind]} in Lictory`;
  const description =
    "Open this link in Lictory. Sign in with an account that has access to see the details.";
  const image = `${siteUrl.replace(/\/$/, "")}/og/${kind}`;
  const meta = (attribute: "name" | "property", key: string, value: string) =>
    `<meta ${attribute}="${key}" content="${escape(value)}" />`;
  return [
    `<title>${escape(title)}</title>`,
    meta("name", "description", description),
    meta("name", "robots", "noindex, nofollow"),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("property", "og:site_name", "Lictory"),
    meta("property", "og:type", "website"),
    meta("property", "og:locale", "en_US"),
    meta("property", "og:image", image),
    meta("property", "og:image:width", "1200"),
    meta("property", "og:image:height", "630"),
    meta("property", "og:image:alt", title),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", title),
    meta("name", "twitter:description", description),
    meta("name", "twitter:image", image),
  ].join("\n    ");
}
