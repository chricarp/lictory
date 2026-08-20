import {
  attachEntityRequestSchema,
  createAttachmentRequestSchema,
  createNoteLinkRequestSchema,
  createNoteRequestSchema,
  listNotesQuerySchema,
  updateNoteEntityRequestSchema,
  updateNoteRequestSchema,
} from "@lictory/contracts";
import { Hono } from "hono";
import type { Context } from "hono";

import type { AppBindings } from "../../bindings";
import { errorBody } from "../../http/errors";
import { attachmentRecord } from "../../infrastructure/database/records";
import type { MediaRow, NoteRow } from "../../infrastructure/database/rows";
import {
  attachEntityToNote,
  listNotes,
  loadNote,
  resetProcessingSteps,
  resolveEntity,
} from "./service";
import { createUploadSlot, mediaKindFor } from "../media/uploads";

const notes = new Hono<AppBindings>();

async function ownedNote(
  c: Context<AppBindings>,
  noteId: string,
): Promise<NoteRow | null> {
  return c.env.DB.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?")
    .bind(noteId, c.get("userId"))
    .first<NoteRow>();
}

/* -------------------------------------------------------------------------- */
/*                                    CRUD                                    */
/* -------------------------------------------------------------------------- */

notes.get("/", async (c) => {
  const parsed = listNotesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_query",
        "The note query is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }
  return c.json(await listNotes(c.env, c.get("userId"), parsed.data));
});

notes.post("/", async (c) => {
  const parsed = createNoteRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_note",
        "The note is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO notes (id, user_id, title, body_markdown, status, occurred_at, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, 0, ?, ?)`,
  )
    .bind(
      id,
      c.get("userId"),
      parsed.data.title ?? null,
      parsed.data.bodyMarkdown ?? "",
      parsed.data.occurredAt ?? null,
      now,
      now,
    )
    .run();

  const note = await loadNote(
    c.env,
    c.get("userId"),
    id,
    new URL(c.req.url).origin,
  );
  return c.json({ note }, 201);
});

notes.get("/:noteId", async (c) => {
  const note = await loadNote(
    c.env,
    c.get("userId"),
    c.req.param("noteId"),
    new URL(c.req.url).origin,
  );
  if (!note) {
    return c.json(
      errorBody("note_not_found", "Note not found", c.get("requestId")),
      404,
    );
  }
  return c.json({ note });
});

notes.patch("/:noteId", async (c) => {
  const existing = await ownedNote(c, c.req.param("noteId"));
  if (!existing) {
    return c.json(
      errorBody("note_not_found", "Note not found", c.get("requestId")),
      404,
    );
  }
  const parsed = updateNoteRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_note",
        "The note update is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE notes SET title = ?, body_markdown = ?, occurred_at = ?, pinned = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      parsed.data.title === undefined ? existing.title : parsed.data.title,
      parsed.data.bodyMarkdown ?? existing.body_markdown,
      parsed.data.occurredAt === undefined
        ? existing.occurred_at
        : parsed.data.occurredAt,
      parsed.data.pinned === undefined
        ? existing.pinned
        : Number(parsed.data.pinned),
      now,
      existing.id,
    )
    .run();

  return c.json({
    note: await loadNote(
      c.env,
      c.get("userId"),
      existing.id,
      new URL(c.req.url).origin,
    ),
  });
});

notes.delete("/:noteId", async (c) => {
  const existing = await ownedNote(c, c.req.param("noteId"));
  if (!existing) {
    return c.json(
      errorBody("note_not_found", "Note not found", c.get("requestId")),
      404,
    );
  }
  const { results } = await c.env.DB.prepare(
    "SELECT object_key FROM media_assets WHERE note_id = ?",
  )
    .bind(existing.id)
    .all<{ object_key: string }>();
  await Promise.all(
    results.map((asset) => c.env.MEDIA_BUCKET.delete(asset.object_key)),
  );
  await c.env.DB.prepare("DELETE FROM notes WHERE id = ?")
    .bind(existing.id)
    .run();
  return c.body(null, 204);
});

/* -------------------------------------------------------------------------- */
/*                                 Attachments                                */
/* -------------------------------------------------------------------------- */

