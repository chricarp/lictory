import {
  errorResponse,
  invokeForWeb,
  noStore,
  webPrincipal,
  requireSameOrigin,
} from "@lictory/core/capabilities/http";
import { CapabilityError } from "@lictory/core/capabilities/core";

// Delivery actions talk to external systems, so they are online-only and
// never go through the durable client mutation queue (which would also put
// API tokens in browser storage). Each action is a capability of the shared
// application layer.

export const dynamic = "force-dynamic";
// Exports of large epics make several Jira calls per item.
export const maxDuration = 300;

const actions: Record<string, string> = {
  connect: "connectDelivery",
  disconnect: "disconnectDelivery",
  listProjects: "listDeliveryProjects",
  describeProject: "describeDeliveryProject",
  setTarget: "setDeliveryTarget",
  removeTarget: "removeDeliveryTarget",
  preview: "previewDeliveryExport",
  publish: "publishDelivery",
  publication: "getDeliveryPublication",
  linkExisting: "linkExternalItem",
  unlink: "unlinkExternalItem",
};

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const principal = await webPrincipal(request);
    const { action, ...input } = ((await request.json().catch(() => null)) ??
      {}) as { action?: string };
    const name = action && Object.hasOwn(actions, action) && actions[action];
    if (!name)
      throw new CapabilityError("validation", "Invalid delivery request.");
    const result = await invokeForWeb(request, name, input, { principal });
    console.info(
      JSON.stringify({
        event: "delivery.action",
        action,
        organization: (input as { organizationId?: string }).organizationId,
        user: principal.userId,
      }),
    );
    return Response.json(result ?? { ok: true }, noStore);
  } catch (error) {
    return errorResponse(error);
  }
}
