type SearchParams = { toString(): string };

const withSearchParams = (path: string, searchParams?: SearchParams) => {
  const query = searchParams?.toString();
  return query ? `${path}?${query}` : path;
};

export const paths = {
  org: (org: string) => `/app/${org}`,
  newOrganization: "/app/new-organization",
  inbox: (org: string) => `/app/${org}/inbox`,
  settings: (org: string) => `/app/${org}/settings`,
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
};
