// What makes a PostgreSQL server compatible with Lictory, checked against the
// server itself. Any PostgreSQL works (the bundled container, your own server,
// a managed service) when these requirements hold; there is no provider list.
// `inspectDatabase` gathers facts over the real connections; the pure
// `evaluateCompatibility` turns them into checks with the exact missing
// requirement and how to fix it. Run by `node database.mjs check` (the migrate
// image), `lictory doctor` and deploy.sh. See docs/operations/external-database.md.
//
// Zero's own requirements come from its documentation
// (https://zero.rocicorp.dev/docs/connecting-to-postgres) and, where the
// documentation is silent, from zero-cache 1.11's source: event triggers need
// the role to create them (SQLSTATE 42501 otherwise, and Zero records
// `zero_0."shardConfig"."ddlDetection" = false`), and degraded mode compares
// only the published tables when replication sees a relation change.
import postgres from "postgres";

import {
  describeUrl,
  isInternalHost,
  poolerReason,
} from "@lictory/core/db/connection-rules";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export type CompatibilityCheck = {
  id: string;
  /** The requirement in one line, as the documentation lists it. */
  requirement: string;
  status: CheckStatus;
  /** What was found. Never contains a connection string or password. */
  detail: string;
  /** What to change, when the status is warn or fail. */
  fix?: string;
};

/** The connections Lictory opens, by purpose. */
export type ConnectionPurpose = "migration" | "zero" | "zeroCvr" | "app";

const purposes: Record<ConnectionPurpose, string> = {
  migration: "migrations (DATABASE_MIGRATION_URL)",
  zero: "zero-cache replication (ZERO_UPSTREAM_DB)",
  zeroCvr: "zero-cache client view records (ZERO_CVR_DB)",
  app: "API and worker (DATABASE_URL)",
};

export type DatabaseUrls = Partial<Record<ConnectionPurpose, string>> & {
  migration: string;
};

type Failure = { code?: string; message: string };

export type ConnectionFacts = {
  purpose: ConnectionPurpose;
  host: string;
  port: number;
  sslmode?: string;
  /** The role in the URL; the server's current_user once connected. */
  user: string;
  error?: Failure;
  /** Whether the session is encrypted (pg_stat_ssl). */
  ssl?: boolean;
  /**
   * The server's process id differs from the one announced when the session
   * started: a pooler or proxy answers in PostgreSQL's place.
   */
  proxied?: boolean;
};

export type ServerFacts = {
  versionNum: number;
  version: string;
  walLevel: string;
  maxReplicationSlots: number;
  slotsUsed: number;
  zeroSlots: number;
  zeroSlotActive: boolean;
  maxWalSenders: number;
  sendersUsed: number;
  maxSlotWalKeepSize: string;
  encoding: string;
  collate: string;
  ctype: string;
  /** pg_database.datlocprovider: b (builtin, 17+), c (libc) or i (ICU). */
  localeProvider: string;
  /** datlocale (17+) or daticulocale (15, 16), for builtin and ICU. */
  locale?: string;
  ownerCanCreateInDatabase: boolean;
  ownerCanCreateInPublic: boolean;
  /** null until the migrations create it. */
  publication: null | { complete: boolean };
};

export type ReplicationProbe =
  | { result: "created" }
  | { result: "timeout" }
  | { result: "failed"; error: Failure };

export type ZeroFacts = {
  superuser: boolean;
  replication: boolean;
  /** Provider roles that grant replication without the attribute. */
  replicationRoles: string[];
  canCreateInDatabase: boolean;
  eventTriggers: "allowed" | "denied" | "unknown";
  /** zero_0."shardConfig"."ddlDetection"; null before zero-cache's first start. */
  ddlDetection: boolean | null;
  /** null while the migrations have not created the published tables. */
  canReadPublished: boolean | null;
  replicationProbe: ReplicationProbe;
};

export type DatabaseFacts = {
  connections: ConnectionFacts[];
  server?: ServerFacts;
  zero?: ZeroFacts;
  cvr?: { canCreateInDatabase: boolean };
};

// ------------------------------------------------------------ requirements

/** Zero's documented floor. */
const minimumVersion = 15;
/** The newest major version Zero's documentation and Lictory have been run on. */
const newestKnownVersion = 18;
/** The version of the bundled database and of CI. */
const testedVersion = 17;

const zeroSlotPattern = String.raw`zero\_0\_%`;
const verifiedModes = new Set(["verify-full", "verify-ca"]);
const encryptedModes = new Set(["require", ...verifiedModes]);

