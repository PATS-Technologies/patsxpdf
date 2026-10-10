#!/bin/bash
set -Eeuo pipefail

export PGHOST="${POSTGRES_HOST:-pats-postgres}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGDATABASE="${POSTGRES_DB:-pats}"
app_user="${POSTGRES_USER:-pats}"
app_password="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be configured}"
admin_user="${POSTGRES_ADMIN_USER:-postgres}"
if [[ "$app_user" == "$admin_user" || "$app_user" == postgres ]]; then
  echo "ERROR: The application role must not be the PostgreSQL administrator." >&2
  exit 1
fi
export PGUSER="$admin_user"
export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD:?POSTGRES_ADMIN_PASSWORD must be configured}"

for attempt in {1..30}; do
  if pg_isready --host "$PGHOST" --port "$PGPORT" --dbname "$PGDATABASE" --username "$PGUSER"; then
    break
  fi
  if (( attempt == 30 )); then
    echo "ERROR: PostgreSQL at $PGHOST:$PGPORT did not become ready." >&2
    exit 1
  fi
  sleep 2
done

psql -v ON_ERROR_STOP=1 \
  --set=app_user="$app_user" \
  --set=app_password="$app_password" \
  --set=schema_name="${POSTGRES_SCHEMA:-patsxpdf}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format('ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
SELECT format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', :'schema_name', :'app_user') \gexec
SELECT format('ALTER SCHEMA %I OWNER TO %I', :'schema_name', :'app_user') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', :'schema_name', :'app_user') \gexec
EOSQL
