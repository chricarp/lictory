import {
  attachEntityRequestSchema,
  createAttachmentRequestSchema,
  createNoteLinkRequestSchema,
  createNoteRequestSchema,
  listNotesQuerySchema,
  updateNoteEntityRequestSchema,
  updateNoteRequestSchema,
} from "@lictory/contracts";
import { and, count, eq, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";

import type { AppBindings } from "../../bindings";
import { errorBody } from "../../http/errors";
import { database } from "../../infrastructure/database/client";
import { upsertMomentFacet } from "../entities/moments";
import { resolveEntity } from "../entities/resolver";
import { attachmentRecord } from "../../infrastructure/database/records";
import type { NoteRow } from "../../infrastructure/database/rows";
import {
  entities,
  mediaAssets,
  noteEntities,
  noteLinks,
  notes as notesTable,
} from "../../infrastructure/database/schema";
import {
  attachEntityToNote,
  listNotes,
  loadNote,
  resetProcessingSteps,
} from "./service";
import { createUploadSlot, mediaKindFor } from "../media/uploads";

const notes = new Hono<AppBindings>();

async function ownedNote(
  c: Context<AppBindings>,
  noteId: string,
): Promise<NoteRow | null> {
  return (
    (await database(c.env)
      .select()
      .from(notesTable)
      .where(
        and(eq(notesTable.id, noteId), eq(notesTable.user_id, c.get("userId"))),
      )
      .get()) ?? null
  );
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
  await database(c.env)
    .insert(notesTable)
    .values({
      id,
      user_id: c.get("userId"),
      title: parsed.data.title ?? null,
      body_markdown: parsed.data.bodyMarkdown ?? "",
      status: "draft",
      capture_timezone: parsed.data.captureTimezone ?? "UTC",
      occurred_at: parsed.data.occurredAt ?? null,
      pinned: 0,
      created_at: now,
      updated_at: now,
    });

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
  await database(c.env)
    .update(notesTable)
    .set({
      title:
        parsed.data.title === undefined ? existing.title : parsed.data.title,
      body_markdown: parsed.data.bodyMarkdown ?? existing.body_markdown,
      occurred_at:
        parsed.data.occurredAt === undefined
          ? existing.occurred_at
          : parsed.data.occurredAt,
      pinned:
        parsed.data.pinned === undefined
          ? existing.pinned
          : Number(parsed.data.pinned),
      updated_at: now,
    })
    .where(eq(notesTable.id, existing.id));

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
  const results = await database(c.env)
    .select({ object_key: mediaAssets.object_key })
    .from(mediaAssets)
    .where(eq(mediaAssets.note_id, existing.id));
  await Promise.all(
    results.map((asset) => c.env.MEDIA_BUCKET.delete(asset.object_key)),
  );
  await database(c.env)
    .delete(notesTable)
    .where(eq(notesTable.id, existing.id));
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

  const position = await database(c.env)
    .select({ current: max(mediaAssets.position) })
    .from(mediaAssets)
    .where(eq(mediaAssets.note_id, note.id))
    .get();

  const slot = await createUploadSlot(c.env, {
    userId: c.get("userId"),
    noteId: note.id,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    bytes: parsed.data.bytes,
    durationSeconds: parsed.data.durationSeconds ?? undefined,
    position: (position?.current ?? -1) + 1,
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
  const row = await database(c.env)
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, c.req.param("attachmentId")),
        eq(mediaAssets.note_id, c.req.param("noteId")),
        eq(mediaAssets.user_id, c.get("userId")),
      ),
    )
    .get();
  if (!row) {
    return c.json(
      errorBody("attachment_not_found", "Attachment not found"),
      404,
    );
  }
  await c.env.MEDIA_BUCKET.delete(row.object_key);
  await database(c.env).delete(mediaAssets).where(eq(mediaAssets.id, row.id));
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

  const pending = await database(c.env)
    .select({ total: count() })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.note_id, note.id),
        eq(mediaAssets.status, "pending_upload"),
      ),
    )
    .get();
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
  await database(c.env)
    .update(notesTable)
    .set({ status: "queued", ai_error: null, updated_at: now })
    .where(eq(notesTable.id, note.id));
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
    const resolved = await resolveEntity(
      c.env,
      c.get("userId"),
      parsed.data.entity,
      "user",
    );
    // A hand-created moment arms its own reminder, exactly as an extracted one
    // does, so both origins reach the same behaviour.
    if (resolved.moment) {
      await upsertMomentFacet(
        c.env,
        c.get("userId"),
        resolved.row,
        resolved.moment,
        {
          noteId: note.id,
          title: note.title?.trim() || "Reminder",
          body: resolved.row.reminder_reason?.trim() || resolved.row.name,
        },
      );
    }
    entityId = resolved.row.id;
  } else {
    const owned = await database(c.env)
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(eq(entities.id, entityId), eq(entities.user_id, c.get("userId"))),
      )
      .get();
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
  const result = await database(c.env)
    .update(noteEntities)
    .set({
      status: parsed.data.status ?? sql`${noteEntities.status}`,
      role: parsed.data.role ?? sql`${noteEntities.role}`,
      origin: "user",
    })
    .where(
      and(
        eq(noteEntities.note_id, note.id),
        eq(noteEntities.entity_id, c.req.param("entityId")),
      ),
    )
    .returning({ id: noteEntities.entity_id });

  if (result.length === 0) {
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
  await database(c.env)
    .delete(noteEntities)
    .where(
      and(
        eq(noteEntities.note_id, note.id),
        eq(noteEntities.entity_id, c.req.param("entityId")),
      ),
    );
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

  await database(c.env)
    .insert(noteLinks)
    .values({
      id: crypto.randomUUID(),
      user_id: c.get("userId"),
      source_note_id: note.id,
      target_note_id: target.id,
      relation: parsed.data.relation,
      confidence: 1,
      origin: "user",
      status: "confirmed",
      reason: parsed.data.reason ?? null,
      created_at: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [
        noteLinks.source_note_id,
        noteLinks.target_note_id,
        noteLinks.relation,
      ],
      set: {
        status: "confirmed",
        origin: "user",
        confidence: 1,
        reason: sql`excluded.reason`,
      },
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

notes.patch("/:noteId/links/:linkId", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: string };
  if (!["suggested", "confirmed", "rejected"].includes(body.status ?? "")) {
    return c.json(errorBody("invalid_link", "Unknown link status"), 400);
  }
  const result = await database(c.env)
    .update(noteLinks)
    .set({
      status: body.status as "suggested" | "confirmed" | "rejected",
      origin: "user",
    })
    .where(
      and(
        eq(noteLinks.id, c.req.param("linkId")),
        eq(noteLinks.user_id, c.get("userId")),
      ),
    )
    .returning({ id: noteLinks.id });
  if (result.length === 0) {
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
  await database(c.env)
    .delete(noteLinks)
    .where(
      and(
        eq(noteLinks.id, c.req.param("linkId")),
        eq(noteLinks.user_id, c.get("userId")),
      ),
    );
  return c.body(null, 204);
});

export { notes as noteRoutes };
