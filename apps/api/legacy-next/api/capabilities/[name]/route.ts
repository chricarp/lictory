import { errorResponse, invokeForWeb, noStore } from "@lictory/core/capabilities/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Generic browser entry point to the shared application layer: any capability
// available on the web surface, invoked as the signed-in user. New UI calls
// capabilities here instead of adding a bespoke route.
export async function POST(
  request: Request,
  context: RouteContext<"/api/capabilities/[name]">,
) {
  try {
    const { name } = await context.params;
    const input: unknown = await request.json().catch(() => ({}));
    return Response.json(
      (await invokeForWeb(request, name, input, { write: true })) ?? {
        ok: true,
      },
      noStore,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
