import {
  type AttachEntityRequest,
  type EntityInput,
  type ListNotesQuery,
  type Note,
  type NoteEntity,
  type NoteLink,
  type NoteSummary,
  normalizeEntityKey,
} from "@lictory/contracts";
import { and, eq, sql } from "drizzle-orm";

import type { Env } from "../../bindings";
import { database } from "../../infrastructure/database/client";
import {
  attachmentRecord,
  excerptFrom,
  noteEntityRecord,
  noteLinkRecord,
  processingStepRecord,
} from "../../infrastructure/database/records";
import type {
  EntityRow,
  MediaRow,
  NoteEntityRow,
  NoteLinkRow,
  NoteRow,
  ProcessingStepRow,
} from "../../infrastructure/database/rows";
import {
  entities as entitiesTable,
  noteEntities,
  noteProcessingSteps,
} from "../../infrastructure/database/schema";
import { signMediaUrl } from "../media/uploads";

const placeholders = (count: number) =>
  Array.from({ length: count }, () => "?").join(", ");

/* -------------------------------------------------------------------------- */
/*                              Entity resolution                             */
/* -------------------------------------------------------------------------- */

const ENTITY_COLORS: Record<EntityInput["type"], string> = {
  person: "#f4a261",
  place: "#5eead4",
  time: "#a78bfa",
  topic: "#93c5fd",
  organization: "#fca5a5",
};

/**
 * Entities are deduplicated per user on (type, normalized name) so that the
 * same person or place mentioned across many notes collapses onto one node in
 * the graph. Newly learned details (coordinates, a date) enrich the existing
 * row instead of creating a duplicate.
 */
export async function resolveEntity(
  env: Env,
  userId: string,
  input: EntityInput,
  origin: "ai" | "user" = "ai",
): Promise<EntityRow> {
  const normalizedKey = normalizeEntityKey(input.type, input.name);
  if (!normalizedKey) throw new Error("Entity name cannot be empty");
  const now = new Date().toISOString();

  const db = database(env);
  const identity = and(
    eq(entitiesTable.user_id, userId),
    eq(entitiesTable.type, input.type),
    eq(entitiesTable.normalized_key, normalizedKey),
  );
  const existing = await db.select().from(entitiesTable).where(identity).get();

  if (existing) {
    const merged: EntityRow = {
      ...existing,
      description: input.description ?? existing.description,
      latitude: input.latitude ?? existing.latitude,
      longitude: input.longitude ?? existing.longitude,
      radius_meters: input.radiusMeters ?? existing.radius_meters,
      address: input.address ?? existing.address,
      starts_at: input.startsAt ?? existing.starts_at,
      ends_at: input.endsAt ?? existing.ends_at,
      all_day:
        input.allDay === undefined || input.allDay === null
          ? existing.all_day
          : Number(input.allDay),
      timezone: input.timezone ?? existing.timezone,
      recurrence: input.recurrence ?? existing.recurrence,
      color: input.color ?? existing.color,
      // A human curating the graph promotes the entity out of "AI guessed it".
      origin: origin === "user" ? "user" : existing.origin,
      updated_at: now,
    };
    await db
      .update(entitiesTable)
      .set({
        description: merged.description,
        latitude: merged.latitude,
        longitude: merged.longitude,
        radius_meters: merged.radius_meters,
        address: merged.address,
        starts_at: merged.starts_at,
        ends_at: merged.ends_at,
        all_day: merged.all_day,
        timezone: merged.timezone,
        recurrence: merged.recurrence,
        color: merged.color,
        origin: merged.origin,
        updated_at: now,
      })
      .where(eq(entitiesTable.id, existing.id));
    return merged;
  }

  const row: EntityRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    type: input.type,
    name: input.name.trim(),
    normalized_key: normalizedKey,
    description: input.description ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    radius_meters: input.radiusMeters ?? (input.type === "place" ? 250 : null),
    address: input.address ?? null,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    all_day: Number(input.allDay ?? false),
    timezone: input.timezone ?? null,
    recurrence: input.recurrence ?? null,
    color: input.color ?? ENTITY_COLORS[input.type],
    origin,
    created_at: now,
    updated_at: now,
  };

  await db
    .insert(entitiesTable)
    .values(row)
    .onConflictDoNothing({
      target: [
        entitiesTable.user_id,
        entitiesTable.type,
        entitiesTable.normalized_key,
      ],
    });

  const stored = await db.select().from(entitiesTable).where(identity).get();
  return stored ?? row;
}

