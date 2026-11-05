# External and managed PostgreSQL

Lictory runs on any PostgreSQL that meets its requirements: the bundled
container (the default), your own server, or a managed service such as Amazon
RDS, Aurora PostgreSQL, Cloud SQL, AlloyDB, Azure Database for PostgreSQL,
Neon, Supabase or Crunchy Bridge. There is no list of supported providers.
_Compatible_ means the requirements below hold, and Lictory checks them
against the server itself:

```sh
sudo lictory database check      # every requirement, what is missing and how to fix it
```

`deploy.sh` runs the same check before it migrates an external database and
stops, naming each missing requirement, before anything changes. `lictory
doctor` includes it. The check is `database.mjs check` in the release's
migrate image (`scripts/database.ts`, `packages/core/src/db/compatibility.ts`);
from a checkout, `bun run db:compatibility` runs it with
`DATABASE_MIGRATION_URL`, `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB` and `DATABASE_URL`.

Zero's requirements come from
[its documentation](https://zero.rocicorp.dev/docs/connecting-to-postgres)
and, where that is silent, from the zero-cache source (1.11) and tests against
real servers ([how it was verified](#how-this-was-verified)).

## Requirements

| Check                          | Requirement                                                                                                                                   | When it is missing                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server-version`               | PostgreSQL 15 or newer (Zero's minimum). Lictory is tested with 17; 18 is the newest version known to work. Newer majors warn                 | Fails below 15                                                                                                                                               |
| `wal-level`                    | `wal_level = logical`                                                                                                                         | Fails: zero-cache cannot replicate. The fix names each provider's setting                                                                                    |
| `replication-privilege`        | The `zero` role may replicate: `REPLICATION`, or the provider's equivalent (`rds_replication`). Never a superuser requirement                 | Fails                                                                                                                                                        |
| `replication-connection`       | zero-cache opens a logical replication connection and creates a slot. The check creates a temporary slot, dropped when it disconnects         | Fails, with the reason (privilege, no slot or WAL sender, `wal_level`, a pooler)                                                                             |
| `replication-slots`            | A free slot for zero-cache and one spare: a replica reset creates its new slot before it drops the old one                                    | Fails without a free slot; warns without a spare                                                                                                             |
| `wal-senders`                  | A free WAL sender for zero-cache and one spare                                                                                                | Fails without a free one; warns without a spare                                                                                                              |
| `slot-wal-limit`               | `max_slot_wal_keep_size` is set (the bundled database uses 8GB)                                                                               | Warns: a stopped zero-cache retains WAL until the disk fills                                                                                                 |
| `direct-connection`            | Migrations and zero-cache connect directly, never through PgBouncer, Supavisor or RDS Proxy                                                   | Fails for known pooler addresses (`-pooler.` hosts, `pooler.supabase.com`, `pgbouncer`); warns for ports 6432 and 6543 and for a pooler at any other address |
| `tls.<connection>`             | Connections that leave the server are encrypted: `sslmode=require` at least, `verify-full` recommended                                        | Fails when unencrypted or when `sslmode` does not insist on TLS; warns for `require` (certificate not verified)                                              |
| `migration-privileges`         | `lictory_owner` has CREATE on the database and on schema `public`: it creates tables, the `drizzle` schema and the `lictory_zero` publication | Fails                                                                                                                                                        |
| `zero-privileges`, `zero-read` | `zero` has CREATE on the database (its `zero` and `zero_0` schemas and the publication of its own tables) and can read the replicated tables  | Fails                                                                                                                                                        |
| `cvr-database`                 | `zero` owns `<database>_zero`, its client view records and change log                                                                         | Fails                                                                                                                                                        |
| `publication`                  | `lictory_zero` publishes inserts, updates, deletes and truncates (the migrations create it)                                                   | Fails; skipped before the first migration                                                                                                                    |
| `encoding`                     | UTF8                                                                                                                                          | Fails                                                                                                                                                        |
| `collation`                    | Code-point (C) collation                                                                                                                      | Warns, with the consequences ([below](#collation))                                                                                                           |
| `event-triggers`               | Optional: the `zero` role may create event triggers                                                                                           | Warns: degraded mode ([below](#degraded-modes))                                                                                                              |

The checks never print a connection string or a password.

## Degraded modes

These work, with consequences you accept knowingly. The check reports each
one as a warning.

**No event triggers (the usual case on managed services).** PostgreSQL lets
only superusers create event triggers; most managed services give no
superuser, and Lictory's role setup does not ask for one. zero-cache then logs
_Proceeding in degraded mode_ and records `ddlDetection = false`. Zero 1.11
compares only the published tables when it sees a schema change, so:

- a migration that changes a replicated table (`sync_entity`, the replicated
  `member` columns, or the `lictory_zero` publication) halts replication, and
  zero-cache (with `ZERO_AUTO_RESET`, as Compose runs it) exits, restarts and
  copies the replicated tables again. Every client resyncs, and live updates
  pause until the copy completes (seconds for thousands of rows, minutes per
  million `sync_entity` rows);
- a migration that changes only other tables replicates normally.

Most migrations change other tables. For precise replication of every change,
the `zero` role must be able to create event triggers: on your own server,
make it a superuser as the bundled database does; on a managed service, grant
it the provider's administrative role where that role may create event
triggers ([providers](#providers)). zero-cache installs its triggers on its
first start, or on the next replica reset if the privilege comes later
([replica loss](recovery.md#zero-replica-loss-or-a-wedged-replica)).

**Unverified TLS (`DATABASE_SSLMODE=require`).** Traffic is encrypted, but
nothing proves the server is the database: someone on the network path could
impersonate it. Use `verify-full`, with `DATABASE_CA_FILE` when the
provider's CA is not publicly trusted.

**Unlimited slot WAL.** Without `max_slot_wal_keep_size`, a stopped
zero-cache makes the server keep WAL until its disk fills. With a limit, the
slot is invalidated past it and zero-cache resyncs instead. Keep the
monitor's slot-lag alerts on either way.

**No `pg_monitor` for `lictory_ops`.** Monitoring skips the WAL directory
size; the provider's disk metrics cover it.

**No Lictory backups.** [Backups](#backups) are the provider's.

### Collation

The bundled database sorts text by code point (`C.UTF-8`, builtin), like
Zero's replica and browsers. In a database with a language collation
(`en_US.UTF-8`, ICU), PostgreSQL sorts by that language's rules. Lists the
server orders (people pickers, administration pages) can then order mixed-case
or accented names differently from synced lists. Board and backlog order is
unaffected: ranks are lowercase base-36 strings, which sort the same either way. libc
collations also change when the server's C library changes, so text indexes
need `REINDEX` after such an upgrade (providers announce these).
`lictory database setup` creates new databases with code-point ordering:
PostgreSQL 17 and newer `LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`,
15 and 16 `LC_COLLATE 'C'` with the server's UTF-8 `LC_CTYPE`. An existing
database keeps its collation; changing it means a dump and restore.

## Configuration

In the environment's `.env` (`lictory install` writes them):

| Setting            | Meaning                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `LICTORY_DATABASE` | `external`; empty or `bundled` runs the bundled container                                                                               |
| `DATABASE_HOST`    | The database's direct endpoint, never a pooler                                                                                          |
| `DATABASE_PORT`    | `5432` by default                                                                                                                       |
| `DATABASE_SSLMODE` | `verify-full` (default) or `require`                                                                                                    |
| `DATABASE_CA_FILE` | Optional CA bundle (PEM) on the server, for providers whose CA is not publicly trusted; `install` copies it to `<home>/database-ca.pem` |
| `LICTORY_DB_NAME`  | The application database (`lictory`); zero-cache's is `<name>_zero`                                                                     |

The role passwords are the bundled ones (`LICTORY_OWNER_PASSWORD`,
`LICTORY_APP_PASSWORD`, `ZERO_DB_PASSWORD`, `LICTORY_OPS_PASSWORD`, generated
as hex). They are written into connection URLs, so replacements must be
URL-safe.

With `LICTORY_DATABASE=external`, `lictory-compose` adds
`deploy/compose.external-database.yaml` to the release's compose file:

- the `postgres` service never starts, and nothing depends on it;
- the API and worker (`lictory_app`), migrations (`lictory_owner`, transport
  `tls`, [migrations](migrations.md)), zero-cache (`zero`) and monitoring
  (`lictory_ops`) connect to `DATABASE_HOST` with `DATABASE_SSLMODE`; Node
  trusts `DATABASE_CA_FILE` through `NODE_EXTRA_CA_CERTS`;
- `migrate`, zero-cache and the `database` tool join the `egress` network,
  since the database is no longer on the internal one. Restrict outbound
  traffic to the database at your firewall or security group if you need to.

The override needs Docker Compose 2.24.4 (`!override`); `install` checks it.

What each connection may be:

| Connection                      | Direct?                    | Notes                                                                      |
| ------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `ZERO_UPSTREAM_DB` (zero-cache) | Always direct              | Holds the replication slot (Zero's documentation)                          |
| `ZERO_CVR_DB`, `ZERO_CHANGE_DB` | Direct, as Compose sets it | Zero allows a session pooler here; Lictory uses the direct endpoint        |
| `DATABASE_MIGRATION_URL`        | Always direct              | Session advisory lock and session settings; transaction poolers break them |
| `DATABASE_URL` (API, worker)    | Direct, as Compose sets it | A pooler needs named prepared statements; not configurable through install |

## Roles

The same four roles as the bundled database, without a superuser:

| Role            | Privileges on an external database                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `lictory_owner` | Owns the application database (CREATE on it and on `public`); DDL through migrations only                                            |
| `lictory_app`   | CONNECT; DML on application tables and Zero's `zero_0.clients`/`mutations`; `idle_in_transaction_session_timeout = 5min`             |
| `zero`          | CONNECT and CREATE on the application database, `REPLICATION` (or `rds_replication`), SELECT on application tables; owns `<db>_zero` |
| `lictory_ops`   | CONNECT, SELECT on application tables; `pg_monitor` where the provider lets the administrator grant it                               |

Create them once with an administrator connection: a role that may create
roles and databases (CREATEROLE and CREATEDB), such as the RDS master user or
Cloud SQL's `postgres`. The connection is used for that command only and never
stored:

```sh
sudo LICTORY_DATABASE_ADMIN_URL='postgresql://admin:…@db.example.com:5432/postgres?sslmode=verify-full' \
  lictory database setup        # or without the variable: it asks, input hidden
```

`lictory install` asks for the same connection (or takes
`LICTORY_DATABASE_ADMIN_URL`) and passes it to `deploy.sh` for that run only.
Setup is idempotent: running it again sets the passwords from `.env` and
repairs privileges. It:

1. creates or updates the four roles (`LOGIN`, a connection limit, the
   password), leaving attributes at their defaults, since naming
   `NOSUPERUSER` and the like needs privileges an administrator may lack;
2. gives `zero` `REPLICATION`, or `rds_replication` where `ALTER ROLE` is
   refused, and grants `pg_monitor` to `lictory_ops` where allowed (each a
   warning if refused);
3. on PostgreSQL 16 and newer, grants the administrator `SET` (without
   inheritance) on `lictory_owner` and `zero`: their creator administers them
   but may not act as them, which `CREATE DATABASE … OWNER` and the grants
   below need;
4. creates `<db>` owned by `lictory_owner` and `<db>_zero` owned by `zero`
   (`TEMPLATE template0`, UTF8, code-point collation), leaving existing ones
   and warning when another role owns them;
5. revokes `PUBLIC` access to both databases and grants CONNECT (and CREATE
   for `zero`) as their owners;
6. applies the object grants.

Object grants are applied by the roles that own the objects, never by an
administrator: `lictory_owner` grants on its tables (with default privileges
for future tables), `zero` grants the API its `zero_0` tables once zero-cache
created them. `deploy.sh` runs `database.mjs grants` before every migration
and after zero-cache starts, as it re-runs the bundled role script.

Where only a web console reaches the database (no network path from the
server to the administrator account), run the same statements there by hand,
with the passwords from `.env` (PostgreSQL 16+ shown; omit the two `GRANT …
TO CURRENT_USER` lines on 15):

```sql
CREATE ROLE lictory_owner LOGIN CONNECTION LIMIT 5 PASSWORD '<LICTORY_OWNER_PASSWORD>';
CREATE ROLE lictory_app LOGIN CONNECTION LIMIT 40 PASSWORD '<LICTORY_APP_PASSWORD>';
CREATE ROLE zero LOGIN CONNECTION LIMIT 40 PASSWORD '<ZERO_DB_PASSWORD>';
CREATE ROLE lictory_ops LOGIN CONNECTION LIMIT 5 PASSWORD '<LICTORY_OPS_PASSWORD>';
ALTER ROLE zero WITH REPLICATION;            -- Amazon RDS and Aurora: GRANT rds_replication TO zero;
GRANT pg_monitor TO lictory_ops;             -- optional
ALTER ROLE lictory_app SET idle_in_transaction_session_timeout = '5min';
GRANT lictory_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT zero TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
CREATE DATABASE lictory OWNER lictory_owner TEMPLATE template0 ENCODING 'UTF8'
  LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8';    -- 15 and 16: LC_COLLATE 'C' LC_CTYPE 'en_US.UTF-8'
CREATE DATABASE lictory_zero OWNER zero TEMPLATE template0 ENCODING 'UTF8'
  LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8';
SET ROLE lictory_owner;
REVOKE ALL ON DATABASE lictory FROM PUBLIC;
GRANT CONNECT ON DATABASE lictory TO lictory_app, lictory_ops;
GRANT CONNECT, CREATE ON DATABASE lictory TO zero;
SET ROLE zero;
REVOKE ALL ON DATABASE lictory_zero FROM PUBLIC;
RESET ROLE;
```

`deploy.sh` applies the object grants itself. The bundled database keeps
`deploy/postgres/10-lictory-roles.sh`, which runs as its local superuser and
makes `zero` a superuser for event triggers ([deployment](deployment.md#database-roles)).

## Install and upgrade

```sh
sudo LICTORY_DATABASE_ADMIN_URL='postgresql://…' lictory install \
  --database external --database-host db.example.com \
  [--database-port 5432] [--database-sslmode verify-full] [--database-ca-file /root/provider-ca.pem]
```

Interactively, `install` asks in its **Database** step. The first release
then checks the requirements before it migrates; when they fail, nothing is
migrated and the failed requirements are listed. Fix them (or run `lictory
database setup`) and run `install` again. `lictory upgrade` works the same in
both modes: every migration is preceded by the check and the grants.

An installation keeps the database it started with: `install` refuses to
switch an active environment between bundled and external.

### Moving an installation

Moving data is a migration, not a setting, and it is not scripted:

1. Create the roles and databases on the new server (`lictory database setup`
   against a separate, not-yet-active environment, or the SQL above).
2. Stop the API, worker and zero-cache; `lictory backup` (bundled) gives a
   `pg_dump` of the application database. Restore it into the new database as
   `lictory_owner` with `pg_restore --no-owner --role=lictory_owner`, skipping
   event triggers and Zero's publications as `deploy/backup/restore.sh` does.
3. Set `LICTORY_DATABASE=external` and the `DATABASE_*` settings in `.env` by
   hand, then run `lictory install`; zero-cache rebuilds its replica.

## Backups

Lictory takes no backups of an external database: `lictory backup` refuses,
the nightly timer reports a skip, and `deploy.sh` takes no pre-deploy backup.
Use the provider's automated backups with point-in-time recovery, retained as
your recovery objectives require ([recovery](recovery.md#objectives)); before
an upgrade you can take a manual snapshot.

To restore, use the provider's point-in-time recovery or snapshot (into the
same host name, or update `DATABASE_HOST`), then run `lictory install`:
zero-cache resyncs from the restored data. If the restore changes the server,
the replication slot is gone and zero-cache creates a new one. `lictory
restore` refuses for an external database. Jira items exported in the lost
window still exist in Jira.

A `pg_dump` of the application database as `lictory_owner`, excluding the
`zero` and `zero_*` schemas, remains possible as an extra copy.

## Providers

Every provider below is **not verified**: nobody has run Lictory against it
yet. The settings are from the providers' and Zero's documentation; where
neither says, the entry says so and `lictory database check` gives the
answer. To verify one, run the [verification](#verifying-a-provider) and
record the summary here.

| Provider                                       | Logical replication                                                                                                | `zero` may replicate                                                                | Connection                                                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amazon RDS for PostgreSQL                      | Parameter group `rds.logical_replication = 1`, reboot                                                              | `GRANT rds_replication TO zero` (setup does it)                                     | The instance endpoint, not RDS Proxy. `verify-full` with the AWS CA bundle (`global-bundle.pem`) as `DATABASE_CA_FILE`                                            | Set `max_slot_wal_keep_size` in the parameter group. Event triggers: not stated for non-superusers; the check tells                                                                                                                                                                                                                                                                     |
| Aurora PostgreSQL                              | Cluster parameter group `rds.logical_replication = 1`, reboot                                                      | `GRANT rds_replication TO zero`                                                     | The cluster (writer) endpoint, never a reader. AWS CA bundle as above                                                                                             | Zero lists Aurora from 15.6                                                                                                                                                                                                                                                                                                                                                             |
| Google Cloud SQL                               | Flag `cloudsql.logical_decoding = on` (not `wal_level`), restart                                                   | `ALTER ROLE zero WITH REPLICATION` as `postgres`                                    | The instance address. Per-instance server CAs name the instance, not its address: `verify-full` needs a CA mode with DNS names, else `require` with the server CA | Event triggers: not stated; the check tells                                                                                                                                                                                                                                                                                                                                             |
| AlloyDB for PostgreSQL                         | Flag `alloydb.logical_decoding = on`, restart                                                                      | `ALTER ROLE zero WITH REPLICATION` as `postgres`                                    | The primary instance address; the server CA from the cluster                                                                                                      | Not mentioned by Zero                                                                                                                                                                                                                                                                                                                                                                   |
| Azure Database for PostgreSQL, flexible server | Server parameter `wal_level = logical`, restart                                                                    | `ALTER ROLE zero WITH REPLICATION` as the administrator                             | Port 5432, not the built-in PgBouncer on 6432. Certificates chain to public roots: `verify-full` without a CA file                                                | Raise `max_replication_slots`/`max_wal_senders` if other consumers use them. Event triggers: not stated; the check tells                                                                                                                                                                                                                                                                |
| Neon                                           | Enable logical replication in the project settings                                                                 | Not stated; the check tells                                                         | The direct host, without `-pooler`. Publicly trusted certificates: `verify-full` without a CA file                                                                | The compute never suspends while zero-cache is connected (Zero's documentation), so it is billed continuously                                                                                                                                                                                                                                                                           |
| Supabase                                       | Already logical                                                                                                    | `ALTER ROLE zero WITH REPLICATION` as `postgres`                                    | The direct connection `db.<project>.supabase.co:5432`, never Supavisor (`*.pooler.supabase.com`, ports 5432/6543). Supabase's CA as `DATABASE_CA_FILE`            | The direct host is IPv6 only without the IPv4 add-on; Docker's default networks are IPv4. Zero does not support Supabase's high-availability failover. Event triggers: Zero documents them for the `postgres` role from 15.8.1.083, and notes that Supabase fires none for `ALTER PUBLICATION`. Setup creates a separate `lictory` database, outside the one Supabase's Data API serves |
| Crunchy Bridge                                 | Not stated; the check tells                                                                                        | Not stated; the check tells                                                         | The cluster host, not a pooler port                                                                                                                               | Crunchy Bridge advertises superuser access: making `zero` a superuser gives precise schema replication, as bundled                                                                                                                                                                                                                                                                      |
| Your own server                                | `wal_level = logical` in `postgresql.conf`, restart; `max_replication_slots` and `max_wal_senders` with room for 2 | `ALTER ROLE zero WITH REPLICATION` (or `SUPERUSER`, as bundled, for event triggers) | `ssl = on`, `hostssl` rules for the four roles; `verify-full` with your CA as `DATABASE_CA_FILE`                                                                  | Set `max_slot_wal_keep_size`. Without TLS, use the bundled container instead                                                                                                                                                                                                                                                                                                            |

## Verifying a provider

From a checkout, on a machine that reaches the provider and runs Docker, with
a disposable administrator connection (never a database that holds data):

```sh
bun install
DATABASE_ADMIN_URL='postgresql://admin:…@<host>:5432/postgres?sslmode=verify-full' \
  NODE_EXTRA_CA_CERTS=/path/to/provider-ca.pem \
  bun scripts/verify-external-database.ts
```

It creates `lictory_pgverify_<random>` roles and databases with the role
setup, runs every check, applies the migrations as `lictory_owner`, starts the
pinned zero-cache image against it, changes an unreplicated table and then a
replicated one to observe how schema changes replicate, and drops everything
it created (`VERIFY_KEEP=1` keeps it). Record its summary, the date, the
server version and the provider's plan in the table above, and change the
entry from _not verified_ only when every requirement passed and zero-cache
reached healthy.

Then, on a test installation against the same provider:

1. `sudo lictory install --database external …` reaches `/readyz`, and
   `lictory doctor` shows no failures.
2. Sign in, create a project and a specification in two browsers: edits
   appear live in both.
3. `sudo lictory upgrade` (or re-run `install` on a newer nightly) migrates
   without errors; with degraded event triggers, the browsers reconnect after
   a migration that changes a replicated table.
4. Restart the database (a provider maintenance or failover): zero-cache
   reconnects without a manual step.
5. Restore a point-in-time copy into a new instance, point `DATABASE_HOST` at
   it, `lictory install`: the data is there and zero-cache resynced.

## How this was verified

On PostgreSQL 17.11 containers, without any managed provider:

- a non-superuser administrator (CREATEROLE, CREATEDB, REPLICATION, like an RDS
  master user) ran the role setup; migrations ran as `lictory_owner`; all
  requirements passed except event triggers (`packages/core/src/db/compatibility.test.ts`
  runs this against an isolated database);
- zero-cache 1.11.3 completed its initial sync as the `REPLICATION`-only role
  over `sslmode=verify-full` with a private CA through `NODE_EXTRA_CA_CERTS`,
  logged degraded mode, kept replicating after a change to an unreplicated
  table, and reset (exit for auto-reset, then a clean resync) after a column
  was added to `sync_entity`;
- `wal_level = replica` failed `wal-level` and `replication-connection`;
  PgBouncer 1.26 in transaction mode passed logical replication through, and
  was reported by `direct-connection` (process id mismatch) and by
  `tls.*` (the client did not insist on TLS).