const providerHelp = "docs/operations/external-database.md#providers";
const degradedMode =
  "Zero runs in degraded mode: a migration that changes a replicated table (sync_entity, space_entity, space_reader, the replicated member columns or the lictory_zero publication) halts replication, and zero-cache (ZERO_AUTO_RESET) rebuilds its replica from scratch, so every client resyncs and live updates pause until the copy completes. Migrations that change only other tables replicate normally.";

// --------------------------------------------------------------- evaluation

const check = (
  id: string,
  requirement: string,
  status: CheckStatus,
  detail: string,
  fix?: string,
): CompatibilityCheck => ({
  id,
  requirement,
  status,
  detail,
  ...(fix && status !== "pass" && status !== "skip" ? { fix } : {}),
});

function connectionChecks(connection: ConnectionFacts): CompatibilityCheck[] {
  const what = purposes[connection.purpose];
  const where = `${connection.host}:${connection.port}`;
  if (connection.error)
    return [
      check(
        `connection.${connection.purpose}`,
        `Lictory connects as ${connection.user} for ${what}`,
        "fail",
        `Could not connect to ${where} as ${connection.user}: ${connection.error.message}`,
        connectionFix(connection),
      ),
    ];
  const checks = [
    check(
      `connection.${connection.purpose}`,
      `Lictory connects as ${connection.user} for ${what}`,
      "pass",
      `Connected to ${where} as ${connection.user}.`,
    ),
  ];
  const tls = `tls.${connection.purpose}`;
  const tlsRequirement = `Connections leaving the server are encrypted (${what})`;
  if (isInternalHost(connection.host)) {
    checks.push(
      check(
        tls,
        tlsRequirement,
        "pass",
        `${connection.host} is on this server or its internal Docker network; TLS is not required${connection.ssl ? " (the session is encrypted)" : ""}.`,
      ),
    );
  } else if (!connection.ssl || !encryptedModes.has(connection.sslmode ?? "")) {
    // The server only sees its own hop: a proxy in front of it may encrypt
    // that while this client, without sslmode=require or stronger, does not.
    checks.push(
      check(
        tls,
        tlsRequirement,
        "fail",
        connection.ssl
          ? `sslmode=${connection.sslmode ?? "unset"} does not insist on TLS: the connection to ${where} may travel unencrypted.`
          : `The session to ${where} is not encrypted (sslmode=${connection.sslmode ?? "unset"}).`,
        "Set DATABASE_SSLMODE=verify-full (and DATABASE_CA_FILE when the provider's CA is not publicly trusted). Lictory never sends credentials or data unencrypted to a database outside this server.",
      ),
    );
  } else if (!verifiedModes.has(connection.sslmode ?? "")) {
    checks.push(
      check(
        tls,
        tlsRequirement,
        "warn",
        `Encrypted, but the server's certificate is not verified (sslmode=${connection.sslmode ?? "unset"}): an attacker on the network path could impersonate the database.`,
        "Set DATABASE_SSLMODE=verify-full and, when the provider's CA is not publicly trusted (Amazon RDS, Cloud SQL, Azure, Supabase), DATABASE_CA_FILE to its CA bundle.",
      ),
    );
  } else {
    checks.push(
      check(
        tls,
        tlsRequirement,
        "pass",
        `Encrypted and the server certificate is verified (sslmode=${connection.sslmode}).`,
      ),
    );
  }
  return checks;
}

function connectionFix(connection: ConnectionFacts) {
  const code = connection.error?.code;
  const message = connection.error?.message ?? "";
  if (/no encryption/i.test(message))
    return "The server accepts only encrypted connections: set DATABASE_SSLMODE=verify-full (or require).";
  if (/pg_hba\.conf/i.test(message))
    return `The server does not admit ${connection.user} from this server's address: allow it in the provider's access rules (pg_hba.conf, security group, authorized networks or IP allow list).`;
  if (code === "28P01" || code === "28000")
    return `Create the role ${connection.user} with the password from .env (sudo lictory database setup, or docs/operations/external-database.md#roles), and allow it in the provider's access rules.`;
  if (code === "3D000")
    return "Create the database (sudo lictory database setup) or correct LICTORY_DB_NAME.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "Check DATABASE_HOST: the name does not resolve from this server.";
  if (
    code === "ECONNREFUSED" ||
    code === "CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    /timeout/i.test(message)
  )
    return "Check DATABASE_HOST and DATABASE_PORT, and that the provider's firewall, security group or authorized networks admit this server.";
  if (/self[- ]signed|certificate|unable to verify|altnames/i.test(message))
    return "The server's certificate is not trusted: set DATABASE_CA_FILE to the provider's CA bundle (PEM), and connect with the host name the certificate names.";
  if (/ssl|tls|encryption/i.test(message))
    return "Check DATABASE_SSLMODE: the server and this setting disagree about TLS.";
  return "Check the host, port, role password and TLS settings in .env.";
}

