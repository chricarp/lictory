import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../../db/schema";
import type { Capabilities } from "../shared/protocol";

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

// Idempotent: an organization that already has active roles is left alone.
// The creator joins Product so the workspace is immediately usable.
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
    if (existing.length) return;
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
  });
}