export async function attachEntityToNote(
  env: Env,
  noteId: string,
  entityId: string,
  options: {
    role: NonNullable<AttachEntityRequest["role"]>;
    status: NonNullable<AttachEntityRequest["status"]>;
    origin: "ai" | "user";
    confidence?: number;
    mention?: string | null;
  },
): Promise<void> {
  await database(env)
    .insert(noteEntities)
    .values({
      note_id: noteId,
      entity_id: entityId,
      role: options.role,
      confidence: options.confidence ?? 1,
      origin: options.origin,
      status: options.status,
      mention: options.mention ?? null,
      created_at: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [noteEntities.note_id, noteEntities.entity_id, noteEntities.role],
      set: {
        confidence: sql`max(${noteEntities.confidence}, excluded.confidence)`,
        status: sql`case when ${noteEntities.origin} = 'user' then ${noteEntities.status} else excluded.status end`,
        origin: sql`case when excluded.origin = 'user' then 'user' else ${noteEntities.origin} end`,
        mention: sql`coalesce(excluded.mention, ${noteEntities.mention})`,
      },
    });
}

/* -------------------------------------------------------------------------- */
/*                              Note aggregation                              */
/* -------------------------------------------------------------------------- */

type Aggregates = {
  attachments: Map<string, MediaRow[]>;
  entities: Map<string, Array<{ edge: NoteEntityRow; entity: EntityRow }>>;
  linkCounts: Map<string, number>;
};

async function loadAggregates(
  env: Env,
  noteIds: string[],
): Promise<Aggregates> {
  const empty: Aggregates = {
    attachments: new Map(),
    entities: new Map(),
    linkCounts: new Map(),
  };
  if (noteIds.length === 0) return empty;

  const slots = placeholders(noteIds.length);
  const [assets, edges, links] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM media_assets WHERE note_id IN (${slots}) ORDER BY position ASC, created_at ASC`,
    )
      .bind(...noteIds)
      .all<MediaRow>(),
    env.DB.prepare(
      `SELECT ne.*, e.id AS e_id, e.user_id AS e_user_id, e.type AS e_type, e.name AS e_name,
              e.normalized_key AS e_normalized_key, e.description AS e_description,
              e.latitude AS e_latitude, e.longitude AS e_longitude, e.radius_meters AS e_radius_meters,
              e.address AS e_address, e.starts_at AS e_starts_at, e.ends_at AS e_ends_at,
              e.all_day AS e_all_day, e.timezone AS e_timezone, e.recurrence AS e_recurrence,
              e.color AS e_color, e.origin AS e_origin, e.created_at AS e_created_at,
              e.updated_at AS e_updated_at
         FROM note_entities ne
         JOIN entities e ON e.id = ne.entity_id
        WHERE ne.note_id IN (${slots})
        ORDER BY ne.confidence DESC, e.name ASC`,
    )
      .bind(...noteIds)
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT note_id, COUNT(*) AS total FROM (
         SELECT source_note_id AS note_id FROM note_links WHERE source_note_id IN (${slots}) AND status <> 'rejected'
         UNION ALL
         SELECT target_note_id AS note_id FROM note_links WHERE target_note_id IN (${slots}) AND status <> 'rejected'
       ) GROUP BY note_id`,
    )
      .bind(...noteIds, ...noteIds)
      .all<{ note_id: string; total: number }>(),
  ]);

  const result: Aggregates = {
    attachments: new Map(),
    entities: new Map(),
    linkCounts: new Map(),
  };

  for (const asset of assets.results) {
    if (!asset.note_id) continue;
    const bucket = result.attachments.get(asset.note_id) ?? [];
    bucket.push(asset);
    result.attachments.set(asset.note_id, bucket);
  }

  for (const raw of edges.results) {
    const edge: NoteEntityRow = {
      note_id: raw.note_id as string,
      entity_id: raw.entity_id as string,
      role: raw.role as NoteEntityRow["role"],
      confidence: raw.confidence as number,
      origin: raw.origin as NoteEntityRow["origin"],
      status: raw.status as NoteEntityRow["status"],
      mention: (raw.mention as string | null) ?? null,
      created_at: raw.created_at as string,
    };
    const entity: EntityRow = {
      id: raw.e_id as string,
      user_id: raw.e_user_id as string,
      type: raw.e_type as EntityRow["type"],
      name: raw.e_name as string,
      normalized_key: raw.e_normalized_key as string,
      description: (raw.e_description as string | null) ?? null,
      latitude: (raw.e_latitude as number | null) ?? null,
      longitude: (raw.e_longitude as number | null) ?? null,
      radius_meters: (raw.e_radius_meters as number | null) ?? null,
      address: (raw.e_address as string | null) ?? null,
      starts_at: (raw.e_starts_at as string | null) ?? null,
      ends_at: (raw.e_ends_at as string | null) ?? null,
      all_day: (raw.e_all_day as number) ?? 0,
      timezone: (raw.e_timezone as string | null) ?? null,
      recurrence: (raw.e_recurrence as string | null) ?? null,
      color: (raw.e_color as string | null) ?? null,
      origin: raw.e_origin as EntityRow["origin"],
      created_at: raw.e_created_at as string,
      updated_at: raw.e_updated_at as string,
    };
    const bucket = result.entities.get(edge.note_id) ?? [];
    bucket.push({ edge, entity });
    result.entities.set(edge.note_id, bucket);
  }

  for (const link of links.results) {
    result.linkCounts.set(link.note_id, link.total);
  }

  return result;
}