function serverChecks(server: ServerFacts): CompatibilityCheck[] {
  const checks: CompatibilityCheck[] = [];
  const major = Math.floor(server.versionNum / 10000);
  checks.push(
    major < minimumVersion
      ? check(
          "server-version",
          `PostgreSQL ${minimumVersion} or newer`,
          "fail",
          `The server runs PostgreSQL ${server.version}. Zero requires ${minimumVersion} or newer.`,
          `Upgrade the server to PostgreSQL ${testedVersion} (the version Lictory is tested with) or another supported version.`,
        )
      : major > newestKnownVersion
        ? check(
            "server-version",
            `PostgreSQL ${minimumVersion} or newer`,
            "warn",
            `The server runs PostgreSQL ${server.version}, newer than any version Lictory and Zero are known to work with (${minimumVersion} to ${newestKnownVersion}).`,
            "Check Zero's release notes for this version before relying on it, or use an earlier major version.",
          )
        : check(
            "server-version",
            `PostgreSQL ${minimumVersion} or newer`,
            "pass",
            `PostgreSQL ${server.version}${major === testedVersion ? " (the version Lictory is tested with)" : ` (supported; Lictory is tested with ${testedVersion})`}.`,
          ),
  );
  checks.push(
    server.walLevel === "logical"
      ? check(
          "wal-level",
          "wal_level = logical",
          "pass",
          "wal_level is logical.",
        )
      : check(
          "wal-level",
          "wal_level = logical",
          "fail",
          `wal_level is ${server.walLevel}: zero-cache cannot replicate without logical decoding.`,
          `Enable logical replication and restart the server. Your own server: ALTER SYSTEM SET wal_level = logical. Amazon RDS and Aurora: rds.logical_replication = 1 in the (cluster) parameter group. Cloud SQL: the flag cloudsql.logical_decoding = on. AlloyDB: alloydb.logical_decoding = on. Azure Database for PostgreSQL: the server parameter wal_level = logical. Neon: enable logical replication in the project settings. See ${providerHelp}.`,
        ),
  );

  const slotsFree = server.maxReplicationSlots - server.slotsUsed;
  const slotsSpare = slotsFree - (server.zeroSlots > 0 ? 0 : 1);
  const slotsDetail = `max_replication_slots = ${server.maxReplicationSlots}, ${server.slotsUsed} in use (${server.zeroSlots} by Zero).`;
  checks.push(
    slotsSpare < 0
      ? check(
          "replication-slots",
          "A free replication slot for zero-cache, and a spare one",
          "fail",
          `No replication slot is free for zero-cache: ${slotsDetail}`,
          "Raise max_replication_slots (a restart is needed) or drop unused slots (SELECT slot_name, active FROM pg_replication_slots).",
        )
      : slotsSpare === 0
        ? check(
            "replication-slots",
            "A free replication slot for zero-cache, and a spare one",
            "warn",
            `Room for zero-cache's slot but none spare: ${slotsDetail} A replica reset creates its new slot before dropping the old one, so it would fail.`,
            "Raise max_replication_slots by at least one.",
          )
        : check(
            "replication-slots",
            "A free replication slot for zero-cache, and a spare one",
            "pass",
            slotsDetail,
          ),
  );
  const sendersFree = server.maxWalSenders - server.sendersUsed;
  const sendersSpare = sendersFree - (server.zeroSlotActive ? 0 : 1);
  const sendersDetail = `max_wal_senders = ${server.maxWalSenders}, ${server.sendersUsed} in use.`;
  checks.push(
    sendersSpare < 0
      ? check(
          "wal-senders",
          "A free WAL sender for zero-cache, and a spare one",
          "fail",
          `No WAL sender is free for zero-cache: ${sendersDetail}`,
          "Raise max_wal_senders (a restart is needed); read replicas and other replication clients use WAL senders too.",
        )
      : sendersSpare === 0
        ? check(
            "wal-senders",
            "A free WAL sender for zero-cache, and a spare one",
            "warn",
            `Room for zero-cache's connection but none spare: ${sendersDetail} A replica reset briefly needs a second one.`,
            "Raise max_wal_senders by at least one.",
          )
        : check(
            "wal-senders",
            "A free WAL sender for zero-cache, and a spare one",
            "pass",
            sendersDetail,
          ),
  );
  checks.push(
    server.maxSlotWalKeepSize === "-1"
      ? check(
          "slot-wal-limit",
          "A limit on the WAL a stopped zero-cache can retain",
          "warn",
          "max_slot_wal_keep_size is unlimited: while zero-cache is stopped, its slot retains WAL until the database's disk fills.",
          "Set max_slot_wal_keep_size (the bundled database uses 8GB) where your provider allows it, and keep alerts on slot lag (lictory doctor, the monitor). Past the limit Zero resyncs its replica instead of filling the disk.",
        )
      : check(
          "slot-wal-limit",
          "A limit on the WAL a stopped zero-cache can retain",
          "pass",
          `max_slot_wal_keep_size = ${server.maxSlotWalKeepSize}.`,
        ),
  );
  checks.push(
    server.ownerCanCreateInDatabase && server.ownerCanCreateInPublic
      ? check(
          "migration-privileges",
          "The migration role can create schemas, tables and publications",
          "pass",
          "The migration role has CREATE on the database and on schema public.",
        )
      : check(
          "migration-privileges",
          "The migration role can create schemas, tables and publications",
          "fail",
          `The migration role lacks CREATE on ${[
            server.ownerCanCreateInDatabase ? "" : "the database",
            server.ownerCanCreateInPublic ? "" : "schema public",
          ]
            .filter(Boolean)
            .join(" and ")}.`,
          "Make the migration role own the database (CREATE DATABASE … OWNER lictory_owner) or grant it CREATE on the database and on schema public: sudo lictory database setup.",
        ),
  );
  checks.push(
    server.encoding === "UTF8"
      ? check(
          "encoding",
          "UTF8 encoding",
          "pass",
          "The database encoding is UTF8.",
        )
      : check(
          "encoding",
          "UTF8 encoding",
          "fail",
          `The database encoding is ${server.encoding}; Lictory stores Unicode text.`,
          "Create the database with ENCODING 'UTF8' (TEMPLATE template0) and move the data with a dump and restore.",
        ),
  );
  checks.push(collationCheck(server));
  checks.push(
    server.publication === null
      ? check(
          "publication",
          "The lictory_zero publication publishes inserts, updates, deletes and truncates",
          "skip",
          "lictory_zero does not exist yet; the migrations create it.",
        )
      : server.publication.complete
        ? check(
            "publication",
            "The lictory_zero publication publishes inserts, updates, deletes and truncates",
            "pass",
            "lictory_zero publishes every change Zero needs.",
          )
        : check(
            "publication",
            "The lictory_zero publication publishes inserts, updates, deletes and truncates",
            "fail",
            "lictory_zero does not publish every operation; Zero refuses it.",
            "ALTER PUBLICATION lictory_zero SET (publish = 'insert, update, delete, truncate').",
          ),
  );
  return checks;
}

