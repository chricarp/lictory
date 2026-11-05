# Backups and recovery

PostgreSQL is the only state that must survive. Everything else is either in
another system (file bytes in object storage, email with your provider) or
rebuildable from PostgreSQL (Zero's replica, client view records and change
log; container images in the registry).

| Data                           | Protection                                                     | Loss means                   |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------- |
| Application database           | Nightly encrypted logical backup (`BACKUP_TARGET`); pre-deploy | Restore (below)              |
| Zero replica, CVRs, change log | Not backed up                                                  | Automatic resync             |
| File bytes (files bucket)      | Provider durability; object versioning or a daily copy (below) | Missing attachments          |
| Secrets (`.env`)               | Password manager, never in backups or Git                      | Re-create; see notes per key |
| Images                         | The image registry, by digest                                  | Rebuild the tag from Git     |

## Objectives

- **RPO 24 hours** for a total loss of the server and its disks (nightly
  backup). Deployments with migrations add a pre-deploy backup, so a failed
  release never loses more than the time since that backup.
- **RTO about 1 hour** for a new server: provisioning (≈10 min), restore
  (seconds to minutes for a small database; plan ≈1 min per GB), first Zero
  sync and DNS propagation.

Continuous WAL archiving (pgBackRest or WAL-G) would bring RPO to minutes, at
the cost of another moving part to operate and test. Add it when the data
volume or customer commitments justify it; until then provider disk snapshots
(if enabled) give a crash-consistent copy between nightly backups.

## Nightly backups

`lictory-backup@<env>.timer` runs `backup.sh` in the ops image at 02:30 UTC:

1. `pg_dump` (custom format, zstd) inside a `REPEATABLE READ` snapshot that
   also records exact row counts per table and the applied migrations (the
   manifest). Zero's schemas (`zero`, `zero_*`) are excluded.
