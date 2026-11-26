import { paths } from "@lictory/core/lib/paths";

// Factory addresses: /{org}/factory, its agents (and one agent's page, with
// its Connection and Wake-ups sections), runners, the sessions and one
// session.
export const factoryPaths = {
  overview: (org: string) => `/${org}/factory`,
  agents: (org: string) => `/${org}/factory/agents`,
  agent: (org: string, agent: string, section?: "connection" | "wake-ups") =>
    `/${org}/factory/agents/${agent}${section ? `#${section}` : ""}`,
  runners: (org: string) => `/${org}/factory/runners`,
  sessions: (org: string) => `/${org}/factory/sessions`,
  session: paths.factorySession,
};
