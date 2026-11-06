#!/bin/sh
# Creates (or re-applies) the database roles of one Lictory environment.
#
# Runs automatically on the first start of an empty data directory
# (/docker-entrypoint-initdb.d), and deploy.sh re-runs it before every
# migration. It is idempotent, so it also rotates passwords or repairs grants:
#
#   docker compose exec -T postgres sh /docker-entrypoint-initdb.d/10-lictory-roles.sh
#
# Roles (docs/operations/deployment.md, "Database roles"):
#   lictory_owner  owns the application database and schema; migrations only
#   lictory_app    API, worker, collaboration: DML on application tables, no DDL
#   zero           zero-cache: superuser (logical replication + event triggers);
#                  owns the separate CVR/change database
#   lictory_ops    backups and monitoring: read-only (pg_read_all_data, pg_monitor)
set -eu

: "${LICTORY_DB_NAME:?}"
: "${LICTORY_OWNER_PASSWORD:?}"
: "${LICTORY_APP_PASSWORD:?}"
: "${ZERO_DB_PASSWORD:?}"
: "${LICTORY_OPS_PASSWORD:?}"
zero_db="${LICTORY_DB_NAME}_zero"

psql() {
  command psql -v ON_ERROR_STOP=1 -X -q --username "${POSTGRES_USER:-postgres}" "$@"
}

psql --dbname postgres \
  -v db="$LICTORY_DB_NAME" -v zero_db="$zero_db" \
  -v owner_password="$LICTORY_OWNER_PASSWORD" \
  -v app_password="$LICTORY_APP_PASSWORD" \
  -v zero_password="$ZERO_DB_PASSWORD" \
  -v ops_password="$LICTORY_OPS_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I', r) FROM unnest(ARRAY['lictory_owner','lictory_app','zero','lictory_ops']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec

ALTER ROLE lictory_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5 PASSWORD :'owner_password';
ALTER ROLE lictory_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 40 PASSWORD :'app_password';
-- Event triggers (precise schema-change replication) require a superuser.
-- Without them zero-cache resets every replica after each migration.
ALTER ROLE zero WITH LOGIN SUPERUSER REPLICATION CONNECTION LIMIT 40 PASSWORD :'zero_password';
ALTER ROLE lictory_ops WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5 PASSWORD :'ops_password';
GRANT pg_read_all_data, pg_monitor TO lictory_ops;
-- A runtime transaction must never sit idle holding the organization lock.
ALTER ROLE lictory_app SET idle_in_transaction_session_timeout = '5min';

SELECT format('CREATE DATABASE %I OWNER lictory_owner', :'db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SELECT format('CREATE DATABASE %I OWNER zero', :'zero_db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'zero_db') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'zero_db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO lictory_app', :'db') \gexec
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM lictory_app', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO lictory_ops, zero', :'db') \gexec
SQL

psql --dbname "$LICTORY_DB_NAME" <<'SQL'
ALTER SCHEMA public OWNER TO lictory_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lictory_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lictory_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO lictory_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lictory_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lictory_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lictory_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lictory_app;

-- zero-cache's DDL event triggers run as the role issuing the DDL, so the
-- migration role needs exactly what they touch. zero-cache creates zero_0 on
-- its first start (and again after a reset); deploy.sh re-runs this script
-- before every migration. Never grant membership in `zero` (a superuser).
DO $$
BEGIN
  IF to_regclass('zero_0."publishedSchema"') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA zero_0 TO lictory_owner;
    GRANT SELECT, UPDATE ON zero_0."publishedSchema" TO lictory_owner;
  END IF;
  -- Zero's push processor records each client's last mutation id (and
  -- mutation results) in the API's own transaction, atomically with the
  -- domain writes. deploy.sh re-runs this script once zero-cache has created
  -- these tables, before the API starts serving pushes.
  IF to_regclass('zero_0.clients') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA zero_0 TO lictory_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON zero_0.clients, zero_0.mutations
      TO lictory_app;
  END IF;
END $$;
SQL

echo "Lictory roles ready for database ${LICTORY_DB_NAME} (Zero state in ${zero_db})."
