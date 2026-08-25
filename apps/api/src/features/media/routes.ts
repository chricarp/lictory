import { createUploadRequestSchema } from "@lictory/contracts";
import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import { errorBody } from "../../http/errors";
import { mediaRecord } from "../../infrastructure/database/records";
import type { MediaRow } from "../../infrastructure/database/rows";
import {
  createUploadSlot,
  mediaKindFor,
  safeFileName,
  verifyMediaUrl,
} from "./uploads";

const publicMedia = new Hono<AppBindings>();

/** Capability-URL delivery for elements that cannot attach bearer tokens. */
publicMedia.get("/media/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const userId = c.req.query("u") ?? null;
  const valid = await verifyMediaUrl(
    c.env,
    assetId,
    userId,
    c.req.query("e") ?? null,
    c.req.query("s") ?? null,
  );
  if (!valid) {
    return c.json(
      errorBody("invalid_media_url", "Invalid or expired URL"),
      403,
    );
  }

  const row = await c.env.DB.prepare(
    "SELECT * FROM media_assets WHERE id = ? AND user_id = ?",
  )
    .bind(assetId, userId)
    .first<MediaRow>();
  if (!row) return c.json(errorBody("media_not_found", "Not found"), 404);

  const object = await c.env.MEDIA_BUCKET.get(row.object_key);
  if (!object) return c.json(errorBody("media_not_found", "Not found"), 404);

  // `?d=1` asks the browser to save rather than render. The signature covers the
  // asset, the user and the expiry, so this presentation hint is not signed: it
  // cannot widen what the capability URL already grants.
  const disposition = c.req.query("d") === "1" ? "attachment" : "inline";

  return new Response(object.body, {
    headers: {
      "content-type": row.content_type,
      "content-length": String(row.byte_size),
      "cache-control": "private, max-age=3600",
      "content-disposition": `${disposition}; filename="${safeFileName(row.original_name)}"`,
    },
  });
});

publicMedia.put("/uploads/local/:assetId", async (c) => {
  if (c.env.ENVIRONMENT !== "development") {
    return c.json(errorBody("not_found", "Not found"), 404);
  }
  const row = await c.env.DB.prepare(
    "SELECT * FROM media_assets WHERE id = ? AND status = 'pending_upload'",
  )
    .bind(c.req.param("assetId"))
    .first<MediaRow>();
  if (!row || row.upload_token !== c.req.header("x-upload-token")) {
    return c.json(
      errorBody("invalid_upload_token", "Invalid upload token"),
      401,
    );
  }
  if (c.req.header("content-type")?.split(";")[0] !== row.content_type) {
    return c.json(
      errorBody("content_type_mismatch", "Content type mismatch"),
      400,
    );
  }
  if (!c.req.raw.body) {
    return c.json(errorBody("empty_upload", "Upload body is empty"), 400);
  }

  await c.env.MEDIA_BUCKET.put(row.object_key, c.req.raw.body, {
    httpMetadata: { contentType: row.content_type },
  });
  return c.body(null, 204);
});

const media = new Hono<AppBindings>();

media.get("/media", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM media_assets WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(c.get("userId"))
    .all<MediaRow>();
  return c.json({ assets: results.map(mediaRecord) });
});

media.post("/uploads", async (c) => {
  const parsed = createUploadRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_upload",
        "The upload metadata is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }
  if (!mediaKindFor(parsed.data.contentType, parsed.data.fileName)) {
    return c.json(
      errorBody(
        "unsupported_media_type",
        `Unsupported content type: ${parsed.data.contentType}`,
        c.get("requestId"),
      ),
      415,
    );
  }

  const slot = await createUploadSlot(c.env, {
    userId: c.get("userId"),
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    bytes: parsed.data.bytes,
    requestOrigin: new URL(c.req.url).origin,
  });
  if (!slot) throw new Error("Validated upload type was rejected");

  return c.json({ asset: mediaRecord(slot.row), upload: slot.upload }, 201);
});

media.post("/uploads/:assetId/complete", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT * FROM media_assets WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("assetId"), c.get("userId"))
    .first<MediaRow>();
  if (!row) {
    return c.json(
      errorBody("media_not_found", "Media asset not found", c.get("requestId")),
      404,
    );
  }
  if (["queued", "processing", "completed"].includes(row.status)) {
    return c.json({ asset: mediaRecord(row) });
  }

  const object = await c.env.MEDIA_BUCKET.head(row.object_key);
  if (!object) {
    return c.json(
      errorBody(
        "upload_incomplete",
        "The object is not visible in storage yet",
        c.get("requestId"),
      ),
      409,
    );
  }
  if (object.size > row.byte_size || object.size > 50 * 1024 * 1024) {
    await c.env.MEDIA_BUCKET.delete(row.object_key);
    return c.json(
      errorBody(
        "upload_too_large",
        "Uploaded bytes exceed the declared size",
        c.get("requestId"),
      ),
      413,
    );
  }

  const now = new Date().toISOString();
  const status = row.note_id ? "uploaded" : "queued";
  await c.env.DB.prepare(
    "UPDATE media_assets SET status = ?, upload_token = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(status, now, row.id)
    .run();
  if (!row.note_id) {
    await c.env.JOBS.send({ type: "process-media", assetId: row.id });
  }

  row.status = status;
  row.updated_at = now;
  row.upload_token = null;
  return c.json({ asset: mediaRecord(row) });
});

export { media as mediaRoutes, publicMedia as publicMediaRoutes };