notes.post("/:noteId/attachments", async (c) => {
  const note = await ownedNote(c, c.req.param("noteId"));
  if (!note) {
    return c.json(
      errorBody("note_not_found", "Note not found", c.get("requestId")),
      404,
    );
  }
  const parsed = createAttachmentRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_attachment",
        "The attachment metadata is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }

  if (!mediaKindFor(parsed.data.contentType)) {
    return c.json(
      errorBody(
        "unsupported_media_type",
        `Unsupported content type: ${parsed.data.contentType}`,
        c.get("requestId"),
      ),
      415,
    );
  }

  const position = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM media_assets WHERE note_id = ?",
  )
    .bind(note.id)
    .first<{ next: number }>();

  const slot = await createUploadSlot(c.env, {
    userId: c.get("userId"),
    noteId: note.id,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    bytes: parsed.data.bytes,
    durationSeconds: parsed.data.durationSeconds ?? undefined,
    position: position?.next ?? 0,
    requestOrigin: new URL(c.req.url).origin,
  });
  if (!slot) throw new Error("Validated attachment type was rejected");

  return c.json(
    {
      attachment: attachmentRecord(slot.row),
      upload: slot.upload,
    },
    201,
  );
});

notes.delete("/:noteId/attachments/:attachmentId", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT * FROM media_assets WHERE id = ? AND note_id = ? AND user_id = ?",
  )
    .bind(c.req.param("attachmentId"), c.req.param("noteId"), c.get("userId"))
    .first<MediaRow>();
  if (!row) {
    return c.json(
      errorBody("attachment_not_found", "Attachment not found"),
      404,
    );
  }
  await c.env.MEDIA_BUCKET.delete(row.object_key);
  await c.env.DB.prepare("DELETE FROM media_assets WHERE id = ?")
    .bind(row.id)
    .run();
  return c.body(null, 204);
});

/* -------------------------------------------------------------------------- */
/*                              AI processing                                 */
/* -------------------------------------------------------------------------- */

notes.post("/:noteId/process", async (c) => {
  const note = await ownedNote(c, c.req.param("noteId"));
  if (!note) {
    return c.json(
      errorBody("note_not_found", "Note not found", c.get("requestId")),
      404,
    );
  }
  if (note.status === "queued" || note.status === "processing") {
    return c.json({
      note: await loadNote(
        c.env,
        c.get("userId"),
        note.id,
        new URL(c.req.url).origin,
      ),
    });
  }

  const pending = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM media_assets WHERE note_id = ? AND status = 'pending_upload'",
  )
    .bind(note.id)
    .first<{ total: number }>();
  if ((pending?.total ?? 0) > 0) {
    return c.json(
      errorBody(
        "attachments_incomplete",
        "Some attachments have not finished uploading",
        c.get("requestId"),
      ),
      409,
    );
  }

  const now = new Date().toISOString();
  await resetProcessingSteps(c.env, note.id);
  await c.env.DB.prepare(
    "UPDATE notes SET status = 'queued', ai_error = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(now, note.id)
    .run();
  await c.env.JOBS.send({
    type: "process-note",
    noteId: note.id,
    userId: c.get("userId"),
  });

  return c.json(
    {
      note: await loadNote(
        c.env,
        c.get("userId"),
        note.id,
        new URL(c.req.url).origin,
      ),
    },
    202,
  );
});

/* -------------------------------------------------------------------------- */
/*                            Note ↔ entity editing                           */
/* -------------------------------------------------------------------------- */

notes.post("/:noteId/entities", async (c) => {
  const note = await ownedNote(c, c.req.param("noteId"));
  if (!note) {
    return c.json(errorBody("note_not_found", "Note not found"), 404);
  }
  const parsed = attachEntityRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_entity_link",
        "The entity link is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }

  let entityId = parsed.data.entityId;
  if (!entityId) {
    if (!parsed.data.entity) {
      return c.json(
        errorBody(
          "invalid_entity_link",
          "Provide either entityId or a new entity",
          c.get("requestId"),
        ),
        400,
      );
    }
    const entity = await resolveEntity(
      c.env,
      c.get("userId"),
      parsed.data.entity,
      "user",
    );
    entityId = entity.id;
  } else {
    const owned = await c.env.DB.prepare(
      "SELECT id FROM entities WHERE id = ? AND user_id = ?",
    )
      .bind(entityId, c.get("userId"))
      .first();
    if (!owned) {
      return c.json(errorBody("entity_not_found", "Entity not found"), 404);
    }
  }

  await attachEntityToNote(c.env, note.id, entityId, {
    role: parsed.data.role,
    status: parsed.data.status,
    origin: "user",
    confidence: 1,
    mention: parsed.data.mention ?? null,
  });

  return c.json(
    {
      note: await loadNote(
        c.env,
        c.get("userId"),
        note.id,
        new URL(c.req.url).origin,
      ),
    },
    201,
  );
});