const codePointLocales = new Set(["c", "posix", "c.utf-8", "c.utf8"]);

function collationCheck(server: ServerFacts): CompatibilityCheck {
  const requirement = "Code-point (C) collation";
  const name =
    server.localeProvider === "c"
      ? server.collate
      : (server.locale ?? server.collate);
  const provider =
    { b: "builtin", c: "libc", i: "ICU" }[server.localeProvider] ??
    server.localeProvider;
  if (server.localeProvider !== "i" && codePointLocales.has(name.toLowerCase()))
    return check(
      "collation",
      requirement,
      "pass",
      `The database sorts text by code point (${provider} ${name}), like Zero's replica and browsers.`,
    );
  return check(
    "collation",
    requirement,
    "warn",
    `The database collation is ${provider} ${name}. PostgreSQL then sorts text by that language's rules, while Zero's replica and browsers sort by code point: lists ordered by the server (people pickers, administration pages) can order mixed-case or accented names differently from synced lists. Board and backlog ranks are unaffected.${server.localeProvider === "c" ? " libc collations also change with the server's C library, so text indexes need REINDEX after the provider upgrades it." : ""}`,
    "For a new database, create it with code-point ordering: PostgreSQL 17 and newer LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8' (as the bundled database); 15 and 16 LC_COLLATE 'C' with a UTF-8 LC_CTYPE. An existing database keeps its collation; changing it means a dump and restore.",
  );
}

