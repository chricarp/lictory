import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as s from "@lictory/core/db/schema";
import { seedTypes } from "@lictory/core/domain/delivery";
import { refreshDirectoryProjection } from "@lictory/core/domain/projections";
import { lock } from "@lictory/core/domain/service";

type Database = PostgresJsDatabase<typeof s>;

// Idempotent organization defaults: the work item type registry, and the
// organization's first directory and profile projections. Projects (with
// their workflow and disciplines) are created deliberately, starting with
// onboarding.
export async function seedOrganization(db: Database, organizationId: string) {
  await db.transaction(async (tx) => {
    await lock(tx, organizationId);
    await seedTypes(tx, organizationId);
    await refreshDirectoryProjection(tx, organizationId);
  });
}
