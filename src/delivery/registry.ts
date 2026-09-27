import { createJiraCloudProvider } from "./jira/provider";
import type { DeliveryProvider, DeliveryProviderKind } from "./provider";

// Resolves a connection's provider kind to its adapter. Tests pass their own
// registry (see fake-provider.ts) instead of patching this one.
export type DeliveryProviders = Record<DeliveryProviderKind, DeliveryProvider>;

let providers: DeliveryProviders | undefined;

export function deliveryProviders(): DeliveryProviders {
  return (providers ??= { jira_cloud: createJiraCloudProvider() });
}
