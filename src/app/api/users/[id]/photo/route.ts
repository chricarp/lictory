import { db } from "~/db";
import { errorResponse, webPrincipal } from "~/capabilities/http";
import { PhotoError } from "~/profile/image";
import { readProfilePhoto } from "~/profile/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"/api/users/[id]/photo">,
) {
  try {
    const { userId } = await webPrincipal(request);
    const { id } = await context.params;
    const photo = await readProfilePhoto(db, userId, id);
    const etag = `"${photo.sha256}"`;
    const headers = {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(photo.content), { headers });
  } catch (error) {
    if (error instanceof PhotoError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    return errorResponse(error, "string");
  }
}
