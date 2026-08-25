import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import { entityRecord } from "../../infrastructure/database/records";
import type { EntityRow } from "../../infrastructure/database/rows";
import { hydrateFacets } from "../entities/query";

const graph = new Hono<AppBindings>();

const WITH_NOTE_COUNT = `
  SELECT e.*, (
    SELECT COUNT(*) FROM note_entities ne
     WHERE ne.entity_id = e.id AND ne.status <> 'rejected'
  ) AS note_count
    FROM entities e
`;

graph.get("/", async (c) => {
  const userId = c.get("userId");
  const top = (type: string, limit = 12) =>
    c.env.DB.prepare(
      `${WITH_NOTE_COUNT} WHERE e.user_id = ? AND e.type = ?
        ORDER BY note_count DESC, e.name ASC LIMIT ${limit}`,
    )
      .bind(userId, type)
      .all<EntityRow>();

  const [counts, people, places, topics, upcoming] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM notes WHERE user_id = ?) AS notes,
         (SELECT COUNT(*) FROM notes WHERE user_id = ? AND status IN ('queued','processing')) AS processing,
         (SELECT COUNT(*) FROM entities WHERE user_id = ? AND type = 'person') AS people,
         (SELECT COUNT(*) FROM entities WHERE user_id = ? AND type = 'place') AS places,
         (SELECT COUNT(*) FROM entities WHERE user_id = ? AND type = 'time') AS times,
         (SELECT COUNT(*) FROM entities WHERE user_id = ? AND type = 'topic') AS topics`,
    )
      .bind(userId, userId, userId, userId, userId, userId)
      .first<{
        notes: number;
        processing: number;
        people: number;
        places: number;
        times: number;
        topics: number;
      }>(),
    top("person"),
    top("place"),
    top("topic", 16),
    // Ordered by the moment's next occurrence, not its anchor, so a birthday
    // recorded years ago still surfaces in the right place.
    c.env.DB.prepare(
      `${WITH_NOTE_COUNT}
         JOIN entity_moments m ON m.entity_id = e.id
        WHERE e.user_id = ? AND m.next_occurrence_at IS NOT NULL
          AND m.next_occurrence_at >= ?
        ORDER BY m.next_occurrence_at ASC LIMIT 12`,
    )
      .bind(userId, new Date(Date.now() - 86_400_000).toISOString())
      .all<EntityRow>(),
  ]);

  return c.json({
    totals: counts ?? {
      notes: 0,
      processing: 0,
      people: 0,
      places: 0,
      times: 0,
      topics: 0,
    },
    people: people.results.map(entityRecord),
    places: places.results.map(entityRecord),
    topics: topics.results.map(entityRecord),
    upcoming: (await hydrateFacets(c.env, upcoming.results)).map(entityRecord),
  });
});

export { graph as graphRoutes };
