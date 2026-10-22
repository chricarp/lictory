import {
  errorResponse,
  invokeForWeb,
  noStore,
  requireSameOrigin,
} from "@lictory/core/capabilities/http";

export const dynamic = "force-dynamic";

// Previews carry a whole draft Definition of Ready, too large for a query
// string. They read only; publishing goes through the mutation queue.
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    return Response.json(
      await invokeForWeb(
        request,
        "previewReadinessChecks",
        await request.json().catch(() => null),
      ),
      noStore,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
