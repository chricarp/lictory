import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import { assertOrganizationAccess } from "@lictory/core/domain/organization-access";
import { spaceLevelAtLeast } from "@lictory/core/contracts/protocol";
import { pageAccess } from "@lictory/core/spaces/access";
import { StorageConfigurationError } from "@lictory/core/storage/errors";
import {
  SUPPORTED_FILE_EXTENSIONS,
  objectKey,
  removedObjectKey,
  validateFile,
} from "@lictory/core/storage/policy";
import {
  CapabilityError,
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
  type CapabilityContext,
  type Database,
} from "@lictory/core/capabilities/core";

// Attachments on work items and Lictory Spaces pages. Bytes travel directly
// between the caller and object storage through short-lived presigned URLs;
// Lictory stores metadata under the organization lock after re-checking
// membership. Removal marks the row first (no new links) and then moves the
// bytes (old links stop working). A page's files follow its space's access:
// commenters attach files (they already add content every reader sees),
// readers list and download them, and nobody else learns they exist.

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
      "You are not a member of this organization.",
    );
  await assertOrganizationAccess(db, userId, organizationId);
}
// The page's space access for a file operation: `comment` to attach, `view`
// to list, download, finish or remove. People without access get not found.
async function requirePageAccess(
  db: Database | Tx,
  organizationId: string,
  userId: string,
  pageId: string,
  level: "view" | "comment",
  missing = "Page not found.",
) {
  const row = await pageAccess(db, { organizationId, userId }, pageId);
  if (!row?.level) throw new CapabilityError("not_found", missing);
  if (level === "comment") {
    if (!spaceLevelAtLeast(row.level, "comment"))
      throw new CapabilityError(
        "forbidden",
        `You can view ${row.space.name} but not add files to it. Ask one of its administrators for comment or edit access.`,
      );
    if (row.space.archivedAt || row.page.archivedAt)
      throw new CapabilityError(
        "conflict",
        "This page is archived. Restore it before adding files.",
      );
  }
  return row;
}

// What a file belongs to: a work item or a page, never both.
const fileOwner = {
  workItemId: id.optional().describe("The work item the file belongs to."),
  pageId: id
    .optional()
    .describe(
      "The Lictory Spaces page the file belongs to (instead of workItemId).",
    ),
};
const oneOwner = (input: { workItemId?: string; pageId?: string }) =>
  Boolean(input.workItemId) !== Boolean(input.pageId);
const oneOwnerMessage = {
  message: "Name either a work item (workItemId) or a page (pageId).",
};

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
  if (!file) throw new CapabilityError("not_found", "File not found.");
  return file;
}

