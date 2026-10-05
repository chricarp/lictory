import { db } from "~/db";
import { contextFailure, sessionUser } from "~/intelligence/http";
import { intelligenceContextHistory } from "~/intelligence/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context =
  RouteContext<"/api/organizations/[id]/intelligence-context/[entry]">;

// Every version of one entry, newest first: what Lictory AI was told, when,
// and by whom.
export async function GET(request: Request, context: Context) {
  try {
    const { id, entry } = await context.params;
    const userId = await sessionUser(request);
    return Response.json(
      { versions: await intelligenceContextHistory(db, id, userId, entry) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contextFailure(error);
  }
}
