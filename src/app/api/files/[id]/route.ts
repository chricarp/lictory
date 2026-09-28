import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "~/db";
import * as s from "~/db/schema";
import { auth } from "~/lib/auth";
import { storage, StorageConfigurationError } from "~/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: RouteContext<"/api/files/[id]">,
) {
  const { id } = await context.params;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Sign in required.", { status: 401 });
  const file = await db.query.fileObject.findFirst({
    where: and(eq(s.fileObject.id, id), isNotNull(s.fileObject.readyAt)),
  });
  if (!file?.readyAt) return new Response("File not found.", { status: 404 });
  const member = await db.query.member.findFirst({
    where: and(
      eq(s.member.organizationId, file.organizationId),
      eq(s.member.userId, session.user.id),
    ),
  });
  if (!member) return new Response("Forbidden.", { status: 403 });
  const inline =
    new URL(request.url).searchParams.get("download") !== "1" &&
    file.mimeType.startsWith("image/");
  try {
    const url = await storage().presignDownload(
      file.objectKey,
      file.filename,
      file.mimeType,
      inline,
    );
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof StorageConfigurationError)
      return new Response("File storage is not configured.", { status: 503 });
    console.error("files.download.error", error);
    return new Response("File storage is unavailable.", { status: 503 });
  }
}
