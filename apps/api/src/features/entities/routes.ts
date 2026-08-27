import {
  type EntityType,
  SUGGEST_SCORE,
  entityInputSchema,
  listEntitiesQuerySchema,
  nameMatchScore,
  normalizeEntityKey,
  updateEntityRequestSchema,
} from "@lictory/contracts";
import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import { errorBody } from "../../http/errors";
import { entityRecord } from "../../infrastructure/database/records";
import type {
  EntityDuplicateRow,
  EntityRow,
} from "../../infrastructure/database/rows";
import { listNotes } from "../notes/service";
import { upsertMomentFacet } from "./moments";
import { WITH_COUNT, hydrateFacets, hydrateOne } from "./query";
import { reindexAliases, resolveEntity } from "./resolver";

const entities = new Hono<AppBindings>();

const placeholders = (count: number) =>
  Array.from({ length: count }, () => "?").join(", ");

entities.get("/", async (c) => {
  const parsed = listEntitiesQuerySchema.safeParse({
    type: c.req.query("type"),
    types: c.req.query("types"),
    q: c.req.query("q"),
  });
  if (!parsed.success) {
    return c.json(errorBody("invalid_query", "Unknown entity type"), 400);
  }

  const { type, types, q } = parsed.data;
  const conditions = ["e.user_id = ?"];
  const bindings: unknown[] = [c.get("userId")];

  // `types` lets one directory render more than one kind — People shows People
  // and Organisations together without two racing requests.
  const wanted = types ?? (type ? [type] : null);
  if (wanted) {
    conditions.push(`e.type IN (${placeholders(wanted.length)})`);
    bindings.push(...wanted);
  }
  if (q) {
    conditions.push("(e.name LIKE ? OR e.normalized_key LIKE ?)");
    bindings.push(`%${q}%`, `%${q.toLowerCase()}%`);
  }

  // A directory of moments is a chronology; every other directory is a
  // popularity ranking. Sorting people by date would be as wrong as sorting
  // dates by how often they are mentioned.
  const chronological = wanted?.length === 1 && wanted[0] === "time";
  const order = chronological
    ? "ORDER BY COALESCE(e.starts_at, '9999') ASC, e.name ASC"
    : "ORDER BY note_count DESC, e.name ASC";

  const { results } = await c.env.DB.prepare(
    `${WITH_COUNT} WHERE ${conditions.join(" AND ")} ${order} LIMIT 200`,
  )
    .bind(...bindings)
    .all<EntityRow>();

  const hydrated = await hydrateFacets(c.env, results);
  return c.json({ entities: hydrated.map(entityRecord) });
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

  const resolved = await resolveEntity(
    c.env,
    c.get("userId"),
    parsed.data,
    "user",
  );
  // A hand-created moment arms its reminder just like an extracted one, so both
  // origins reach the same behaviour.
  if (resolved.moment) {
    await upsertMomentFacet(
      c.env,
      c.get("userId"),
      resolved.row,
      resolved.moment,
      {
        noteId: null,
        title: resolved.row.name,
        body: resolved.row.reminder_reason?.trim() || resolved.row.name,
      },
    );
  }

  const row = await hydrateOne(c.env, resolved.row);
  return c.json({ entity: entityRecord(row) }, 201);
});

/**
 * Open duplicate suspicions across the whole graph — the review queue for
 * pairs the resolver was not confident enough to collapse on its own.
 */
entities.get("/duplicates", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM entity_duplicates
      WHERE user_id = ? AND status = 'open'
      ORDER BY score DESC, created_at DESC LIMIT 50`,
  )
    .bind(c.get("userId"))
    .all<EntityDuplicateRow>();

  if (results.length === 0) return c.json({ duplicates: [] });

  const ids = [
    ...new Set(results.flatMap((r) => [r.entity_id, r.candidate_entity_id])),
  ];
  const { results: rows } = await c.env.DB.prepare(
    `${WITH_COUNT} WHERE e.user_id = ? AND e.id IN (${placeholders(ids.length)})`,
  )
    .bind(c.get("userId"), ...ids)
    .all<EntityRow>();

  const byId = new Map(
    (await hydrateFacets(c.env, rows)).map((row) => [row.id, row]),
  );

  const duplicates = results.flatMap((row) => {
    const entity = byId.get(row.entity_id);
    const candidate = byId.get(row.candidate_entity_id);
    if (!entity || !candidate) return [];
    return [
      {
        id: row.id,
        type: row.type,
        score: row.score,
        reason: row.reason,
        status: row.status,
        entity: entityRecord(entity),
        candidate: entityRecord(candidate),
        createdAt: row.created_at,
      },
    ];
  });

  return c.json({ duplicates });
});

/**
 * Sweeps the existing graph for pairs that look like the same thing.
 *
 * The resolver only ever sees mentions as they arrive, so a graph built before
 * normalization existed — or one where two nodes drifted together after a
 * rename — keeps duplicates it will never be asked about again. This is the
 * way to surface those, and it only ever proposes: nothing is merged here.
 */
entities.post("/duplicates/scan", async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, type, name FROM entities WHERE user_id = ? ORDER BY type, name LIMIT 1000",
  )
    .bind(userId)
    .all<{ id: string; type: EntityType; name: string }>();

  const byType = new Map<EntityType, typeof results>();
  for (const row of results) {
    const bucket = byType.get(row.type) ?? [];
    bucket.push(row);
    byType.set(row.type, bucket);
  }

  const statements = [];
  const now = new Date().toISOString();

  for (const [type, rows] of byType) {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const left = rows[i];
        const right = rows[j];
        if (!left || !right) continue;
        const score = nameMatchScore(type, left.name, right.name);
        if (score < SUGGEST_SCORE) continue;

        // Stable ordering so the same pair is one row whichever side is seen
        // first, and so re-scanning cannot re-open a dismissed decision.
        const [first, second] =
          left.id < right.id ? [left, right] : [right, left];
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO entity_duplicates
               (id, user_id, type, entity_id, candidate_entity_id, score, reason, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
             ON CONFLICT(entity_id, candidate_entity_id)
             DO UPDATE SET score = max(entity_duplicates.score, excluded.score)`,
          ).bind(
            crypto.randomUUID(),
            userId,
            type,
            first.id,
            second.id,
            score,
            `"${left.name}" looks like "${right.name}"`,
            now,
          ),
        );
      }
    }
  }

  if (statements.length > 0) await c.env.DB.batch(statements);
  return c.json({ found: statements.length });
});

