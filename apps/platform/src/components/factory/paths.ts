import { paths } from "@lictory/core/lib/paths";

// Factory addresses: /{org}/factory, its agents and runners, one session.
export const factoryPaths = {
  overview: (org: string) => `/${org}/factory`,
  agents: (org: string) => `/${org}/factory/agents`,
  runners: (org: string) => `/${org}/factory/runners`,
  session: paths.factorySession,
};
