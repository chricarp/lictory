import {
  entityInputSchema,
  entityTypeSchema,
  updateEntityRequestSchema,
} from "@lictory/contracts";
import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import { errorBody } from "../../http/errors";
import { entityRecord } from "../../infrastructure/database/records";
import type { EntityRow } from "../../infrastructure/database/rows";
import { listNotes, resolveEntity } from "../notes/service";

const entities = new Hono<AppBindings>();

const WITH_COUNT = `
  SELECT e.*, (
    SELECT COUNT(*) FROM note_entities ne
     WHERE ne.entity_id = e.id AND ne.status <> 'rejected'
  ) AS note_count
    FROM entities e
`;

entities.get("/", async (c) => {
  const type = c.req.query("type");
  const q = c.req.query("q");
  const conditions = ["e.user_id = ?"];
  const bindings: unknown[] = [c.get("userId")];

  if (type) {
    const parsed = entityTypeSchema.safeParse(type);
    if (!parsed.success) {
      return c.json(errorBody("invalid_query", "Unknown entity type"), 400);
    }
    conditions.push("e.type = ?");
    bindings.push(parsed.data);
  }
  if (q) {
    conditions.push("(e.name LIKE ? OR e.normalized_key LIKE ?)");
    bindings.push(`%${q}%`, `%${q.toLowerCase()}%`);
  }

  const { results } = await c.env.DB.prepare(
    `${WITH_COUNT} WHERE ${conditions.join(" AND ")}
      ORDER BY note_count DESC, e.name ASC LIMIT 200`,
  )
    .bind(...bindings)
    .all<EntityRow>();

  return c.json({ entities: results.map(entityRecord) });
});

entities.post("/", async (c) => {
  const parsed = entityInputSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_entity",
        "The entity is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }
  const row = await resolveEntity(c.env, c.get("userId"), parsed.data, "user");
  return c.json({ entity: entityRecord(row) }, 201);
});

entities.get("/:entityId", async (c) => {
  const row = await c.env.DB.prepare(
    `${WITH_COUNT} WHERE e.id = ? AND e.user_id = ?`,
  )
    .bind(c.req.param("entityId"), c.get("userId"))
    .first<EntityRow>();
  if (!row) {
    return c.json(errorBody("entity_not_found", "Entity not found"), 404);
  }

  const notes = await listNotes(c.env, c.get("userId"), {
    entityId: row.id,
    limit: 50,
  });

  // Entities that repeatedly appear alongside this one form the neighbourhood
  // that makes the graph browsable rather than a flat tag list.
  const { results: related } = await c.env.DB.prepare(
    `SELECT e.*, COUNT(*) AS note_count
       FROM note_entities a
       JOIN note_entities b ON b.note_id = a.note_id AND b.entity_id <> a.entity_id
       JOIN entities e ON e.id = b.entity_id
      WHERE a.entity_id = ? AND a.status <> 'rejected' AND b.status <> 'rejected'
        AND e.user_id = ?
      GROUP BY e.id
      ORDER BY note_count DESC, e.name ASC
      LIMIT 12`,
  )
    .bind(row.id, c.get("userId"))
    .all<EntityRow>();

  return c.json({
    entity: entityRecord(row),
    notes: notes.notes,
    related: related.map(entityRecord),
  });
});

entities.patch("/:entityId", async (c) => {
  const existing = await c.env.DB.prepare(
    "SELECT * FROM entities WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("entityId"), c.get("userId"))
    .first<EntityRow>();
  if (!existing) {
    return c.json(errorBody("entity_not_found", "Entity not found"), 404);
  }
  const parsed = updateEntityRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_entity",
        "The entity update is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }

  const patch = parsed.data;
  const pick = <T>(next: T | null | undefined, current: T) =>
    next === undefined ? current : next;

  await c.env.DB.prepare(
    `UPDATE entities SET name = ?, description = ?, latitude = ?, longitude = ?,
       radius_meters = ?, address = ?, starts_at = ?, ends_at = ?, all_day = ?,
       timezone = ?, recurrence = ?, color = ?, origin = 'user', updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      pick(patch.name, existing.name),
      pick(patch.description, existing.description),
      pick(patch.latitude, existing.latitude),
      pick(patch.longitude, existing.longitude),
      pick(patch.radiusMeters, existing.radius_meters),
      pick(patch.address, existing.address),
      pick(patch.startsAt, existing.starts_at),
      pick(patch.endsAt, existing.ends_at),
      patch.allDay === undefined || patch.allDay === null
        ? existing.all_day
        : Number(patch.allDay),
      pick(patch.timezone, existing.timezone),
      pick(patch.recurrence, existing.recurrence),
      pick(patch.color, existing.color),
      new Date().toISOString(),
      existing.id,
    )
    .run();

  const updated = await c.env.DB.prepare(`${WITH_COUNT} WHERE e.id = ?`)
    .bind(existing.id)
    .first<EntityRow>();
  return c.json({ entity: entityRecord(updated ?? existing) });
});

entities.delete("/:entityId", async (c) => {
  const result = await c.env.DB.prepare(
    "DELETE FROM entities WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("entityId"), c.get("userId"))
    .run();
  if (!result.meta.changes) {
    return c.json(errorBody("entity_not_found", "Entity not found"), 404);
  }
  return c.body(null, 204);
});

/**
 * Merging is how a user repairs the AI's biggest failure mode: the same person
 * or place recorded twice under slightly different names.
 */
entities.post("/:entityId/merge", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { sourceId?: string };
  const userId = c.get("userId");
  const targetId = c.req.param("entityId");
  if (!body.sourceId || body.sourceId === targetId) {
    return c.json(
      errorBody("invalid_merge", "A distinct sourceId is required"),
      400,
    );
  }

  const [target, source] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM entities WHERE id = ? AND user_id = ?")
      .bind(targetId, userId)
      .first<EntityRow>(),
    c.env.DB.prepare("SELECT * FROM entities WHERE id = ? AND user_id = ?")
      .bind(body.sourceId, userId)
      .first<EntityRow>(),
  ]);
  if (!target || !source) {
    return c.json(errorBody("entity_not_found", "Entity not found"), 404);
  }
  if (target.type !== source.type) {
    return c.json(
      errorBody(
        "invalid_merge",
        "Only entities of the same type can be merged",
      ),
      400,
    );
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO note_entities (note_id, entity_id, role, confidence, origin, status, mention, created_at)
       SELECT note_id, ?, role, confidence, origin, status, mention, created_at
         FROM note_entities WHERE entity_id = ?`,
    ).bind(targetId, source.id),
    c.env.DB.prepare("DELETE FROM entities WHERE id = ?").bind(source.id),
    c.env.DB.prepare(
      "UPDATE entities SET origin = 'user', updated_at = ? WHERE id = ?",
    ).bind(new Date().toISOString(), targetId),
  ]);

  const merged = await c.env.DB.prepare(`${WITH_COUNT} WHERE e.id = ?`)
    .bind(targetId)
    .first<EntityRow>();
  return c.json({ entity: entityRecord(merged ?? target) });
});

export { entities as entityRoutes };
