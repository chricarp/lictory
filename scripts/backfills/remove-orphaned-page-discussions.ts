// Removes page discussions left on Lictory Spaces branches that were deleted
// before branch deletion removed them (docs/internals/spaces.md#when-a-line-ends).
// One short transaction per page under its organization's lock: safe while
// the application serves traffic, resumable and idempotent. Each removal is
// recorded in the page's activity and the page is reprojected in the same
// transaction.
// Usage: bun scripts/backfills/remove-orphaned-page-discussions.ts [--dry-run] [organizationId ...]
// On a server: deploy.sh <env> backfill <version> remove-orphaned-page-discussions
import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as s from "@lictory/core/db/schema";
import { resolveMigrationConnection } from "@lictory/core/db/migration-safety";
import { removeOrphanedPageDiscussions } from "@lictory/core/spaces/discussions";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const requested = args.filter((a) => !a.startsWith("--"));

const connection = resolveMigrationConnection(process.env);
console.info(
  `Target: ${connection.target} via ${connection.transport} (${connection.host}/${connection.database})${dryRun ? ", dry run" : ""}`,
);
const client = postgres(connection.url, {
  max: 1,
  onnotice: () => undefined,
  connection: { application_name: "lictory-backfill" },
});
const db = drizzle(client, { schema: s });

try {
  const organizationIds = requested.length
    ? requested
    : (await db.select({ id: s.organization.id }).from(s.organization)).map(
        (o) => o.id,
      );
  const total = { pages: 0, threads: 0, messages: 0 };
  for (const organizationId of organizationIds) {
    const result = await removeOrphanedPageDiscussions(db, organizationId, {
      dryRun,
    });
    if (result.threads)
      console.info(JSON.stringify({ organizationId, dryRun, ...result }));
    total.pages += result.pages;
    total.threads += result.threads;
    total.messages += result.messages;
  }
  console.info(
    JSON.stringify({ organizations: organizationIds.length, dryRun, ...total }),
  );
} finally {
  await client.end();
}
