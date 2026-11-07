type SearchParams = { toString(): string };

const withSearchParams = (path: string, searchParams?: SearchParams) => {
  const query = searchParams?.toString();
  return query ? `${path}?${query}` : path;
};

export const paths = {
  org: (org: string) => `/${org}`,
  newOrganization: "/new-organization",
  // Instance administration (instance administrators only): overview, users,
  // organizations, activity.
  admin: (section?: string) => `/admin${section ? `/${section}` : ""}`,
  intelligence: (org: string) => `/${org}/intelligence`,
  intelligenceChat: (org: string, chat: string) =>
    `/${org}/intelligence/${chat}`,
  // Resolves any work item identifier (PAY-142) to its project route.
  itemByKey: (org: string, key: string) => `/${org}/items/${key}`,
  inbox: (org: string) => `/${org}/inbox`,
  // Content search results: `q`, and optionally `kind` and `project`.
  search: (org: string, params: Record<string, string>) =>
    withSearchParams(`/${org}/search`, new URLSearchParams(params)),
  notificationSettings: (org: string) => `/${org}/inbox/settings`,
  // Organization settings: general, members, projects, security, audit, types,
  // integrations, intelligence.
  settings: (org: string, section?: string) =>
    `/${org}/settings${section ? `/${section}` : ""}`,
  // Lictory Spaces: every space I can read, one space's home and settings,
  // and a page (addressed by its id, which never changes when it moves).
  spaces: (org: string) => `/${org}/spaces`,
  space: (org: string, space: string) =>
    `/${org}/spaces/${encodeURIComponent(space)}`,
  spaceSettings: (org: string, space: string) =>
    `/${org}/spaces/${encodeURIComponent(space)}/settings`,
  spacePage: (org: string, space: string, page: string) =>
    `/${org}/spaces/${encodeURIComponent(space)}/pages/${page}`,
  account: (returnTo?: string) =>
    returnTo ? `/account?returnTo=${encodeURIComponent(returnTo)}` : "/account",
  project: (org: string, project: string) => `/${org}/${project.toLowerCase()}`,
  // Every item, whatever its type, lives at one address. Legacy /epics and
  // /stories addresses redirect here.
  item: (
    org: string,
    project: string,
    id: string,
    searchParams?: SearchParams,
  ) =>
    withSearchParams(
      `/${org}/${project.toLowerCase()}/items/${id}`,
      searchParams,
    ),
  proposals: (org: string, project: string) =>
    `/${org}/${project.toLowerCase()}/proposals`,
  refinement: (org: string, project: string) =>
    `/${org}/${project.toLowerCase()}/refinement`,
  items: (org: string, project: string, searchParams?: SearchParams) =>
    withSearchParams(`/${org}/${project.toLowerCase()}/items`, searchParams),
  reviews: (org: string, project: string) =>
    `/${org}/${project.toLowerCase()}/reviews`,
  view: (org: string, project: string, view: string) =>
    `/${org}/${project.toLowerCase()}/views/${view}`,
  // Delivery surfaces belong to the project; `team` narrows them to one of
  // its teams.
  board: (org: string, project: string, team?: string | null) =>
    `/${org}/${project.toLowerCase()}/board${team ? `?team=${encodeURIComponent(team)}` : ""}`,
  backlog: (org: string, project: string, team?: string | null) =>
    `/${org}/${project.toLowerCase()}/backlog${team ? `?team=${encodeURIComponent(team)}` : ""}`,
  iteration: (org: string, project: string, iteration: string) =>
    `/${org}/${project.toLowerCase()}/iterations/${iteration}`,
  // A team's own page: its backlog of unplanned work and its intake.
  team: (org: string, project: string, team: string) =>
    `/${org}/${project.toLowerCase()}/teams/${encodeURIComponent(team)}`,
  // Projects delivered in an external tool: what is ready, handed off, and
  // what Jira reports back.
  handoff: (org: string, project: string) =>
    `/${org}/${project.toLowerCase()}/handoff`,
  // Project settings: general, members, disciplines, teams, workflow,
  // planning, delivery, labels, context.
  projectSettings: (org: string, project: string, section?: string) =>
    `/${org}/${project.toLowerCase()}/settings${section ? `/${section}` : ""}`,
};

// Top-level segments that are not workspace pages.
const authPages = new Set([
  "sign-in",
  "sign-up",
  "forgot-password",
  "reset-password",
  "verify-email",
  "welcome",
  "auth-error",
]);
const nonPages = new Set([
  "api",
  "zero",
  "relay",
  "assets",
  "brand",
  "illustrations",
  "og",
]);
const origin = "https://lictory.invalid";

// Only relative destinations inside this app are allowed as post-step
// redirects (sign-in, handle, invitation). Anything else lands on "/".
// Links from before the move to the app host (/app/...) keep working.
export function safeCallbackPath(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return "/";
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  const pathname = url.pathname.replace(/^\/app(?=\/|$)/, "") || "/";
  const first = pathname.split("/")[1] ?? "";
  if (authPages.has(first) || nonPages.has(first)) return "/";
  return `${pathname}${url.search}${url.hash}`;
}

// Every app page except the account flows names a workspace (organization,
// project, item) or the signed-in person.
export function isWorkspacePath(pathname: string) {
  const first = pathname.split("/")[1] ?? "";
  return first !== "" && !authPages.has(first) && !nonPages.has(first);
}
