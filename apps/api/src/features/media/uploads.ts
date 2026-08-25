import { AwsClient } from "aws4fetch";

import type { Env } from "../../bindings";
import type { MediaRow } from "../../infrastructure/database/rows";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "audio/flac",
]);

const ALLOWED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
  "application/epub+zip",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  "application/json",
  "application/zip",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
]);

const ANYDOC_EXTENSIONS = new Set([
  "doc",
  "docm",
  "docx",
  "epub",
  "odp",
  "ods",
  "odt",
  "pdf",
  "pot",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  "rtf",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "csv",
]);

export type AttachmentKind = "image" | "audio" | "document";

export function mediaKindFor(
  contentType: string,
  fileName?: string,
): AttachmentKind | null {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_IMAGE_TYPES.has(normalized)) return "image";
  if (ALLOWED_AUDIO_TYPES.has(normalized)) return "audio";
  if (ALLOWED_DOCUMENT_TYPES.has(normalized)) return "document";
  const extension = fileName?.split(".").at(-1)?.toLowerCase();
  if (extension && ANYDOC_EXTENSIONS.has(extension)) return "document";
  return null;
}

export function safeFileName(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 120) || "upload";
}

/**
 * Returns the browser-facing API origin. Behind the local HTTPS proxy, the
 * Worker sees an HTTP upstream request, so the request URL is only a fallback.
 */
export function publicApiOrigin(env: Env, requestOrigin: string): string {
  const configuredOrigin = env.BETTER_AUTH_URL?.trim();
  return configuredOrigin
    ? new URL(configuredOrigin).origin
    : new URL(requestOrigin).origin;
}

export async function createPresignedUpload(
  env: Env,
  objectKey: string,
  contentType: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error("R2 S3 credentials are not configured");
  }

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/lictory-media/${objectKey}`,
  );
  url.searchParams.set("X-Amz-Expires", "900");
  const signed = await client.sign(
    new Request(url, {
      method: "PUT",
      headers: { "content-type": contentType },
    }),
    { aws: { signQuery: true } },
  );

  return { url: signed.url, headers: { "content-type": contentType } };
}

type CreateUploadSlotInput = {
  userId: string;
  fileName: string;
  contentType: string;
  bytes: number;
  requestOrigin: string;
  noteId?: string;
  durationSeconds?: number;
  position?: number;
};

/**
 * Creates the database row and byte-upload capability as one operation. Both
 * standalone media and note attachments use this path so their validation and
 * storage layout cannot drift apart.
 */
export async function createUploadSlot(env: Env, input: CreateUploadSlotInput) {
  const kind = mediaKindFor(input.contentType, input.fileName);
  if (!kind) return null;

  const id = crypto.randomUUID();
  const objectKey = `${input.userId.replace(/[^a-zA-Z0-9_-]/g, "_")}/${id}/${safeFileName(input.fileName)}`;
  const now = new Date().toISOString();
  const localUpload = env.ENVIRONMENT === "development";
  const uploadToken = localUpload ? crypto.randomUUID() : null;

  await env.DB.prepare(
    `INSERT INTO media_assets
      (id, user_id, note_id, kind, original_name, object_key, content_type, byte_size,
       duration_seconds, position, status, upload_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_upload', ?, ?, ?)`,
  )
    .bind(
      id,
      input.userId,
      input.noteId ?? null,
      kind,
      input.fileName,
      objectKey,
      input.contentType,
      input.bytes,
      input.durationSeconds ?? null,
      input.position ?? 0,
      uploadToken,
      now,
      now,
    )
    .run();

  const upload = localUpload
    ? {
        url: `${publicApiOrigin(env, input.requestOrigin)}/uploads/local/${id}`,
        headers: {
          "content-type": input.contentType,
          "x-upload-token": uploadToken!,
        },
      }
    : await createPresignedUpload(env, objectKey, input.contentType);

  const row = await env.DB.prepare("SELECT * FROM media_assets WHERE id = ?")
    .bind(id)
    .first<MediaRow>();
  if (!row) throw new Error("The media row was not persisted");

  return {
    row,
    upload: {
      method: "PUT" as const,
      ...upload,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                      Short lived, self-signed media URLs                   */
/* -------------------------------------------------------------------------- */

const MEDIA_URL_TTL_SECONDS = 60 * 60;

function signingSecret(env: Env): string {
  const configuredSecret = env.BETTER_AUTH_SECRET?.trim();
  if (configuredSecret) return configuredSecret;
  if (env.ENVIRONMENT === "development")
    return "lictory-local-media-development";
  throw new Error("BETTER_AUTH_SECRET is required to sign private media URLs");
}

async function hmac(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Media is private, but `<img>` and `<audio>` cannot send an Authorization
 * header. A capability URL signed with the auth secret keeps the object behind
 * a credential without leaking long-lived access.
 */
export async function signMediaUrl(
  env: Env,
  origin: string,
  assetId: string,
  userId: string,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1_000) + MEDIA_URL_TTL_SECONDS;
  const signature = await hmac(env, `${assetId}.${userId}.${expiresAt}`);
  // Behind the local HTTPS proxy the Worker sees an http upstream request, and
  // an http URL embedded in an https page is blocked as mixed content — so the
  // browser-facing origin has to come from configuration, as it does for uploads.
  const publicOrigin = publicApiOrigin(env, origin);
  return `${publicOrigin}/media/${assetId}?u=${encodeURIComponent(userId)}&e=${expiresAt}&s=${signature}`;
}

export async function verifyMediaUrl(
  env: Env,
  assetId: string,
  userId: string | null,
  expiresAt: string | null,
  signature: string | null,
): Promise<boolean> {
  if (!userId || !expiresAt || !signature) return false;
  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry * 1_000 < Date.now()) return false;
  const expected = await hmac(env, `${assetId}.${userId}.${expiry}`);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0;
}
