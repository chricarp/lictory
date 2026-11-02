import type {
  DeliveryConnectionSummary,
  Directory,
} from "@lictory/core/contracts/protocol";

// Names the delivery tool a project hands work off to, so hand-off copy never
// hard-codes one vendor. Product names live here, next to the adapter kinds;
// everything else asks for the project's provider.
const providerNames: Record<DeliveryConnectionSummary["provider"], string> = {
  jira_cloud: "Jira",
};

export type DeliveryTool = {
  // Mid-sentence form: "Export to Jira", "changed in your delivery tool".
  name: string;
  // Sentence-start form: "Jira owns…", "Your delivery tool owns…".
  Name: string;
  // The vendor name when one is known; null when copy must stay generic.
  product: string | null;
};

const generic: DeliveryTool = {
  name: "your delivery tool",
  Name: "Your delivery tool",
  product: null,
};

function named(product: string): DeliveryTool {
  return { name: product, Name: product, product };
}

export function deliveryToolOf(
  connection: Pick<DeliveryConnectionSummary, "provider"> | undefined,
): DeliveryTool {
  const product = connection && providerNames[connection.provider];
  return product ? named(product) : generic;
}

// The project's target connection decides. Before a target is chosen, an
// organization whose connections are all one provider can only hand off
// there; otherwise the copy stays generic.
export function projectDeliveryTool(
  directory: Pick<Directory, "delivery">,
  projectId: string | undefined,
): DeliveryTool {
  const { connections, targets } = directory.delivery;
  const target = projectId
    ? targets.find((t) => t.projectId === projectId)
    : undefined;
  const connection = connections.find((c) => c.id === target?.connectionId);
  if (connection) return deliveryToolOf(connection);
  const kinds = new Set(connections.map((c) => c.provider));
  return kinds.size === 1 ? deliveryToolOf(connections[0]) : generic;
}
