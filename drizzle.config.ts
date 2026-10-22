import "dotenv/config";

import { defineConfig } from "drizzle-kit";

// drizzle-kit is a local development tool here (generate, check, studio, push).
// Committed migrations are applied only by scripts/migrate.ts; see
// docs/operations/migrations.md. Refuse remote databases so `db:push` or `db:studio`
// cannot mutate a shared environment by accident.
const directUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
const url =
  (directUrl?.length ? directUrl : undefined) ??
  process.env.DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/lictory";

const connects = process.argv.some((arg) =>
  ["push", "studio", "migrate", "pull", "up", "drop"].includes(arg),
);
const host = URL.canParse(url) ? new URL(url).hostname : "";
if (
  connects &&
  !["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(host) &&
  process.env.DRIZZLE_KIT_ALLOW_REMOTE !== "1"
) {
  throw new Error(
    `drizzle-kit is configured for local databases only (got host "${host}"). Use bun run db:migrate with DATABASE_MIGRATION_TARGET for shared environments.`,
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/core/src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
