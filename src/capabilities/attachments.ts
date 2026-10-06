import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../db/schema";
import { StorageConfigurationError } from "../storage/errors";
import { objectKey, validateFile } from "../storage/policy";
import {
  CapabilityError,
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
  type CapabilityContext,
  type Database,
} from "./core";

// Attachments on work items. Bytes travel directly between the caller and
// object storage through short-lived presigned URLs; Lictory stores metadata
// under the organization lock after re-checking membership.

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function storage(ctx: CapabilityContext) {
  if (!ctx.storage)
    throw new StorageConfigurationError("No object storage is configured.");
  return ctx.storage();
}
async function lockedMember(tx: Tx, organizationId: string, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
  );
  await requireMember(tx, organizationId, userId);
}
async function requireMember(
  db: Database | Tx,
  organizationId: string,
  userId: string,
) {
  const [member] = await db
    .select({ id: s.member.id })
    .from(s.member)
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        eq(s.member.userId, userId),
      ),
    );
  if (!member)
    throw new CapabilityError(
      "forbidden",
      "Organization access has been removed.",
    );
}
async function fileOf(
  ctx: CapabilityContext,
  organizationId: string,
  fileId: string,
) {
  const [file] = await ctx.db
    .select()
    .from(s.fileObject)
    .where(
      and(
        eq(s.fileObject.id, fileId),
        eq(s.fileObject.organizationId, organizationId),
      ),
    );
  if (!file) throw new CapabilityError("unavailable", "File not found.");
  return file;
}

const listAttachments = defineCapability({
  name: "listAttachments",
  title: "List attachments",
  description: "Files attached to a work item.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, workItemId: id }),
  async run(ctx, input) {
    await requireMember(ctx.db, input.organizationId, ctx.principal.userId);
    const [item] = await ctx.db
      .select({ id: s.workItem.id })
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, input.organizationId),
          eq(s.workItem.id, input.workItemId),
        ),
      );
    if (!item) throw new CapabilityError("unavailable", "Work item not found.");
    const files = await ctx.db.query.fileObject.findMany({
      where: and(
        eq(s.fileObject.organizationId, input.organizationId),
        eq(s.fileObject.workItemId, input.workItemId),
        sql`${s.fileObject.readyAt} is not null`,
        sql`${s.fileObject.removedAt} is null`,
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    return files.map(
      ({ id, filename, mimeType, size, createdAt, createdById }) => ({
        id,
        filename,
        mimeType,
        size,
        createdAt,
        createdById,
        url: `/api/files/${id}`,
      }),
    );
  },
});

const startAttachmentUpload = defineCapability({
  name: "startAttachmentUpload",
  title: "Start attachment upload",
  description:
    "Reserve an attachment on a work item and get a presigned URL. PUT the bytes to `uploadUrl` with `headers` within five minutes, then call finishAttachmentUpload.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    workItemId: id,
    filename: z.string().max(255),
    mimeType: z.string().max(200),
    size: z.number().int().min(1),
  }),
  async run(ctx, input) {
    const userId = ctx.principal.userId;
    await requireMember(ctx.db, input.organizationId, userId);
    try {
      validateFile(input.filename, input.mimeType, input.size);
    } catch (error) {
      throw new CapabilityError("validation", (error as Error).message);
    }
    const fileId = crypto.randomUUID();
    const key = objectKey(input.organizationId, fileId);
    // Validate storage configuration before reserving metadata.
    const uploadUrl = await storage(ctx).presignUpload(
      key,
      input.mimeType,
      input.size,
    );
    await ctx.db.transaction(async (tx) => {
      await lockedMember(tx, input.organizationId, userId);
      const [item] = await tx
        .select()
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, input.organizationId),
            eq(s.workItem.id, input.workItemId),
          ),
        );
      if (!item || item.archivedAt)
        throw new CapabilityError("unavailable", "Work item not found.");
      await tx.insert(s.fileObject).values({
        id: fileId,
        organizationId: input.organizationId,
        projectId: item.projectId,
        workItemId: item.id,
        objectKey: key,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        createdById: userId,
      });
    });
    return {
      id: fileId,
      uploadUrl,
      headers: { "Content-Type": input.mimeType, "If-None-Match": "*" },
    };
  },
});

