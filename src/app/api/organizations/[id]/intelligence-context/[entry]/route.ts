import { errorResponse, invokeForWeb, noStore } from "~/capabilities/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context =
  RouteContext<"/api/organizations/[id]/intelligence-context/[entry]">;

// Every version of one entry, newest first: what Lictory AI was told, when,
// and by whom.
export async function GET(request: Request, context: Context) {
  try {
    const { id, entry } = await context.params;
    return Response.json(
      await invokeForWeb(request, "getIntelligenceContextHistory", {
        organizationId: id,
        entryId: entry,
      }),
      noStore,
    );
  } catch (error) {
    return errorResponse(error, "string");
  }
}
