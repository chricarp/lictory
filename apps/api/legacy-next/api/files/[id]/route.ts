import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { httpStatus } from "@lictory/core/capabilities/core";
import { invokeForWeb } from "@lictory/core/capabilities/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: RouteContext<"/api/files/[id]">,
) {
  const { id } = await context.params;
  try {
    const { url } = (await invokeForWeb(request, "getAttachmentDownloadUrl", {
      fileId: id,
      inline: new URL(request.url).searchParams.get("download") !== "1",
    })) as { url: string };
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const e = toCapabilityError(error);
    return new Response(e.message, { status: httpStatus(e) });
  }
}
