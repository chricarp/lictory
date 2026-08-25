import type { Env } from "../../bindings";
import type {
  EntityMomentRow,
  EntityPlaceRow,
  EntityRow,
} from "../../infrastructure/database/rows";

/** Correlated note count, excluding edges the user has rejected. */
export const WITH_COUNT = `
  SELECT e.*, (
    SELECT COUNT(*) FROM note_entities ne
     WHERE ne.entity_id = e.id AND ne.status <> 'rejected'
  ) AS note_count
    FROM entities e
`;

const placeholders = (count: number) =>
  Array.from({ length: count }, () => "?").join(", ");

/**
 * Attaches the place and moment facets to already-loaded entity rows.
 *
 * Kept as a separate pass rather than a join because the facet tables share
 * column names with `entities` (latitude, precision), and aliasing every column
 * of a `SELECT e.*` is exactly the kind of quiet mapping bug that returns
 * `undefined` and still typechecks.
 */
export async function hydrateFacets<T extends EntityRow>(
  env: Env,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const placeIds = rows.filter((r) => r.type === "place").map((r) => r.id);
  const momentIds = rows.filter((r) => r.type === "time").map((r) => r.id);
  if (placeIds.length === 0 && momentIds.length === 0) return rows;

  const [places, moments] = await Promise.all([
    placeIds.length > 0
      ? env.DB.prepare(
          `SELECT * FROM entity_places WHERE entity_id IN (${placeholders(placeIds.length)})`,
        )
          .bind(...placeIds)
          .all<EntityPlaceRow>()
      : Promise.resolve({ results: [] as EntityPlaceRow[] }),
    momentIds.length > 0
      ? env.DB.prepare(
          `SELECT * FROM entity_moments WHERE entity_id IN (${placeholders(momentIds.length)})`,
        )
          .bind(...momentIds)
          .all<EntityMomentRow>()
      : Promise.resolve({ results: [] as EntityMomentRow[] }),
  ]);

  const placeByEntity = new Map(
    (places.results ?? []).map((row) => [row.entity_id, row]),
  );
  // A moment points at its trigger even after cancellation, so the live status
  // has to be read to tell "armed" from "deliberately switched off".
  const momentRows = moments.results ?? [];
  const triggerIds = [
    ...new Set(momentRows.map((row) => row.trigger_id).filter(Boolean)),
  ] as string[];

  if (triggerIds.length > 0) {
    const { results: statuses } = await env.DB.prepare(
      `SELECT id, status FROM triggers WHERE id IN (${placeholders(triggerIds.length)})`,
    )
      .bind(...triggerIds)
      .all<{ id: string; status: "active" | "triggered" | "cancelled" }>();
    const statusById = new Map(
      (statuses ?? []).map((row) => [row.id, row.status]),
    );
    for (const row of momentRows) {
      row.trigger_status = row.trigger_id
        ? (statusById.get(row.trigger_id) ?? null)
        : null;
    }
  }

  const momentByEntity = new Map(momentRows.map((row) => [row.entity_id, row]));

  for (const row of rows) {
    if (row.type === "place") row.place = placeByEntity.get(row.id) ?? null;
    if (row.type === "time") row.moment = momentByEntity.get(row.id) ?? null;
  }
  return rows;
}

/** Convenience for the many endpoints that hydrate exactly one row. */
export async function hydrateOne<T extends EntityRow>(
  env: Env,
  row: T,
): Promise<T> {
  const [hydrated] = await hydrateFacets(env, [row]);
  return hydrated ?? row;
}
