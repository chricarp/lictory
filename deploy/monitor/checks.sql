-- Operational checks for deploy/monitor/monitor.sh. Each row is one problem:
--   check | detail
-- An empty result means healthy. Thresholds are deliberately coarse; the
-- monitor runs every five minutes. Variables: :slot_lag_bytes, :wal_bytes.

-- The WAL directory's size, where this role may list it (pg_monitor; an
-- external database's provider may not grant it and watches its own disk).
SELECT has_function_privilege('pg_ls_waldir()', 'EXECUTE') AS can_list_wal \gset
\if :can_list_wal
SELECT 'wal_size', format('pg_wal holds %s', pg_size_pretty(sum(size)))
FROM pg_ls_waldir()
HAVING sum(size) > :wal_bytes;
\endif

-- Zero's logical replication slot: lag, lost or abandoned slots retain WAL.
SELECT 'replication_slot',
       format('%s: %s behind, wal_status=%s, active=%s', slot_name,
              pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)),
              wal_status, active)
FROM pg_replication_slots
WHERE slot_type = 'logical'
  AND (wal_status IN ('unreserved', 'lost')
       OR pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) > :slot_lag_bytes
       OR (NOT active AND pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) > 268435456))
UNION ALL
SELECT 'replication_slot', 'no logical replication slot exists: zero-cache is not replicating'
WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_type = 'logical')
UNION ALL
-- After a replica resync zero-cache replicates through a new slot and leaves
-- the old one behind, retaining WAL until max_slot_wal_keep_size invalidates it.
SELECT 'replication_slot', format('%s is orphaned (another slot is active); drop it: SELECT pg_drop_replication_slot(%L)', s.slot_name, s.slot_name)
FROM pg_replication_slots s
WHERE s.slot_type = 'logical' AND NOT s.active
  AND EXISTS (SELECT 1 FROM pg_replication_slots a WHERE a.slot_type = 'logical' AND a.active)
UNION ALL
-- AI reviews: failures in the last day, runs stuck in running or queued.
SELECT 'ai_run', format('%s failed in the last 24 h', count(*))
FROM ai_run WHERE status = 'failed' AND coalesce(completed_at, created_at) > now() - interval '24 hours'
HAVING count(*) > 0
UNION ALL
SELECT 'ai_run', format('%s running for more than 30 min (oldest %s)', count(*), min(started_at))
FROM ai_run WHERE status = 'running' AND started_at < now() - interval '30 minutes'
HAVING count(*) > 0
UNION ALL
SELECT 'ai_run', format('%s queued for more than 15 min', count(*))
FROM ai_run WHERE status = 'queued' AND created_at < now() - interval '15 minutes'
HAVING count(*) > 0
UNION ALL
-- Notification email outbox.
SELECT 'notification_email', format('%s failed permanently in the last 24 h (latest: %s)', count(*), max(last_error))
FROM notification_email WHERE status = 'failed' AND created_at > now() - interval '24 hours'
HAVING count(*) > 0
UNION ALL
SELECT 'notification_email', format('%s pending past their retry time by more than 30 min', count(*))
FROM notification_email
WHERE status = 'pending' AND next_attempt_at < now() - interval '30 minutes'
  AND (lease_until IS NULL OR lease_until < now())
HAVING count(*) > 0
UNION ALL
-- Delivery exports: partial/failed outcomes and runs without a live lease.
SELECT 'delivery_publication', format('%s %s in the last 24 h', count(*), status)
FROM delivery_publication
WHERE status IN ('partial', 'failed') AND finished_at > now() - interval '24 hours'
GROUP BY status
UNION ALL
SELECT 'delivery_publication', format('%s running for more than 30 min without a live lease', count(*))
FROM delivery_publication
WHERE status = 'running' AND created_at < now() - interval '30 minutes'
  AND (lease_until IS NULL OR lease_until < now())
HAVING count(*) > 0
UNION ALL
-- Automatic cycles that should have been completed by the worker.
SELECT 'iteration_automation', format('%s automatic cycle(s) past their end by more than 2 h (oldest %s)', count(*), min(i.ends_at))
FROM iteration i
JOIN project p ON p.organization_id = i.organization_id AND p.id = i.project_id
WHERE p.iteration_mode = 'automatic' AND p.archived_at IS NULL
  AND i.state = 'active' AND i.ends_at < now() - interval '2 hours'
HAVING count(*) > 0;
