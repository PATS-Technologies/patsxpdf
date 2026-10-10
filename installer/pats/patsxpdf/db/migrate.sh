#!/bin/sh
set -eu

export PGHOST="${POSTGRES_HOST:-pats-postgres}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGDATABASE="${POSTGRES_DB:-pats}"
export PGUSER="${POSTGRES_USER:-pats}"
export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be configured}"
export PGOPTIONS="-c search_path=${POSTGRES_SCHEMA:-patsxpdf}"

psql_database() {
  psql -v ON_ERROR_STOP=1 "$@"
}

psql_database -c "
  CREATE TABLE IF NOT EXISTS schema_migration (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  INSERT INTO schema_migration(filename)
  SELECT '001-schema.sql'
  WHERE to_regclass('app_user') IS NOT NULL
  ON CONFLICT DO NOTHING;
"

for migration in /migrations/[0-9][0-9][0-9]-*.sql; do
  filename=$(basename "$migration")
  applied=$(psql_database -Atc "SELECT 1 FROM schema_migration WHERE filename = '$filename'")
  if [ "$applied" = "1" ]; then
    continue
  fi

  {
    printf 'BEGIN;\n'
    cat "$migration"
    printf "\nINSERT INTO schema_migration(filename) VALUES ('%s');\nCOMMIT;\n" "$filename"
  } | psql_database
done