const listAttachments = defineCapability({
  name: "listAttachments",
  title: "List attachments",
  description:
    "Files attached to a work item (workItemId) or to a page (pageId; readers of its space).",
  kind: "query",
  surfaces: everywhere,
  input: z
    .object({ organizationId, ...fileOwner })
    .refine(oneOwner, oneOwnerMessage),
  async run(ctx, input) {
    const userId = ctx.principal.userId;
    await requireMember(ctx.db, input.organizationId, userId);
    if (input.pageId)
      await requirePageAccess(
        ctx.db,
        input.organizationId,
        userId,
        input.pageId,
        "view",
      );
    else {
      const [item] = await ctx.db
        .select({ id: s.workItem.id })
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, input.organizationId),
            eq(s.workItem.id, input.workItemId!),
          ),
        );
      if (!item) throw new CapabilityError("not_found", "Work item not found.");
    }
    const files = await ctx.db.query.fileObject.findMany({
      where: and(
        eq(s.fileObject.organizationId, input.organizationId),
        input.pageId
          ? eq(s.fileObject.pageId, input.pageId)
          : eq(s.fileObject.workItemId, input.workItemId!),
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
  description: `Reserve an attachment on a work item (workItemId) or a page (pageId; comment or edit access to its space) and get a presigned URL. PUT the bytes to \`uploadUrl\` with \`headers\` within five minutes, then call finishAttachmentUpload. Allowed types: ${SUPPORTED_FILE_EXTENSIONS.join(", ")}. Files must be between 1 byte and 25 MB.`,
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z
    .object({
      organizationId,
      ...fileOwner,
      filename: z.string().max(255),
      mimeType: z.string().max(200),
      size: z.number().int().min(1),
    })
    .refine(oneOwner, oneOwnerMessage),
  async run(ctx, input) {
    const userId = ctx.principal.userId;
    await requireMember(ctx.db, input.organizationId, userId);
    try {
      validateFile(input.filename, input.mimeType, input.size);
    } catch (error) {
      throw new CapabilityError("validation", (error as Error).message);
    }
    // Refuse before signing anything when the page cannot take files.
    if (input.pageId)
      await requirePageAccess(
        ctx.db,
        input.organizationId,
        userId,
        input.pageId,
        "comment",
      );
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
      const owner = input.pageId
        ? {
            projectId: null,
            workItemId: null,
            pageId: (
              await requirePageAccess(
                tx,
                input.organizationId,
                userId,
                input.pageId,
                "comment",
              )
            ).page.id,
          }
        : await (async () => {
            const [item] = await tx
              .select()
              .from(s.workItem)
              .where(
                and(
                  eq(s.workItem.organizationId, input.organizationId),
                  eq(s.workItem.id, input.workItemId!),
                ),
              );
            if (!item || item.archivedAt)
              throw new CapabilityError("not_found", "Work item not found.");
            return {
              projectId: item.projectId,
              workItemId: item.id,
              pageId: null,
            };
          })();
      await tx.insert(s.fileObject).values({
        id: fileId,
        organizationId: input.organizationId,
        ...owner,
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
    if (file.pageId)
      await requirePageAccess(
        ctx.db,
        input.organizationId,
        userId,
        file.pageId,
        "view",
        "File not found.",
      );
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
        ...(file.pageId
          ? { page_id: file.pageId }
          : { project_id: file.projectId, work_item_id: file.workItemId }),
        file_size: file.size,
        file_kind: file.mimeType.startsWith("image/") ? "image" : "document",
      },
      `${file.id}:uploaded`,
    );
    return { id: file.id, url: `/api/files/${file.id}` };
  },
});

// Signed download URLs are bearer links to an object key and cannot be revoked.
// Moving the bytes to a retained key makes every link issued before the removal
// fail. Safe to repeat: a retry finishes a move that was interrupted.
async function retireObject(
  ctx: CapabilityContext,
  file: typeof s.fileObject.$inferSelect,
) {
  const retired = removedObjectKey(file.organizationId, file.id);
  if (file.objectKey === retired) return;
  const store = storage(ctx);
  try {
    await store.copy(file.objectKey, retired).catch(async (error) => {
      // An earlier attempt may have copied and deleted the source already.
      if (
        !(await store.stat(retired).then(
          () => true,
          () => false,
        ))
      )
        throw error;
    });
    await store.delete(file.objectKey);
  } catch {
    throw new CapabilityError(
      "external",
      "The attachment was removed, but storage did not confirm that earlier download links were revoked. Those links expire within a minute; retry removeAttachment to finish.",
      { retryable: true },
    );
  }
  await ctx.db.transaction(async (tx) => {
    await lockedMember(tx, file.organizationId, ctx.principal.userId);
    await tx
      .update(s.fileObject)
      .set({ objectKey: retired })
      .where(
        and(
          eq(s.fileObject.id, file.id),
          eq(s.fileObject.organizationId, file.organizationId),
          eq(s.fileObject.objectKey, file.objectKey),
        ),
      );
  });
}

const removeAttachment = defineCapability({
  name: "removeAttachment",
  title: "Remove attachment",
  description:
    "Uploader only: remove an attachment from the item. It can no longer be downloaded, including through links issued before the removal; the bytes are retained privately. Returns `removed: false` when it was already removed.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  idempotent: true,
  input: z.object({ organizationId, id: z.uuid() }),
  async run(ctx, input) {
    const userId = ctx.principal.userId;
    await requireMember(ctx.db, input.organizationId, userId);
    const file = await fileOf(ctx, input.organizationId, input.id);
    if (file.pageId)
      await requirePageAccess(
        ctx.db,
        input.organizationId,
        userId,
        file.pageId,
        "view",
        "File not found.",
      );
    if (file.createdById !== userId)
      throw new CapabilityError(
        "forbidden",
        "Only the uploader can remove this attachment.",
      );
    const removed = await ctx.db.transaction(async (tx) => {
      await lockedMember(tx, input.organizationId, userId);
      const rows = await tx
        .update(s.fileObject)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(s.fileObject.id, file.id),
            eq(s.fileObject.organizationId, input.organizationId),
            isNull(s.fileObject.removedAt),
          ),
        )
        .returning({ id: s.fileObject.id });
      return rows.length > 0;
    });
    if (removed)
      ctx.effects.track(
        "attachment_removed",
        {
          organization_id: input.organizationId,
          ...(file.pageId
            ? { page_id: file.pageId }
            : { work_item_id: file.workItemId }),
        },
        `${file.id}:removed`,
      );
    // Download links are only ever issued for finished uploads.
    if (file.readyAt) await retireObject(ctx, file);
    return { removed };
  },
});

const getAttachmentDownloadUrl = defineCapability({
  name: "getAttachmentDownloadUrl",
  title: "Get attachment download URL",
  description:
    "A short-lived URL to download an attachment's bytes. The file id appears in `/api/files/<id>` references inside specifications, pages and comments. A page's files are available to readers of its space.",
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
    if (!file || file.removedAt)
      throw new CapabilityError("not_found", "File not found.");
    await requireMember(ctx.db, file.organizationId, ctx.principal.userId);
    if (file.pageId)
      await requirePageAccess(
        ctx.db,
        file.organizationId,
        ctx.principal.userId,
        file.pageId,
        "view",
        "File not found.",
      );
    return {
      url: await storage(ctx).presignDownload(
        file.objectKey,
        file.filename,
        file.mimeType,
        input.inline,
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
