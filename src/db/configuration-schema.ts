import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  foreignKey,
  unique,
  uniqueIndex,
  check,
  index,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";
import { project, team } from "./domain-schema";

export const configurationRole = pgTable(
  "configuration_role",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: text("scope").notNull(),
    projectId: text("project_id"),
    teamId: text("team_id"),
    parentRoleId: text("parent_role_id"),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.teamId],
      foreignColumns: [team.organizationId, team.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.parentRoleId],
      foreignColumns: [t.organizationId, t.id],
    }).onDelete("restrict"),
    check(
      "configuration_role_local_scope",
      sql`(${t.projectId} is null or ${t.scope} = 'project') and (${t.teamId} is null or ${t.scope} = 'team') and not (${t.projectId} is not null and ${t.teamId} is not null) and ((${t.projectId} is null and ${t.teamId} is null) or ${t.parentRoleId} is not null)`,
    ),
    unique("configuration_role_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("configuration_role_active_name_unique")
      .on(
        t.organizationId,
        t.scope,
        sql`coalesce(${t.projectId}, ${t.teamId}, '')`,
        sql`lower(${t.name})`,
      )
      .where(sql`${t.archivedAt} IS NULL`),
    check("configuration_role_scope", sql`${t.scope} in ('project', 'team')`),
    check("configuration_role_name", sql`length(trim(${t.name})) > 0`),
  ],
);

export const configurationAssignment = pgTable(
  "configuration_assignment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    teamId: text("team_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [configurationRole.organizationId, configurationRole.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.teamId],
      foreignColumns: [team.organizationId, team.id],
    }).onDelete("cascade"),
    check(
      "configuration_assignment_one_scope",
      sql`(${t.projectId} is not null) <> (${t.teamId} is not null)`,
    ),
    uniqueIndex("configuration_assignment_project_unique")
      .on(t.roleId, t.userId, t.projectId)
      .where(sql`${t.projectId} is not null`),
    uniqueIndex("configuration_assignment_team_unique")
      .on(t.roleId, t.userId, t.teamId)
      .where(sql`${t.teamId} is not null`),
    index("configuration_assignment_org_user_idx").on(
      t.organizationId,
      t.userId,
    ),
  ],
);

// Immutable configuration history also retains revoked assignments and old templates.
export const configurationAudit = pgTable(
  "configuration_audit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("configuration_audit_org_idx").on(t.organizationId, t.createdAt),
  ],
);
