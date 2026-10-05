#!/bin/sh
set -eu

psql_database() {
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

psql_database -c "
  CREATE TABLE IF NOT EXISTS schema_migration (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
"

for migration in /migrations/[0-9][0-9][0-9]-*.sql; do
  filename=$(basename "$migration")
  if [ "$filename" = "001-schema.sql" ]; then
    continue
  fi
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