function summarize(note: NoteRow, aggregates: Aggregates): NoteSummary {
  const attachments = aggregates.attachments.get(note.id) ?? [];
  const edges = (aggregates.entities.get(note.id) ?? []).filter(
    (item) => item.edge.status !== "rejected",
  );
  const countByType = (type: EntityRow["type"]) =>
    edges.filter((item) => item.entity.type === type).length;

  const transcriptFallback = attachments
    .map((asset) => asset.ai_result ?? "")
    .filter(Boolean)
    .join(" ");

  return {
    id: note.id,
    title: note.title,
    excerpt: excerptFrom(
      note.body_markdown,
      note.ai_summary ?? transcriptFallback,
    ),
    status: note.status,
    aiSummary: note.ai_summary,
    aiError: note.ai_error,
    occurredAt: note.occurred_at,
    pinned: note.pinned === 1,
    counts: {
      attachments: attachments.length,
      images: attachments.filter((asset) => asset.kind === "image").length,
      audio: attachments.filter((asset) => asset.kind === "audio").length,
      documents: attachments.filter((asset) => asset.kind === "document")
        .length,
      people: countByType("person") + countByType("organization"),
      places: countByType("place"),
      times: countByType("time"),
      topics: countByType("topic"),
      links: aggregates.linkCounts.get(note.id) ?? 0,
    },
    highlights: edges.slice(0, 6).map((item) => ({
      id: item.entity.id,
      type: item.entity.type,
      name: item.entity.name,
      status: item.edge.status,
    })),
    processedAt: note.processed_at,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  };
}

export async function listNotes(
  env: Env,
  userId: string,
  query: ListNotesQuery,
): Promise<{ notes: NoteSummary[]; nextCursor: string | null }> {
  const conditions = ["n.user_id = ?"];
  const bindings: unknown[] = [userId];

  if (query.status) {
    conditions.push("n.status = ?");
    bindings.push(query.status);
  }
  if (query.q) {
    conditions.push(
      "(n.title LIKE ? OR n.body_markdown LIKE ? OR n.ai_summary LIKE ?)",
    );
    const like = `%${query.q}%`;
    bindings.push(like, like, like);
  }
  if (query.entityId) {
    conditions.push(
      `EXISTS (SELECT 1 FROM note_entities ne WHERE ne.note_id = n.id AND ne.entity_id = ? AND ne.status <> 'rejected')`,
    );
    bindings.push(query.entityId);
  }
  if (query.entityType) {
    conditions.push(
      `EXISTS (SELECT 1 FROM note_entities ne JOIN entities e ON e.id = ne.entity_id
                WHERE ne.note_id = n.id AND e.type = ? AND ne.status <> 'rejected')`,
    );
    bindings.push(query.entityType);
  }
  if (query.cursor) {
    conditions.push("n.created_at < ?");
    bindings.push(query.cursor);
  }

  const limit = query.limit;
  const { results } = await env.DB.prepare(
    `SELECT n.* FROM notes n
      WHERE ${conditions.join(" AND ")}
      ORDER BY n.pinned DESC, n.created_at DESC
      LIMIT ?`,
  )
    .bind(...bindings, limit + 1)
    .all<NoteRow>();

  const page = results.slice(0, limit);
  const aggregates = await loadAggregates(
    env,
    page.map((note) => note.id),
  );

  return {
    notes: page.map((note) => summarize(note, aggregates)),
    nextCursor:
      results.length > limit ? (page.at(-1)?.created_at ?? null) : null,
  };
}

