import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  MigrationConfigurationError,
  MigrationHistoryError,
  planMigrations,
  resolveMigrationConnection,
} from "@lictory/core/db/migration-safety";

const neonDirect =
  "postgresql://owner:secret@ep-calm-sun-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const neonHost = "ep-calm-sun-123.eu-central-1.aws.neon.tech";

void describe("migration connection", () => {
  void test("local target falls back to runtime variables for local hosts", () => {
    const resolved = resolveMigrationConnection({
      DATABASE_URL: "postgresql://lictory:lictory@localhost:5432/lictory",
    });
    assert.equal(resolved.target, "local");
    assert.equal(resolved.database, "lictory");
  });

  void test("local target refuses a remote database", () => {
    assert.throws(
      () => resolveMigrationConnection({ DATABASE_URL: neonDirect }),
      MigrationConfigurationError,
    );
  });

  void test("production never uses runtime variables", () => {
    assert.throws(
      () =>
        resolveMigrationConnection({
          DATABASE_MIGRATION_TARGET: "production",
          DATABASE_URL: neonDirect,
          DATABASE_URL_UNPOOLED: neonDirect,
          DATABASE_MIGRATION_EXPECTED_HOST: neonHost,
        }),
      /DATABASE_MIGRATION_URL is required/,
    );
  });

  void test("production requires the expected host to match", () => {
    assert.throws(
      () =>
        resolveMigrationConnection({
          DATABASE_MIGRATION_TARGET: "production",
          DATABASE_MIGRATION_URL: neonDirect,
          DATABASE_MIGRATION_EXPECTED_HOST: "ep-staging-999.aws.neon.tech",
        }),
      /does not match/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          DATABASE_MIGRATION_TARGET: "production",
          DATABASE_MIGRATION_URL: neonDirect,
        }),
      /EXPECTED_HOST is required/,
    );
    const resolved = resolveMigrationConnection({
      DATABASE_MIGRATION_TARGET: "production",
      DATABASE_MIGRATION_URL: neonDirect,
      DATABASE_MIGRATION_EXPECTED_HOST: neonHost.toUpperCase(),
    });
    assert.equal(resolved.host, neonHost);
  });

  void test("remote targets reject pooled, unencrypted and local connections", () => {
    const pooled = neonDirect.replace(
      "ep-calm-sun-123",
      "ep-calm-sun-123-pooler",
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          DATABASE_MIGRATION_TARGET: "staging",
          DATABASE_MIGRATION_URL: pooled,
          DATABASE_MIGRATION_EXPECTED_HOST: new URL(pooled).hostname,
        }),
      /unpooled/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          DATABASE_MIGRATION_TARGET: "staging",
          DATABASE_MIGRATION_URL: neonDirect.replace("?sslmode=require", ""),
          DATABASE_MIGRATION_EXPECTED_HOST: neonHost,
        }),
      /sslmode/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          DATABASE_MIGRATION_TARGET: "production",
          DATABASE_MIGRATION_URL: "postgresql://a:b@localhost/db",
          DATABASE_MIGRATION_EXPECTED_HOST: "localhost",
        }),
      /local database host/,
    );
  });

  void test("refuses unknown targets and transports", () => {
    assert.throws(
      () => resolveMigrationConnection({ DATABASE_MIGRATION_TARGET: "prod" }),
      /must be one of/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          DATABASE_MIGRATION_TARGET: "production",
          DATABASE_MIGRATION_TRANSPORT: "plaintext",
        }),
      /DATABASE_MIGRATION_TRANSPORT must be one of/,
    );
  });
});

