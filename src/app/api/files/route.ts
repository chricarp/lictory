import {
  errorResponse,
  invokeForWeb,
  noStore,
  requireSameOrigin,
  webPrincipal,
} from "~/capabilities/http";
import { CapabilityError } from "~/capabilities/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Attachments are capabilities of the shared application layer; this route
// adapts them to the browser's upload flow.

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(
      await invokeForWeb(request, "listAttachments", {
        organizationId: url.searchParams.get("organizationId") ?? "",
        workItemId: url.searchParams.get("workItemId") ?? "",
      }),
      noStore,
    );
  } catch (error) {
    return errorResponse(error, "string");
  }
}

const actions: Record<string, string> = {
  start: "startAttachmentUpload",
  finish: "finishAttachmentUpload",
  remove: "removeAttachment",
};

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const principal = await webPrincipal(request);
    const { action, ...input } = ((await request.json().catch(() => null)) ??
      {}) as { action?: string };
    const name = action && Object.hasOwn(actions, action) && actions[action];
    if (!name) throw new CapabilityError("validation", "Invalid file request.");
    return Response.json(
      await invokeForWeb(request, name, input, { principal }),
      noStore,
    );
  } catch (error) {
    return errorResponse(error, "string");
  }
}
