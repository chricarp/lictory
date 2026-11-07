// Rolls out docs/internals/knowledge-links.md for existing data: builds the
// reference index of every page's published version (`page_reference`) and
// of every main specification revision (`specification_reference`) from the
// stored commits and revisions, and reprojects the knowledge links of the
// pages involved. One short transaction per page and per work item under the
// organization's lock: safe while the application serves traffic, resumable
// and idempotent (a second run changes nothing). Commits and revisions are
// only read; only the derived index rows are written.
// Usage: bun scripts/backfills/rebuild-knowledge-index.ts [--dry-run] [organizationId ...]
// On a server: deploy.sh <env> backfill <version> rebuild-knowledge-index
import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as s from "@lictory/core/db/schema";
import { resolveMigrationConnection } from "@lictory/core/db/migration-safety";
import { rebuildReferenceIndex } from "@lictory/core/spaces/knowledge";

const args = process.argv.slice(2);
// A mistyped option must not turn a preview into a write.
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
  const total = { pages: 0, pagesChanged: 0, items: 0, itemsChanged: 0 };
  for (const organizationId of organizationIds) {
    const result = await rebuildReferenceIndex(db, organizationId, { dryRun });
    if (result.pagesChanged || result.itemsChanged)
      console.info(JSON.stringify({ organizationId, dryRun, ...result }));
    total.pages += result.pages;
    total.pagesChanged += result.pagesChanged;
    total.items += result.items;
    total.itemsChanged += result.itemsChanged;
  }
  console.info(
    JSON.stringify({ organizations: organizationIds.length, dryRun, ...total }),
  );
} finally {
  await client.end();
}
