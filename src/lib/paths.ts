export const paths = {
  org: (org: string) => `/app/${org}`,
  inbox: (org: string) => `/app/${org}/inbox`,
  settings: (org: string) => `/app/${org}/settings`,
  account: (org: string) => `/app/${org}/account`,
  project: (org: string, project: string) =>
    `/app/${org}/${project.toLowerCase()}`,
  list: (org: string, project: string, kind: "epics" | "stories") =>
    `/app/${org}/${project.toLowerCase()}/${kind}`,
  item: (org: string, project: string, kind: "epics" | "stories", id: string) =>
    `/app/${org}/${project.toLowerCase()}/${kind}/${id}`,
  reviews: (org: string, project: string) =>
    `/app/${org}/${project.toLowerCase()}/reviews`,
  view: (org: string, project: string, view: string) =>
    `/app/${org}/${project.toLowerCase()}/views/${view}`,
};
