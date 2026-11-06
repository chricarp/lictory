// Rolls out docs/internals/spaces.md#when-a-line-ends for existing data:
// removes page discussions left on Lictory Spaces branches that were deleted
// before branch deletion removed them, and reprojects every page so branch
// deletion and merge confirmations show the discussions they remove. One
// short transaction per page under its organization's lock: safe while the
// application serves traffic, resumable and idempotent. Each removal is
// recorded in the page's activity.
// Usage: bun scripts/backfills/remove-orphaned-page-discussions.ts [--dry-run] [organizationId ...]
// On a server: deploy.sh <env> backfill <version> remove-orphaned-page-discussions
import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as s from "@lictory/core/db/schema";
import { resolveMigrationConnection } from "@lictory/core/db/migration-safety";
import { removeOrphanedPageDiscussions } from "@lictory/core/spaces/discussions";

const args = process.argv.slice(2);
// A mistyped option must not turn a preview into a removal.
const unknown = args.find((a) => a.startsWith("-") && a !== "--dry-run");
if (unknown)
  throw new Error(`Unknown option ${unknown}. The only option is --dry-run.`);
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
  // `pages`: pages that had orphaned discussions.
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
