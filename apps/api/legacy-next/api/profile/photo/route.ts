import { db } from "@lictory/core/db";
import {
  errorResponse,
  noStore,
  requireSameOrigin,
  webPrincipal,
} from "@lictory/core/capabilities/http";
import { MAX_PROFILE_PHOTO_SIZE } from "@lictory/core/profile/photo";
import { PhotoError } from "@lictory/core/profile/image";
import { setProfilePhoto } from "@lictory/core/profile/server";

export const runtime = "nodejs";

function fail(error: unknown) {
  if (error instanceof PhotoError)
    return Response.json(
      { error: error.message },
      { status: error.status, ...noStore },
    );
  return errorResponse(error, "string");
}

export async function PUT(request: Request) {
  try {
    requireSameOrigin(request);
    const { userId } = await webPrincipal(request);
    if (Number(request.headers.get("content-length")) > MAX_PROFILE_PHOTO_SIZE)
      throw new PhotoError("Choose a photo smaller than 4 MB.", 413);
    // Bound the actual stream too: Content-Length is not authoritative.
    const reader = request.body?.getReader();
    if (!reader) throw new PhotoError("Choose a photo to upload.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_PROFILE_PHOTO_SIZE) {
          await reader.cancel();
          throw new PhotoError("Choose a photo smaller than 4 MB.", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Response.json(
      await setProfilePhoto(db, userId, Buffer.concat(chunks)),
      noStore,
    );
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const { userId } = await webPrincipal(request);
    return Response.json(await setProfilePhoto(db, userId, null), noStore);
  } catch (error) {
    return fail(error);
  }
}
