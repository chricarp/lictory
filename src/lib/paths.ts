export const paths = {
  org: (org: string) => `/app/${org}`,
  inbox: (org: string) => `/app/${org}/inbox`,
  settings: (org: string) => `/app/${org}/settings`,
  product: (org: string, product: string) =>
    `/app/${org}/${product.toLowerCase()}`,
  list: (org: string, product: string, kind: "epics" | "stories") =>
    `/app/${org}/${product.toLowerCase()}/${kind}`,
  item: (org: string, product: string, kind: "epics" | "stories", id: string) =>
    `/app/${org}/${product.toLowerCase()}/${kind}/${id}`,
  reviews: (org: string, product: string) =>
    `/app/${org}/${product.toLowerCase()}/reviews`,
  view: (org: string, product: string, view: string) =>
    `/app/${org}/${product.toLowerCase()}/views/${view}`,
};
