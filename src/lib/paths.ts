type SearchParams = { toString(): string };

const withSearchParams = (path: string, searchParams?: SearchParams) => {
  const query = searchParams?.toString();
  return query ? `${path}?${query}` : path;
};

export const paths = {
  org: (org: string) => `/app/${org}`,
  newOrganization: "/app/new-organization",
  intelligence: (org: string) => `/app/${org}/intelligence`,
  intelligenceChat: (org: string, chat: string) =>
    `/app/${org}/intelligence/${chat}`,
  inbox: (org: string) => `/app/${org}/inbox`,
  notificationSettings: (org: string) => `/app/${org}/inbox/settings`,
  // Organization settings: general, members, projects, types, integrations,
  // intelligence.
  settings: (org: string, section?: string) =>
    `/app/${org}/settings${section ? `/${section}` : ""}`,
  account: (returnTo?: string) =>
    returnTo
      ? `/app/account?returnTo=${encodeURIComponent(returnTo)}`
      : "/app/account",
  project: (org: string, project: string) =>
    `/app/${org}/${project.toLowerCase()}`,
  list: (
    org: string,
    project: string,
    kind: "epics" | "stories",
    searchParams?: SearchParams,
  ) =>
    withSearchParams(
      `/app/${org}/${project.toLowerCase()}/${kind}`,
      searchParams,
    ),
  item: (
    org: string,
    project: string,
    kind: "epics" | "stories",
    id: string,
    searchParams?: SearchParams,
  ) =>
    withSearchParams(
      `/app/${org}/${project.toLowerCase()}/${kind}/${id}`,
      searchParams,
    ),
  reviews: (org: string, project: string) =>
    `/app/${org}/${project.toLowerCase()}/reviews`,
  view: (org: string, project: string, view: string) =>
    `/app/${org}/${project.toLowerCase()}/views/${view}`,
  // Delivery surfaces belong to the project; `team` narrows them to one of
  // its teams.
  board: (org: string, project: string, team?: string | null) =>
    `/app/${org}/${project.toLowerCase()}/board${team ? `?team=${encodeURIComponent(team)}` : ""}`,
  backlog: (org: string, project: string, team?: string | null) =>
    `/app/${org}/${project.toLowerCase()}/backlog${team ? `?team=${encodeURIComponent(team)}` : ""}`,
  iteration: (org: string, project: string, iteration: string) =>
    `/app/${org}/${project.toLowerCase()}/iterations/${iteration}`,
  // A team's own page: its backlog of unplanned work and its intake.
  team: (org: string, project: string, team: string) =>
    `/app/${org}/${project.toLowerCase()}/teams/${encodeURIComponent(team)}`,
  // Projects delivered in an external tool: what is ready, handed off, and
  // what Jira reports back.
  handoff: (org: string, project: string) =>
    `/app/${org}/${project.toLowerCase()}/handoff`,
  // Project settings: general, members, disciplines, teams, workflow,
  // planning, delivery, labels, context.
  projectSettings: (org: string, project: string, section?: string) =>
    `/app/${org}/${project.toLowerCase()}/settings${section ? `/${section}` : ""}`,
};

// Only in-app destinations are allowed as post-step redirects.
export function safeAppPath(value: string | null | undefined) {
  return value && /^\/app(?:[/?#]|$)/.test(value) && !value.startsWith("//")
    ? value
    : "/app";
}
