// The Factory: /{org}/factory (overview), /{org}/factory/sessions (and one
// session, /{org}/factory/sessions/{session}), /{org}/factory/agents (and
// one agent, /{org}/factory/agents/{agent}) and /{org}/factory/runners.
// Data comes from Zero subscriptions, never a loader.

export { FactoryOverview as FactoryRoute } from "@lictory/platform/components/factory/overview";
export { FactoryAgents as FactoryAgentsRoute } from "@lictory/platform/components/factory/agents";
export { AgentPage as FactoryAgentRoute } from "@lictory/platform/components/factory/agent-page";
export { FactoryRunners as FactoryRunnersRoute } from "@lictory/platform/components/factory/runners";
export { FactorySessions as FactorySessionsRoute } from "@lictory/platform/components/factory/sessions";
export { SessionView as FactorySessionRoute } from "@lictory/platform/components/factory/session-view";
