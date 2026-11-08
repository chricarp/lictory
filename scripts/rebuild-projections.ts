// Operator recovery: reconciles the synchronized projections (`sync_entity`)
// with the domain tables, for one organization or all of them. Safe to run
// while the application serves traffic: each organization is rebuilt under
// its organization lock, and only rows that differ are written.
// Usage: bun scripts/rebuild-projections.ts [organizationId ...]
import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as s from "@lictory/core/db/schema";
import { rebuildProjections } from "@lictory/core/domain/projections";
import { refreshAiState } from "@lictory/core/domain/ai-settings";
import { env } from "@lictory/core/lib/env";

const url = env("DATABASE_URL_UNPOOLED") ?? env("DATABASE_URL");
if (!url) throw new Error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED).");
const client = postgres(url, { max: 1, onnotice: () => undefined });
const db = drizzle(client, { schema: s });

try {
  const requested = process.argv.slice(2);
  // Directories record the AI provider: use the stored settings, like the API.
  await refreshAiState(db);
  const organizationIds = requested.length
    ? requested
    : (await db.select({ id: s.organization.id }).from(s.organization)).map(
        (o) => o.id,
      );
  for (const organizationId of organizationIds) {
    const result = await rebuildProjections(db, organizationId);
    console.info(JSON.stringify({ organizationId, ...result }));
  }
} finally {
  await client.end();
}
