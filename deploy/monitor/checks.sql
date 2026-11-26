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
-- Notification queue: events the worker could not fan out, or has not
-- reached (no worker running, or it cannot keep up).
SELECT 'notification_event', format('%s could not be fanned out in the last 24 h (latest: %s)', count(*), max(last_error))
FROM notification_event WHERE failed_at > now() - interval '24 hours'
HAVING count(*) > 0
UNION ALL
SELECT 'notification_event', format('%s waiting for more than 15 min (oldest %s)', count(*), min(created_at))
FROM notification_event
WHERE failed_at IS NULL AND next_attempt_at < now() - interval '15 minutes'
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
-- Items whose last hand-off failed stay failed (with the work waiting under
-- them) until someone retries; this outlives the 24 h window above.
SELECT 'delivery_link', format('%s item(s) whose last hand-off failed more than an hour ago and was not retried (oldest %s); retry them on the project''s Hand-off view', count(*), min(updated_at))
FROM work_item_external_link
WHERE status = 'failed' AND updated_at < now() - interval '1 hour'
HAVING count(*) > 0
UNION ALL
-- Automatic cycles that should have been completed by the worker.
SELECT 'iteration_automation', format('%s automatic cycle(s) past their end by more than 2 h (oldest %s)', count(*), min(i.ends_at))
FROM iteration i
JOIN project p ON p.organization_id = i.organization_id AND p.id = i.project_id
WHERE p.iteration_mode = 'automatic' AND p.archived_at IS NULL
  AND i.state = 'active' AND i.ends_at < now() - interval '2 hours'
HAVING count(*) > 0
UNION ALL
-- Factory: organization runners (servers) that stopped heartbeating. Personal
-- runners are people's own machines, often asleep, and are not alerted on.
SELECT 'runner', format('%s organization runner(s) offline for more than 10 min: %s (revoke a retired runner in Factory -> Runners)',
                        count(*), string_agg(format('%s (last seen %s)', r.name, coalesce(r.last_seen_at, r.registered_at)), ', ' ORDER BY r.name))
FROM runner r
WHERE r.owner_id IS NULL AND r.revoked_at IS NULL
  AND coalesce(r.last_seen_at, r.registered_at) < now() - interval '10 minutes'
HAVING count(*) > 0
UNION ALL
-- Agent sessions waiting for a runner that no online runner can take (no
-- runner with the agent's harness, the requested runner, or the owner's
-- personal runner is online), and sessions assigned but never started.
-- Online matches the Factory page: seen in the last 135 s.
SELECT 'agent_session', format('%s queued for more than 15 min with no online runner that can run them (oldest %s)', count(*), min(q.created_at))
FROM agent_session q
JOIN agent a ON a.id = q.agent_id
WHERE q.status = 'queued' AND q.created_at < now() - interval '15 minutes'
  AND a.kind = 'runner' AND a.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM runner r
    WHERE r.organization_id = q.organization_id AND r.revoked_at IS NULL
      AND r.last_seen_at > now() - interval '135 seconds'
      AND r.harnesses @> jsonb_build_array(jsonb_build_object('id', a.harness))
      AND (q.requested_runner_id IS NULL OR q.requested_runner_id = r.id)
      AND (r.owner_id IS NULL OR r.owner_id = a.owner_id))
HAVING count(*) > 0
UNION ALL
SELECT 'agent_session', format('%s queued for more than 1 h although a capable runner is online: runners are at capacity (oldest %s)', count(*), min(q.created_at))
FROM agent_session q
WHERE q.status = 'queued' AND q.created_at < now() - interval '1 hour'
  AND EXISTS (
    SELECT 1 FROM agent a JOIN runner r ON r.organization_id = q.organization_id
    WHERE a.id = q.agent_id AND a.kind = 'runner' AND a.archived_at IS NULL
      AND r.revoked_at IS NULL AND r.last_seen_at > now() - interval '135 seconds'
      AND r.harnesses @> jsonb_build_array(jsonb_build_object('id', a.harness))
      AND (q.requested_runner_id IS NULL OR q.requested_runner_id = r.id)
      AND (r.owner_id IS NULL OR r.owner_id = a.owner_id))
HAVING count(*) > 0
UNION ALL
SELECT 'agent_session', format('%s assigned to a runner for more than 10 min without starting (oldest %s)', count(*), min(assigned_at))
FROM agent_session
WHERE status = 'assigned' AND assigned_at < now() - interval '10 minutes'
HAVING count(*) > 0
UNION ALL
-- Event deliveries to agents: subscriptions suspended after repeated
-- failures (their person must resume them) and ones failing for an hour.
SELECT 'agent_event_subscription', format('%s %s subscription(s) suspended (latest: %s)', count(*), kind, max(status_reason))
FROM agent_event_subscription
WHERE status = 'suspended'
GROUP BY kind
UNION ALL
SELECT 'agent_event_subscription', format('%s failing to deliver for more than 1 h (latest: %s)', count(*), max(last_error_detail))
FROM agent_event_subscription
WHERE status = 'active' AND failed_since < now() - interval '1 hour'
HAVING count(*) > 0
UNION ALL
-- Slack: installations whose token Slack refused, events and mirrored
-- messages that failed or are not being processed.
SELECT 'slack', format('%s Slack installation(s) need reinstalling: Slack refused the token (latest: %s)', count(*), max(last_error))
FROM slack_installation
WHERE status = 'invalid'
HAVING count(*) > 0
UNION ALL
SELECT 'slack', format('%s Slack event(s) failed in the last 24 h (latest: %s)', count(*), max(last_error))
FROM slack_event
WHERE failed_at > now() - interval '24 hours'
HAVING count(*) > 0
UNION ALL
SELECT 'slack', format('%s Slack event(s) waiting for more than 15 min (oldest %s)', count(*), min(received_at))
FROM slack_event
WHERE processed_at IS NULL AND failed_at IS NULL AND due_at < now() - interval '15 minutes'
  AND (leased_until IS NULL OR leased_until < now())
HAVING count(*) > 0
UNION ALL
SELECT 'slack', format('%s message(s) failed to mirror to Slack in the last 24 h (latest: %s)', count(*), max(last_error))
FROM channel_mirror
WHERE failed_at > now() - interval '24 hours'
HAVING count(*) > 0
UNION ALL
SELECT 'slack', format('%s message(s) waiting to mirror to Slack for more than 15 min', count(*))
FROM channel_mirror
WHERE due_at IS NOT NULL AND failed_at IS NULL AND due_at < now() - interval '15 minutes'
  AND (leased_until IS NULL OR leased_until < now())
HAVING count(*) > 0;
