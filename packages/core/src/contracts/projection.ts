import {
  entityKey,
  type Directory,
  type Entity,
} from "@lictory/core/contracts/protocol";

// The read projections synchronized to browsers. Server writers and client
// predictions both route rows through `projectionRow`, so an optimistic row
// and the authoritative row it is replaced by always share key and scope.

// Entities listed at organization level (every list, board and inbox reads
// them). Everything else belongs to one work item's history.
export const organizationLevelTypes: ReadonlySet<Entity["type"]> = new Set([
  "project",
  "label",
  "milestone",
  "workItem",
  "relation",
  "externalLink",
]);

// The organization's shared directory, without the per-user organization list
// (which clients derive from their own memberships).
export type DirectoryProjection = Omit<Directory, "organizations">;
export type OrganizationProfile = {
  id: string;
  name: string;
  slug: string;
  logos: { mark: string | null; full: string | null };
};

export type ProjectionRow = {
  key: string;
  organizationId: string;
  projectId: string | null;
  workItemId: string | null;
  type: string;
  data: Record<string, unknown>;
};

export type ProjectionScope = { projectId: string; workItemId?: string };

export const directoryKey = (organizationId: string) =>
  `directory:${organizationId}`;
export const organizationProfileKey = (organizationId: string) =>
  `organizationProfile:${organizationId}`;

function projectOf(entity: Entity) {
  if (entity.type === "project") return entity.id;
  if ("projectId" in entity && typeof entity.projectId === "string")
    return entity.projectId;
  return undefined;
}

// Item-history entities are routed by their own work item; those that do not
// carry one (assignments, messages) use the command's scope.
export function projectionRow(
  entity: Entity,
  fallback?: ProjectionScope,
): ProjectionRow {
  const projectId = projectOf(entity) ?? fallback?.projectId;
  if (!projectId)
    throw new Error(`No projection scope for ${entity.type}:${entity.id}.`);
  const workItemId = organizationLevelTypes.has(entity.type)
    ? null
    : "workItemId" in entity && typeof entity.workItemId === "string"
      ? entity.workItemId
      : (fallback?.workItemId ?? null);
  if (!organizationLevelTypes.has(entity.type) && !workItemId)
    throw new Error(`No work item scope for ${entity.type}:${entity.id}.`);
  return {
    key: entityKey(entity),
    organizationId: entity.organizationId,
    projectId,
    workItemId,
    type: entity.type,
    data: entity as unknown as Record<string, unknown>,
  };
}

export type ProjectionOperation =
  | { operation: "upsert"; row: ProjectionRow }
  | { operation: "delete"; key: string };

// Changed entities become upserts and vanished ones deletions. Unchanged
// entities produce nothing, so replication only carries real changes.
export function diffProjections(
  before: Entity[],
  after: Entity[],
  fallback?: ProjectionScope,
): ProjectionOperation[] {
  const operations: ProjectionOperation[] = [];
  const old = new Map(before.map((e) => [entityKey(e), e]));
  const seen = new Set<string>();
  for (const entity of after) {
    const key = entityKey(entity);
    seen.add(key);
    const previous = old.get(key);
    if (previous && JSON.stringify(previous) === JSON.stringify(entity))
      continue;
    operations.push({ operation: "upsert", row: projectionRow(entity, fallback) });
  }
  for (const key of old.keys())
    if (!seen.has(key)) operations.push({ operation: "delete", key });
  return operations;
}