function zeroChecks(zero: ZeroFacts): CompatibilityCheck[] {
  const checks: CompatibilityCheck[] = [];
  const probe = zero.replicationProbe;
  const deniedSender =
    probe.result === "failed" && probe.error.code === "42501";
  const hasReplication =
    zero.superuser || zero.replication || zero.replicationRoles.length > 0;
  const replicationRequirement =
    "The zero-cache role may replicate (REPLICATION, or the provider's equivalent)";
  if (deniedSender || (!hasReplication && probe.result !== "created"))
    checks.push(
      check(
        "replication-privilege",
        replicationRequirement,
        "fail",
        "The zero-cache role may not start logical replication.",
        `Give it replication: your own server ALTER ROLE zero WITH REPLICATION; Amazon RDS and Aurora GRANT rds_replication TO zero; Cloud SQL, AlloyDB, Azure, Neon and Supabase ALTER ROLE zero WITH REPLICATION as the provider's administrator. sudo lictory database setup tries these. See ${providerHelp}.`,
      ),
    );
  else
    checks.push(
      check(
        "replication-privilege",
        replicationRequirement,
        "pass",
        zero.superuser
          ? "The zero-cache role is a superuser."
          : zero.replication
            ? "The zero-cache role has REPLICATION."
            : zero.replicationRoles.length
              ? `The zero-cache role is a member of ${zero.replicationRoles.join(", ")}.`
              : "The zero-cache role opened a replication connection.",
      ),
    );

  const connectionRequirement =
    "zero-cache opens a direct logical replication connection and creates a slot";
  if (probe.result === "created")
    checks.push(
      check(
        "replication-connection",
        connectionRequirement,
        "pass",
        "Opened a replication connection and created (and dropped) a temporary logical slot.",
      ),
    );
  else if (probe.result === "timeout")
    checks.push(
      check(
        "replication-connection",
        connectionRequirement,
        "warn",
        "Creating a test replication slot did not finish within 20 seconds: PostgreSQL waits for every running transaction before it creates a logical slot, and zero-cache's own slot would wait the same way.",
        "Find long-running transactions (SELECT pid, xact_start, state FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY xact_start) and end them, then check again.",
      ),
    );
  else checks.push(probeFailure(probe.error));

  checks.push(
    zero.canCreateInDatabase
      ? check(
          "zero-privileges",
          "The zero-cache role can create its schemas and its metadata publication",
          "pass",
          "The zero-cache role has CREATE on the application database.",
        )
      : check(
          "zero-privileges",
          "The zero-cache role can create its schemas and its metadata publication",
          "fail",
          "The zero-cache role lacks CREATE on the application database: it cannot create its zero and zero_0 schemas or the publication of its own tables.",
          "GRANT CREATE ON DATABASE <database> TO zero (sudo lictory database setup).",
        ),
  );
  if (zero.canReadPublished !== null)
    checks.push(
      zero.canReadPublished
        ? check(
            "zero-read",
            "The zero-cache role can read the replicated tables",
            "pass",
            "The zero-cache role can read sync_entity and the replicated member columns.",
          )
        : check(
            "zero-read",
            "The zero-cache role can read the replicated tables",
            "fail",
            "The zero-cache role cannot read sync_entity or the replicated member columns, so its initial copy fails.",
            "Apply the grants: deploy.sh applies them before every migration (node database.mjs grants), or run sudo lictory database setup.",
          ),
    );

  const eventRequirement =
    "Event triggers for precise schema-change replication (optional)";
  if (
    zero.ddlDetection === true ||
    (zero.superuser && zero.ddlDetection !== false)
  )
    checks.push(
      check(
        "event-triggers",
        eventRequirement,
        "pass",
        zero.ddlDetection === true
          ? "zero-cache installed its event triggers: schema changes replicate precisely."
          : "The zero-cache role is a superuser: zero-cache installs its event triggers on its first start.",
      ),
    );
  else if (zero.ddlDetection === false)
    checks.push(
      check(
        "event-triggers",
        eventRequirement,
        "warn",
        `zero-cache started without event triggers. ${degradedMode}`,
        zero.eventTriggers === "allowed"
          ? "The role can create event triggers now; zero-cache installs them when its replica is next reset (docs/operations/recovery.md, replica loss)."
          : `Accept degraded mode, or let the role create event triggers (on most managed services, membership in the provider's administrative role; see ${providerHelp}) and then reset the replica.`,
      ),
    );
  else
    checks.push(
      zero.eventTriggers === "allowed"
        ? check(
            "event-triggers",
            eventRequirement,
            "pass",
            "The zero-cache role can create event triggers: zero-cache installs them on its first start.",
          )
        : check(
            "event-triggers",
            eventRequirement,
            "warn",
            `${zero.eventTriggers === "denied" ? "The zero-cache role may not create event triggers (PostgreSQL requires a superuser, or the provider's administrative role)." : "Could not tell whether the zero-cache role may create event triggers."} ${degradedMode}`,
            `Accept degraded mode, or let the role create event triggers (see ${providerHelp}) before zero-cache's first start.`,
          ),
    );
  return checks;
}

