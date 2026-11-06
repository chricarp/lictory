import {
  createBuilder,
  createSchema,
  json,
  number,
  relationships,
  string,
  table,
  type ReadonlyJSONValue,
} from "@rocicorp/zero";

// The Zero schema covers exactly the replicated publication `lictory_zero`
// (drizzle/0018_zero_publication.sql, 0035_spaces_zero_publication.sql): read
// projections, the membership columns that authorize every synced query, and
// Lictory Spaces' projections and effective access. Domain tables are never
// synced.

const member = table("member")
  .columns({
    id: string(),
    organizationId: string().from("organization_id"),
    userId: string().from("user_id"),
    role: string(),
  })
  .primaryKey("id");

const syncEntity = table("syncEntity")
  .from("sync_entity")
  .columns({
    key: string(),
    organizationId: string().from("organization_id"),
    projectId: string().from("project_id").optional(),
    workItemId: string().from("work_item_id").optional(),
    type: string(),
    data: json<Readonly<Record<string, ReadonlyJSONValue>>>(),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("key");

// Lictory Spaces projections, apart from `syncEntity` so the organization and
// work item queries can never return space data. A NULL `pageId` marks a
// space-level row (space, grants, page tree); otherwise the row belongs to
// that page's history.
const spaceEntity = table("spaceEntity")
  .from("space_entity")
  .columns({
    key: string(),
    organizationId: string().from("organization_id"),
    spaceId: string().from("space_id"),
    pageId: string().from("page_id").optional(),
    type: string(),
    data: json<Readonly<Record<string, ReadonlyJSONValue>>>(),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("key");

// Effective access to a space: one row per person who can read it, with
// their level (view, comment or edit).
const spaceReader = table("spaceReader")
  .from("space_reader")
  .columns({
    organizationId: string().from("organization_id"),
    spaceId: string().from("space_id"),
    userId: string().from("user_id"),
    level: string(),
  })
  .primaryKey("spaceId", "userId");

const memberRelationships = relationships(member, ({ many }) => ({
  // Filtered to the `organizationProfile` row by the memberships query.
  organization: many({
    sourceField: ["organizationId"],
    destSchema: syncEntity,
    destField: ["organizationId"],
  }),
}));

const syncEntityRelationships = relationships(syncEntity, ({ many }) => ({
  // Every synced query requires the current user's membership through this
  // relationship, so removing a member removes rows from open subscriptions.
  members: many({
    sourceField: ["organizationId"],
    destSchema: member,
    destField: ["organizationId"],
  }),
}));

const spaceEntityRelationships = relationships(spaceEntity, ({ many }) => ({
  // Spaces queries require both a reader row of the row's space and an
  // organization membership, so revoking either removes the rows.
  readers: many({
    sourceField: ["organizationId", "spaceId"],
    destSchema: spaceReader,
    destField: ["organizationId", "spaceId"],
  }),
  members: many({
    sourceField: ["organizationId"],
    destSchema: member,
    destField: ["organizationId"],
  }),
}));

const spaceReaderRelationships = relationships(spaceReader, ({ many }) => ({
  members: many({
    sourceField: ["organizationId"],
    destSchema: member,
    destField: ["organizationId"],
  }),
}));

export const schema = createSchema({
  tables: [member, syncEntity, spaceEntity, spaceReader],
  relationships: [
    memberRelationships,
    syncEntityRelationships,
    spaceEntityRelationships,
    spaceReaderRelationships,
  ],
});

export type Schema = typeof schema;
export const zql = createBuilder(schema);