/** Dismissing is permanent: these two really are different things. */ entities.post(
  "/duplicates/:duplicateId/dismiss",
  async (c) => {
    const result = await c.env.DB.prepare(
      "UPDATE entity_duplicates SET status = 'dismissed' WHERE id = ? AND user_id = ?",
    )
      .bind(c.req.param("duplicateId"), c.get("userId"))
      .run();
    if (!result.meta.changes) {
      return c.json(
        errorBody("duplicate_not_found", "Suggestion not found"),
        404,
      );
    }
    return c.body(null, 204);
  },
);

entities.get("/:entityId", async (c) => {
  const found = await c.env.DB.prepare(
    `${WITH_COUNT} WHERE e.id = ? AND e.user_id = ?`,
  )
    .bind(c.req.param("entityId"), c.get("userId"))
    .first<EntityRow>();
  if (!found) {
    return c.json(errorBody("entity_not_found", "Entity not found"), 404);
  }
  const row = await hydrateOne(c.env, found);

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

  // Anything this node might be a duplicate of, so the repair is offered where
  // the user is already looking at it.
  const { results: duplicates } = await c.env.DB.prepare(
    `SELECT * FROM entity_duplicates
      WHERE user_id = ? AND status = 'open'
        AND (entity_id = ? OR candidate_entity_id = ?)
      ORDER BY score DESC LIMIT 5`,
  )
    .bind(c.get("userId"), row.id, row.id)
    .all<EntityDuplicateRow>();

  const otherIds = duplicates.map((d) =>
    d.entity_id === row.id ? d.candidate_entity_id : d.entity_id,
  );
  const others =
    otherIds.length > 0
      ? await c.env.DB.prepare(
          `${WITH_COUNT} WHERE e.user_id = ? AND e.id IN (${placeholders(otherIds.length)})`,
        )
          .bind(c.get("userId"), ...otherIds)
          .all<EntityRow>()
      : { results: [] as EntityRow[] };

  const otherById = new Map(
    (await hydrateFacets(c.env, others.results ?? [])).map((r) => [r.id, r]),
  );

  return c.json({
    entity: entityRecord(row),
    notes: notes.notes,
    related: await hydrateFacets(c.env, related).then((rows) =>
      rows.map(entityRecord),
    ),
    duplicates: duplicates.flatMap((d) => {
      const otherId =
        d.entity_id === row.id ? d.candidate_entity_id : d.entity_id;
      const other = otherById.get(otherId);
      if (!other) return [];
      return [
        {
          id: d.id,
          type: d.type,
          score: d.score,
          reason: d.reason,
          status: d.status,
          entity: entityRecord(row),
          candidate: entityRecord(other),
          createdAt: d.created_at,
        },
      ];
    }),
  });
});