function probeFailure(error: Failure): CompatibilityCheck {
  const requirement =
    "zero-cache opens a direct logical replication connection and creates a slot";
  const message = error.message;
  let fix: string;
  if (error.code === "42501")
    fix = "Give the zero-cache role replication (see replication-privilege).";
  else if (error.code === "53400" || /replication slots/i.test(message))
    fix = "Raise max_replication_slots or drop unused slots.";
  else if (
    error.code === "53300" ||
    /wal sender|max_wal_senders/i.test(message)
  )
    fix = "Raise max_wal_senders, or reduce other replication clients.";
  else if (error.code === "55000" || /wal_level/i.test(message))
    fix = "Set wal_level = logical (see wal-level).";
  else if (
    /startup parameter|replication.*not supported|unsupported|pooler|pgbouncer|supavisor|tenant/i.test(
      message,
    ) ||
    error.code === "08P01"
  )
    fix =
      "ZERO_UPSTREAM_DB goes through a connection pooler, which cannot carry logical replication: point DATABASE_HOST and DATABASE_PORT at the database's direct endpoint (Neon: the host without -pooler; Supabase: db.<project>.supabase.co:5432, not the Supavisor pooler).";
  else
    fix =
      "Check that ZERO_UPSTREAM_DB reaches PostgreSQL directly (no pooler or proxy) and that the role may replicate.";
  return check(
    "replication-connection",
    requirement,
    "fail",
    `Could not open a logical replication connection and create a slot: ${message}`,
    fix,
  );
}

function directConnectionCheck(connections: ConnectionFacts[]) {
  const requirement =
    "Migrations and zero-cache use a direct connection, never a pooler";
  const findings = connections
    .filter((c) => c.purpose === "migration" || c.purpose === "zero")
    .map((c) => ({ c, reason: poolerReason(c.host, c.port) }))
    .filter((f) => f.reason);
  if (!findings.length) {
    const proxied = connections.filter(
      (c) => (c.purpose === "migration" || c.purpose === "zero") && c.proxied,
    );
    if (proxied.length)
      return check(
        "direct-connection",
        requirement,
        "warn",
        `${proxied.map((c) => purposes[c.purpose]).join(" and ")}: something other than PostgreSQL started the session (the server's process id differs from the announced one), so a pooler or proxy sits in between. PgBouncer, Supavisor and RDS Proxy break the migration lock and are not supported for zero-cache, even where they pass replication through. Some providers' routing proxies in front of the direct endpoint cause this too and are fine.`,
        "Make sure DATABASE_HOST and DATABASE_PORT name the database's direct endpoint, not a pooler.",
      );
    return check(
      "direct-connection",
      requirement,
      "pass",
      "No pooler between Lictory and PostgreSQL for migrations and zero-cache.",
    );
  }
  const portOnly = findings.every(({ reason }) => reason!.startsWith("port "));
  return check(
    "direct-connection",
    requirement,
    portOnly ? "warn" : "fail",
    findings
      .map(({ c, reason }) => `${purposes[c.purpose]}: ${reason}.`)
      .join(" "),
    "Point DATABASE_HOST and DATABASE_PORT at the direct endpoint: logical replication and the migration runner's session lock do not work through PgBouncer or Supavisor. Only the API's DATABASE_URL may use a session pooler.",
  );
}

/** Every check, in the order the documentation lists the requirements. */
export function evaluateCompatibility(
  facts: DatabaseFacts,
): CompatibilityCheck[] {
  const checks = facts.connections.flatMap(connectionChecks);
  checks.push(directConnectionCheck(facts.connections));
  if (facts.server) checks.push(...serverChecks(facts.server));
  if (facts.zero) checks.push(...zeroChecks(facts.zero));
  else if (!facts.connections.some((c) => c.purpose === "zero"))
    checks.push(
      check(
        "zero",
        "zero-cache's role can replicate",
        "skip",
        "ZERO_UPSTREAM_DB is not set; zero-cache's requirements were not checked.",
      ),
    );
  if (facts.cvr)
    checks.push(
      facts.cvr.canCreateInDatabase
        ? check(
            "cvr-database",
            "zero-cache can create its schemas in its own database",
            "pass",
            "The zero-cache role can create schemas in the client view record database.",
          )
        : check(
            "cvr-database",
            "zero-cache can create its schemas in its own database",
            "fail",
            "The zero-cache role cannot create schemas in the client view record database.",
            "Create <database>_zero owned by the zero-cache role: CREATE DATABASE lictory_zero OWNER zero (sudo lictory database setup).",
          ),
    );
  return checks;
}

// ---------------------------------------------------------------- inspection

function failure(error: unknown, secret: string): Failure {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error";
  const message = secret ? raw.split(secret).join("****") : raw;
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : undefined;
  return { ...(code ? { code } : {}), message };
}

