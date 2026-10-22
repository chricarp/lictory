import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as s from "@lictory/core/db/schema";
import { seedTypes } from "@lictory/core/domain/delivery";

type Database = PostgresJsDatabase<typeof s>;

// Idempotent organization defaults: the work item type registry. Projects
// (with their workflow and disciplines) are created deliberately, starting
// with onboarding.
export async function seedOrganization(db: Database, organizationId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
    );
    await seedTypes(tx, organizationId);
  });
}
