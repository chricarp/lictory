import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { trackServer } from "~/lib/analytics/server";
import { db } from "~/db";
import * as s from "~/db/schema";
import { auth } from "~/lib/auth";
import { objectKey, validateFile } from "~/storage/policy";
import { storage, StorageConfigurationError } from "~/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const start = z.object({
  action: z.literal("start"),
  organizationId: z.string(),
  workItemId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
});
const finish = z.object({
  action: z.literal("finish"),
  organizationId: z.string(),
  id: z.string().uuid(),
});
const remove = z.object({
  action: z.literal("remove"),
  organizationId: z.string(),
  id: z.string().uuid(),
});

async function principal(request: Request, organizationId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new FileError("Sign in again to continue.", 401);
  const member = await db.query.member.findFirst({
    where: and(
      eq(s.member.organizationId, organizationId),
      eq(s.member.userId, session.user.id),
    ),
  });
  if (!member)
    throw new FileError("Organization access has been removed.", 403);
  return session.user.id;
}
class FileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
function fail(error: unknown) {
  if (error instanceof FileError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError)
    return Response.json({ error: "Invalid file request." }, { status: 400 });
  if (error instanceof StorageConfigurationError)
    return Response.json(
      {
        error:
          "File uploads are not configured. Ask an administrator to add storage credentials.",
      },
      { status: 503 },
    );
  console.error("files.error", error);
  return Response.json(
    { error: "File storage is unavailable." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId") ?? "";
    const workItemId = url.searchParams.get("workItemId") ?? "";
    await principal(request, organizationId);
    const item = await db.query.workItem.findFirst({
      where: and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.id, workItemId),
      ),
    });
    if (!item) throw new FileError("Work item not found.", 404);
    const files = await db.query.fileObject.findMany({
      where: and(
        eq(s.fileObject.organizationId, organizationId),
        eq(s.fileObject.workItemId, workItemId),
        sql`${s.fileObject.readyAt} is not null`,
        sql`${s.fileObject.removedAt} is null`,
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    return Response.json(
      files.map(({ id, filename, mimeType, size, createdAt, createdById }) => ({
        id,
        filename,
        mimeType,
        size,
        createdAt,
        createdById,
      })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (
      origin !== new URL(request.url).origin &&
      origin !== process.env.BETTER_AUTH_URL
    )
      throw new FileError("Cross-origin request.", 403);
    const body = z
      .discriminatedUnion("action", [start, finish, remove])
      .parse(await request.json());
    const userId = await principal(request, body.organizationId);
    if (body.action === "start") {
      try {
        validateFile(body.filename, body.mimeType, body.size);
      } catch (error) {
        throw new FileError((error as Error).message, 422);
      }
      const id = crypto.randomUUID();
      const key = objectKey(body.organizationId, id);
      // Validate storage configuration before reserving metadata.
      const uploadUrl = await storage().presignUpload(
        key,
        body.mimeType,
        body.size,
      );
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${body.organizationId}, 0))`,
        );
        const item = await tx.query.workItem.findFirst({
          where: and(
            eq(s.workItem.organizationId, body.organizationId),
            eq(s.workItem.id, body.workItemId),
          ),
        });
        if (!item || item.archivedAt)
          throw new FileError("Work item not found.", 404);
        const member = await tx.query.member.findFirst({
          where: and(
            eq(s.member.organizationId, body.organizationId),
            eq(s.member.userId, userId),
          ),
        });
        if (!member)
          throw new FileError("Organization access has been removed.", 403);
        await tx.insert(s.fileObject).values({
          id,
          organizationId: body.organizationId,
          projectId: item.projectId,
          workItemId: item.id,
          objectKey: key,
          filename: body.filename,
          mimeType: body.mimeType,
          size: body.size,
          createdById: userId,
        });
      });
      return Response.json(
        {
          id,
          uploadUrl,
          headers: { "Content-Type": body.mimeType, "If-None-Match": "*" },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const file = await db.query.fileObject.findFirst({
      where: and(
        eq(s.fileObject.id, body.id),
        eq(s.fileObject.organizationId, body.organizationId),
      ),
    });
    if (!file) throw new FileError("File not found.", 404);
    if (body.action === "finish") {
      if (file.createdById !== userId)
        throw new FileError("Only the uploader can finish this upload.", 403);
      if (!file.readyAt && Date.now() - file.createdAt.getTime() > 10 * 60_000)
        throw new FileError("Upload expired. Try again.", 410);
      const head = await storage()
        .stat(file.objectKey)
        .catch(() => {
          throw new FileError("Upload has not reached storage.", 409);
        });
      if (head.size !== file.size || head.contentType !== file.mimeType)
        throw new FileError(
          "Uploaded file size or type does not match the request.",
          422,
        );
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${body.organizationId}, 0))`,
        );
        const member = await tx.query.member.findFirst({
          where: and(
            eq(s.member.organizationId, body.organizationId),
            eq(s.member.userId, userId),
          ),
        });
        if (!member)
          throw new FileError("Organization access has been removed.", 403);
        await tx
          .update(s.fileObject)
          .set({ readyAt: file.readyAt ?? new Date() })
          .where(
            and(
              eq(s.fileObject.id, file.id),
              eq(s.fileObject.organizationId, body.organizationId),
            ),
          );
      });
      trackServer(
        userId,
        "attachment_uploaded",
        {
          organization_id: body.organizationId,
          project_id: file.projectId,
          work_item_id: file.workItemId,
          file_size: file.size,
          file_kind: file.mimeType.startsWith("image/") ? "image" : "document",
        },
        request.headers,
        `${file.id}:uploaded`,
      );
      return Response.json(
        { id: file.id, url: `/api/files/${file.id}` },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (file.createdById !== userId)
      throw new FileError("Only the uploader can remove this attachment.", 403);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${body.organizationId}, 0))`,
      );
      const member = await tx.query.member.findFirst({
        where: and(
          eq(s.member.organizationId, body.organizationId),
          eq(s.member.userId, userId),
        ),
      });
      if (!member)
        throw new FileError("Organization access has been removed.", 403);
      await tx
        .update(s.fileObject)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(s.fileObject.id, file.id),
            eq(s.fileObject.organizationId, body.organizationId),
          ),
        );
    });
    // Retain bytes for immutable revisions and existing comment references.
    trackServer(
      userId,
      "attachment_removed",
      {
        organization_id: body.organizationId,
        work_item_id: file.workItemId,
      },
      request.headers,
      `${file.id}:removed`,
    );
    return Response.json({ removed: true });
  } catch (error) {
    return fail(error);
  }
}
