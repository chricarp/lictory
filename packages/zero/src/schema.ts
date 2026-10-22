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
// (drizzle/0018_zero_publication.sql): read projections plus the membership
// columns that authorize every synced query. Domain tables are never synced.

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
    data: json<{ readonly [key: string]: ReadonlyJSONValue }>(),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("key");

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

export const schema = createSchema({
  tables: [member, syncEntity],
  relationships: [memberRelationships, syncEntityRelationships],
});

export type Schema = typeof schema;
export const zql = createBuilder(schema);