2. `pg_restore --list` proves the archive is readable.
3. Dump and manifest are encrypted with [age](https://age-encryption.org) to
   `BACKUP_AGE_RECIPIENTS`. Only public keys live on the server; the private
   identity is kept offline (password manager plus a printed copy), so a
   server or storage compromise does not expose old backups.
4. Store them at `BACKUP_TARGET`, then verify a download checksum of the
   stored object.
5. Retention: 7 daily, 4 weekly (Sundays), 6 monthly (1st) and the last 10
   pre-deploy and manual backups. `latest.json` names the newest backup.
6. Success pings `BACKUP_PING_URL`; failure (including a configuration error)
   pings `<url>/fail` and posts to `ALERT_WEBHOOK_URL`. The monitor alerts when
   the last success is older than 30 hours.

Manual backup: `/srv/lictory/bin/lictory-backup production manual`.

### Where backups go

| `BACKUP_TARGET` | Settings                                                                                                                                                            | Notes                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `s3` (default)  | `BACKUP_BUCKET`, `BACKUP_S3_PROVIDER` (rclone provider, default `Cloudflare`), `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, keys                                       | Any S3-compatible storage: Cloudflare R2, AWS S3 (`AWS`, empty endpoint), MinIO (`Minio`), Backblaze, Wasabi, Ceph        |
| `local`         | `BACKUP_LOCAL_PATH`: a host directory owned by uid 70 (the ops image's `postgres` user), mode 0700                                                                  | A NAS mount or second disk. Unset keeps backups in the server's own `backups` volume: not a disaster-recovery copy        |
| `rclone`        | `BACKUP_RCLONE_REMOTE`: an rclone [connection string](https://rclone.org/docs/#connection-strings) such as `:sftp,host=nas.internal,user=lictory,key_pem=…:backups` | SFTP, WebDAV, SMB, Azure Blob, Google Cloud Storage and any other rclone backend; obscure passwords with `rclone obscure` |
| `none`          | none                                                                                                                                                                | Backups disabled: no timer work, no pre-deploy backup (logged), no backup-freshness alert. Use your own database backups  |

Keep at least one copy off the server. Give the backup storage its own
credentials (never the files bucket's) that can write and delete only there.

**Unencrypted backups.** `BACKUP_AGE_RECIPIENTS=none` stores dumps and
manifests unencrypted (`.dump`, `.manifest.json`). Every run prints a warning:
whoever can read the backup storage can read every organization's data. Use it
only for storage you would trust with the database itself; an empty value
fails the backup instead of silently skipping encryption. Restore drills take
`none` instead of an identity file.

**Protecting history.** Make the backup storage refuse deletes and overwrites
by the server's credential where it can, so a stolen credential cannot erase
history: on Cloudflare R2 a bucket lock on the `<environment>/daily/`,
`<environment>/weekly/` and `<environment>/monthly/` prefixes (for example
`production/daily/`), on AWS S3 or MinIO object lock (governance mode)
retention, on a NAS snapshots or an append-only share. Add a lifecycle rule or
snapshot expiry deleting objects older than 200 days as a safety net. Keep any
retention lock shorter than the script's retention or pruning fails visibly.

### Without the bundled tooling

The backup format is plain `pg_dump`. If you already back up PostgreSQL
(pgBackRest, WAL-G, managed snapshots, a corporate backup agent), set
`BACKUP_TARGET=none` and back up the application database with it, for
example:

```sh
lictory-compose production exec -T postgres pg_dump -U postgres --format=custom \
  --exclude-schema='zero' --exclude-schema='zero_*' lictory >lictory.dump
```

Restore such a dump with `pg_restore` into an empty database created as in
[PostgreSQL loss](#postgresql-loss-or-corruption), skipping event triggers and
the `_zero` publications (as `restore.sh` does for the bundled backups). Zero's
replica and client view records never need a backup.

## Restore drill

Run monthly, after changing backups or migrations, and before relying on a
new server:

```sh
/srv/lictory/bin/lictory-restore-drill production /path/to/age-identity.txt latest
# unencrypted backups (BACKUP_AGE_RECIPIENTS=none):
/srv/lictory/bin/lictory-restore-drill production none latest
```

It starts a throwaway PostgreSQL with the Lictory roles in a separate Compose
project and network (it cannot reach the live database), fetches the backup
from the environment's `BACKUP_TARGET` (a local target is mounted read-only)
and decrypts it, verifies its checksum, restores it into an empty
database, then checks: identical migration history, identical row count for
every table, the `lictory_zero` publication and the runtime role's privileges,
the release's migration runner reporting "up to date", and the release's API
becoming ready against the restored data. Everything is removed afterwards.
Delete the temporary copy of the identity file when done.

## PostgreSQL loss or corruption

Use `lictory restore`; it does every step below, checks the backup before
it stops anything, keeps the current database in a Docker volume, and puts
it back if the restore fails:

```sh
sudo lictory backup list                                # pick a backup
sudo lictory restore /path/to/age-identity.txt latest   # or a key from the list
```

By hand, when the CLI cannot run (replace `production` with the environment;
`/srv/lictory/bin/lictory-compose` is the Compose wrapper):

1. Stop everything, PostgreSQL included, and remove its container so the
   volume is free: `lictory-compose production stop proxy api worker
zero-cache postgres`, then `lictory-compose production rm -f postgres
zero-cache`.
2. Keep the damaged data for analysis. Docker cannot rename a volume: copy
   it into a new one (or take a disk snapshot):

   ```sh
   docker volume create lictory-production_postgres_data-damaged
   docker run --rm --entrypoint cp -v lictory-production_postgres_data:/from:ro \
     -v lictory-production_postgres_data-damaged:/to postgres:17-alpine -a /from/. /to/
   ```

3. Create an empty cluster: `docker volume rm lictory-production_postgres_data
lictory-production_zero_replica`, then `lictory-compose production up -d
--wait postgres` (roles and databases are created on first start).
4. Restore into the empty application database with the ops image. The
   superuser password is in `.env`; export it into this shell first:

   ```sh
   export POSTGRES_SUPERUSER_PASSWORD="$(sudo lictory config get POSTGRES_SUPERUSER_PASSWORD)"
   lictory-compose production run --rm --no-deps -T \
     -v /path/to/age-identity.txt:/run/age-identity:ro \
     -e AGE_IDENTITY_FILE=/run/age-identity -e RESTORE_PGHOST=postgres \
     -e RESTORE_PGUSER=postgres -e RESTORE_PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" \
     -e RESTORE_DATABASE=lictory ops sh -c 'restore.sh latest && verify.sh'
   ```

   `restore.sh` refuses a database that already has tables. Zero's event
   triggers and internal publications are skipped; zero-cache recreates them.

5. Start everything: `sudo lictory config apply` (it starts PostgreSQL, then
   re-activates the active release). zero-cache resyncs, and clients
   reconnect and resync from the restored state. Changes clients queued
   against the lost history go through the server's normal validation and
   may be rejected.
6. Writes after the backup are lost. Tell affected organizations what window
   was lost. Jira items exported in that window still exist in Jira; check
   their links before the next export.

## Zero replica loss or a wedged replica

The replica is always safe to delete; PostgreSQL is untouched.

```sh
lictory-compose production stop zero-cache
docker run --rm -v lictory-production_zero_replica:/data alpine sh -c 'rm -f /data/*'
lictory-compose production up -d --wait zero-cache
```

zero-cache copies the published tables (a few seconds for thousands of rows,
roughly minutes per million `sync_entity` rows) and clients resync when they
reconnect. Its first start after a resync creates a new replication slot and
leaves the old one inactive; the monitor reports it as orphaned. Drop it once
the new slot is active:

```sql
SELECT slot_name, active FROM pg_replication_slots;
SELECT pg_drop_replication_slot('zero_0_a');  -- the inactive one
```

## Replication slot and WAL growth

A logical slot keeps WAL until zero-cache confirms it. If zero-cache stops for
long, WAL accumulates. `max_slot_wal_keep_size` (8 GB) caps this: past it
PostgreSQL invalidates the slot and zero-cache resyncs its replica on the next
start, instead of the disk filling up and stopping the database. The monitor
alerts at 2 GB of slot lag and 6 GB of `pg_wal`. Raise the cap only together
with the disk size. If the disk is nearly full, fix zero-cache or drop the
stale slot (above) before anything else.

## Worker crashes and restarts

The worker is restarted by Docker (`restart: unless-stopped`). Jobs are rows
in PostgreSQL with leases (AI runs, the notification email outbox, delivery
exports) and are retried after a lease expires; external calls are idempotent
(email idempotency keys, Jira create attempts recorded before the call). A
crash therefore delays work but does not lose or duplicate it. The monitor
reports work stuck past its expected time. Inspect with
`lictory-compose production logs --tail 200 worker`.

## Server loss

1. Create a new server and provision it ([deployment](deployment.md)).
2. Restore `.env` from the password manager (new database passwords are fine;
   keep `BETTER_AUTH_SECRET` to keep sessions valid and
   `DELIVERY_CREDENTIALS_KEY` to keep Jira credentials readable).
3. Prepare the active release (`deploy.sh production prepare < release.env`,
   from the GitHub deployment journal or the release workflow) and restore the
   database as above, before activating.
4. Activate the release, point DNS at the new address, check certificates,
   then run the post-launch checks.

## File storage

Attachment bytes are in the files bucket, not in database backups.
Deletes are rare by design (removed attachments are moved to a
`removed-files/` prefix and retained, not deleted), so the main risks are a mistaken bulk delete or a leaked
token. Use object versioning where the provider offers it; otherwise copy the
bucket daily to a second private bucket with its own read-only source token
(for example `rclone copy`, never `sync`, so deletions do not propagate). Do
not expire the shared key prefix with a lifecycle rule: it holds live objects.
