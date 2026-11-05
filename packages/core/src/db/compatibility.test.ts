import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  checkDatabaseCompatibility,
  compatible,
  evaluateCompatibility,
  formatReport,
  type ConnectionFacts,
  type DatabaseFacts,
  type ServerFacts,
  type ZeroFacts,
} from "@lictory/core/db/compatibility";
import { applyGrants, setupDatabase } from "@lictory/core/db/database-roles";
import { resolveMigrationConnection } from "@lictory/core/db/migration-safety";

// ------------------------------------------------------------------ facts

const server: ServerFacts = {
  versionNum: 170011,
  version: "17.11",
  walLevel: "logical",
  maxReplicationSlots: 10,
  slotsUsed: 0,
  zeroSlots: 0,
  zeroSlotActive: false,
  maxWalSenders: 10,
  sendersUsed: 0,
  maxSlotWalKeepSize: "8GB",
  encoding: "UTF8",
  collate: "C.UTF-8",
  ctype: "C.UTF-8",
  localeProvider: "b",
  locale: "C.UTF-8",
  ownerCanCreateInDatabase: true,
  ownerCanCreateInPublic: true,
  publication: { complete: true },
};

const zero: ZeroFacts = {
  superuser: false,
  replication: true,
  replicationRoles: [],
  canCreateInDatabase: true,
  eventTriggers: "allowed",
  ddlDetection: true,
  canReadPublished: true,
  replicationProbe: { result: "created" },
};

const external = (
  purpose: ConnectionFacts["purpose"],
  overrides: Partial<ConnectionFacts> = {},
): ConnectionFacts => ({
  purpose,
  host: "lictory.abc123.eu-central-1.rds.amazonaws.com",
  port: 5432,
  sslmode: "verify-full",
  user: purpose,
  ssl: true,
  ...overrides,
});

const compatibleFacts: DatabaseFacts = {
  connections: [external("migration"), external("zero"), external("app")],
  server,
  zero,
  cvr: { canCreateInDatabase: true },
};

function result(facts: DatabaseFacts, id: string) {
  const found = evaluateCompatibility(facts).find((c) => c.id === id);
  assert.ok(found, `no ${id} check`);
  return found;
}