const clientOptions = {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 2,
  onnotice: () => undefined,
  connection: { application_name: "lictory-database-check" },
} as const;

async function withClient<T>(
  url: string,
  run: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(url, clientOptions);
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function identify(sql: postgres.Sql) {
  const result = await sql<
    { user: string; ssl: boolean | null; pid: number }[]
  >`
    SELECT current_user AS user, pg_backend_pid() AS pid,
           (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`;
  const row = result[0]!;
  // PostgreSQL announces its process id in BackendKeyData; PgBouncer,
  // Supavisor and other poolers announce their own.
  const announced = (result as unknown as { state?: { pid?: number } }).state
    ?.pid;
  return { ...row, proxied: announced !== undefined && announced !== row.pid };
}

async function serverFacts(sql: postgres.Sql): Promise<ServerFacts> {
  const [row] = await sql<
    (Omit<ServerFacts, "publication"> & { publication: boolean | null })[]
  >`
    SELECT current_setting('server_version_num')::int AS "versionNum",
           current_setting('server_version') AS version,
           current_setting('wal_level') AS "walLevel",
           current_setting('max_replication_slots')::int AS "maxReplicationSlots",
           (SELECT count(*) FROM pg_replication_slots)::int AS "slotsUsed",
           (SELECT count(*) FROM pg_replication_slots
             WHERE slot_name LIKE ${zeroSlotPattern})::int AS "zeroSlots",
           EXISTS (SELECT 1 FROM pg_replication_slots
             WHERE slot_name LIKE ${zeroSlotPattern} AND active) AS "zeroSlotActive",
           current_setting('max_wal_senders')::int AS "maxWalSenders",
           (SELECT count(*) FROM pg_stat_replication)::int AS "sendersUsed",
           current_setting('max_slot_wal_keep_size') AS "maxSlotWalKeepSize",
           pg_encoding_to_char(d.encoding) AS encoding,
           d.datcollate AS collate,
           d.datctype AS ctype,
           d.datlocprovider::text AS "localeProvider",
           coalesce(to_jsonb(d) ->> 'datlocale', to_jsonb(d) ->> 'daticulocale') AS locale,
           has_database_privilege(current_database(), 'CREATE') AS "ownerCanCreateInDatabase",
           has_schema_privilege('public', 'CREATE') AS "ownerCanCreateInPublic",
           (SELECT pubinsert AND pubupdate AND pubdelete AND pubtruncate
              FROM pg_publication WHERE pubname = 'lictory_zero') AS publication
      FROM pg_database d WHERE d.datname = current_database()`;
  const { publication, locale, ...rest } = row!;
  return {
    ...rest,
    ...(locale ? { locale } : {}),
    publication: publication === null ? null : { complete: publication },
  };
}

/** Rolled back: creates nothing. Answers whether CREATE EVENT TRIGGER is allowed. */
async function probeEventTriggers(
  sql: postgres.Sql,
): Promise<ZeroFacts["eventTriggers"]> {
  const name = `lictory_check_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const rollback = new Error("rollback");
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        CREATE SCHEMA ${name};
        CREATE FUNCTION ${name}.probe() RETURNS event_trigger
          LANGUAGE plpgsql AS $$ BEGIN END $$;
        CREATE EVENT TRIGGER ${name} ON ddl_command_end
          EXECUTE FUNCTION ${name}.probe();`);
      throw rollback;
    });
  } catch (error) {
    if (error === rollback) return "allowed";
    if ((error as { code?: string }).code === "42501") {
      // Denied at CREATE SCHEMA says nothing about event triggers.
      return /event trigger/i.test((error as Error).message)
        ? "denied"
        : "unknown";
    }
    return "unknown";
  }
  return "unknown";
}

/**
 * Opens a logical replication connection (as zero-cache does) and creates a
 * temporary slot, dropped when the connection closes. Proves the role may
 * replicate, a slot and a WAL sender are free and no pooler is in the way.
 */
