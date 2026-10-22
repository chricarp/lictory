import type { Entities } from "@lictory/core/contracts/optimistic";
import type { Entity } from "@lictory/core/contracts/protocol";
import type {
  DirectoryProjection,
  OrganizationProfile,
} from "@lictory/core/contracts/projection";

// Synchronized `sync_entity` rows as the workspace sees them: entities keyed
// by `${type}:${id}`, plus the organization-level directory and profile.

export type SyncRow = {
  readonly key: string;
  readonly type: string;
  readonly data: unknown;
  readonly updatedAt: number;
};

type Cached = { data: unknown; updatedAt: number; entity: Entity };
export type RowCache = Map<string, Cached>;

const special = new Set(["directory", "organizationProfile"]);

// Reuses the previous object for every row whose content did not change, and
// the previous record when nothing changed at all, so memoized lists and rows
// only re-render for real changes.
export function reconcileRows(
  rows: readonly SyncRow[],
  cache: RowCache,
  previous: Entities | undefined,
): Entities {
  const next: Entities = {};
  const seen = new Set<string>();
  let changed = !previous;
  for (const row of rows) {
    if (special.has(row.type)) continue;
    seen.add(row.key);
    const hit = cache.get(row.key);
    let entity: Entity;
    if (hit && hit.data === row.data) entity = hit.entity;
    else if (
      hit &&
      hit.updatedAt === row.updatedAt &&
      JSON.stringify(hit.data) === JSON.stringify(row.data)
    ) {
      entity = hit.entity;
      cache.set(row.key, { ...hit, data: row.data });
    } else {
      entity = row.data as Entity;
      cache.set(row.key, { data: row.data, updatedAt: row.updatedAt, entity });
    }
    next[row.key] = entity;
    if (previous?.[row.key] !== entity) changed = true;
  }
  for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
  if (previous && Object.keys(previous).length !== seen.size) changed = true;
  return changed || !previous ? next : previous;
}

export function findRow<T>(rows: readonly SyncRow[], key: string) {
  return rows.find((r) => r.key === key)?.data as T | undefined;
}

export type { DirectoryProjection, OrganizationProfile };

export const emptyDirectoryProjection: DirectoryProjection = {
  projects: [],
  members: [],
  projectMembers: [],
  disciplines: [],
  teams: [],
  types: [],
  projectTypes: [],
  statuses: [],
  iterations: [],
  delivery: { connections: [], targets: [] },
  readiness: [],
  ai: { enabled: false, available: false },
};

// Archived projects still prove that an organization was set up.
export function hasProjectRows(rows: readonly SyncRow[]) {
  return rows.some((r) => r.type === "project");
}