void describe("database compatibility", () => {
  void test("a database that meets every requirement passes without warnings", () => {
    const checks = evaluateCompatibility(compatibleFacts);
    assert.ok(compatible(checks));
    assert.deepEqual(
      checks.filter((c) => c.status !== "pass").map((c) => c.id),
      [],
    );
    assert.match(formatReport(checks), /^Compatible\.$/m);
  });

  void test("without logical WAL the check fails and says how to enable it per provider", () => {
    const facts = {
      ...compatibleFacts,
      server: { ...server, walLevel: "replica" },
    };
    const wal = result(facts, "wal-level");
    assert.equal(wal.status, "fail");
    assert.match(wal.detail, /wal_level is replica/);
    assert.match(wal.fix!, /ALTER SYSTEM SET wal_level = logical/);
    assert.match(wal.fix!, /rds\.logical_replication = 1/);
    assert.match(wal.fix!, /cloudsql\.logical_decoding = on/);
    assert.ok(!compatible(evaluateCompatibility(facts)));
  });

  void test("the server version must be 15 or newer; untested newer majors warn", () => {
    assert.equal(
      result(
        {
          ...compatibleFacts,
          server: { ...server, versionNum: 140012, version: "14.12" },
        },
        "server-version",
      ).status,
      "fail",
    );
    assert.equal(
      result(
        {
          ...compatibleFacts,
          server: { ...server, versionNum: 150004, version: "15.4" },
        },
        "server-version",
      ).status,
      "pass",
    );
    assert.equal(
      result(
        {
          ...compatibleFacts,
          server: { ...server, versionNum: 190000, version: "19.0" },
        },
        "server-version",
      ).status,
      "warn",
    );
  });

  void test("replication needs a free slot and WAL sender, plus a spare for a replica reset", () => {
    const full = { ...server, maxReplicationSlots: 2, slotsUsed: 2 };
    assert.equal(
      result({ ...compatibleFacts, server: full }, "replication-slots").status,
      "fail",
    );
    const tight = { ...server, maxReplicationSlots: 2, slotsUsed: 1 };
    assert.equal(
      result({ ...compatibleFacts, server: tight }, "replication-slots").status,
      "warn",
    );
    // Zero's own slot already counts as used.
    const running = {
      ...server,
      maxReplicationSlots: 2,
      slotsUsed: 1,
      zeroSlots: 1,
    };
    assert.equal(
      result({ ...compatibleFacts, server: running }, "replication-slots")
        .status,
      "pass",
    );
    const senders = { ...server, maxWalSenders: 1, sendersUsed: 1 };
    assert.equal(
      result({ ...compatibleFacts, server: senders }, "wal-senders").status,
      "fail",
    );
  });

  void test("a role without replication fails with the provider's way to grant it", () => {
    const facts = {
      ...compatibleFacts,
      zero: {
        ...zero,
        replication: false,
        replicationProbe: {
          result: "failed",
          error: {
            code: "42501",
            message: "permission denied to start WAL sender",
          },
        },
      } satisfies ZeroFacts,
    };
    const privilege = result(facts, "replication-privilege");
    assert.equal(privilege.status, "fail");
    assert.match(privilege.fix!, /GRANT rds_replication TO zero/);
    assert.match(privilege.fix!, /ALTER ROLE zero WITH REPLICATION/);
    assert.equal(result(facts, "replication-connection").status, "fail");
  });

  void test("pooled endpoints fail: replication and the migration lock need a direct connection", () => {
    for (const host of [
      "ep-calm-sun-123-pooler.eu-central-1.aws.neon.tech",
      "aws-0-eu-central-1.pooler.supabase.com",
    ]) {
      const facts = {
        ...compatibleFacts,
        connections: [external("migration"), external("zero", { host })],
      };
      const direct = result(facts, "direct-connection");
      assert.equal(direct.status, "fail", host);
      assert.match(direct.fix!, /direct endpoint/);
    }
    // A pooler that refuses the replication startup parameter.
    const refused = result(
      {
        ...compatibleFacts,
        zero: {
          ...zero,
          replicationProbe: {
            result: "failed",
            error: {
              code: "08P01",
              message: "unsupported startup parameter: replication",
            },
          },
        },
      },
      "replication-connection",
    );
    assert.equal(refused.status, "fail");
    assert.match(refused.fix!, /connection pooler/);
    // A pooler at a neutral address is recognised by the session it starts.
    const hidden = result(
      {
        ...compatibleFacts,
        connections: [
          external("migration"),
          external("zero", { proxied: true }),
        ],
      },
      "direct-connection",
    );
    assert.equal(hidden.status, "warn");
    assert.match(hidden.detail, /pooler or proxy sits in between/);
    // The migration runner refuses the same addresses on its own.
    assert.throws(
      () =>
        resolveMigrationConnection({
          DATABASE_MIGRATION_TARGET: "production",
          DATABASE_MIGRATION_URL:
            "postgresql://o:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require",
          DATABASE_MIGRATION_EXPECTED_HOST:
            "aws-0-eu-central-1.pooler.supabase.com",
        }),
      /direct \(unpooled\) connection/,
    );
  });

  void test("connections leaving the server must be encrypted and should verify the certificate", () => {
    const plain = result(
      {
        ...compatibleFacts,
        connections: [
          external("migration", { ssl: false, sslmode: "disable" }),
        ],
      },
      "tls.migration",
    );
    assert.equal(plain.status, "fail");
    const unverified = result(
      {
        ...compatibleFacts,
        connections: [external("migration", { sslmode: "require" })],
      },
      "tls.migration",
    );
    assert.equal(unverified.status, "warn");
    assert.match(unverified.fix!, /DATABASE_CA_FILE/);
    // An encrypted session is not enough: the client must insist on TLS, or
    // a proxy could encrypt only its own hop to the server.
    const proxyHop = result(
      {
        ...compatibleFacts,
        connections: [external("migration", { ssl: true, sslmode: "prefer" })],
      },
      "tls.migration",
    );
    assert.equal(proxyHop.status, "fail");
    assert.match(proxyHop.detail, /does not insist on TLS/);
    // The bundled database on the internal Docker network needs no TLS.
    const bundled = result(
      {
        ...compatibleFacts,
        connections: [
          external("migration", {
            host: "postgres",
            ssl: false,
            sslmode: "disable",
          }),
        ],
      },
      "tls.migration",
    );
    assert.equal(bundled.status, "pass");
  });

  void test("a language collation warns and states the consequences; code point passes", () => {
    const libc = result(
      {
        ...compatibleFacts,
        server: {
          ...server,
          localeProvider: "c",
          collate: "en_US.UTF-8",
          ctype: "en_US.UTF-8",
          locale: undefined,
        },
      },
      "collation",
    );
    assert.equal(libc.status, "warn");
    assert.match(libc.detail, /sort by code point/);
    assert.match(libc.detail, /REINDEX/);
    assert.match(libc.detail, /ranks are unaffected/);
    const c = result(
      {
        ...compatibleFacts,
        server: {
          ...server,
          localeProvider: "c",
          collate: "C",
          locale: undefined,
        },
      },
      "collation",
    );
    assert.equal(c.status, "pass");
  });

  void test("without event triggers Zero's degraded mode is stated, not hidden", () => {
    const running = result(
      {
        ...compatibleFacts,
        zero: { ...zero, eventTriggers: "denied", ddlDetection: false },
      },
      "event-triggers",
    );
    assert.equal(running.status, "warn");
    assert.match(running.detail, /degraded mode/);
    assert.match(running.detail, /rebuilds its replica from scratch/);
    assert.match(
      running.detail,
      /Migrations that change only other tables replicate normally/,
    );
    const beforeStart = result(
      {
        ...compatibleFacts,
        zero: { ...zero, eventTriggers: "denied", ddlDetection: null },
      },
      "event-triggers",
    );
    assert.equal(beforeStart.status, "warn");
    // Degraded mode is a warning: the database is still compatible.
    assert.ok(
      compatible(
        evaluateCompatibility({
          ...compatibleFacts,
          zero: { ...zero, eventTriggers: "denied", ddlDetection: false },
        }),
      ),
    );
  });
});

