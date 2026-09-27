import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../../db/schema";
import type { Capabilities } from "../shared/protocol";
import { seedDelivery } from "./delivery";

type Database = PostgresJsDatabase<typeof s>;

// Every organization starts with these roles. Administrators may rename,
// re-scope, archive or add roles afterwards; nothing here is fixed.
export const defaultRoles: { name: string; capabilities: Capabilities }[] = [
  {
    name: "Product",
    capabilities: {
      editSpecifications: true,
      changeProperties: true,
      requestReviews: true,
      review: true,
    },
  },
  {
    name: "Engineering",
    capabilities: {
      editSpecifications: false,
      changeProperties: false,
      requestReviews: true,
      review: true,
    },
  },
  {
    name: "QA",
    capabilities: {
      editSpecifications: false,
      changeProperties: false,
      requestReviews: true,
      review: true,
    },
  },
];

export function roleColumns(c: Capabilities) {
  return {
    canEditSpecifications: c.editSpecifications,
    canChangeProperties: c.changeProperties,
    canRequestReviews: c.requestReviews,
    canReview: c.review,
  };
}

// Idempotent: existing roles, types and teams are left alone. The creator
// joins Product and the default team so the workspace is immediately usable.
export async function seedDefaultRoles(
  db: Database,
  organizationId: string,
  creatorUserId: string,
) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
    );
    const existing = await tx
      .select({ id: s.organizationRole.id })
      .from(s.organizationRole)
      .where(
        and(
          eq(s.organizationRole.organizationId, organizationId),
          isNull(s.organizationRole.archivedAt),
        ),
      );
    if (!existing.length) {
      const rows = defaultRoles.map((r) => ({
        id: crypto.randomUUID(),
        organizationId,
        name: r.name,
        ...roleColumns(r.capabilities),
      }));
      await tx.insert(s.organizationRole).values(rows);
      await tx.insert(s.organizationRoleMember).values({
        organizationId,
        roleId: rows[0]!.id,
        userId: creatorUserId,
      });
    }
    // Default types (Epic, Story, Task, Bug, Subtask) and one team named
    // after the organization, so delivery works without configuration.
    const [org] = await tx
      .select({ name: s.organization.name })
      .from(s.organization)
      .where(eq(s.organization.id, organizationId));
    await seedDelivery(tx, organizationId, org?.name ?? "Team", [
      creatorUserId,
    ]);
  });
}
