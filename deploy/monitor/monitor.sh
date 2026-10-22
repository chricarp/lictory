#!/usr/bin/env bash
# Five-minute health check for one environment (run by deploy/bin/lictory-monitor
# from a systemd timer). Collects problems, then:
#   - pings MONITOR_PING_URL (healthy) or MONITOR_PING_URL/fail (problems), so a
#     dead server is noticed by the absence of pings;
#   - posts to ALERT_WEBHOOK_URL when the set of problems changes, again every
#     6 hours while it persists, and once when everything recovers.
#
# Inputs from the host wrapper: HOST_REPORT (disk usage and container states,
# one problem per line, may be empty).
set -Euo pipefail

: "${LICTORY_ENVIRONMENT:?}"
state_file=/backups/monitor-state.json
problems=()
add() { problems+=("$1: $2"); }

while IFS= read -r line; do
  [ -n "$line" ] && add host "$line"
done <<<"${HOST_REPORT:-}"

# Database checks (connection failures are a problem too).
if output=$(psql -X -A -t -F ' | ' -v ON_ERROR_STOP=1 \
  -v slot_lag_bytes="${MONITOR_SLOT_LAG_ALERT_BYTES:-2147483648}" \
  -v wal_bytes="${MONITOR_WAL_ALERT_BYTES:-6442450944}" \
  -f /opt/lictory/sql/checks.sql 2>&1); then
  while IFS= read -r line; do
    [ -n "$line" ] && add "${line%% | *}" "${line#* | }"
  done <<<"$output"
else
  add postgres "checks failed: $(echo "$output" | head -n 3 | tr '\n' ' ')"
fi

# Service endpoints on the internal network.
probe() { # probe <name> <url>
  curl -fsS -m 10 -o /dev/null "$2" 2>/dev/null || add "$1" "$2 is not healthy"
}
probe api http://api:3002/readyz
probe zero-cache http://zero-cache:4848/keepalive

# Backup freshness (written by backup.sh on this volume).
max_age=$(( ${MONITOR_BACKUP_MAX_AGE_HOURS:-30} * 3600 ))
if [ -f /backups/last-success.json ]; then
  completed=$(jq -r .completed_at /backups/last-success.json)
  age=$(( $(date -u +%s) - $(date -u -d "$completed" +%s) ))
  [ "$age" -le "$max_age" ] || add backup "last successful backup $completed ($((age / 3600)) h ago)"
else
  add backup "no successful backup recorded on this server"
fi

now=$(date -u +%s)
summary=$(printf '%s\n' "${problems[@]+"${problems[@]}"}" | sort)
digest=$(printf '%s' "$summary" | sha256sum | cut -d' ' -f1)
previous_digest=""
previous_sent=0
if [ -f "$state_file" ]; then
  previous_digest=$(jq -r '.digest // ""' "$state_file")
  previous_sent=$(jq -r '.sent // 0' "$state_file")
fi

notify() {
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  jq -cn --arg m "[lictory ${LICTORY_ENVIRONMENT}] $1" '{text:$m,content:$m}' |
    curl -fsS -m 10 --retry 2 -H 'Content-Type: application/json' --data-binary @- \
      "$ALERT_WEBHOOK_URL" >/dev/null || echo "Alert webhook failed" >&2
}
ping() {
  [ -n "${MONITOR_PING_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 2 --data-raw "$2" "${MONITOR_PING_URL}$1" >/dev/null || true
}

sent=$previous_sent
if [ ${#problems[@]} -gt 0 ]; then
  echo "Problems:"
  echo "$summary"
  if [ "$digest" != "$previous_digest" ] || [ $((now - previous_sent)) -ge 21600 ]; then
    notify "$(printf '%s problem(s):\n%s' "${#problems[@]}" "$summary")"
    sent=$now
  fi
  ping /fail "$summary"
else
  echo "Healthy."
  if [ -n "$previous_digest" ] && [ "$previous_digest" != "$(printf '' | sha256sum | cut -d' ' -f1)" ]; then
    notify "recovered: all checks pass"
  fi
  ping "" "healthy"
  sent=0
fi
jq -cn --arg digest "$digest" --argjson sent "$sent" --argjson checked "$now" \
  '{digest:$digest,sent:$sent,checked:$checked}' >"$state_file"
[ ${#problems[@]} -eq 0 ]