async function probeReplication(
  url: string,
  secret: string,
): Promise<ReplicationProbe> {
  const sql = postgres(url, {
    ...clientOptions,
    fetch_types: false,
    connection: { ...clientOptions.connection, replication: "database" },
  } as postgres.Options<Record<string, never>>);
  const name = `lictory_check_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const created = sql
      .unsafe(
        `CREATE_REPLICATION_SLOT ${name} TEMPORARY LOGICAL pgoutput (SNAPSHOT 'nothing')`,
      )
      .simple()
      .then(() => ({ result: "created" }) as const);
    const timeout = new Promise<{ result: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ result: "timeout" }), 20_000);
    });
    return await Promise.race([created, timeout]);
  } catch (error) {
    return { result: "failed", error: failure(error, secret) };
  } finally {
    clearTimeout(timer);
    await sql.end({ timeout: 0 });
  }
}

async function zeroFacts(
  sql: postgres.Sql,
  url: string,
  secret: string,
): Promise<ZeroFacts> {
  const [row] = await sql<
    {
      superuser: boolean;
      replication: boolean;
      replicationRoles: string[];
      canCreateInDatabase: boolean;
      shardConfig: boolean;
      published: boolean;
    }[]
  >`
    SELECT r.rolsuper AS superuser,
           r.rolreplication AS replication,
           ARRAY(SELECT g.rolname::text FROM pg_roles g
                  WHERE g.rolname IN ('rds_replication')
                    AND pg_has_role(current_user, g.oid, 'MEMBER')) AS "replicationRoles",
           has_database_privilege(current_database(), 'CREATE') AS "canCreateInDatabase",
           to_regclass('zero_0."shardConfig"') IS NOT NULL AS "shardConfig",
           to_regclass('public.sync_entity') IS NOT NULL
             AND to_regclass('public.member') IS NOT NULL AS published
      FROM pg_roles r WHERE r.rolname = current_user`;
  const facts = row!;
  let ddlDetection: boolean | null = null;
  if (facts.shardConfig) {
    const [config] = await sql<{ ddlDetection: boolean }[]>`
      SELECT "ddlDetection" FROM zero_0."shardConfig"`;
    ddlDetection = config?.ddlDetection ?? null;
  }
  let canReadPublished: boolean | null = null;
  if (facts.published) {
    const [read] = await sql<{ ok: boolean }[]>`
      SELECT has_table_privilege('public.sync_entity', 'SELECT')
         AND has_any_column_privilege('public.member', 'SELECT') AS ok`;
    canReadPublished = read?.ok ?? false;
  }
  return {
    superuser: facts.superuser,
    replication: facts.replication,
    replicationRoles: facts.replicationRoles,
    canCreateInDatabase: facts.canCreateInDatabase,
    eventTriggers: facts.canCreateInDatabase
      ? await probeEventTriggers(sql)
      : "unknown",
    ddlDetection,
    canReadPublished,
    replicationProbe: await probeReplication(url, secret),
  };
}

/** Connects with every given URL and gathers the facts the checks need. */
export async function inspectDatabase(
  urls: DatabaseUrls,
): Promise<DatabaseFacts> {
  const facts: DatabaseFacts = { connections: [] };
  const order: ConnectionPurpose[] = ["migration", "zero", "zeroCvr", "app"];
  for (const purpose of order) {
    const url = urls[purpose];
    if (!url) continue;
    const { host, port, sslmode, user } = describeUrl(url);
    const secret = decodeURIComponent(new URL(url).password);
    const connection: ConnectionFacts = {
      purpose,
      host,
      port,
      user,
      ...(sslmode ? { sslmode } : {}),
    };
    facts.connections.push(connection);
    try {
      await withClient(url, async (sql) => {
        const identity = await identify(sql);
        connection.user = identity.user;
        connection.ssl = identity.ssl ?? false;
        connection.proxied = identity.proxied;
        if (purpose === "migration") facts.server = await serverFacts(sql);
        if (purpose === "zero") facts.zero = await zeroFacts(sql, url, secret);
        if (purpose === "zeroCvr") {
          const [row] = await sql<{ ok: boolean }[]>`
            SELECT has_database_privilege(current_database(), 'CREATE') AS ok`;
          facts.cvr = { canCreateInDatabase: row?.ok ?? false };
        }
      });
    } catch (error) {
      connection.error = failure(error, secret);
    }
  }
  return facts;
}

export async function checkDatabaseCompatibility(urls: DatabaseUrls) {
  return evaluateCompatibility(await inspectDatabase(urls));
}

/** Whether any check failed (warnings and skipped checks do not fail). */
export function compatible(checks: readonly CompatibilityCheck[]) {
  return !checks.some((c) => c.status === "fail");
}

/** The report for a terminal or a log: one line per check, fixes indented. */
export function formatReport(checks: readonly CompatibilityCheck[]) {
  const mark: Record<CheckStatus, string> = {
    pass: "ok  ",
    warn: "warn",
    fail: "FAIL",
    skip: "skip",
  };
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`${mark[c.status]} ${c.id}: ${c.detail}`);
    if (c.fix) lines.push(`     fix: ${c.fix}`);
  }
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  lines.push(
    failed
      ? `${failed} requirement(s) not met, ${warned} warning(s). See docs/operations/external-database.md.`
      : `Compatible${warned ? `, with ${warned} warning(s)` : ""}.`,
  );
  return lines.join("\n");
}