entities.patch("/:entityId", async (c) => {
  const userId = c.get("userId");
  const existing = await c.env.DB.prepare(
    "SELECT * FROM entities WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("entityId"), userId)
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

  // A name is the one field that can never be cleared, so it does not go
  // through `pick`.
  const name = patch.name ?? existing.name;
  // Renaming has to move the identity key with the name, or the node keeps
  // answering to a key nothing will ever look up again.
  const normalizedKey = normalizeEntityKey(existing.type, name);
  if (!normalizedKey) {
    return c.json(errorBody("invalid_entity", "Name cannot be empty"), 400);
  }

  if (normalizedKey !== existing.normalized_key) {
    const clash = await c.env.DB.prepare(
      "SELECT id FROM entities WHERE user_id = ? AND type = ? AND normalized_key = ? AND id <> ?",
    )
      .bind(userId, existing.type, normalizedKey, existing.id)
      .first<{ id: string }>();
    if (clash) {
      return c.json(
        errorBody(
          "entity_name_taken",
          "Another entity already uses that name — merge them instead",
        ),
        409,
      );
    }
  }

  await c.env.DB.prepare(
    `UPDATE entities SET name = ?, normalized_key = ?, description = ?, latitude = ?, longitude = ?,
       radius_meters = ?, address = ?, starts_at = ?, ends_at = ?, all_day = ?,
       timezone = ?, recurrence = ?, time_kind = ?, needs_reminder = ?,
       reminder_reason = ?, color = ?, origin = 'user', updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      name,
      normalizedKey,
      existing.type === "topic"
        ? null
        : pick(patch.description, existing.description),
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
      pick(patch.timeKind, existing.time_kind),
      patch.needsReminder === undefined || patch.needsReminder === null
        ? existing.needs_reminder
        : Number(patch.needsReminder),
      pick(patch.reminderReason, existing.reminder_reason),
      pick(patch.color, existing.color),
      new Date().toISOString(),
      existing.id,
    )
    .run();

  const updated = await c.env.DB.prepare(`${WITH_COUNT} WHERE e.id = ?`)
    .bind(existing.id)
    .first<EntityRow>();
  const row = updated ?? existing;

  if (normalizedKey !== existing.normalized_key) {
    await reindexAliases(c.env, userId, row);
  }

  // Re-resolve the facets so a corrected address gets re-parsed and a moved
  // moment retimes its reminder instead of leaving a stale one armed.
  const touchedPlace =
    row.type === "place" &&
    (patch.address !== undefined ||
      patch.latitude !== undefined ||
      patch.longitude !== undefined ||
      patch.street !== undefined ||
      patch.locality !== undefined ||
      patch.region !== undefined ||
      patch.postalCode !== undefined ||
      patch.country !== undefined ||
      patch.name !== undefined);

  // Every field a moment is derived from has to be in this gate, or editing it
  // leaves the schedule and the armed reminder describing the old moment.
  const touchedMoment =
    row.type === "time" &&
    (patch.startsAt !== undefined ||
      patch.endsAt !== undefined ||
      patch.allDay !== undefined ||
      patch.timezone !== undefined ||
      patch.recurrence !== undefined ||
      patch.recurrenceRule !== undefined ||
      patch.timeKind !== undefined ||
      patch.needsReminder !== undefined ||
      patch.reminderReason !== undefined);

  if (touchedPlace || touchedMoment) {
    const reresolved = await resolveEntity(
      c.env,
      userId,
      {
        type: row.type,
        name: row.name,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        street: patch.street,
        locality: patch.locality,
        region: patch.region,
        postalCode: patch.postalCode,
        country: patch.country,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        allDay: row.all_day === 1,
        timezone: row.timezone,
        recurrence: row.recurrence,
        recurrenceRule: patch.recurrenceRule,
        timeKind: row.time_kind,
        needsReminder: row.needs_reminder === 1,
        reminderReason: row.reminder_reason,
      },
      "user",
    );
    if (reresolved.moment) {
      await upsertMomentFacet(c.env, userId, row, reresolved.moment, {
        noteId: null,
        title: row.name,
        body: row.reminder_reason?.trim() || row.name,
      });
    }
  }

  return c.json({ entity: entityRecord(await hydrateOne(c.env, row)) });
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
 * or place recorded twice under slightly different names. The source's aliases
 * move to the target, so every spelling the graph has ever seen keeps resolving
 * after the merge instead of quietly recreating the duplicate on the next note.
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

  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO note_entities (note_id, entity_id, role, confidence, origin, status, mention, created_at)
       SELECT note_id, ?, role, confidence, origin, status, mention, created_at
         FROM note_entities WHERE entity_id = ?`,
    ).bind(targetId, source.id),
    // Every surface form the source answered to now points at the target.
    c.env.DB.prepare(
      "UPDATE OR IGNORE entity_aliases SET entity_id = ? WHERE entity_id = ?",
    ).bind(targetId, source.id),
    // Reminders follow the node they belong to.
    c.env.DB.prepare(
      "UPDATE triggers SET entity_id = ? WHERE entity_id = ?",
    ).bind(targetId, source.id),
    // The pair is settled, so it must not come back as a suggestion.
    c.env.DB.prepare(
      `UPDATE entity_duplicates SET status = 'merged'
        WHERE (entity_id = ? AND candidate_entity_id = ?)
           OR (entity_id = ? AND candidate_entity_id = ?)`,
    ).bind(targetId, source.id, source.id, targetId),
    c.env.DB.prepare("DELETE FROM entities WHERE id = ?").bind(source.id),
    c.env.DB.prepare(
      "UPDATE entities SET origin = 'user', updated_at = ? WHERE id = ?",
    ).bind(now, targetId),
  ]);

  const merged = await c.env.DB.prepare(`${WITH_COUNT} WHERE e.id = ?`)
    .bind(targetId)
    .first<EntityRow>();
  return c.json({
    entity: entityRecord(await hydrateOne(c.env, merged ?? target)),
  });
});

export { entities as entityRoutes };
