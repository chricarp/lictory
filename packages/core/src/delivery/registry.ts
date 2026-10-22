import { createJiraCloudProvider } from "@lictory/core/delivery/jira/provider";
import type {
  DeliveryProvider,
  DeliveryProviderKind,
} from "@lictory/core/delivery/provider";

// Resolves a connection's provider kind to its adapter. Tests pass their own
// registry (see fake-provider.ts) instead of patching this one.
export type DeliveryProviders = Record<DeliveryProviderKind, DeliveryProvider>;

let providers: DeliveryProviders | undefined;

export function deliveryProviders(): DeliveryProviders {
  return (providers ??= { jira_cloud: createJiraCloudProvider() });
}