const finishAttachmentUpload = defineCapability({
  name: "finishAttachmentUpload",
  title: "Finish attachment upload",
  description:
    "Confirm an upload reached storage. Returns the attachment URL to reference in Markdown.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  idempotent: true,
  input: z.object({ organizationId, id: z.uuid() }),
  async run(ctx, input) {
    const userId = ctx.principal.userId;
    await requireMember(ctx.db, input.organizationId, userId);
    const file = await fileOf(ctx, input.organizationId, input.id);
    if (file.createdById !== userId)
      throw new CapabilityError(
        "forbidden",
        "Only the uploader can finish this upload.",
      );
    if (!file.readyAt && Date.now() - file.createdAt.getTime() > 10 * 60_000)
      throw new CapabilityError("unavailable", "Upload expired. Try again.", {
        status: 410,
      });
    const head = await storage(ctx)
      .stat(file.objectKey)
      .catch(() => {
        throw new CapabilityError(
          "conflict",
          "Upload has not reached storage.",
        );
      });
    if (head.size !== file.size || head.contentType !== file.mimeType)
      throw new CapabilityError(
        "validation",
        "Uploaded file size or type does not match the request.",
      );
    await ctx.db.transaction(async (tx) => {
      await lockedMember(tx, input.organizationId, userId);
      await tx
        .update(s.fileObject)
        .set({ readyAt: file.readyAt ?? new Date() })
        .where(
          and(
            eq(s.fileObject.id, file.id),
            eq(s.fileObject.organizationId, input.organizationId),
          ),
        );
    });
    ctx.effects.track(
      "attachment_uploaded",
      {
        organization_id: input.organizationId,
        project_id: file.projectId,
        work_item_id: file.workItemId,
        file_size: file.size,
        file_kind: file.mimeType.startsWith("image/") ? "image" : "document",
      },
      `${file.id}:uploaded`,
    );
    return { id: file.id, url: `/api/files/${file.id}` };
  },
});

const removeAttachment = defineCapability({
  name: "removeAttachment",
  title: "Remove attachment",
  description:
    "Uploader only: remove an attachment from the item. Bytes are retained for revisions and comments that reference it.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  idempotent: true,
  input: z.object({ organizationId, id: z.uuid() }),
  async run(ctx, input) {
    const userId = ctx.principal.userId;
    await requireMember(ctx.db, input.organizationId, userId);
    const file = await fileOf(ctx, input.organizationId, input.id);
    if (file.createdById !== userId)
      throw new CapabilityError(
        "forbidden",
        "Only the uploader can remove this attachment.",
      );
    await ctx.db.transaction(async (tx) => {
      await lockedMember(tx, input.organizationId, userId);
      await tx
        .update(s.fileObject)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(s.fileObject.id, file.id),
            eq(s.fileObject.organizationId, input.organizationId),
          ),
        );
    });
    ctx.effects.track(
      "attachment_removed",
      {
        organization_id: input.organizationId,
        work_item_id: file.workItemId,
      },
      `${file.id}:removed`,
    );
    return { removed: true };
  },
});

const getAttachmentDownloadUrl = defineCapability({
  name: "getAttachmentDownloadUrl",
  title: "Get attachment download URL",
  description:
    "A short-lived URL to download an attachment's bytes. The file id appears in `/api/files/<id>` references inside specifications and comments.",
  kind: "query",
  surfaces: everywhere,
  external: true,
  input: z.object({
    fileId: id,
    inline: z.boolean().default(false),
  }),
  async run(ctx, input) {
    const [file] = await ctx.db
      .select()
      .from(s.fileObject)
      .where(
        and(eq(s.fileObject.id, input.fileId), isNotNull(s.fileObject.readyAt)),
      );
    if (!file) throw new CapabilityError("unavailable", "File not found.");
    await requireMember(ctx.db, file.organizationId, ctx.principal.userId);
    return {
      url: await storage(ctx).presignDownload(
        file.objectKey,
        file.filename,
        file.mimeType,
        input.inline && file.mimeType.startsWith("image/"),
      ),
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
    };
  },
});

export const attachmentCapabilities = [
  listAttachments,
  startAttachmentUpload,
  finishAttachmentUpload,
  removeAttachment,
  getAttachmentDownloadUrl,
] as AnyCapability[];