export async function loadNote(
  env: Env,
  userId: string,
  noteId: string,
  origin: string,
): Promise<Note | null> {
  const note = await env.DB.prepare(
    "SELECT * FROM notes WHERE id = ? AND user_id = ?",
  )
    .bind(noteId, userId)
    .first<NoteRow>();
  if (!note) return null;

  const aggregates = await loadAggregates(env, [noteId]);
  const summary = summarize(note, aggregates);

  const [steps, outgoing, incoming] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM note_processing_steps WHERE note_id = ? ORDER BY rowid ASC",
    )
      .bind(noteId)
      .all<ProcessingStepRow>(),
    env.DB.prepare(
      `SELECT l.*, n.title AS n_title, n.body_markdown AS n_body, n.ai_summary AS n_summary, n.created_at AS n_created_at
         FROM note_links l JOIN notes n ON n.id = l.target_note_id
        WHERE l.source_note_id = ? AND l.status <> 'rejected'
        ORDER BY l.confidence DESC`,
    )
      .bind(noteId)
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT l.*, n.title AS n_title, n.body_markdown AS n_body, n.ai_summary AS n_summary, n.created_at AS n_created_at
         FROM note_links l JOIN notes n ON n.id = l.source_note_id
        WHERE l.target_note_id = ? AND l.status <> 'rejected'
        ORDER BY l.confidence DESC`,
    )
      .bind(noteId)
      .all<Record<string, unknown>>(),
  ]);

  const toLink = (
    raw: Record<string, unknown>,
    direction: "outgoing" | "incoming",
  ): NoteLink => {
    const row = raw as unknown as NoteLinkRow;
    return noteLinkRecord(row, direction, {
      id: direction === "outgoing" ? row.target_note_id : row.source_note_id,
      title: (raw.n_title as string | null) ?? null,
      excerpt: excerptFrom(
        (raw.n_body as string) ?? "",
        (raw.n_summary as string | null) ?? "",
      ),
      createdAt: raw.n_created_at as string,
    });
  };

  const attachments = aggregates.attachments.get(noteId) ?? [];
  const entities: NoteEntity[] = (aggregates.entities.get(noteId) ?? []).map(
    (item) => noteEntityRecord(item.edge, item.entity),
  );

  return {
    ...summary,
    bodyMarkdown: note.body_markdown,
    attachments: await Promise.all(
      attachments.map(async (asset) =>
        attachmentRecord(
          asset,
          asset.status === "pending_upload"
            ? null
            : await signMediaUrl(env, origin, asset.id, userId),
        ),
      ),
    ),
    entities,
    links: [
      ...outgoing.results.map((raw) => toLink(raw, "outgoing")),
      ...incoming.results.map((raw) => toLink(raw, "incoming")),
    ],
    steps: steps.results.map(processingStepRecord),
  };
}

export async function loadNoteSummaries(
  env: Env,
  userId: string,
  noteIds: string[],
): Promise<NoteSummary[]> {
  if (noteIds.length === 0) return [];
  const { results } = await env.DB.prepare(
    `SELECT * FROM notes WHERE user_id = ? AND id IN (${placeholders(noteIds.length)})
      ORDER BY created_at DESC`,
  )
    .bind(userId, ...noteIds)
    .all<NoteRow>();
  const aggregates = await loadAggregates(
    env,
    results.map((note) => note.id),
  );
  return results.map((note) => summarize(note, aggregates));
}

/* -------------------------------------------------------------------------- */
/*                             Processing bookkeeping                         */
/* -------------------------------------------------------------------------- */

export const PROCESSING_STAGES = [
  "transcribe",
  "describe",
  "extract",
  "resolve",
  "connect",
] as const;

export async function resetProcessingSteps(
  env: Env,
  noteId: string,
): Promise<void> {
  const db = database(env);
  await db
    .delete(noteProcessingSteps)
    .where(eq(noteProcessingSteps.note_id, noteId));
  await db.insert(noteProcessingSteps).values(
    PROCESSING_STAGES.map((stage) => ({
      id: crypto.randomUUID(),
      note_id: noteId,
      stage,
      status: "pending" as const,
    })),
  );
}

export async function markStep(
  env: Env,
  noteId: string,
  stage: (typeof PROCESSING_STAGES)[number],
  status: "running" | "completed" | "failed" | "skipped",
  detail?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await database(env)
    .update(noteProcessingSteps)
    .set({
      status,
      detail: sql`coalesce(${detail ?? null}, ${noteProcessingSteps.detail})`,
      started_at:
        status === "running" ? now : sql`${noteProcessingSteps.started_at}`,
      finished_at: ["completed", "failed", "skipped"].includes(status)
        ? now
        : sql`${noteProcessingSteps.finished_at}`,
    })
    .where(
      and(
        eq(noteProcessingSteps.note_id, noteId),
        eq(noteProcessingSteps.stage, stage),
      ),
    );
}
