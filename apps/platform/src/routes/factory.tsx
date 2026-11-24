// The Factory: /{org}/factory (overview), /{org}/factory/agents,
// /{org}/factory/runners and /{org}/factory/sessions/{session}. Data comes
// from Zero subscriptions, never a loader.

export { FactoryOverview as FactoryRoute } from "@lictory/platform/components/factory/overview";
export { FactoryAgents as FactoryAgentsRoute } from "@lictory/platform/components/factory/agents";
export { FactoryRunners as FactoryRunnersRoute } from "@lictory/platform/components/factory/runners";
export { SessionView as FactorySessionRoute } from "@lictory/platform/components/factory/session-view";