notes.patch("/:noteId/entities/:entityId", async (c) => {
  const note = await ownedNote(c, c.req.param("noteId"));
  if (!note) {
    return c.json(errorBody("note_not_found", "Note not found"), 404);
  }
  const parsed = updateNoteEntityRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody("invalid_entity_link", "The update is invalid"),
      400,
    );
  }

  // Any human decision on an AI suggestion promotes the edge to user-owned so
  // later re-processing never silently overwrites the correction.
  const result = await c.env.DB.prepare(
    `UPDATE note_entities
        SET status = COALESCE(?, status),
            role = COALESCE(?, role),
            origin = 'user'
      WHERE note_id = ? AND entity_id = ?`,
  )
    .bind(
      parsed.data.status ?? null,
      parsed.data.role ?? null,
      note.id,
      c.req.param("entityId"),
    )
    .run();

  if (!result.meta.changes) {
    return c.json(errorBody("entity_link_not_found", "Link not found"), 404);
  }
  return c.json({
    note: await loadNote(
      c.env,
      c.get("userId"),
      note.id,
      new URL(c.req.url).origin,
    ),
  });
});

notes.delete("/:noteId/entities/:entityId", async (c) => {
  const note = await ownedNote(c, c.req.param("noteId"));
  if (!note) {
    return c.json(errorBody("note_not_found", "Note not found"), 404);
  }
  await c.env.DB.prepare(
    "DELETE FROM note_entities WHERE note_id = ? AND entity_id = ?",
  )
    .bind(note.id, c.req.param("entityId"))
    .run();
  return c.body(null, 204);
});

/* -------------------------------------------------------------------------- */
/*                             Note ↔ note editing                            */
/* -------------------------------------------------------------------------- */

notes.post("/:noteId/links", async (c) => {
  const note = await ownedNote(c, c.req.param("noteId"));
  if (!note) {
    return c.json(errorBody("note_not_found", "Note not found"), 404);
  }
  const parsed = createNoteLinkRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(errorBody("invalid_link", "The link is invalid"), 400);
  }
  if (parsed.data.targetNoteId === note.id) {
    return c.json(
      errorBody("invalid_link", "A note cannot link to itself"),
      400,
    );
  }
  const target = await ownedNote(c, parsed.data.targetNoteId);
  if (!target) {
    return c.json(errorBody("note_not_found", "Target note not found"), 404);
  }

  await c.env.DB.prepare(
    `INSERT INTO note_links
       (id, user_id, source_note_id, target_note_id, relation, confidence, origin, status, reason, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 'user', 'confirmed', ?, ?)
     ON CONFLICT(source_note_id, target_note_id, relation)
     DO UPDATE SET status = 'confirmed', origin = 'user', confidence = 1, reason = excluded.reason`,
  )
    .bind(
      crypto.randomUUID(),
      c.get("userId"),
      note.id,
      target.id,
      parsed.data.relation,
      parsed.data.reason ?? null,
      new Date().toISOString(),
    )
    .run();

  return c.json(
    {
      note: await loadNote(
        c.env,
        c.get("userId"),
        note.id,
        new URL(c.req.url).origin,
      ),
    },
    201,
  );
});

notes.patch("/:noteId/links/:linkId", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: string };
  if (!["suggested", "confirmed", "rejected"].includes(body.status ?? "")) {
    return c.json(errorBody("invalid_link", "Unknown link status"), 400);
  }
  const result = await c.env.DB.prepare(
    "UPDATE note_links SET status = ?, origin = 'user' WHERE id = ? AND user_id = ?",
  )
    .bind(body.status, c.req.param("linkId"), c.get("userId"))
    .run();
  if (!result.meta.changes) {
    return c.json(errorBody("link_not_found", "Link not found"), 404);
  }
  return c.json({
    note: await loadNote(
      c.env,
      c.get("userId"),
      c.req.param("noteId"),
      new URL(c.req.url).origin,
    ),
  });
});

notes.delete("/:noteId/links/:linkId", async (c) => {
  await c.env.DB.prepare("DELETE FROM note_links WHERE id = ? AND user_id = ?")
    .bind(c.req.param("linkId"), c.get("userId"))
    .run();
  return c.body(null, 204);
});

export { notes as noteRoutes };