// ------------------------------------------------------ a real database

// Never use DATABASE_URL: isolated databases and roles, removed afterwards.
const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const names = {
  provider: `lictory_compat_${id}_provider`,
  owner: `lictory_compat_${id}_owner`,
  app: `lictory_compat_${id}_app`,
  zero: `lictory_compat_${id}_zero`,
  ops: `lictory_compat_${id}_ops`,
  database: `lictory_compat_${id}`,
  cvr: `lictory_compat_${id}_zero`,
};
const passwords = Object.fromEntries(
  ["provider", "owner", "app", "zero", "ops"].map((r) => [
    r,
    crypto.randomUUID().replaceAll("-", ""),
  ]),
) as Record<"provider" | "owner" | "app" | "zero" | "ops", string>;

function urlFor(user: string, password: string, database: string) {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

const urls = {
  migration: urlFor(names.owner, passwords.owner, names.database),
  zero: urlFor(names.zero, passwords.zero, names.database),
  zeroCvr: urlFor(names.zero, passwords.zero, names.cvr),
  app: urlFor(names.app, passwords.app, names.database),
  monitoring: urlFor(names.ops, passwords.ops, names.database),
};
const superuser = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let created = false;

void describe("a database set up without a superuser", () => {
  before(async () => {
    // The managed-provider administrator: may create roles and databases and
    // replicate (like Amazon RDS's master user), but is not a superuser.
    await superuser.unsafe(
      `CREATE ROLE ${names.provider} LOGIN CREATEROLE CREATEDB REPLICATION PASSWORD '${passwords.provider}'`,
    );
    created = true;
  });

  after(async () => {
    if (created) {
      for (const database of [names.database, names.cvr])
        await superuser.unsafe(
          `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`,
        );
      for (const role of [
        names.owner,
        names.app,
        names.zero,
        names.ops,
        names.provider,
      ])
        await superuser.unsafe(`DROP ROLE IF EXISTS ${role}`);
    }
    await superuser.end({ timeout: 5 });
  });

  void test("setup, migrations and grants produce a compatible database; missing replication fails", async () => {
    const providerUrl = urlFor(names.provider, passwords.provider, "postgres");
    const report = await setupDatabase(providerUrl, urls);
    assert.ok(
      report.done.some((line) =>
        line.includes(`Created database ${names.database}`),
      ),
      report.done.join("\n"),
    );
    // Idempotent: a second run repairs instead of failing.
    await setupDatabase(providerUrl, urls);

    const owner = postgres(urls.migration, {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      await migrate(drizzle(owner), { migrationsFolder: "drizzle" });
    } finally {
      await owner.end({ timeout: 5 });
    }
    await applyGrants(urls);

    const checks = await checkDatabaseCompatibility(urls);
    const report1 = formatReport(checks);
    assert.ok(compatible(checks), report1);
    const by = (checkId: string) =>
      checks.find((c) => c.id === checkId)?.status;
    assert.equal(by("wal-level"), "pass", report1);
    assert.equal(by("replication-privilege"), "pass", report1);
    assert.equal(by("replication-connection"), "pass", report1);
    assert.equal(by("zero-privileges"), "pass", report1);
    assert.equal(by("zero-read"), "pass", report1);
    assert.equal(by("cvr-database"), "pass", report1);
    assert.equal(by("publication"), "pass", report1);
    assert.equal(by("migration-privileges"), "pass", report1);
    // Not a superuser: PostgreSQL refuses event triggers, so degraded mode.
    assert.equal(by("event-triggers"), "warn", report1);
    for (const password of Object.values(passwords))
      assert.ok(
        !report1.includes(password),
        "a password leaked into the report",
      );

    // The API role reads and writes the application tables.
    const app = postgres(urls.app, { max: 1, onnotice: () => undefined });
    try {
      const [row] = await app<{ ok: boolean }[]>`
        SELECT has_table_privilege('public.work_item', 'INSERT') AS ok`;
      assert.equal(row?.ok, true);
    } finally {
      await app.end({ timeout: 5 });
    }

    await superuser.unsafe(`ALTER ROLE ${names.zero} NOREPLICATION`);
    const without = await checkDatabaseCompatibility(urls);
    assert.ok(!compatible(without));
    const failing = without.filter((c) => c.status === "fail").map((c) => c.id);
    assert.deepEqual(failing.sort(), [
      "replication-connection",
      "replication-privilege",
    ]);

    const wrong = await checkDatabaseCompatibility({
      migration: urlFor(names.owner, "not-the-password", names.database),
    });
    const connection = wrong.find((c) => c.id === "connection.migration");
    assert.equal(connection?.status, "fail");
    assert.match(connection.fix!, /lictory database setup/);
    assert.ok(!formatReport(wrong).includes("not-the-password"));
  });
});
