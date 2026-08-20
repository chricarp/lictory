import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import { entityRecord } from "../../infrastructure/database/records";
import type { EntityRow } from "../../infrastructure/database/rows";
import { listNotes } from "../notes/service";

const search = new Hono<AppBindings>();

search.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ notes: [], entities: [] });
  const userId = c.get("userId");

  const [notes, entities] = await Promise.all([
    listNotes(c.env, userId, { q, limit: 12 }),
    c.env.DB.prepare(
      `SELECT e.*, (
         SELECT COUNT(*) FROM note_entities ne WHERE ne.entity_id = e.id AND ne.status <> 'rejected'
       ) AS note_count
         FROM entities e
        WHERE e.user_id = ? AND e.name LIKE ?
        ORDER BY note_count DESC LIMIT 12`,
    )
      .bind(userId, `%${q}%`)
      .all(),
  ]);

  return c.json({
    notes: notes.notes,
    entities: entities.results.map((row) =>
      entityRecord(row as unknown as EntityRow),
    ),
  });
});

export { search as searchRoutes };
