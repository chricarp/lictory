# Backups and recovery

PostgreSQL is the only state that must survive. Everything else is either in
another system (file bytes in R2, email in Resend) or rebuildable from
PostgreSQL (Zero's replica, client view records and change log; container
images in the registry).

| Data                           | Protection                                                      | Loss means                   |
| ------------------------------ | --------------------------------------------------------------- | ---------------------------- |
| Application database           | Nightly encrypted logical backup off-server; pre-deploy backups | Restore (below)              |
| Zero replica, CVRs, change log | Not backed up                                                   | Automatic resync             |
| File bytes (R2 files bucket)   | R2 durability; object versioning or a lifecycle copy (below)    | Missing attachments          |
| Secrets (`.env`)               | Password manager, never in backups or Git                       | Re-create; see notes per key |
| Images                         | GHCR, by digest                                                 | Rebuild the tag from Git     |

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
   server or bucket compromise does not expose old backups.
4. Upload to a dedicated private R2 bucket with its own bucket-scoped token,
   then a download checksum of the stored object.
5. Retention: 7 daily, 4 weekly (Sundays), 6 monthly (1st) and the last 10
   pre-deploy and manual backups. `latest.json` names the newest backup.
6. Success pings `BACKUP_PING_URL`; failure pings `<url>/fail` and posts to
   `ALERT_WEBHOOK_URL`. The monitor alerts when the last success is older than
   30 hours.

Manual backup: `/srv/lictory/bin/lictory-backup production manual`.

Harden the bucket with a retention lock (R2 bucket locks) on the `daily/`,
`weekly/` and `monthly/` prefixes so a stolen backup token cannot erase
history, and a lifecycle rule deleting objects older than 200 days as a safety
net. Keep the retention lock shorter than the script's retention or pruning
fails visibly.

## Restore drill

Run monthly, after changing backups or migrations, and before relying on a
new server:

```sh
/srv/lictory/bin/lictory-restore-drill production /path/to/age-identity.txt latest
```

It starts a throwaway PostgreSQL with the Lictory roles in a separate Compose
project and network (it cannot reach the live database), downloads and
decrypts the backup, verifies its checksum, restores it into an empty
database, then checks: identical migration history, identical row count for
every table, the `lictory_zero` publication and the runtime role's privileges,
the release's migration runner reporting "up to date", and the release's API
becoming ready against the restored data. Everything is removed afterwards.
Delete the temporary copy of the identity file when done.

## PostgreSQL loss or corruption

1. Stop writers: `lictory-compose production stop api worker zero-cache`.
2. Keep the damaged volume if possible (`docker volume` rename or a disk
   snapshot) for analysis.
3. Create an empty cluster: remove or rename the `postgres_data` volume, then
   `lictory-compose production up -d postgres` (roles and databases are
   created on first start).
4. Restore into the empty application database with the ops image:

   ```sh
   lictory-compose production run --rm --no-deps -T \
     -v /path/to/age-identity.txt:/run/age-identity:ro \
     -e AGE_IDENTITY_FILE=/run/age-identity -e RESTORE_PGHOST=postgres \
     -e RESTORE_PGUSER=postgres -e RESTORE_PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" \
     -e RESTORE_DATABASE=lictory ops sh -c 'restore.sh latest && verify.sh'
   ```

   `restore.sh` refuses a database that already has tables. Zero's event
   triggers and internal publications are skipped; zero-cache recreates them.

5. Delete the Zero replica (`zero_replica` volume) and start everything:
   `deploy.sh production activate <current version>`. zero-cache resyncs and
   clients reconnect and resync from the restored state. Changes clients
   queued against the lost history go through the server's normal validation
   and may be rejected.
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

Attachment bytes are in the R2 files bucket, not in database backups.
Deletes are rare by design (attachments are retained because revisions may
reference them), so the main risks are a mistaken bulk delete or a leaked
token. Use object versioning where the provider offers it; otherwise copy the
bucket daily to a second private bucket with its own read-only source token
(for example `rclone copy`, never `sync`, so deletions do not propagate). Do
not expire the shared key prefix with a lifecycle rule: it holds live objects.