void describe("compose-internal migration connection", () => {
  const production = {
    DATABASE_MIGRATION_TARGET: "production",
    DATABASE_MIGRATION_TRANSPORT: "compose-internal",
    DATABASE_MIGRATION_URL:
      "postgresql://lictory_owner:secret@postgres:5432/lictory?sslmode=disable",
    DATABASE_MIGRATION_EXPECTED_HOST: "postgres",
    DATABASE_MIGRATION_EXPECTED_DATABASE: "lictory",
    LICTORY_ENVIRONMENT: "production",
  };

  void test("accepts the server's own Compose database when every guard agrees", () => {
    const resolved = resolveMigrationConnection(production);
    assert.equal(resolved.target, "production");
    assert.equal(resolved.transport, "compose-internal");
    assert.equal(resolved.host, "postgres");
    assert.equal(resolved.database, "lictory");
  });

  void test("the same Compose host still refuses the plain TLS rules", () => {
    assert.throws(
      () =>
        resolveMigrationConnection({
          ...production,
          DATABASE_MIGRATION_TRANSPORT: undefined,
        }),
      /local database host/,
    );
  });

  void test("only staging and production may use the internal transport", () => {
    for (const target of ["local", "test", "preview"])
      assert.throws(
        () =>
          resolveMigrationConnection({
            ...production,
            DATABASE_MIGRATION_TARGET: target,
            LICTORY_ENVIRONMENT: target,
          }),
        /only serves the staging and production servers/,
      );
  });

  void test("a staging configuration cannot migrate production and vice versa", () => {
    assert.throws(
      () =>
        resolveMigrationConnection({
          ...production,
          LICTORY_ENVIRONMENT: "staging",
        }),
      /does not confirm the production target/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({ ...production, LICTORY_ENVIRONMENT: "" }),
      /does not confirm/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          ...production,
          DATABASE_MIGRATION_URL: production.DATABASE_MIGRATION_URL.replace(
            "/lictory?",
            "/lictory_staging?",
          ),
        }),
      /does not match DATABASE_MIGRATION_EXPECTED_DATABASE/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          ...production,
          DATABASE_MIGRATION_EXPECTED_DATABASE: undefined,
        }),
      /EXPECTED_DATABASE is required/,
    );
  });

  void test("refuses other hosts and implicit transport security", () => {
    assert.throws(
      () =>
        resolveMigrationConnection({
          ...production,
          DATABASE_MIGRATION_URL: production.DATABASE_MIGRATION_URL.replace(
            "@postgres:",
            "@db.example.com:",
          ),
          DATABASE_MIGRATION_EXPECTED_HOST: "db.example.com",
        }),
      /only reaches the Compose service "postgres"/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          ...production,
          DATABASE_MIGRATION_URL: production.DATABASE_MIGRATION_URL.replace(
            "?sslmode=disable",
            "",
          ),
        }),
      /sslmode=disable stated explicitly/,
    );
    assert.throws(
      () =>
        resolveMigrationConnection({
          ...production,
          DATABASE_MIGRATION_EXPECTED_HOST: undefined,
        }),
      /EXPECTED_HOST is required/,
    );
  });
});

void describe("migration plan", () => {
  const repo = [
    { tag: "0000_a", when: 100, hash: "a" },
    { tag: "0001_b", when: 200, hash: "b" },
    { tag: "0002_c", when: 300, hash: "c" },
  ];

  void test("returns pending migrations after the applied prefix", () => {
    const plan = planMigrations(repo, [{ hash: "a", createdAt: 100 }]);
    assert.deepEqual(
      plan.pending.map((m) => m.tag),
      ["0001_b", "0002_c"],
    );
  });

  void test("rejects an applied migration whose SQL was edited", () => {
    assert.throws(
      () => planMigrations(repo, [{ hash: "edited", createdAt: 100 }]),
      /edited after it was applied/,
    );
  });

  void test("rejects a migration Drizzle would silently skip", () => {
    assert.throws(
      () =>
        planMigrations(repo, [
          { hash: "a", createdAt: 100 },
          { hash: "c", createdAt: 300 },
        ]),
      /would be skipped/,
    );
  });

  void test("rejects non-increasing journal timestamps", () => {
    assert.throws(
      () =>
        planMigrations(
          [repo[0]!, { tag: "0001_old", when: 50, hash: "x" }],
          [],
        ),
      MigrationHistoryError,
    );
  });

  void test("tolerates a database newer than an older rollback checkout", () => {
    const plan = planMigrations(repo.slice(0, 2), [
      { hash: "a", createdAt: 100 },
      { hash: "b", createdAt: 200 },
      { hash: "c", createdAt: 300 },
    ]);
    assert.equal(plan.pending.length, 0);
    assert.equal(plan.unknownApplied.length, 1);
  });

  void test("committed migration history is consistent", async () => {
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string; when: number }[] };
    const files = readMigrationFiles({ migrationsFolder: "drizzle" });
    const committed = journal.entries.map((entry, i) => ({
      tag: entry.tag,
      when: entry.when,
      hash: files[i]!.hash,
    }));
    assert.equal(
      planMigrations(committed, []).pending.length,
      committed.length,
    );
  });
});
